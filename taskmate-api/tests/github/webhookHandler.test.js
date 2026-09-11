jest.mock('../../models/github.model', () => ({
    beginDelivery: jest.fn(),
    finishDelivery: jest.fn(),
    failDelivery: jest.fn(),
    deleteInstallation: jest.fn(),
    setInstallationSuspended: jest.fn(),
    deleteRepository: jest.fn(),
    upsertRepository: jest.fn(),
    applyPullRequest: jest.fn(),
    findTaskByBranch: jest.fn(),
}));
jest.mock('../../helpers/transaction', () => ({ withTransaction: jest.fn(), isFkViolation: jest.fn() }));
jest.mock('../../models/tasks.model', () => ({ completeTask: jest.fn() }));
jest.mock('../../services/AnalyticsIntegration', () => ({ onTaskCompletion: jest.fn() }));

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const githubModel = require('../../models/github.model');
const transaction = require('../../helpers/transaction');
const tasksModel = require('../../models/tasks.model');
const AnalyticsIntegration = require('../../services/AnalyticsIntegration');
const { githubApp } = require('../../services/github/githubApp');
const { createWebhookHandler } = require('../../services/github/webhookHandler');
const { signWebhookPayload } = require('../../services/github/webhookSignature');
const { useFakeGitHub, tokenRoute } = require('./helpers/fakeGitHub');

const SECRET = 'whsec-test';
const DELIVERY = '6c3f1a2e-0b9d-11f0-8a3e-0242ac120002';
const TX = { id: 'tx' };

const buildApp = (options) => {
    const app = express();
    app.post('/api/github/webhook', express.raw({ type: '*/*', limit: '1mb' }), createWebhookHandler(options));
    return app;
};

const send = (app, event, payload, { secret = SECRET, delivery = DELIVERY, signature } = {}) => {
    const body = Buffer.from(JSON.stringify(payload));
    return request(app)
        .post('/api/github/webhook')
        .set('Content-Type', 'application/json')
        .set('X-GitHub-Event', event)
        .set('X-GitHub-Delivery', delivery)
        .set('X-Hub-Signature-256', signature || signWebhookPayload(body, secret))
        // A string is sent byte-for-byte; superagent would JSON-encode a Buffer.
        .send(body.toString('utf8'));
};

const prPayload = ({ merged = true, base = 'main', headRepoId = 500, action = 'closed' } = {}) => ({
    action,
    installation: { id: 77 },
    repository: { id: 500, name: 'demo', full_name: 'octo/demo', default_branch: 'main', private: true },
    pull_request: {
        id: 9001,
        number: 12,
        title: 'Add auth',
        draft: false,
        head: { ref: 'tm/add-auth-abcdef12', repo: headRepoId === null ? null : { id: headRepoId } },
        base: { ref: base },
        created_at: '2026-09-10T10:00:00Z',
        updated_at: '2026-09-11T10:00:00Z',
        closed_at: merged ? '2026-09-11T10:00:00Z' : null,
        merged_at: merged ? '2026-09-11T10:00:00Z' : null,
    },
});

let previousSecret;
beforeAll(() => {
    previousSecret = process.env.GITHUB_WEBHOOK_SECRET;
    process.env.GITHUB_WEBHOOK_SECRET = SECRET;
});
afterAll(() => {
    if (previousSecret === undefined) delete process.env.GITHUB_WEBHOOK_SECRET;
    else process.env.GITHUB_WEBHOOK_SECRET = previousSecret;
});

beforeEach(() => {
    transaction.withTransaction.mockImplementation(async (fn) => fn(TX));
    transaction.isFkViolation.mockImplementation((err) => Boolean(err && err.number === 547));
    githubModel.beginDelivery.mockResolvedValue({ duplicate: false });
    githubModel.finishDelivery.mockResolvedValue(undefined);
    githubModel.failDelivery.mockResolvedValue(undefined);
    githubModel.applyPullRequest.mockResolvedValue({ state: 'merged', changed: true, becameMerged: true });
    githubModel.findTaskByBranch.mockResolvedValue({ tid: 'T1', gid: 'G1' });
    tasksModel.completeTask.mockResolvedValue({ status: 'completed' });
    AnalyticsIntegration.onTaskCompletion.mockResolvedValue({ success: true });
});

const sendRaw = (app, event, rawText) => request(app)
    .post('/api/github/webhook')
    .set('Content-Type', 'application/json')
    .set('X-GitHub-Event', event)
    .set('X-GitHub-Delivery', DELIVERY)
    .set('X-Hub-Signature-256', signWebhookPayload(Buffer.from(rawText), SECRET))
    .send(rawText);

describe('signature', () => {
    test('invalid signature → 401 and nothing recorded', async () => {
        const res = await send(buildApp(), 'pull_request', prPayload(), { secret: 'wrong' });
        expect(res.status).toBe(401);
        expect(githubModel.beginDelivery).not.toHaveBeenCalled();
    });

    test('secret unset → 401', async () => {
        delete process.env.GITHUB_WEBHOOK_SECRET;
        try {
            const res = await send(buildApp(), 'ping', { zen: 'x' });
            expect(res.status).toBe(401);
        } finally {
            process.env.GITHUB_WEBHOOK_SECRET = SECRET;
        }
    });

    test('missing delivery id → 400', async () => {
        const res = await send(buildApp(), 'pull_request', prPayload(), { delivery: 'not-a-guid' });
        expect(res.status).toBe(400);
    });
});

test.each([['null'], ['[]'], ['"text"'], ['42']])('a validly signed %s body → 400, no crash', async (raw) => {
    const res = await sendRaw(buildApp(), 'pull_request', raw);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(githubModel.beginDelivery).not.toHaveBeenCalled();
});

test('beginDelivery failure → error response, no unhandled rejection', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    githubModel.beginDelivery.mockRejectedValue(new Error('db down'));
    const res = await send(buildApp(), 'pull_request', prPayload());
    expect(res.status).toBe(500);
    spy.mockRestore();
});

test('ping → 200 pong without touching the DB', async () => {
    const res = await send(buildApp(), 'ping', { zen: 'Keep it logically awesome.' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'pong' });
    expect(githubModel.beginDelivery).not.toHaveBeenCalled();
});

describe('pull_request', () => {
    test('merged into the default branch → applyPullRequest + completeTask in the same transaction', async () => {
        const res = await send(buildApp(), 'pull_request', prPayload());
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('processed');
        const bodyHash = crypto.createHash('sha256').update(JSON.stringify(prPayload())).digest('hex');
        expect(githubModel.beginDelivery).toHaveBeenCalledWith({ deliveryId: DELIVERY, event: 'pull_request', action: 'closed', installationId: 77, payloadSha256: bodyHash });
        expect(githubModel.upsertRepository).toHaveBeenCalledWith(
            { repoId: 500, installationId: 77, name: 'demo', defaultBranch: 'main', isPrivate: true }, { tx: TX },
        );
        expect(githubModel.applyPullRequest).toHaveBeenCalledWith(expect.objectContaining({
            prId: 9001, repoId: 500, number: 12, headBranch: 'tm/add-auth-abcdef12', baseBranch: 'main',
            mergedAt: '2026-09-11T10:00:00Z', ghUpdatedAt: '2026-09-11T10:00:00Z',
        }), { tx: TX });
        expect(githubModel.findTaskByBranch).toHaveBeenCalledWith(500, 'tm/add-auth-abcdef12', { tx: TX });
        expect(tasksModel.completeTask).toHaveBeenCalledWith('T1', { tx: TX, source: 'github_pr' });
        expect(githubModel.finishDelivery).toHaveBeenCalledWith(DELIVERY, 'processed', { tx: TX });
        await new Promise((r) => setImmediate(r));
        expect(AnalyticsIntegration.onTaskCompletion).toHaveBeenCalledWith('T1', true, { percentage: 100 });
    });

    test('analytics is only notified after a committed completion, and its failure is harmless', async () => {
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        AnalyticsIntegration.onTaskCompletion.mockRejectedValue(new Error('analytics down'));
        const res = await send(buildApp(), 'pull_request', prPayload());
        expect(res.status).toBe(200);
        await new Promise((r) => setImmediate(r));
        expect(AnalyticsIntegration.onTaskCompletion).toHaveBeenCalledTimes(1);

        AnalyticsIntegration.onTaskCompletion.mockClear();
        tasksModel.completeTask.mockResolvedValue({ status: 'already_completed' });
        await send(buildApp(), 'pull_request', prPayload());
        await new Promise((r) => setImmediate(r));
        expect(AnalyticsIntegration.onTaskCompletion).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    test('merged into a non-default branch → PR stored, task not completed', async () => {
        const res = await send(buildApp(), 'pull_request', prPayload({ base: 'develop' }));
        expect(res.status).toBe(200);
        expect(githubModel.applyPullRequest).toHaveBeenCalled();
        expect(tasksModel.completeTask).not.toHaveBeenCalled();
    });

    test('an older/duplicate event that does not become merged → no completion', async () => {
        githubModel.applyPullRequest.mockResolvedValue({ state: 'merged', changed: false, becameMerged: false });
        await send(buildApp(), 'pull_request', prPayload());
        expect(tasksModel.completeTask).not.toHaveBeenCalled();
    });

    test('merged branch without a linked task → processed, nothing completed', async () => {
        githubModel.findTaskByBranch.mockResolvedValue(null);
        const res = await send(buildApp(), 'pull_request', prPayload());
        expect(res.body.status).toBe('processed');
        expect(tasksModel.completeTask).not.toHaveBeenCalled();
    });

    test.each([[999], [null]])('fork PR (head repo %s) → ignored', async (headRepoId) => {
        const res = await send(buildApp(), 'pull_request', prPayload({ headRepoId }));
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ignored');
        expect(githubModel.applyPullRequest).not.toHaveBeenCalled();
        expect(githubModel.finishDelivery).toHaveBeenCalledWith(DELIVERY, 'ignored');
    });

    test('unknown repository/installation (FK violation) → ignored', async () => {
        githubModel.upsertRepository.mockRejectedValue(Object.assign(new Error('FK'), { number: 547 }));
        const res = await send(buildApp(), 'pull_request', prPayload());
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ignored');
        expect(tasksModel.completeTask).not.toHaveBeenCalled();
        expect(githubModel.finishDelivery).toHaveBeenCalledWith(DELIVERY, 'ignored');
    });

    test('duplicate delivery → 200 without reprocessing', async () => {
        githubModel.beginDelivery.mockResolvedValue({ duplicate: true });
        const res = await send(buildApp(), 'pull_request', prPayload());
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('duplicate');
        expect(githubModel.applyPullRequest).not.toHaveBeenCalled();
    });

    test('processing error → failDelivery and 500', async () => {
        githubModel.applyPullRequest.mockRejectedValue(new Error('deadlock victim'));
        const res = await send(buildApp(), 'pull_request', prPayload());
        expect(res.status).toBe(500);
        expect(githubModel.failDelivery).toHaveBeenCalledWith(DELIVERY, expect.stringContaining('deadlock victim'));
    });

    test('slower than the deadline → 202 and finishes in the background', async () => {
        let release;
        githubModel.applyPullRequest.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
        const res = await send(buildApp({ deadlineMs: 30 }), 'pull_request', prPayload());
        expect(res.status).toBe(202);
        expect(githubModel.finishDelivery).not.toHaveBeenCalled();
        release({ state: 'merged', changed: true, becameMerged: true });
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));
        expect(tasksModel.completeTask).toHaveBeenCalled();
        expect(githubModel.finishDelivery).toHaveBeenCalledWith(DELIVERY, 'processed', { tx: TX });
    });
});

describe('installation events', () => {
    test('deleted → deleteInstallation and cached tokens dropped', async () => {
        const spy = jest.spyOn(githubApp, 'invalidateInstallation');
        const res = await send(buildApp(), 'installation', { action: 'deleted', installation: { id: 77 } });
        expect(res.status).toBe(200);
        expect(githubModel.deleteInstallation).toHaveBeenCalledWith(77, { tx: TX });
        expect(spy).toHaveBeenCalledWith(77);
    });

    test('suspend / unsuspend', async () => {
        await send(buildApp(), 'installation', { action: 'suspend', installation: { id: 77, suspended_at: '2026-09-11T00:00:00Z' } });
        expect(githubModel.setInstallationSuspended).toHaveBeenCalledWith(77, new Date('2026-09-11T00:00:00Z'), { tx: TX });
        await send(buildApp(), 'installation', { action: 'unsuspend', installation: { id: 77 } });
        expect(githubModel.setInstallationSuspended).toHaveBeenLastCalledWith(77, null, { tx: TX });
    });

    test('other actions → ignored', async () => {
        const res = await send(buildApp(), 'installation', { action: 'new_permissions_accepted', installation: { id: 77 } });
        expect(res.body.status).toBe('ignored');
    });

    test('installation_repositories removed → deleteRepository for each', async () => {
        await send(buildApp(), 'installation_repositories', {
            action: 'removed', installation: { id: 77 }, repositories_removed: [{ id: 500 }, { id: 501 }],
        });
        expect(githubModel.deleteRepository).toHaveBeenCalledWith(500, { tx: TX });
        expect(githubModel.deleteRepository).toHaveBeenCalledWith(501, { tx: TX });
    });

    test('installation_repositories added → reads metadata from the API, then upserts', async () => {
        useFakeGitHub({
            'POST /app/installations/77/access_tokens': tokenRoute('ghs_hook'),
            'GET /repos/octo/new': { body: { id: 600, name: 'new', default_branch: 'trunk', private: false } },
        });
        await send(buildApp(), 'installation_repositories', {
            action: 'added', installation: { id: 77 }, repositories_added: [{ id: 600, full_name: 'octo/new' }],
        });
        expect(githubModel.upsertRepository).toHaveBeenCalledWith(
            { repoId: 600, installationId: 77, name: 'new', defaultBranch: 'trunk', isPrivate: false }, { tx: TX },
        );
    });
});

test('unhandled events → ignored', async () => {
    const res = await send(buildApp(), 'push', { installation: { id: 77 } });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ignored');
});

jest.mock('../../models/deployment.model', () => ({
    PROVIDERS: ['vercel', 'aws'],
    STATES: ['queued', 'building', 'ready', 'error', 'canceled'],
    beginDelivery: jest.fn(),
    finishDelivery: jest.fn(),
    findGroupByProjectRef: jest.fn(),
    applyDeployment: jest.fn(),
}));
jest.mock('../../models/github.model', () => ({ getGroupRepository: jest.fn() }));

const express = require('express');
const request = require('supertest');
const deploymentModel = require('../../models/deployment.model');
const githubModel = require('../../models/github.model');
const { createVercelWebhookHandler } = require('../../services/deploy/deployWebhookHandler');
const { signVercelPayload } = require('../../services/deploy/deploySignature');

const SECRET = 'vercel-whsec-test';
const GID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const buildApp = () => {
    const app = express();
    // Mounted exactly as app.js mounts it, so the handler receives Express's (req, res, next)
    // and the deadline cannot be clobbered by `next`.
    app.post('/api/deploy/webhook/vercel', express.raw({ type: '*/*' }), createVercelWebhookHandler({ deadlineMs: 2000 }));
    return app;
};

const body = (type, overrides = {}) => JSON.stringify({
    id: 'evt_test_1',
    type,
    createdAt: 1760000000000,
    payload: {
        project: { id: 'prj_abc123' },
        deployment: {
            id: 'dpl_xyz789',
            url: 'taskmate.vercel.app',
            target: 'production',
            meta: { githubCommitRef: 'main', githubCommitSha: 'a'.repeat(40) },
        },
        ...overrides,
    },
});

const post = (payload) => request(buildApp())
    .post('/api/deploy/webhook/vercel')
    .set('content-type', 'application/json')
    .set('x-vercel-signature', signVercelPayload(Buffer.from(payload), SECRET))
    .send(payload);

beforeEach(() => {
    jest.clearAllMocks();
    process.env.VERCEL_WEBHOOK_SECRET = SECRET;
    deploymentModel.beginDelivery.mockResolvedValue(true);
    deploymentModel.finishDelivery.mockResolvedValue(true);
    deploymentModel.findGroupByProjectRef.mockResolvedValue(GID);
    deploymentModel.applyDeployment.mockResolvedValue({ changed: true, stale: false, state: 'ready' });
    githubModel.getGroupRepository.mockResolvedValue({ repoId: 42 });
});

describe('vercel webhook', () => {
    test('stores a successful deployment against its group', async () => {
        const res = await post(body('deployment.succeeded'));

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('processed');
        expect(deploymentModel.applyDeployment).toHaveBeenCalledWith(expect.objectContaining({
            deploymentId: 'dpl_xyz789',
            gid: GID,
            repoId: 42,
            state: 'ready',
            branch: 'main',
        }));
    });

    test('records a failed build with its message', async () => {
        await post(body('deployment.error', { errorMessage: 'Build failed: exit 1' }));

        expect(deploymentModel.applyDeployment).toHaveBeenCalledWith(expect.objectContaining({
            state: 'error',
            errorMessage: 'Build failed: exit 1',
        }));
    });

    test('rejects an unsigned request', async () => {
        const payload = body('deployment.succeeded');
        const res = await request(buildApp())
            .post('/api/deploy/webhook/vercel')
            .set('content-type', 'application/json')
            .send(payload);

        expect(res.status).toBe(401);
        expect(deploymentModel.beginDelivery).not.toHaveBeenCalled();
    });

    test('rejects a tampered body', async () => {
        const payload = body('deployment.succeeded');
        const res = await request(buildApp())
            .post('/api/deploy/webhook/vercel')
            .set('content-type', 'application/json')
            .set('x-vercel-signature', signVercelPayload(Buffer.from(payload), SECRET))
            .send(Buffer.from(payload.replace('succeeded', 'error')));

        expect(res.status).toBe(401);
        expect(deploymentModel.applyDeployment).not.toHaveBeenCalled();
    });

    test('a retried delivery is answered without reprocessing', async () => {
        deploymentModel.beginDelivery.mockResolvedValue(false);
        const res = await post(body('deployment.succeeded'));

        expect(res.body.status).toBe('duplicate');
        expect(deploymentModel.applyDeployment).not.toHaveBeenCalled();
    });

    test('an unlinked project is ignored, not stored', async () => {
        deploymentModel.findGroupByProjectRef.mockResolvedValue(null);
        const res = await post(body('deployment.succeeded'));

        expect(res.body.status).toBe('ignored');
        expect(deploymentModel.applyDeployment).not.toHaveBeenCalled();
        expect(deploymentModel.finishDelivery).toHaveBeenCalledWith(
            'evt_test_1', 'ignored', expect.stringContaining('not linked'),
        );
    });

    test('a non-deployment event is ignored', async () => {
        const res = await post(body('project.created'));
        expect(res.body.status).toBe('ignored');
        expect(deploymentModel.applyDeployment).not.toHaveBeenCalled();
    });

    test('a deployment is still recorded when no repository is linked', async () => {
        githubModel.getGroupRepository.mockResolvedValue(null);
        await post(body('deployment.succeeded'));

        expect(deploymentModel.applyDeployment).toHaveBeenCalledWith(
            expect.objectContaining({ gid: GID, repoId: null }),
        );
    });

    test('a database failure is recorded on the delivery, not thrown at Vercel', async () => {
        deploymentModel.applyDeployment.mockRejectedValue(new Error('deadlock'));
        const res = await post(body('deployment.succeeded'));

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('failed');
        expect(deploymentModel.finishDelivery).toHaveBeenCalledWith(
            'evt_test_1', 'failed', expect.stringContaining('deadlock'),
        );
    });

    // Regression: beginDelivery was awaited outside any try/catch. Express 4 does not catch a
    // rejected async handler, so the request hung and, on Node 24, the process exited.
    test('a database failure while claiming the delivery answers 500 instead of hanging', async () => {
        deploymentModel.beginDelivery.mockRejectedValue(new Error('connection lost'));
        const res = await post(body('deployment.succeeded'));

        expect(res.status).toBe(500);
        expect(res.body.code).toBe('INTERNAL_ERROR');
        expect(deploymentModel.applyDeployment).not.toHaveBeenCalled();
    });

    test('rejects a validly signed non-JSON body', async () => {
        const payload = 'not json';
        const res = await request(buildApp())
            .post('/api/deploy/webhook/vercel')
            .set('content-type', 'application/json')
            .set('x-vercel-signature', signVercelPayload(Buffer.from(payload), SECRET))
            .send(payload);

        expect(res.status).toBe(400);
    });
});

describe('mounting', () => {
    // Regression: the handler used to take (req, res, deadlineMs). Express calls route handlers
    // with (req, res, next), so `next` landed on deadlineMs; a function coerced to a setTimeout
    // delay is 0, which made every request answer "timeout" while the work actually succeeded.
    // Only caught by running the real server -- the unit tests passed a number explicitly.
    test('the default export works when mounted directly on a route', async () => {
        const { vercelWebhookHandler } = require('../../services/deploy/deployWebhookHandler');
        const app = express();
        app.post('/hook', express.raw({ type: '*/*' }), vercelWebhookHandler);

        const payload = body('deployment.succeeded');
        const res = await request(app)
            .post('/hook')
            .set('content-type', 'application/json')
            .set('x-vercel-signature', signVercelPayload(Buffer.from(payload), SECRET))
            .send(payload);

        expect(res.body.status).toBe('processed');
    });
});

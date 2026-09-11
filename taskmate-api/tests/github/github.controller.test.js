jest.mock('../../models/access.model', () => ({
    isGroupMember: jest.fn(),
    isGroupAdmin: jest.fn(),
    resolveGroupId: jest.fn(),
}));
jest.mock('../../models/github.model', () => ({
    getGroupRepository: jest.fn(),
    unlinkGroupRepository: jest.fn(),
    getTaskLinksByGroup: jest.fn(),
    getTaskBranch: jest.fn(),
    insertTaskBranch: jest.fn(),
    findTaskByBranch: jest.fn(),
    upsertRepository: jest.fn(),
    applyPullRequest: jest.fn(),
    setAiAnalysisEnabled: jest.fn(),
}));
jest.mock('../../helpers/transaction', () => ({ withTransaction: jest.fn(), isFkViolation: jest.fn() }));
jest.mock('../../models/tasks.model', () => ({ getTask: jest.fn(), completeTask: jest.fn() }));
jest.mock('../../services/AnalyticsIntegration', () => ({ onTaskCompletion: jest.fn() }));

const express = require('express');
const request = require('supertest');
const accessModel = require('../../models/access.model');
const githubModel = require('../../models/github.model');
const tasksModel = require('../../models/tasks.model');
const { createGithubRouter, createGithubCallbackRouter, githubWebhookHandler } = require('../../controllers/github.controller');
const { useFakeGitHub, tokenRoute, REPO } = require('./helpers/fakeGitHub');

const GID = REPO.gid;
const UID = '22222222-2222-4222-8222-222222222222';
const TID = 'abcdef12-3456-4789-8abc-def012345678';

const fakeAuth = (req, res, next) => {
    const uid = req.get('x-test-user');
    if (!uid) return res.status(401).json({ success: false, error: 'Authentication required.', code: 'UNAUTHENTICATED' });
    req.user = { userId: uid, username: 'tester' };
    return next();
};

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/github', createGithubCallbackRouter());
    app.use('/api/github', createGithubRouter({ auth: fakeAuth }));
    return app;
};

const as = (req) => req.set('x-test-user', UID);
const fileRoute = (content, extra = {}) => ({ body: { type: 'file', path: 'a.txt', size: content.length, encoding: 'base64', content: Buffer.from(content).toString('base64'), ...extra } });

let app;
beforeEach(() => {
    app = buildApp();
    accessModel.isGroupMember.mockResolvedValue(true);
    accessModel.isGroupAdmin.mockResolvedValue(true);
    accessModel.resolveGroupId.mockResolvedValue(GID);
    githubModel.getGroupRepository.mockResolvedValue({ ...REPO });
    githubModel.unlinkGroupRepository.mockResolvedValue(true);
    githubModel.getTaskLinksByGroup.mockResolvedValue([]);
    githubModel.getTaskBranch.mockResolvedValue(null);
    githubModel.findTaskByBranch.mockResolvedValue(null);
    githubModel.insertTaskBranch.mockResolvedValue(undefined);
    tasksModel.getTask.mockResolvedValue([{ tid: TID, gid: GID, name: 'Login page' }]);
});

describe('access control', () => {
    test('401 without a user', async () => {
        const res = await request(app).get(`/api/github/groups/${GID}/repository`);
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('UNAUTHENTICATED');
    });

    test('400 for a malformed gid', async () => {
        const res = await as(request(app).get('/api/github/groups/not-a-uuid/repository'));
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    test('403 NOT_GROUP_MEMBER for members-only routes', async () => {
        accessModel.isGroupMember.mockResolvedValue(false);
        for (const path of ['repository', 'tree', 'file?path=a.txt', 'readme', 'commits', 'task-links']) {
            const res = await as(request(app).get(`/api/github/groups/${GID}/${path}`));
            expect(res.status).toBe(403);
            expect(res.body.code).toBe('NOT_GROUP_MEMBER');
        }
        expect(githubModel.getGroupRepository).not.toHaveBeenCalled();
    });

    test('403 NOT_GROUP_ADMIN for admin routes', async () => {
        accessModel.isGroupAdmin.mockResolvedValue(false);
        const install = await as(request(app).post(`/api/github/groups/${GID}/install`));
        const link = await as(request(app).post(`/api/github/groups/${GID}/repository`).send({ selectionId: 'x'.repeat(43), repoId: 1 }));
        const unlink = await as(request(app).delete(`/api/github/groups/${GID}/repository`));
        [install, link, unlink].forEach((res) => {
            expect(res.status).toBe(403);
            expect(res.body.code).toBe('NOT_GROUP_ADMIN');
        });
        expect(githubModel.unlinkGroupRepository).not.toHaveBeenCalled();
    });

    test('branch on an unknown task → 404 TASK_NOT_FOUND', async () => {
        accessModel.resolveGroupId.mockResolvedValue(null);
        const res = await as(request(app).post(`/api/github/tasks/${TID}/branch`));
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('TASK_NOT_FOUND');
    });

    test('branch on a task of another group → 403', async () => {
        accessModel.isGroupMember.mockResolvedValue(false);
        const res = await as(request(app).post(`/api/github/tasks/${TID}/branch`));
        expect(res.status).toBe(403);
    });
});

describe('repository endpoints', () => {
    test('GET repository → formatted repo or null', async () => {
        const res = await as(request(app).get(`/api/github/groups/${GID}/repository`));
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({
            repoId: 500, fullName: 'octo/demo', htmlUrl: 'https://github.com/octo/demo', aiAnalysisEnabled: false,
            installation: { accountLogin: 'octo', suspended: false },
        });
        githubModel.getGroupRepository.mockResolvedValue({ ...REPO, aiAnalysisEnabled: true });
        const enabled = await as(request(app).get(`/api/github/groups/${GID}/repository`));
        expect(enabled.body.data.aiAnalysisEnabled).toBe(true);
        githubModel.getGroupRepository.mockResolvedValue(null);
        const none = await as(request(app).get(`/api/github/groups/${GID}/repository`));
        expect(none.body).toEqual({ data: null });
    });

    test('PUT ai-analysis (admin) toggles the opt-in', async () => {
        githubModel.setAiAnalysisEnabled.mockResolvedValue(true);
        const res = await as(request(app).put(`/api/github/groups/${GID}/ai-analysis`).send({ enabled: true }));
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ data: { aiAnalysisEnabled: true } });
        expect(githubModel.setAiAnalysisEnabled).toHaveBeenCalledWith(GID, true);
    });

    test('PUT ai-analysis validates, requires admin and a connected repo', async () => {
        const bad = await as(request(app).put(`/api/github/groups/${GID}/ai-analysis`).send({ enabled: 'yes' }));
        expect(bad.status).toBe(400);
        githubModel.setAiAnalysisEnabled.mockResolvedValue(false);
        const none = await as(request(app).put(`/api/github/groups/${GID}/ai-analysis`).send({ enabled: false }));
        expect(none.status).toBe(409);
        expect(none.body.code).toBe('REPO_NOT_CONNECTED');
        accessModel.isGroupAdmin.mockResolvedValue(false);
        const member = await as(request(app).put(`/api/github/groups/${GID}/ai-analysis`).send({ enabled: true }));
        expect(member.status).toBe(403);
        expect(member.body.code).toBe('NOT_GROUP_ADMIN');
    });

    test('DELETE repository → 204', async () => {
        const res = await as(request(app).delete(`/api/github/groups/${GID}/repository`));
        expect(res.status).toBe(204);
        expect(githubModel.unlinkGroupRepository).toHaveBeenCalledWith(GID);
    });

    test('POST repository validates the body', async () => {
        const bad = await as(request(app).post(`/api/github/groups/${GID}/repository`).send({ selectionId: 'short', repoId: 1 }));
        expect(bad.status).toBe(400);
        const badRepo = await as(request(app).post(`/api/github/groups/${GID}/repository`).send({ selectionId: 'x'.repeat(43), repoId: 'abc' }));
        expect(badRepo.status).toBe(400);
        const unknown = await as(request(app).post(`/api/github/groups/${GID}/repository`).send({ selectionId: 'x'.repeat(43), repoId: 1 }));
        expect(unknown.status).toBe(404);
        expect(unknown.body.code).toBe('SELECTION_NOT_FOUND');
    });

    test('GET selections of an unknown id → 404', async () => {
        const res = await as(request(app).get(`/api/github/selections/${'y'.repeat(43)}`));
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('SELECTION_NOT_FOUND');
    });
});

describe('file endpoint over HTTP', () => {
    const tokens = { 'POST /app/installations/77/access_tokens': tokenRoute('ghs_c') };

    test.each([
        ['../secret'],
        ['%2e%2e/secret'],
        ['/etc/passwd'],
        ['a\\b'],
        ['a%00b'],
    ])('rejects path %j with 400 before calling GitHub', async (path) => {
        const fetchImpl = useFakeGitHub(tokens);
        const res = await as(request(app).get(`/api/github/groups/${GID}/file`).query({ path }));
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(fetchImpl.calls).toHaveLength(0);
    });

    test('rejects a repeated path parameter', async () => {
        const res = await as(request(app).get(`/api/github/groups/${GID}/file?path=a&path=b`));
        expect(res.status).toBe(400);
    });

    test('> 1 MB → 413', async () => {
        useFakeGitHub({ ...tokens, 'GET /repos/octo/demo/contents/big.bin': { body: { type: 'file', path: 'big.bin', size: 2 * 1024 * 1024, encoding: 'none', content: '' } } });
        const res = await as(request(app).get(`/api/github/groups/${GID}/file`).query({ path: 'big.bin' }));
        expect(res.status).toBe(413);
        expect(res.body.code).toBe('FILE_TOO_LARGE');
    });

    test('text file → 200 with content', async () => {
        useFakeGitHub({ ...tokens, 'GET /repos/octo/demo/contents/a.txt': fileRoute('hola') });
        const res = await as(request(app).get(`/api/github/groups/${GID}/file`).query({ path: 'a.txt' }));
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ path: 'a.txt', binary: false, content: 'hola' });
    });

    test('GitHub rate limit → 503 with Retry-After', async () => {
        useFakeGitHub({ ...tokens, 'GET /repos/octo/demo/contents/a.txt': { status: 429, headers: { 'retry-after': '17' } } });
        const res = await as(request(app).get(`/api/github/groups/${GID}/file`).query({ path: 'a.txt' }));
        expect(res.status).toBe(503);
        expect(res.body.code).toBe('GITHUB_RATE_LIMITED');
        expect(res.headers['retry-after']).toBe('17');
    });

    test('no repository connected → 409 REPO_NOT_CONNECTED', async () => {
        useFakeGitHub(tokens);
        githubModel.getGroupRepository.mockResolvedValue(null);
        const res = await as(request(app).get(`/api/github/groups/${GID}/readme`));
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('REPO_NOT_CONNECTED');
    });
});

describe('branch and sync', () => {
    test('POST /tasks/:tid/branch → 201 then 200 on repeat', async () => {
        useFakeGitHub({
            'POST /app/installations/77/access_tokens': tokenRoute('ghs_w'),
            'GET /repos/octo/demo/git/ref/heads/main': { body: { object: { sha: 'a'.repeat(40) } } },
            'POST /repos/octo/demo/git/refs': { status: 201, body: {} },
        });
        const first = await as(request(app).post(`/api/github/tasks/${TID}/branch`));
        expect(first.status).toBe(201);
        expect(first.body.data).toMatchObject({ tid: TID, branchName: 'tm/login-page-abcdef12', created: true });
        githubModel.getTaskBranch.mockResolvedValue({ tid: TID, repoId: 500, branchName: 'tm/login-page-abcdef12', baseSha: 'a'.repeat(40) });
        const again = await as(request(app).post(`/api/github/tasks/${TID}/branch`));
        expect(again.status).toBe(200);
        expect(again.body.data.created).toBe(false);
    });

    test('POST sync is limited to once every 30 s per user', async () => {
        useFakeGitHub({
            'POST /app/installations/77/access_tokens': tokenRoute('ghs_s'),
            'GET /repos/octo/demo': { body: { id: 500, name: 'demo', default_branch: 'main' } },
        });
        const first = await as(request(app).post(`/api/github/groups/${GID}/sync`));
        expect(first.status).toBe(200);
        expect(first.body.data).toEqual({ branchesChecked: 0, pullRequestsFound: 0, updated: 0 });
        const second = await as(request(app).post(`/api/github/groups/${GID}/sync`));
        expect(second.status).toBe(429);
        expect(second.body.code).toBe('RATE_LIMITED');
    });

    test('GET task-links', async () => {
        githubModel.getTaskLinksByGroup.mockResolvedValue([{ tid: TID, branchName: 'tm/x-abcdef12', pr: null }]);
        const res = await as(request(app).get(`/api/github/groups/${GID}/task-links`));
        expect(res.body).toEqual({ data: [{ tid: TID, branchName: 'tm/x-abcdef12', pr: null }] });
    });
});

describe('public routes', () => {
    test('callback is public and always redirects to FRONTEND_URL/github', async () => {
        const res = await request(app).get('/api/github/callback').query({ state: 'forged', code: 'x', installation_id: '1' });
        expect(res.status).toBe(302);
        const target = new URL(res.headers.location);
        expect(`${target.origin}${target.pathname}`).toBe(`${(process.env.FRONTEND_URL || 'http://localhost:3000').split(',')[0].trim()}/github`);
        expect(target.searchParams.get('status')).toBe('error');
        expect(target.searchParams.get('code')).toBe('INVALID_STATE');
        expect(res.headers['cache-control']).toBe('no-store');
    });

    test('webhook handler is exported for the raw-body mount', () => {
        expect(typeof githubWebhookHandler).toBe('function');
    });
});

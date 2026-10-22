// Phase 4 routes of the GitHub router: access control, input checks and wiring to the services.
jest.mock('../../models/access.model', () => ({
    isGroupMember: jest.fn(),
    isGroupAdmin: jest.fn(),
    resolveGroupId: jest.fn(),
}));
jest.mock('../../services/github/pipelineService', () => ({
    getPipeline: jest.fn(),
    proposePipeline: jest.fn(),
    previewPipeline: jest.fn(),
    applyPipeline: jest.fn(),
}));
jest.mock('../../services/github/actionsService', () => ({
    listWorkflows: jest.fn(),
    listRuns: jest.fn(),
    getRun: jest.fn(),
    getJobLog: jest.fn(),
    getJobAnnotations: jest.fn(),
    dispatchPipeline: jest.fn(),
    rerunFailed: jest.fn(),
    cancelRun: jest.fn(),
}));

jest.mock('../../services/github/deployService', () => ({
    getDeployments: jest.fn(),
    deployNow: jest.fn(),
    requestDeploy: jest.fn(),
    approveRequest: jest.fn(),
    rejectRequest: jest.fn(),
    cancelRequest: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const accessModel = require('../../models/access.model');
const pipelineService = require('../../services/github/pipelineService');
const actionsService = require('../../services/github/actionsService');
const deployService = require('../../services/github/deployService');
const { createGithubRouter } = require('../../controllers/github.controller');
const { AppError } = require('../../helpers/errors');

const GID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';
const SPEC = { version: 1, project: { dir: '.', stack: 'node' } };

const fakeAuth = (req, res, next) => {
    req.user = { userId: UID, username: 'ana' };
    next();
};

let app;
beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/github', createGithubRouter({ auth: fakeAuth }));
    accessModel.isGroupMember.mockResolvedValue(true);
    accessModel.isGroupAdmin.mockResolvedValue(true);
    pipelineService.getPipeline.mockResolvedValue({ pipeline: null });
    pipelineService.proposePipeline.mockResolvedValue({ spec: SPEC });
    pipelineService.previewPipeline.mockResolvedValue({ yaml: 'x' });
    pipelineService.applyPipeline.mockResolvedValue({ commit: { sha: 'c'.repeat(40) } });
    actionsService.listWorkflows.mockResolvedValue([]);
    actionsService.listRuns.mockResolvedValue({ runs: [] });
    actionsService.getRun.mockResolvedValue({ run: { id: 1 }, jobs: [] });
    actionsService.getJobLog.mockResolvedValue({ jobId: 7, lines: [], errors: [], truncated: false });
    actionsService.getJobAnnotations.mockResolvedValue([]);
    actionsService.dispatchPipeline.mockResolvedValue({ dispatched: true, ref: 'main' });
    actionsService.rerunFailed.mockResolvedValue({ rerun: true, runId: 1 });
    actionsService.cancelRun.mockResolvedValue({ cancelled: true, runId: 1 });
    deployService.getDeployments.mockResolvedValue({ deploys: true });
    deployService.deployNow.mockResolvedValue({ dispatched: true });
    deployService.requestDeploy.mockResolvedValue({ status: 'pending' });
    deployService.approveRequest.mockResolvedValue({ status: 'approved' });
    deployService.rejectRequest.mockResolvedValue({ status: 'rejected' });
    deployService.cancelRequest.mockResolvedValue({ status: 'cancelled' });
});

describe('pipeline', () => {
    test('members read it', async () => {
        accessModel.isGroupAdmin.mockResolvedValue(false);
        const res = await request(app).get(`/api/github/groups/${GID}/pipeline`);
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ pipeline: null });
        expect(pipelineService.getPipeline).toHaveBeenCalledWith(GID);
    });

    test('non-members cannot read it', async () => {
        accessModel.isGroupMember.mockResolvedValue(false);
        const res = await request(app).get(`/api/github/groups/${GID}/pipeline`);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('NOT_GROUP_MEMBER');
    });

    test.each([
        ['post', 'pipeline/proposal', {}],
        ['post', 'pipeline/preview', { spec: SPEC }],
        ['put', 'pipeline', { spec: SPEC }],
    ])('%s %s is admin only', async (method, path, body) => {
        accessModel.isGroupAdmin.mockResolvedValue(false);
        const res = await request(app)[method](`/api/github/groups/${GID}/${path}`).send(body);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('NOT_GROUP_ADMIN');
        expect(pipelineService.proposePipeline).not.toHaveBeenCalled();
        expect(pipelineService.previewPipeline).not.toHaveBeenCalled();
        expect(pipelineService.applyPipeline).not.toHaveBeenCalled();
    });

    test('proposal passes the acting user and an optional project', async () => {
        await request(app).post(`/api/github/groups/${GID}/pipeline/proposal`).send({ dir: 'api', stack: 'python' }).expect(200);
        expect(pipelineService.proposePipeline).toHaveBeenCalledWith({ gid: GID, uid: UID, dir: 'api', stack: 'python' });
    });

    test.each([
        [{ dir: '' }],
        [{ dir: 5 }],
        [{ dir: 'x'.repeat(201) }],
        [{ stack: ['node'] }],
    ])('proposal rejects %j', async (body) => {
        const res = await request(app).post(`/api/github/groups/${GID}/pipeline/proposal`).send(body);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    test.each([[{}], [{ spec: 'x' }], [{ spec: [] }], [{ spec: null }]])('preview and apply need a spec object: %j', async (body) => {
        expect((await request(app).post(`/api/github/groups/${GID}/pipeline/preview`).send(body)).status).toBe(400);
        expect((await request(app).put(`/api/github/groups/${GID}/pipeline`).send(body)).status).toBe(400);
        expect(pipelineService.applyPipeline).not.toHaveBeenCalled();
    });

    test('apply commits with the username of the token', async () => {
        const res = await request(app).put(`/api/github/groups/${GID}/pipeline`).send({ spec: SPEC });
        expect(res.status).toBe(200);
        expect(pipelineService.applyPipeline).toHaveBeenCalledWith({ gid: GID, uid: UID, username: 'ana', spec: SPEC });
    });

    test('service errors keep their code and status', async () => {
        pipelineService.applyPipeline.mockRejectedValue(new AppError('BRANCH_PROTECTED', 'protected', 409));
        const res = await request(app).put(`/api/github/groups/${GID}/pipeline`).send({ spec: SPEC });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('BRANCH_PROTECTED');
    });

    test('GitHub rate limits are relayed with Retry-After', async () => {
        pipelineService.proposePipeline.mockRejectedValue(new AppError('GITHUB_RATE_LIMITED', 'later', 503, { retryAfterSec: 42 }));
        const res = await request(app).post(`/api/github/groups/${GID}/pipeline/proposal`).send({});
        expect(res.status).toBe(503);
        expect(res.headers['retry-after']).toBe('42');
    });
});

describe('actions', () => {
    test('members list workflows and runs with the query filters', async () => {
        accessModel.isGroupAdmin.mockResolvedValue(false);
        await request(app).get(`/api/github/groups/${GID}/actions/workflows`).expect(200);
        await request(app).get(`/api/github/groups/${GID}/actions/runs?branch=main&status=failure&workflow=5&page=2`).expect(200);
        expect(actionsService.listRuns).toHaveBeenCalledWith(GID, { branch: 'main', status: 'failure', workflow: '5', page: '2' });
    });

    test('repeated query values are rejected', async () => {
        const res = await request(app).get(`/api/github/groups/${GID}/actions/runs?branch=a&branch=b`);
        expect(res.status).toBe(400);
        expect(actionsService.listRuns).not.toHaveBeenCalled();
    });

    test('run detail', async () => {
        const res = await request(app).get(`/api/github/groups/${GID}/actions/runs/901`);
        expect(res.status).toBe(200);
        expect(actionsService.getRun).toHaveBeenCalledWith(GID, '901');
    });

    test('non-members are refused before GitHub', async () => {
        accessModel.isGroupMember.mockResolvedValue(false);
        expect((await request(app).get(`/api/github/groups/${GID}/actions/runs`)).status).toBe(403);
        expect((await request(app).get(`/api/github/groups/${GID}/actions/runs/1`)).status).toBe(403);
        expect(actionsService.listRuns).not.toHaveBeenCalled();
        expect(actionsService.getRun).not.toHaveBeenCalled();
    });
});

describe('logs, annotations and run controls', () => {
    test('members read the log and the annotations of a job', async () => {
        accessModel.isGroupAdmin.mockResolvedValue(false);
        await request(app).get(`/api/github/groups/${GID}/actions/jobs/7/logs`).expect(200);
        await request(app).get(`/api/github/groups/${GID}/actions/jobs/7/annotations`).expect(200);
        expect(actionsService.getJobLog).toHaveBeenCalledWith(GID, '7');
        expect(actionsService.getJobAnnotations).toHaveBeenCalledWith(GID, '7');
    });

    test('members run the CI on a branch; ref is required', async () => {
        accessModel.isGroupAdmin.mockResolvedValue(false);
        const res = await request(app).post(`/api/github/groups/${GID}/actions/runs`).send({ ref: 'main' });
        expect(res.status).toBe(202);
        expect(actionsService.dispatchPipeline).toHaveBeenCalledWith(GID, { ref: 'main' });
        for (const body of [{}, { ref: '' }, { ref: ['main'] }]) {
            expect((await request(app).post(`/api/github/groups/${GID}/actions/runs`).send(body)).status).toBe(400);
        }
    });

    test('re-run and cancel tell the service whether the user is the group admin', async () => {
        accessModel.isGroupAdmin.mockResolvedValue(false);
        await request(app).post(`/api/github/groups/${GID}/actions/runs/5/rerun-failed`).expect(202);
        expect(actionsService.rerunFailed).toHaveBeenCalledWith(GID, '5', { isAdmin: false });
        accessModel.isGroupAdmin.mockResolvedValue(true);
        await request(app).post(`/api/github/groups/${GID}/actions/runs/5/cancel`).expect(202);
        expect(actionsService.cancelRun).toHaveBeenCalledWith(GID, '5', { isAdmin: true });
    });

    test('non-members are refused before GitHub', async () => {
        accessModel.isGroupMember.mockResolvedValue(false);
        for (const [method, path] of [['get', 'actions/jobs/7/logs'], ['post', 'actions/runs'], ['post', 'actions/runs/5/rerun-failed'], ['post', 'actions/runs/5/cancel']]) {
            expect((await request(app)[method](`/api/github/groups/${GID}/${path}`).send({ ref: 'main' })).status).toBe(403);
        }
        expect(actionsService.dispatchPipeline).not.toHaveBeenCalled();
        expect(actionsService.rerunFailed).not.toHaveBeenCalled();
    });
});

describe('continuous delivery routes', () => {
    const REQ = '44444444-4444-4444-8444-444444444444';
    const VERSION = 'b'.repeat(40);

    test('members read the environments and ask for a deploy', async () => {
        accessModel.isGroupAdmin.mockResolvedValue(false);
        await request(app).get(`/api/github/groups/${GID}/deployments`).expect(200);
        const res = await request(app).post(`/api/github/groups/${GID}/deploy-requests`).send({ environment: 'production', version: VERSION });
        expect(res.status).toBe(201);
        expect(deployService.requestDeploy).toHaveBeenCalledWith({ gid: GID, uid: UID, environment: 'production', version: VERSION });
    });

    test('only admins deploy directly, approve or reject', async () => {
        accessModel.isGroupAdmin.mockResolvedValue(false);
        for (const [path, body] of [['deployments', { environment: 'production', version: VERSION }], [`deploy-requests/${REQ}/approve`, {}], [`deploy-requests/${REQ}/reject`, {}]]) {
            const res = await request(app).post(`/api/github/groups/${GID}/${path}`).send(body);
            expect(res.status).toBe(403);
            expect(res.body.code).toBe('NOT_GROUP_ADMIN');
        }
        expect(deployService.deployNow).not.toHaveBeenCalled();
        expect(deployService.approveRequest).not.toHaveBeenCalled();
        expect(deployService.rejectRequest).not.toHaveBeenCalled();
    });

    test('admins deploy, approve and reject with their identity', async () => {
        await request(app).post(`/api/github/groups/${GID}/deployments`).send({ environment: 'production', version: VERSION }).expect(202);
        expect(deployService.deployNow).toHaveBeenCalledWith({ gid: GID, username: 'ana', environment: 'production', version: VERSION });
        await request(app).post(`/api/github/groups/${GID}/deploy-requests/${REQ}/approve`).expect(200);
        expect(deployService.approveRequest).toHaveBeenCalledWith({ gid: GID, uid: UID, username: 'ana', requestId: REQ });
        await request(app).post(`/api/github/groups/${GID}/deploy-requests/${REQ}/reject`).send({ note: 'falta QA' }).expect(200);
        expect(deployService.rejectRequest).toHaveBeenCalledWith({ gid: GID, uid: UID, requestId: REQ, note: 'falta QA' });
    });

    test('a member cancels (the service checks it is their request)', async () => {
        accessModel.isGroupAdmin.mockResolvedValue(false);
        await request(app).post(`/api/github/groups/${GID}/deploy-requests/${REQ}/cancel`).expect(200);
        expect(deployService.cancelRequest).toHaveBeenCalledWith({ gid: GID, uid: UID, requestId: REQ });
    });

    test('non-members get nothing', async () => {
        accessModel.isGroupMember.mockResolvedValue(false);
        expect((await request(app).get(`/api/github/groups/${GID}/deployments`)).status).toBe(403);
        expect((await request(app).post(`/api/github/groups/${GID}/deploy-requests`).send({ version: VERSION })).status).toBe(403);
        expect(deployService.getDeployments).not.toHaveBeenCalled();
        expect(deployService.requestDeploy).not.toHaveBeenCalled();
    });
});

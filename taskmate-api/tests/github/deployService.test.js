jest.mock('../../models/github.model', () => ({ getGroupRepository: jest.fn() }));
jest.mock('../../models/cicd.model', () => ({
    getPipeline: jest.fn(),
    listDeployRequests: jest.fn(),
    createDeployRequest: jest.fn(),
    getDeployRequest: jest.fn(),
    decideDeployRequest: jest.fn(),
    reopenDeployRequest: jest.fn(),
}));
jest.mock('../../services/realtime', () => ({ realtime: { publish: jest.fn() } }));

const githubModel = require('../../models/github.model');
const cicdModel = require('../../models/cicd.model');
const { realtime } = require('../../services/realtime');
const deployService = require('../../services/github/deployService');
const { useFakeGitHub, tokenRoute, REPO } = require('./helpers/fakeGitHub');

const GID = REPO.gid;
const ADMIN = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const REQ = '44444444-4444-4444-8444-444444444444';
const API = '/repos/octo/demo';
const DISPATCH = `POST ${API}/actions/workflows/taskmate-ci.yml/dispatches`;
const RUNS = `GET ${API}/actions/workflows/taskmate-ci.yml/runs`;
const sha = (c) => c.repeat(40);

const node = (environment, commit, state, { requestedBy = '', at = '2026-10-09T10:00:00Z', task = 'deploy:taskmate' } = {}) => ({
    databaseId: Math.floor(Math.random() * 1e9),
    environment,
    task,
    commitOid: sha(commit),
    createdAt: at,
    description: 'Desde TaskMate',
    // GitHub hands the payload back JSON-encoded twice.
    payload: JSON.stringify(JSON.stringify({ taskmate: true, requestedBy, runId: 1 })),
    creator: { login: 'github-actions' },
    latestStatus: state ? {
        state: state.toUpperCase(),
        environmentUrl: environment === 'staging' ? 'https://octo.github.io/demo/staging/' : 'https://octo.github.io/demo/',
        logUrl: 'https://github.com/octo/demo/actions/runs/1',
        createdAt: at,
    } : null,
});

// Newest first, like GitHub: staging b live (a inactive), production a live, an older production c.
const HISTORY = [
    node('staging', 'b', 'success'),
    node('production', 'a', 'success', { requestedBy: 'ana' }),
    node('staging', 'a', 'inactive'),
    node('production', 'c', 'success', { requestedBy: 'ana' }),
    node('staging', 'z', 'success', { task: 'deploy' }),
];

const routes = (extra = {}) => ({
    'POST /app/installations/77/access_tokens': tokenRoute('ghs_cd'),
    'POST /graphql': { body: { data: { repository: { deployments: { nodes: HISTORY } } } } },
    [RUNS]: (call) => ({ body: { total_count: call.query.head_sha === sha('b') ? 1 : 0, workflow_runs: [] } }),
    [DISPATCH]: { status: 204 },
    [`GET ${API}/pages`]: { body: { build_type: 'workflow', html_url: 'https://octo.github.io/demo/' } },
    ...extra,
});

const pending = (extra = {}) => ({
    requestId: REQ, gid: GID, environment: 'production', versionSha: sha('b'), status: 'pending',
    requestedBy: MEMBER, requestedByUsername: 'beto', ...extra,
});

beforeEach(() => {
    githubModel.getGroupRepository.mockResolvedValue({ ...REPO });
    cicdModel.getPipeline.mockResolvedValue({ spec: { deploy: { target: 'github-pages' } } });
    cicdModel.listDeployRequests.mockResolvedValue([]);
    cicdModel.createDeployRequest.mockImplementation(async (r) => ({ requestId: REQ, ...r, status: 'pending' }));
    cicdModel.getDeployRequest.mockResolvedValue(pending());
    cicdModel.decideDeployRequest.mockImplementation(async ({ status }) => pending({ status, decidedByUsername: 'admin' }));
    cicdModel.reopenDeployRequest.mockResolvedValue(true);
    realtime.publish.mockResolvedValue(1);
});

describe('parsePayload', () => {
    test('objects and once or twice encoded JSON; anything else is null', () => {
        const obj = { requestedBy: 'ana' };
        expect(deployService.parsePayload(obj)).toEqual(obj);
        expect(deployService.parsePayload(JSON.stringify(obj))).toEqual(obj);
        expect(deployService.parsePayload(JSON.stringify(JSON.stringify(obj)))).toEqual(obj);
        expect(deployService.parsePayload('{bad')).toBeNull();
        expect(deployService.parsePayload('[1]')).toBeNull();
    });
});

describe('getDeployments', () => {
    test('live version per environment, history of TaskMate deploys, rollback candidates and requests', async () => {
        const fetchImpl = useFakeGitHub(routes());
        cicdModel.listDeployRequests.mockResolvedValue([pending()]);
        const result = await deployService.getDeployments(GID);
        expect(result.deploys).toBe(true);
        expect(result.environments.staging.live).toMatchObject({ sha: sha('b'), shortSha: 'bbbbbbb', state: 'success', automatic: true, url: 'https://octo.github.io/demo/staging/' });
        expect(result.environments.production.live).toMatchObject({ sha: sha('a'), requestedBy: 'ana', automatic: false });
        expect(result.environments.production.inProgress).toBeNull();
        expect(result.history).toHaveLength(4);
        expect(result.rollbackCandidates.map((d) => d.sha)).toEqual([sha('c')]);
        expect(result.requests).toEqual([pending()]);
        expect(result.pages).toMatchObject({ enabled: true });
        const graphql = fetchImpl.calls.find((c) => c.path === '/graphql');
        expect(graphql.body.variables).toEqual({ owner: 'octo', name: 'demo', first: 30 });
        const mints = fetchImpl.calls.filter((c) => c.path.endsWith('/access_tokens')).map((c) => c.body.permissions);
        expect(mints).toContainEqual({ deployments: 'read' });
    });

    test('a deploy in progress and a failed one are reported', () => {
        const history = [node('production', 'd', 'in_progress'), node('production', 'a', 'success'), node('staging', 'e', 'failure'), node('staging', 'b', 'success')]
            .map(deployService.toDeploy);
        const env = deployService.summarize(history);
        expect(env.production.inProgress.sha).toBe(sha('d'));
        expect(env.production.live.sha).toBe(sha('a'));
        expect(env.staging.lastFailed.sha).toBe(sha('e'));
        expect(env.staging.live.sha).toBe(sha('b'));
    });

    test('a pipeline without deploy only returns the requests', async () => {
        const fetchImpl = useFakeGitHub(routes());
        cicdModel.getPipeline.mockResolvedValue({ spec: { deploy: null } });
        await expect(deployService.getDeployments(GID)).resolves.toEqual({
            deploys: false, environments: null, history: [], rollbackCandidates: [], requests: [], pages: null,
        });
        expect(fetchImpl.calls).toHaveLength(0);
    });

    test('GraphQL errors → GITHUB_ERROR', async () => {
        useFakeGitHub(routes({ 'POST /graphql': { body: { errors: [{ message: 'Resource not accessible by integration' }] } } }));
        await expect(deployService.getDeployments(GID)).rejects.toMatchObject({ code: 'GITHUB_ERROR' });
    });
});

describe('deployNow (admin)', () => {
    test('dispatches the workflow on the default branch with environment, version and who asked', async () => {
        const fetchImpl = useFakeGitHub(routes());
        await expect(deployService.deployNow({ gid: GID, username: 'ana<x>', environment: 'production', version: sha('b').toUpperCase() }))
            .resolves.toEqual({ dispatched: true, environment: 'production', version: sha('b') });
        const call = fetchImpl.calls.find((c) => c.method === 'POST' && c.path.endsWith('/dispatches'));
        expect(call.body).toEqual({ ref: 'main', inputs: { environment: 'production', version: sha('b'), requested_by: 'anax' } });
        expect(fetchImpl.calls.filter((c) => c.path.endsWith('/access_tokens')).map((c) => c.body.permissions)).toContainEqual({ actions: 'write' });
    });

    test('a rollback to a version deployed before needs no CI lookup', async () => {
        const fetchImpl = useFakeGitHub(routes());
        await deployService.deployNow({ gid: GID, username: 'ana', environment: 'production', version: sha('c') });
        expect(fetchImpl.calls.some((c) => c.path.endsWith('/taskmate-ci.yml/runs'))).toBe(false);
    });

    test('a commit that never passed the TaskMate CI is refused', async () => {
        const fetchImpl = useFakeGitHub(routes());
        await expect(deployService.deployNow({ gid: GID, environment: 'production', version: sha('9') }))
            .rejects.toMatchObject({ code: 'VERSION_NOT_VERIFIED', status: 409 });
        expect(fetchImpl.calls.some((c) => c.path.endsWith('/dispatches'))).toBe(false);
    });

    test.each([
        [{ environment: 'qa', version: sha('b') }, 'VALIDATION_ERROR'],
        [{ environment: 'production', version: 'main' }, 'VALIDATION_ERROR'],
        [{ environment: 'production', version: 'b'.repeat(39) }, 'VALIDATION_ERROR'],
    ])('rejects %j', async (input, code) => {
        const fetchImpl = useFakeGitHub(routes());
        await expect(deployService.deployNow({ gid: GID, ...input })).rejects.toMatchObject({ code });
        expect(fetchImpl.calls).toHaveLength(0);
    });

    test('no deploy in the pipeline → DEPLOY_NOT_CONFIGURED; an old workflow → PIPELINE_OUTDATED', async () => {
        useFakeGitHub(routes({ [DISPATCH]: { status: 422, body: { message: "Unexpected inputs provided: [\"version\"]" } } }));
        await expect(deployService.deployNow({ gid: GID, environment: 'production', version: sha('b') })).rejects.toMatchObject({ code: 'PIPELINE_OUTDATED' });
        cicdModel.getPipeline.mockResolvedValue(null);
        await expect(deployService.deployNow({ gid: GID, environment: 'production', version: sha('b') })).rejects.toMatchObject({ code: 'DEPLOY_NOT_CONFIGURED' });
    });
});

describe('deploy requests', () => {
    test('a member asks for production: verified, stored and announced to the group', async () => {
        useFakeGitHub(routes());
        const request = await deployService.requestDeploy({ gid: GID, uid: MEMBER, version: sha('b') });
        expect(cicdModel.createDeployRequest).toHaveBeenCalledWith({ gid: GID, repoId: REPO.repoId, environment: 'production', versionSha: sha('b'), requestedBy: MEMBER });
        expect(request.status).toBe('pending');
        expect(realtime.publish).toHaveBeenCalledWith(GID, 'deploy_request', expect.objectContaining({ requestId: REQ, status: 'pending', shortSha: 'bbbbbbb' }));
    });

    test('an unverified version is never requested', async () => {
        useFakeGitHub(routes());
        await expect(deployService.requestDeploy({ gid: GID, uid: MEMBER, version: sha('9') })).rejects.toMatchObject({ code: 'VERSION_NOT_VERIFIED' });
        expect(cicdModel.createDeployRequest).not.toHaveBeenCalled();
    });

    test('approve: decided first, then dispatched with the requester name', async () => {
        const fetchImpl = useFakeGitHub(routes());
        const approved = await deployService.approveRequest({ gid: GID, uid: ADMIN, username: 'admin', requestId: REQ });
        expect(approved.status).toBe('approved');
        expect(cicdModel.decideDeployRequest).toHaveBeenCalledWith({ requestId: REQ, gid: GID, status: 'approved', decidedBy: ADMIN });
        const call = fetchImpl.calls.find((c) => c.path.endsWith('/dispatches'));
        expect(call.body.inputs).toEqual({ environment: 'production', version: sha('b'), requested_by: 'beto' });
        expect(realtime.publish).toHaveBeenCalledWith(GID, 'deploy_request', expect.objectContaining({ status: 'approved' }));
    });

    test('a failed dispatch puts the request back to pending', async () => {
        useFakeGitHub(routes({ [DISPATCH]: { status: 404, body: { message: 'Not Found' } } }));
        await expect(deployService.approveRequest({ gid: GID, uid: ADMIN, requestId: REQ })).rejects.toMatchObject({ code: 'PIPELINE_NOT_CONFIGURED' });
        expect(cicdModel.reopenDeployRequest).toHaveBeenCalledWith({ requestId: REQ, gid: GID });
        expect(realtime.publish).not.toHaveBeenCalled();
    });

    test('two admins: the second one finds it decided and dispatches nothing', async () => {
        const fetchImpl = useFakeGitHub(routes());
        cicdModel.decideDeployRequest.mockResolvedValue(null);
        await expect(deployService.approveRequest({ gid: GID, uid: ADMIN, requestId: REQ })).rejects.toMatchObject({ code: 'DEPLOY_REQUEST_DECIDED' });
        expect(fetchImpl.calls.some((c) => c.path.endsWith('/dispatches'))).toBe(false);
    });

    test('requests of another group, unknown ids and decided requests', async () => {
        useFakeGitHub(routes());
        cicdModel.getDeployRequest.mockResolvedValue(pending({ gid: '99999999-9999-4999-8999-999999999999' }));
        await expect(deployService.approveRequest({ gid: GID, uid: ADMIN, requestId: REQ })).rejects.toMatchObject({ code: 'DEPLOY_REQUEST_NOT_FOUND', status: 404 });
        cicdModel.getDeployRequest.mockResolvedValue(pending({ status: 'rejected' }));
        await expect(deployService.rejectRequest({ gid: GID, uid: ADMIN, requestId: REQ })).rejects.toMatchObject({ code: 'DEPLOY_REQUEST_DECIDED', status: 409 });
        await expect(deployService.cancelRequest({ gid: GID, uid: MEMBER, requestId: 'nope' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    test('reject keeps a trimmed note; only the requester can cancel', async () => {
        useFakeGitHub(routes());
        await deployService.rejectRequest({ gid: GID, uid: ADMIN, requestId: REQ, note: `  falta QA ${'x'.repeat(600)}` });
        const note = cicdModel.decideDeployRequest.mock.calls[0][0].note;
        expect(note.startsWith('falta QA')).toBe(true);
        expect(note).toHaveLength(500);
        await expect(deployService.rejectRequest({ gid: GID, uid: ADMIN, requestId: REQ, note: 5 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

        await expect(deployService.cancelRequest({ gid: GID, uid: ADMIN, requestId: REQ })).rejects.toMatchObject({ code: 'NOT_REQUESTER', status: 403 });
        const cancelled = await deployService.cancelRequest({ gid: GID, uid: MEMBER.toUpperCase(), requestId: REQ });
        expect(cancelled.status).toBe('cancelled');
    });
});

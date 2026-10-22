jest.mock('../../models/github.model', () => ({ getGroupRepository: jest.fn() }));
jest.mock('../../models/cicd.model', () => ({
    getPipeline: jest.fn(),
    listDeployRequests: jest.fn(),
    createDeployRequest: jest.fn(),
    getDeployRequest: jest.fn(),
    decideDeployRequest: jest.fn(),
    reopenDeployRequest: jest.fn(),
    cancelApprovedDeployRequest: jest.fn(),
}));
jest.mock('../../services/realtime', () => ({ realtime: { publish: jest.fn() } }));

const githubModel = require('../../models/github.model');
const { AppError } = require('../../helpers/errors');
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
const COMPARE = (c, branch = 'main') => `GET ${API}/compare/${sha(c)}...${branch}`;
const CHECKS = (c) => `GET ${API}/commits/${sha(c)}/check-runs`;
const NOW = Date.parse('2026-10-09T10:10:00Z');
const minutesBefore = (minutes) => new Date(NOW - minutes * 60 * 1000).toISOString();

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
    node('staging', 'b', 'success', { at: '2026-10-09T10:00:00Z' }),
    node('production', 'a', 'success', { requestedBy: 'ana', at: '2026-10-09T09:00:00Z' }),
    node('staging', 'a', 'inactive', { at: '2026-10-09T08:00:00Z' }),
    node('production', 'c', 'success', { requestedBy: 'ana', at: '2026-10-09T07:00:00Z' }),
    node('staging', 'z', 'success', { task: 'deploy', at: '2026-10-09T06:00:00Z' }),
];

// The GraphQL answer: one connection per environment alias.
const graphqlRoute = (nodes) => () => ({
    body: {
        data: {
            repository: {
                staging: { nodes: nodes.filter((n) => n.environment === 'staging') },
                production: { nodes: nodes.filter((n) => n.environment === 'production') },
            },
        },
    },
});

const checkRun = (c, { name = 'CI (Node.js)', status = 'completed', conclusion = 'success', slug = 'github-actions' } = {}) => ({
    id: Math.floor(Math.random() * 1e9), name, head_sha: sha(c), status, conclusion, app: { slug },
});
const checks = (...runs) => ({ body: { total_count: runs.length, check_runs: runs } });

const routes = (extra = {}) => ({
    'POST /app/installations/77/access_tokens': tokenRoute('ghs_cd'),
    'POST /graphql': graphqlRoute(HISTORY),
    // d: a commit of the default branch whose TaskMate CI passed, never deployed.
    [COMPARE('d')]: { body: { status: 'ahead', ahead_by: 3, behind_by: 0 } },
    [CHECKS('d')]: checks(checkRun('d'), checkRun('d', { name: 'Deploy a GitHub Pages', conclusion: 'skipped' })),
    // The old lookup answered "yes" for anything; it must not be used any more.
    [RUNS]: { body: { total_count: 1, workflow_runs: [{ id: 1, conclusion: 'success' }] } },
    [DISPATCH]: { status: 204 },
    [`GET ${API}/pages`]: { body: { build_type: 'workflow', html_url: 'https://octo.github.io/demo/' } },
    ...extra,
});

const pending = (extra = {}) => ({
    requestId: REQ, gid: GID, repoId: REPO.repoId, environment: 'production', versionSha: sha('b'), status: 'pending',
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
    cicdModel.cancelApprovedDeployRequest.mockImplementation(async ({ note }) => pending({ status: 'cancelled', note }));
    realtime.publish.mockResolvedValue(1);
    deployService._timing.sleep = jest.fn(async () => {});
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
        expect(graphql.body.variables).toEqual({ owner: 'octo', name: 'demo', first: 20 });
        const mints = fetchImpl.calls.filter((c) => c.path.endsWith('/access_tokens')).map((c) => c.body.permissions);
        expect(mints).toContainEqual({ deployments: 'read' });
    });

    test('only the requests of the repository linked now are listed', async () => {
        useFakeGitHub(routes());
        await deployService.getDeployments(GID);
        expect(cicdModel.listDeployRequests).toHaveBeenCalledWith(GID, { repoId: REPO.repoId });
        cicdModel.getPipeline.mockResolvedValue(null);
        await deployService.getDeployments(GID);
        expect(cicdModel.listDeployRequests).toHaveBeenLastCalledWith(GID, { repoId: REPO.repoId });
    });

    test('each environment is asked for separately, so many staging deploys never hide production', async () => {
        const staging = Array.from({ length: 20 }, (_, i) =>
            node('staging', (i % 6 + 4).toString(16), i === 0 ? 'success' : 'inactive', { at: `2026-10-09T10:${String(59 - i).padStart(2, '0')}:00Z` }));
        const production = [
            node('production', 'a', 'success', { requestedBy: 'ana', at: '2026-10-01T09:00:00Z' }),
            node('production', 'c', 'success', { requestedBy: 'ana', at: '2026-09-20T09:00:00Z' }),
        ];
        const fetchImpl = useFakeGitHub(routes({ 'POST /graphql': graphqlRoute([...staging, ...production]) }));
        const result = await deployService.getDeployments(GID);

        const { query } = fetchImpl.calls.find((c) => c.path === '/graphql').body;
        expect(query).toMatch(/staging: deployments\(first: \$first, environments: \["staging"\]/);
        expect(query).toMatch(/production: deployments\(first: \$first, environments: \["production"\]/);
        expect(result.environments.production.live).toMatchObject({ sha: sha('a') });
        expect(result.rollbackCandidates.map((d) => d.sha)).toEqual([sha('c')]);
        // Merged newest first.
        const times = result.history.map((d) => Date.parse(d.createdAt));
        expect(times).toEqual([...times].sort((x, y) => y - x));
        expect(result.history[0].sha).toBe(staging[0].commitOid);
    });

    test('a deploy in progress and a failed one are reported', () => {
        const history = [
            node('production', 'd', 'in_progress', { at: minutesBefore(5) }),
            node('production', 'a', 'success', { at: minutesBefore(60) }),
            node('staging', 'e', 'failure', { at: minutesBefore(70) }),
            node('staging', 'b', 'success', { at: minutesBefore(80) }),
        ].map((n) => deployService.toDeploy(n, { now: NOW }));
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

describe('abandoned deploys', () => {
    const at = (state, minutes) => deployService.toDeploy(node('production', 'd', state, { at: minutesBefore(minutes) }), { now: NOW });

    test('pending, queued, in progress or without status for more than an hour → failed (abandoned)', () => {
        for (const state of ['in_progress', 'queued', 'pending', null]) {
            expect(at(state, 61)).toMatchObject({ state: 'error', abandoned: true });
            expect(at(state, 59)).toMatchObject({ state: state || 'pending', abandoned: false });
        }
        expect(at('success', 600)).toMatchObject({ state: 'success', abandoned: false });
        expect(at('waiting', 600)).toMatchObject({ state: 'waiting', abandoned: false });
    });

    test('an abandoned deploy counts as the last failure, never as "deploying"', () => {
        const history = [at('in_progress', 90), deployService.toDeploy(node('production', 'a', 'success', { at: minutesBefore(120) }), { now: NOW })];
        const env = deployService.summarize(history);
        expect(env.production.inProgress).toBeNull();
        expect(env.production.lastFailed).toMatchObject({ sha: sha('d'), abandoned: true });
        expect(env.production.live.sha).toBe(sha('a'));
    });

    test('a deploy without a creation date is never judged', () => {
        const deploy = deployService.toDeploy({ ...node('production', 'd', 'in_progress'), createdAt: null }, { now: NOW });
        expect(deploy).toMatchObject({ state: 'in_progress', abandoned: false });
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
        expect(fetchImpl.calls.some((c) => c.path.includes('/compare/') || c.path.endsWith('/check-runs') || c.path.endsWith('/runs'))).toBe(false);
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

describe('verified versions (only what passed the TaskMate CI on the default branch)', () => {
    const deploy = (version) => deployService.deployNow({ gid: GID, username: 'ana', environment: 'production', version });
    const dispatched = (fetchImpl) => fetchImpl.calls.some((c) => c.path.endsWith('/dispatches'));

    test('a default-branch commit whose CI job passed: compare + check runs with read-only tokens', async () => {
        const fetchImpl = useFakeGitHub(routes());
        await expect(deploy(sha('d'))).resolves.toMatchObject({ dispatched: true, version: sha('d') });
        const compare = fetchImpl.calls.find((c) => c.path.includes('/compare/'));
        expect(compare.path).toBe(`${API}/compare/${sha('d')}...main`);
        const checkRuns = fetchImpl.calls.find((c) => c.path.endsWith('/check-runs'));
        expect(checkRuns.query).toMatchObject({ filter: 'latest' });
        const mints = fetchImpl.calls.filter((c) => c.path.endsWith('/access_tokens')).map((c) => c.body.permissions);
        expect(mints).toEqual(expect.arrayContaining([{ contents: 'read' }, { checks: 'read' }]));
        expect(fetchImpl.calls.some((c) => c.path.endsWith('/taskmate-ci.yml/runs'))).toBe(false);
        expect(deployService._timing.sleep).not.toHaveBeenCalled();
    });

    test('the head is the default branch itself ("identical") → verified', async () => {
        const fetchImpl = useFakeGitHub(routes({ [COMPARE('d')]: { body: { status: 'identical', ahead_by: 0, behind_by: 0 } } }));
        await deploy(sha('d'));
        expect(dispatched(fetchImpl)).toBe(true);
    });

    test('a head whose CI failed stays refused although a TaskMate deploy run on it ended "success"', async () => {
        const fetchImpl = useFakeGitHub(routes({
            [COMPARE('e')]: { body: { status: 'identical', ahead_by: 0, behind_by: 0 } },
            // The dispatch run skipped the CI job; its deploy job succeeded. The push run's CI failed.
            [CHECKS('e')]: checks(
                checkRun('e', { conclusion: 'skipped' }),
                checkRun('e', { name: 'Deploy a GitHub Pages' }),
                checkRun('e', { conclusion: 'failure' }),
            ),
        }));
        await expect(deploy(sha('e'))).rejects.toMatchObject({ code: 'VERSION_NOT_VERIFIED', status: 409 });
        expect(dispatched(fetchImpl)).toBe(false);
        expect(fetchImpl.calls.some((c) => c.path.endsWith('/taskmate-ci.yml/runs'))).toBe(false);
    });

    test.each([['diverged'], ['behind']])('a commit off the default branch (%s: feature branch, fork PR) is refused before reading checks', async (status) => {
        const fetchImpl = useFakeGitHub(routes({
            [COMPARE('f')]: { body: { status, ahead_by: 1, behind_by: 2 } },
            [CHECKS('f')]: checks(checkRun('f')),
        }));
        await expect(deploy(sha('f'))).rejects.toMatchObject({ code: 'VERSION_NOT_VERIFIED' });
        expect(fetchImpl.calls.some((c) => c.path.endsWith('/check-runs'))).toBe(false);
        expect(dispatched(fetchImpl)).toBe(false);
    });

    test('an unknown commit (compare 404) is refused as unverified, not as an inaccessible repository', async () => {
        useFakeGitHub(routes({ [COMPARE('7')]: { status: 404, body: { message: 'Not Found' } } }));
        await expect(deploy(sha('7'))).rejects.toMatchObject({ code: 'VERSION_NOT_VERIFIED' });
    });

    test.each([
        ['another app', checkRun('d', { slug: 'some-ci-app' })],
        ['another job name', checkRun('d', { name: 'Lint' })],
        ['still running', checkRun('d', { status: 'in_progress', conclusion: null })],
        ['another commit', { ...checkRun('d'), head_sha: sha('8') }],
    ])('a passing check run of %s does not count', async (_, run) => {
        const fetchImpl = useFakeGitHub(routes({ [CHECKS('d')]: checks(run) }));
        await expect(deploy(sha('d'))).rejects.toMatchObject({ code: 'VERSION_NOT_VERIFIED' });
        expect(dispatched(fetchImpl)).toBe(false);
    });

    test.each([['CI (Python)'], ['CI (sitio estático)']])('every generated CI job name counts (%s)', async (name) => {
        const fetchImpl = useFakeGitHub(routes({ [CHECKS('d')]: checks(checkRun('d', { name })) }));
        await deploy(sha('d'));
        expect(dispatched(fetchImpl)).toBe(true);
    });

    test('GitHub lagging behind: the lookup is asked once more after a short wait', async () => {
        let calls = 0;
        const fetchImpl = useFakeGitHub(routes({
            [CHECKS('d')]: () => {
                calls += 1;
                return calls === 1 ? checks() : checks(checkRun('d'));
            },
        }));
        await deploy(sha('d'));
        expect(deployService._timing.sleep).toHaveBeenCalledTimes(1);
        expect(deployService._timing.sleep).toHaveBeenCalledWith(deployService._timing.retryDelayMs);
        expect(fetchImpl.calls.filter((c) => c.path.endsWith('/check-runs'))).toHaveLength(2);
        expect(dispatched(fetchImpl)).toBe(true);
    });

    test('still nothing after the retry → refused (asked exactly twice)', async () => {
        const fetchImpl = useFakeGitHub(routes({ [CHECKS('d')]: checks() }));
        await expect(deploy(sha('d'))).rejects.toMatchObject({ code: 'VERSION_NOT_VERIFIED' });
        expect(deployService._timing.sleep).toHaveBeenCalledTimes(1);
        expect(fetchImpl.calls.filter((c) => c.path.includes('/compare/'))).toHaveLength(2);
        expect(fetchImpl.calls.filter((c) => c.path.endsWith('/check-runs'))).toHaveLength(2);
    });

    test('a default branch with a slash is compared by its path segments', async () => {
        githubModel.getGroupRepository.mockResolvedValue({ ...REPO, defaultBranch: 'release/v1' });
        const fetchImpl = useFakeGitHub(routes({ [COMPARE('d', 'release/v1')]: { body: { status: 'ahead', ahead_by: 1, behind_by: 0 } } }));
        await deploy(sha('d'));
        expect(fetchImpl.calls.find((c) => c.path.includes('/compare/')).path).toBe(`${API}/compare/${sha('d')}...release/v1`);
        expect(dispatched(fetchImpl)).toBe(true);
    });
});

describe('deploy requests', () => {
    test('a member asks to promote the staging version: verified, stored and announced to the group', async () => {
        const fetchImpl = useFakeGitHub(routes());
        const request = await deployService.requestDeploy({ gid: GID, uid: MEMBER, version: sha('b') });
        expect(cicdModel.createDeployRequest).toHaveBeenCalledWith({ gid: GID, repoId: REPO.repoId, environment: 'production', versionSha: sha('b'), requestedBy: MEMBER });
        expect(request.status).toBe('pending');
        expect(realtime.publish).toHaveBeenCalledWith(GID, 'deploy_request', expect.objectContaining({ requestId: REQ, status: 'pending', shortSha: 'bbbbbbb' }));
        // The staging version was deployed by TaskMate: no CI lookup needed.
        expect(fetchImpl.calls.some((c) => c.path.includes('/compare/') || c.path.endsWith('/check-runs'))).toBe(false);
    });

    test('members can only ask for production', async () => {
        const fetchImpl = useFakeGitHub(routes());
        await expect(deployService.requestDeploy({ gid: GID, uid: MEMBER, environment: 'staging', version: sha('b') }))
            .rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
        expect(fetchImpl.calls).toHaveLength(0);
        expect(cicdModel.createDeployRequest).not.toHaveBeenCalled();
    });

    test('any version other than the live staging one → VERSION_NOT_STAGING, even a verified one', async () => {
        useFakeGitHub(routes());
        // a: inactive in staging and live in production; d: passed CI on main; 9: unknown.
        for (const c of ['a', 'd', '9']) {
            await expect(deployService.requestDeploy({ gid: GID, uid: MEMBER, version: sha(c) }))
                .rejects.toMatchObject({ code: 'VERSION_NOT_STAGING', status: 409 });
        }
        expect(cicdModel.createDeployRequest).not.toHaveBeenCalled();
    });

    test('nothing live in staging → nothing can be requested', async () => {
        useFakeGitHub(routes({ 'POST /graphql': graphqlRoute(HISTORY.filter((n) => n.environment === 'production')) }));
        await expect(deployService.requestDeploy({ gid: GID, uid: MEMBER, version: sha('b') })).rejects.toMatchObject({ code: 'VERSION_NOT_STAGING' });
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

    test('approve a request made for the previous repository → cancelled with a note, DEPLOY_REQUEST_STALE', async () => {
        const fetchImpl = useFakeGitHub(routes());
        cicdModel.getDeployRequest.mockResolvedValue(pending({ repoId: 999 }));
        await expect(deployService.approveRequest({ gid: GID, uid: ADMIN, username: 'admin', requestId: REQ }))
            .rejects.toMatchObject({ code: 'DEPLOY_REQUEST_STALE', status: 409 });
        expect(cicdModel.decideDeployRequest).toHaveBeenCalledTimes(1);
        expect(cicdModel.decideDeployRequest).toHaveBeenCalledWith({
            requestId: REQ, gid: GID, status: 'cancelled', decidedBy: ADMIN, note: 'El grupo cambió de repositorio.',
        });
        expect(realtime.publish).toHaveBeenCalledWith(GID, 'deploy_request', expect.objectContaining({ status: 'cancelled' }));
        expect(fetchImpl.calls).toHaveLength(0);
    });

    test('approve after staging moved on → cancelled with a note, DEPLOY_REQUEST_STALE, nothing dispatched', async () => {
        const fetchImpl = useFakeGitHub(routes());
        cicdModel.getDeployRequest.mockResolvedValue(pending({ versionSha: sha('a') }));
        await expect(deployService.approveRequest({ gid: GID, uid: ADMIN, requestId: REQ }))
            .rejects.toMatchObject({ code: 'DEPLOY_REQUEST_STALE' });
        expect(cicdModel.decideDeployRequest).toHaveBeenCalledWith({
            requestId: REQ, gid: GID, status: 'cancelled', decidedBy: ADMIN, note: 'La versión de staging cambió; pide de nuevo.',
        });
        expect(cicdModel.decideDeployRequest).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'approved' }));
        expect(fetchImpl.calls.some((c) => c.path.endsWith('/dispatches'))).toBe(false);
    });

    test('a stale request another admin decided meanwhile → DEPLOY_REQUEST_DECIDED', async () => {
        useFakeGitHub(routes());
        cicdModel.getDeployRequest.mockResolvedValue(pending({ repoId: 999 }));
        cicdModel.decideDeployRequest.mockResolvedValue(null);
        await expect(deployService.approveRequest({ gid: GID, uid: ADMIN, requestId: REQ })).rejects.toMatchObject({ code: 'DEPLOY_REQUEST_DECIDED' });
        expect(realtime.publish).not.toHaveBeenCalled();
    });

    test('a failed dispatch puts the request back to pending', async () => {
        useFakeGitHub(routes({ [DISPATCH]: { status: 404, body: { message: 'Not Found' } } }));
        await expect(deployService.approveRequest({ gid: GID, uid: ADMIN, requestId: REQ })).rejects.toMatchObject({ code: 'PIPELINE_NOT_CONFIGURED' });
        expect(cicdModel.reopenDeployRequest).toHaveBeenCalledWith({ requestId: REQ, gid: GID });
        expect(cicdModel.cancelApprovedDeployRequest).not.toHaveBeenCalled();
        expect(realtime.publish).not.toHaveBeenCalled();
    });

    test('a failed dispatch when a new request took the pending slot → the approved one is cancelled with a note', async () => {
        useFakeGitHub(routes({ [DISPATCH]: { status: 404, body: { message: 'Not Found' } } }));
        cicdModel.reopenDeployRequest.mockRejectedValue(new AppError('DEPLOY_REQUEST_PENDING', 'taken', 409));
        await expect(deployService.approveRequest({ gid: GID, uid: ADMIN, requestId: REQ })).rejects.toMatchObject({ code: 'PIPELINE_NOT_CONFIGURED' });
        expect(cicdModel.cancelApprovedDeployRequest).toHaveBeenCalledWith({
            requestId: REQ, gid: GID, note: 'No se pudo iniciar el deploy en GitHub; pide de nuevo.',
        });
        expect(realtime.publish).toHaveBeenCalledWith(GID, 'deploy_request', expect.objectContaining({ status: 'cancelled' }));
    });

    test('a failed dispatch after the group switched repositories → the approved one is cancelled, not reopened', async () => {
        useFakeGitHub(routes({ [DISPATCH]: { status: 404, body: { message: 'Not Found' } } }));
        cicdModel.reopenDeployRequest.mockResolvedValue(false);
        await expect(deployService.approveRequest({ gid: GID, uid: ADMIN, requestId: REQ })).rejects.toMatchObject({ code: 'PIPELINE_NOT_CONFIGURED' });
        expect(cicdModel.reopenDeployRequest).toHaveBeenCalledWith({ requestId: REQ, gid: GID });
        expect(cicdModel.cancelApprovedDeployRequest).toHaveBeenCalledWith({
            requestId: REQ, gid: GID, note: 'No se pudo iniciar el deploy en GitHub; pide de nuevo.',
        });
        expect(realtime.publish).toHaveBeenCalledWith(GID, 'deploy_request', expect.objectContaining({ status: 'cancelled' }));
    });

    test('nothing to undo (the request is no longer approved) → nothing is published', async () => {
        useFakeGitHub(routes({ [DISPATCH]: { status: 404, body: { message: 'Not Found' } } }));
        cicdModel.reopenDeployRequest.mockResolvedValue(false);
        cicdModel.cancelApprovedDeployRequest.mockResolvedValue(null);
        await expect(deployService.approveRequest({ gid: GID, uid: ADMIN, requestId: REQ })).rejects.toMatchObject({ code: 'PIPELINE_NOT_CONFIGURED' });
        expect(cicdModel.cancelApprovedDeployRequest).toHaveBeenCalled();
        expect(realtime.publish).not.toHaveBeenCalled();
    });

    test('a database error while reopening is logged, and the request is still closed', async () => {
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        useFakeGitHub(routes({ [DISPATCH]: { status: 404, body: { message: 'Not Found' } } }));
        cicdModel.reopenDeployRequest.mockRejectedValue(new Error('connection lost'));
        cicdModel.cancelApprovedDeployRequest.mockRejectedValue(new Error('connection lost again'));
        await expect(deployService.approveRequest({ gid: GID, uid: ADMIN, requestId: REQ })).rejects.toMatchObject({ code: 'PIPELINE_NOT_CONFIGURED' });
        expect(cicdModel.cancelApprovedDeployRequest).toHaveBeenCalled();
        expect(spy.mock.calls.map((c) => c.join(' ')).join('\n')).toMatch(/connection lost[\s\S]*connection lost again/);
        spy.mockRestore();
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

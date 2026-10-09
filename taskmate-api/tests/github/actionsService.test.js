jest.mock('../../models/github.model', () => ({ getGroupRepository: jest.fn() }));

const githubModel = require('../../models/github.model');
const actionsService = require('../../services/github/actionsService');
const { useFakeGitHub, tokenRoute, REPO } = require('./helpers/fakeGitHub');

const GID = REPO.gid;
const API = '/repos/octo/demo';
const SHA = 'd'.repeat(40);

const run = (extra = {}) => ({
    id: 901,
    name: 'TaskMate CI/CD',
    display_title: 'feat: login',
    workflow_id: 55,
    path: '.github/workflows/taskmate-ci.yml',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    head_branch: 'main',
    head_sha: SHA,
    run_number: 12,
    run_attempt: 1,
    actor: { login: 'ana', avatar_url: 'https://avatars/ana' },
    triggering_actor: { login: 'ana', avatar_url: 'https://avatars/ana' },
    created_at: '2026-10-09T10:00:00Z',
    run_started_at: '2026-10-09T10:00:05Z',
    updated_at: '2026-10-09T10:02:05Z',
    pull_requests: [{ number: 7 }],
    html_url: 'https://github.com/octo/demo/actions/runs/901',
    ...extra,
});

const job = (id, extra = {}) => ({
    id,
    name: `job ${id}`,
    status: 'completed',
    conclusion: 'success',
    started_at: '2026-10-09T10:00:10Z',
    completed_at: '2026-10-09T10:01:10Z',
    run_attempt: 1,
    html_url: `https://github.com/octo/demo/actions/runs/901/job/${id}`,
    steps: [{ number: 1, name: 'Checkout', status: 'completed', conclusion: 'success', started_at: '2026-10-09T10:00:10Z', completed_at: '2026-10-09T10:00:12Z' }],
    ...extra,
});

const tokenRoutes = { 'POST /app/installations/77/access_tokens': tokenRoute('ghs_actions') };

beforeEach(() => {
    githubModel.getGroupRepository.mockResolvedValue({ ...REPO });
});

describe('listRuns', () => {
    test('formats runs and asks for an actions:read token scoped to the repository', async () => {
        const fetchImpl = useFakeGitHub({ ...tokenRoutes, [`GET ${API}/actions/runs`]: { body: { total_count: 1, workflow_runs: [run()] } } });
        const result = await actionsService.listRuns(GID, { branch: 'main', status: 'failure', page: '2' });
        expect(result).toEqual({
            totalCount: 1,
            page: 2,
            perPage: actionsService.RUNS_PER_PAGE,
            runs: [{
                id: 901, name: 'TaskMate CI/CD', title: 'feat: login', workflowId: 55, workflowPath: '.github/workflows/taskmate-ci.yml',
                isTaskmate: true, event: 'push', status: 'completed', conclusion: 'success', branch: 'main', headSha: SHA, shortSha: 'ddddddd',
                runNumber: 12, attempt: 1, actor: { login: 'ana', avatarUrl: 'https://avatars/ana' }, triggeringActor: { login: 'ana', avatarUrl: 'https://avatars/ana' },
                createdAt: '2026-10-09T10:00:00Z', startedAt: '2026-10-09T10:00:05Z', updatedAt: '2026-10-09T10:02:05Z', durationMs: 120000,
                pullRequests: [7], htmlUrl: 'https://github.com/octo/demo/actions/runs/901',
            }],
        });
        const call = fetchImpl.calls.find((c) => c.path === `${API}/actions/runs`);
        expect(call.query).toEqual({ per_page: '20', page: '2', branch: 'main', status: 'failure' });
        const mint = fetchImpl.calls.find((c) => c.path.endsWith('/access_tokens'));
        expect(mint.body).toEqual({ permissions: { actions: 'read' }, repository_ids: [REPO.repoId] });
    });

    test('a workflow filter uses the workflow runs endpoint; running runs have no duration', async () => {
        useFakeGitHub({ ...tokenRoutes, [`GET ${API}/actions/workflows/55/runs`]: { body: { total_count: 1, workflow_runs: [run({ status: 'in_progress', conclusion: null })] } } });
        const result = await actionsService.listRuns(GID, { workflow: '55' });
        expect(result.runs[0]).toMatchObject({ status: 'in_progress', durationMs: null });
    });

    test.each([
        [{ page: '0' }],
        [{ page: '51' }],
        [{ page: 'x' }],
        [{ status: 'exploded' }],
        [{ workflow: '-1' }],
        [{ workflow: '1e3' }],
        [{ branch: '../main' }],
        [{ branch: 'a..b' }],
    ])('rejects %j before touching the DB or GitHub', async (opts) => {
        const fetchImpl = useFakeGitHub(tokenRoutes);
        await expect(actionsService.listRuns(GID, opts)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
        expect(githubModel.getGroupRepository).not.toHaveBeenCalled();
        expect(fetchImpl.calls).toHaveLength(0);
    });

    test('Actions permission missing in the installation', async () => {
        useFakeGitHub({ 'POST /app/installations/77/access_tokens': { status: 422, body: { message: 'The permissions requested are not granted to this installation.' } } });
        await expect(actionsService.listRuns(GID)).rejects.toMatchObject({ code: 'APP_PERMISSIONS_MISSING' });
    });
});

describe('listWorkflows', () => {
    test('marks the TaskMate workflow', async () => {
        useFakeGitHub({
            ...tokenRoutes,
            [`GET ${API}/actions/workflows`]: { body: { workflows: [
                { id: 55, name: 'TaskMate CI/CD', path: '.github/workflows/taskmate-ci.yml', state: 'active' },
                { id: 56, name: 'Other', path: '.github/workflows/other.yml', state: 'disabled_manually' },
            ] } },
        });
        await expect(actionsService.listWorkflows(GID)).resolves.toEqual([
            { id: 55, name: 'TaskMate CI/CD', path: '.github/workflows/taskmate-ci.yml', state: 'active', isTaskmate: true },
            { id: 56, name: 'Other', path: '.github/workflows/other.yml', state: 'disabled_manually', isTaskmate: false },
        ]);
    });
});

describe('getRun', () => {
    test('run with every job (paginated) and their steps', async () => {
        const page2 = `https://api.github.com${API}/actions/runs/901/jobs?filter=latest&per_page=100&page=2`;
        const fetchImpl = useFakeGitHub({
            ...tokenRoutes,
            [`GET ${API}/actions/runs/901`]: { body: run() },
            [`GET ${API}/actions/runs/901/jobs`]: (call) => (call.query.page === '2'
                ? { body: { jobs: [job(2)] } }
                : { body: { jobs: [job(1)] }, headers: { link: `<${page2}>; rel="next"` } }),
        });
        const result = await actionsService.getRun(GID, '901');
        expect(result.run.id).toBe(901);
        expect(result.jobs.map((j) => j.id)).toEqual([1, 2]);
        expect(result.jobs[0]).toMatchObject({ durationMs: 60000, steps: [{ number: 1, name: 'Checkout', durationMs: 2000 }] });
        expect(fetchImpl.calls.find((c) => c.path === `${API}/actions/runs/901/jobs`).query.filter).toBe('latest');
    });

    test('an unknown run (or one of another repository) is RUN_NOT_FOUND', async () => {
        useFakeGitHub({ ...tokenRoutes, [`GET ${API}/actions/runs/902`]: { status: 404, body: { message: 'Not Found' } } });
        await expect(actionsService.getRun(GID, 902)).rejects.toMatchObject({ code: 'RUN_NOT_FOUND', status: 404 });
    });

    test.each([['abc'], ['0'], ['-5'], ['12345678901234567']])('rejects run id %j', async (id) => {
        await expect(actionsService.getRun(GID, id)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
});

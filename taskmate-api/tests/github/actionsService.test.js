jest.mock('../../models/github.model', () => ({ getGroupRepository: jest.fn() }));
jest.mock('../../models/cicd.model', () => ({ getPipeline: jest.fn() }));

const githubModel = require('../../models/github.model');
const cicdModel = require('../../models/cicd.model');
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
    cicdModel.getPipeline.mockResolvedValue({ workflowPath: '.github/workflows/taskmate-ci.yml' });
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

describe('getJobLog', () => {
    const BLOB = 'https://pipelinesghubeus1.actions.githubusercontent.com/logs/job-77.txt?sig=abc';
    const logRoutes = (body, extra = {}) => ({
        ...tokenRoutes,
        [`GET ${API}/actions/jobs/77/logs`]: { status: 302, headers: { location: BLOB } },
        'GET /logs/job-77.txt': () => new Response(body, { status: 200 }),
        ...extra,
    });

    test('follows the redirect without the GitHub token and cleans the log', async () => {
        const log = [
            '2026-10-09T21:00:00.1234567Z ##[group]Run npm run lint',
            '2026-10-09T21:00:01.0000000Z \u001b[31m/src/a.js\u001b[0m',
            '2026-10-09T21:00:01.5000000Z   3:7  error  x is not defined  no-undef',
            '2026-10-09T21:00:02.0000000Z ##[error]Process completed with exit code 1.',
            '2026-10-09T21:00:02.1000000Z GROQ_API_KEY=gsk_abcdefghijklmnopqrstuvwxyz123456',
            '',
        ].join('\n');
        const fetchImpl = useFakeGitHub(logRoutes(log));
        const result = await actionsService.getJobLog(GID, '77');
        expect(result).toEqual({
            jobId: 77,
            lines: [
                '##[group]Run npm run lint',
                '/src/a.js',
                '  3:7  error  x is not defined  no-undef',
                '##[error]Process completed with exit code 1.',
                'GROQ_API_KEY=[REDACTED]',
            ],
            errors: ['Process completed with exit code 1.'],
            truncated: false,
        });
        const blobCall = fetchImpl.calls.find((c) => c.path === '/logs/job-77.txt');
        expect(blobCall.headers.Authorization).toBeUndefined();
        const apiCall = fetchImpl.calls.find((c) => c.path.endsWith('/actions/jobs/77/logs'));
        expect(apiCall.headers.Authorization).toBe('Bearer ghs_actions');
    });

    test('keeps only the tail of a long log and drops the cut first line', async () => {
        const line = (i) => `2026-10-09T21:00:00.0000000Z line ${String(i).padStart(6, '0')} ${'x'.repeat(80)}`;
        const big = Array.from({ length: 6000 }, (_, i) => line(i)).join('\n');
        useFakeGitHub(logRoutes(big));
        const result = await actionsService.getJobLog(GID, 77);
        expect(result.truncated).toBe(true);
        expect(result.lines.length).toBeLessThanOrEqual(3000);
        expect(result.lines[result.lines.length - 1]).toMatch(/^line 005999 /);
        expect(result.lines.every((l) => /^line \d{6} x+$/.test(l))).toBe(true);
    });

    test.each([
        ['http://pipelines.actions.githubusercontent.com/logs/x'],
        ['https://evil.example.com/logs/x'],
        ['https://actions.githubusercontent.com.evil.io/x'],
    ])('refuses a log location outside GitHub storage: %s', async (location) => {
        const fetchImpl = useFakeGitHub(logRoutes('x', { [`GET ${API}/actions/jobs/77/logs`]: { status: 302, headers: { location } } }));
        await expect(actionsService.getJobLog(GID, 77)).rejects.toMatchObject({ code: 'GITHUB_ERROR' });
        expect(fetchImpl.calls.some((c) => c.path === '/logs/x' || c.path === '/x')).toBe(false);
    });

    test.each([[404], [410]])('no log yet or expired (%i) → LOG_NOT_AVAILABLE', async (status) => {
        useFakeGitHub(logRoutes('x', { [`GET ${API}/actions/jobs/77/logs`]: { status, body: { message: 'Not Found' } } }));
        await expect(actionsService.getJobLog(GID, 77)).rejects.toMatchObject({ code: 'LOG_NOT_AVAILABLE', status: 404 });
    });

    test('rejects a bad job id before GitHub', async () => {
        await expect(actionsService.getJobLog(GID, '../x')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
});

describe('getJobAnnotations', () => {
    test('errors with file and line from the check run, secrets redacted', async () => {
        const fetchImpl = useFakeGitHub({
            ...tokenRoutes,
            [`GET ${API}/check-runs/77/annotations`]: { body: [
                { path: 'src/a.js', start_line: 3, end_line: 3, annotation_level: 'failure', title: 'no-undef', message: "'x' is not defined" },
                { path: '.github', start_line: 1, end_line: 1, annotation_level: 'warning', message: 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789' },
                { path: null, annotation_level: 'weird', message: 'm' },
            ] },
        });
        await expect(actionsService.getJobAnnotations(GID, 77)).resolves.toEqual([
            { path: 'src/a.js', startLine: 3, endLine: 3, level: 'failure', title: 'no-undef', message: "'x' is not defined" },
            { path: '.github', startLine: 1, endLine: 1, level: 'warning', title: null, message: 'token [REDACTED]' },
            { path: null, startLine: null, endLine: null, level: 'notice', title: null, message: 'm' },
        ]);
        const mint = fetchImpl.calls.find((c) => c.path.endsWith('/access_tokens'));
        expect(mint.body.permissions).toEqual({ checks: 'read' });
    });
});

describe('dispatchPipeline', () => {
    const DISPATCH = `POST ${API}/actions/workflows/taskmate-ci.yml/dispatches`;

    test('runs the TaskMate CI on an existing branch with an actions:write token', async () => {
        const fetchImpl = useFakeGitHub({
            ...tokenRoutes,
            [`GET ${API}/branches/feature/login`]: { body: { name: 'feature/login' } },
            [DISPATCH]: { status: 204 },
        });
        await expect(actionsService.dispatchPipeline(GID, { ref: 'feature/login' })).resolves.toEqual({ dispatched: true, ref: 'feature/login' });
        const call = fetchImpl.calls.find((c) => c.method === 'POST' && c.path.endsWith('/dispatches'));
        expect(call.body).toEqual({ ref: 'feature/login', inputs: { environment: 'none' } });
        const mints = fetchImpl.calls.filter((c) => c.path.endsWith('/access_tokens')).map((c) => c.body.permissions);
        expect(mints).toContainEqual({ actions: 'write' });
    });

    test('needs a TaskMate pipeline and a real branch (not a commit)', async () => {
        useFakeGitHub({ ...tokenRoutes, [`GET ${API}/branches/nope`]: { status: 404, body: { message: 'Branch not found' } } });
        await expect(actionsService.dispatchPipeline(GID, { ref: 'a'.repeat(40) })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(actionsService.dispatchPipeline(GID, { ref: 'nope' })).rejects.toMatchObject({ code: 'BRANCH_NOT_FOUND' });
        cicdModel.getPipeline.mockResolvedValue(null);
        await expect(actionsService.dispatchPipeline(GID, { ref: 'main' })).rejects.toMatchObject({ code: 'PIPELINE_NOT_CONFIGURED', status: 409 });
    });

    test('a branch whose workflow cannot be dispatched → PIPELINE_OUTDATED', async () => {
        useFakeGitHub({
            ...tokenRoutes,
            [`GET ${API}/branches/old`]: { body: { name: 'old' } },
            [DISPATCH]: { status: 422, body: { message: "Workflow does not have 'workflow_dispatch' trigger" } },
        });
        await expect(actionsService.dispatchPipeline(GID, { ref: 'old' })).rejects.toMatchObject({ code: 'PIPELINE_OUTDATED' });
    });
});

describe('rerunFailed / cancelRun', () => {
    const deployRun = run({ event: 'workflow_dispatch', display_title: 'Deploy a production desde TaskMate', conclusion: 'failure' });

    test('re-runs the failed jobs of a failed run', async () => {
        const fetchImpl = useFakeGitHub({
            ...tokenRoutes,
            [`GET ${API}/actions/runs/901`]: { body: run({ conclusion: 'failure' }) },
            [`POST ${API}/actions/runs/901/rerun-failed-jobs`]: { status: 201, body: {} },
        });
        await expect(actionsService.rerunFailed(GID, '901')).resolves.toEqual({ rerun: true, runId: 901 });
        expect(fetchImpl.calls.some((c) => c.method === 'POST' && c.path.endsWith('/rerun-failed-jobs'))).toBe(true);
    });

    test('a successful or running run cannot be re-run', async () => {
        useFakeGitHub({ ...tokenRoutes, [`GET ${API}/actions/runs/901`]: { body: run() } });
        await expect(actionsService.rerunFailed(GID, 901)).rejects.toMatchObject({ code: 'RUN_NOT_RERUNNABLE', status: 409 });
        useFakeGitHub({ ...tokenRoutes, [`GET ${API}/actions/runs/901`]: { body: run({ status: 'in_progress', conclusion: null }) } });
        await expect(actionsService.rerunFailed(GID, 901)).rejects.toMatchObject({ code: 'RUN_NOT_RERUNNABLE' });
    });

    test('deploy runs are admin-only to re-run or cancel', async () => {
        const fetchImpl = useFakeGitHub({
            ...tokenRoutes,
            [`GET ${API}/actions/runs/901`]: { body: deployRun },
            [`POST ${API}/actions/runs/901/rerun-failed-jobs`]: { status: 201, body: {} },
        });
        await expect(actionsService.rerunFailed(GID, 901, { isAdmin: false })).rejects.toMatchObject({ code: 'NOT_GROUP_ADMIN', status: 403 });
        await expect(actionsService.cancelRun(GID, 901, { isAdmin: false })).rejects.toMatchObject({ code: 'NOT_GROUP_ADMIN' });
        expect(fetchImpl.calls.some((c) => c.method === 'POST' && c.path.includes('/runs/901/'))).toBe(false);
        await expect(actionsService.rerunFailed(GID, 901, { isAdmin: true })).resolves.toMatchObject({ rerun: true });
    });

    test('cancels a running run; a finished one is RUN_NOT_CANCELLABLE', async () => {
        useFakeGitHub({
            ...tokenRoutes,
            [`GET ${API}/actions/runs/901`]: { body: run({ status: 'in_progress', conclusion: null }) },
            [`POST ${API}/actions/runs/901/cancel`]: { status: 202, body: {} },
        });
        await expect(actionsService.cancelRun(GID, 901)).resolves.toEqual({ cancelled: true, runId: 901 });
        useFakeGitHub({ ...tokenRoutes, [`GET ${API}/actions/runs/901`]: { body: run() } });
        await expect(actionsService.cancelRun(GID, 901)).rejects.toMatchObject({ code: 'RUN_NOT_CANCELLABLE', status: 409 });
    });

    test('GitHub refusing the re-run (too old) → RUN_NOT_RERUNNABLE', async () => {
        useFakeGitHub({
            ...tokenRoutes,
            [`GET ${API}/actions/runs/901`]: { body: run({ conclusion: 'failure' }) },
            [`POST ${API}/actions/runs/901/rerun-failed-jobs`]: { status: 403, body: { message: 'Unable to retry this workflow run because it was created over a month ago' } },
        });
        await expect(actionsService.rerunFailed(GID, 901)).rejects.toMatchObject({ code: 'RUN_NOT_RERUNNABLE' });
    });
});

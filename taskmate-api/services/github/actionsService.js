// Phase 4: GitHub Actions of the group's repository inside TaskMate — workflow runs, their jobs and
// steps. GitHub is the source of truth: nothing here is stored, every call reads it live.
const { AppError } = require('../../helpers/errors');
const { githubApp, PERMISSIONS } = require('./githubApp');
const repoService = require('./repoService');
const { WORKFLOW_PATH } = require('./pipelineSpec');

const RUNS_PER_PAGE = 20;
const MAX_PAGE = 50;
const MAX_JOBS = 100;
const MAX_TITLE = 300;
const RUN_STATUSES = new Set([
    'queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending',
    'success', 'failure', 'cancelled', 'skipped', 'timed_out', 'action_required', 'neutral', 'stale',
]);

const { repoAuth, repoPath, scope, validateRef } = repoService;
const invalid = (message) => new AppError('VALIDATION_ERROR', message, 400);

const positiveId = (value, name) => {
    const n = typeof value === 'number' ? value : (typeof value === 'string' && /^\d{1,16}$/.test(value) ? Number(value) : NaN);
    if (!Number.isSafeInteger(n) || n <= 0) throw invalid(`${name} must be a positive integer`);
    return n;
};

const durationMs = (start, end) => {
    const a = Date.parse(start);
    const b = Date.parse(end);
    return Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : null;
};

const actor = (user) => (user && user.login ? { login: String(user.login), avatarUrl: user.avatar_url || null } : null);

const formatRun = (run) => ({
    id: Number(run.id),
    name: run.name || null,
    title: String(run.display_title || run.name || '').slice(0, MAX_TITLE),
    workflowId: run.workflow_id ? Number(run.workflow_id) : null,
    workflowPath: run.path || null,
    isTaskmate: typeof run.path === 'string' && run.path.split('@')[0] === WORKFLOW_PATH,
    event: run.event || null,
    status: run.status || null,
    conclusion: run.conclusion || null,
    branch: run.head_branch || null,
    headSha: run.head_sha || null,
    shortSha: String(run.head_sha || '').slice(0, 7),
    runNumber: run.run_number || null,
    attempt: run.run_attempt || 1,
    actor: actor(run.actor),
    triggeringActor: actor(run.triggering_actor),
    createdAt: run.created_at || null,
    startedAt: run.run_started_at || run.created_at || null,
    updatedAt: run.updated_at || null,
    durationMs: run.status === 'completed' ? durationMs(run.run_started_at || run.created_at, run.updated_at) : null,
    pullRequests: (Array.isArray(run.pull_requests) ? run.pull_requests : []).map((pr) => Number(pr.number)).filter(Boolean),
    htmlUrl: run.html_url || null,
});

const formatStep = (s) => ({
    number: Number(s.number),
    name: String(s.name || ''),
    status: s.status || null,
    conclusion: s.conclusion || null,
    startedAt: s.started_at || null,
    completedAt: s.completed_at || null,
    durationMs: durationMs(s.started_at, s.completed_at),
});

const formatJob = (job) => ({
    id: Number(job.id),
    name: String(job.name || ''),
    status: job.status || null,
    conclusion: job.conclusion || null,
    startedAt: job.started_at || null,
    completedAt: job.completed_at || null,
    durationMs: durationMs(job.started_at, job.completed_at),
    runAttempt: job.run_attempt || 1,
    htmlUrl: job.html_url || null,
    steps: (Array.isArray(job.steps) ? job.steps : []).map(formatStep),
});

const parsePage = (page) => {
    if (page === undefined || page === null || page === '') return 1;
    const n = Number(page);
    if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE) throw invalid(`page must be between 1 and ${MAX_PAGE}`);
    return n;
};

const parseStatus = (status) => {
    if (status === undefined || status === null || status === '') return undefined;
    if (typeof status !== 'string' || !RUN_STATUSES.has(status)) throw invalid('status is invalid');
    return status;
};

const parseWorkflow = (workflow) => (workflow === undefined || workflow === null || workflow === ''
    ? undefined
    : positiveId(workflow, 'workflow'));

const validateListOptions = ({ branch, status, workflow, page } = {}) => ({
    branch: validateRef(branch) || undefined,
    status: parseStatus(status),
    workflow: parseWorkflow(workflow),
    page: parsePage(page),
});

/** Workflows of the repository (for the filter): [{id, name, path, state, isTaskmate}]. */
const listWorkflowsForRepo = async (repo) => {
    const { data } = await githubApp.request(repoAuth(repo), 'GET', `${repoPath(repo)}/actions/workflows`, {
        ...scope(repo, PERMISSIONS.actionsRead),
        query: { per_page: 100 },
    });
    return (Array.isArray(data && data.workflows) ? data.workflows : []).map((w) => ({
        id: Number(w.id),
        name: String(w.name || w.path || ''),
        path: w.path || null,
        state: w.state || null,
        isTaskmate: w.path === WORKFLOW_PATH,
    }));
};

/** Runs, newest first: {runs, totalCount, page, perPage}. */
const listRunsForRepo = async (repo, opts = {}) => {
    const { branch, status, workflow, page } = validateListOptions(opts);
    const path = workflow
        ? `${repoPath(repo)}/actions/workflows/${workflow}/runs`
        : `${repoPath(repo)}/actions/runs`;
    const { data } = await githubApp.request(repoAuth(repo), 'GET', path, {
        ...scope(repo, PERMISSIONS.actionsRead),
        query: { per_page: RUNS_PER_PAGE, page, branch, status },
        notFoundCode: 'NOT_FOUND',
    });
    const runs = Array.isArray(data && data.workflow_runs) ? data.workflow_runs : [];
    return {
        runs: runs.map(formatRun),
        totalCount: Number(data && data.total_count) || 0,
        page,
        perPage: RUNS_PER_PAGE,
    };
};

/** One run with its jobs and their steps (latest attempt). */
const getRunForRepo = async (repo, runId) => {
    const id = positiveId(runId, 'runId');
    const auth = repoAuth(repo);
    const runScope = scope(repo, PERMISSIONS.actionsRead);
    const { data: run } = await githubApp.request(auth, 'GET', `${repoPath(repo)}/actions/runs/${id}`, {
        ...runScope,
        notFoundCode: 'RUN_NOT_FOUND',
    });
    if (!run || !run.id) throw new AppError('RUN_NOT_FOUND', 'Workflow run not found', 404);
    const jobs = await githubApp.paginate(auth, `${repoPath(repo)}/actions/runs/${id}/jobs`, {
        ...runScope,
        query: { filter: 'latest' },
        itemsKey: 'jobs',
        maxItems: MAX_JOBS,
    });
    return { run: formatRun(run), jobs: jobs.map(formatJob) };
};

module.exports = {
    formatRun,
    formatJob,
    positiveId,
    validateListOptions,
    listWorkflowsForRepo,
    listRunsForRepo,
    getRunForRepo,
    RUNS_PER_PAGE,
    // Input is validated before touching the DB or GitHub.
    listWorkflows: async (gid) => listWorkflowsForRepo(await repoService.getConnectedRepo(gid)),
    listRuns: async (gid, opts = {}) => {
        validateListOptions(opts);
        return listRunsForRepo(await repoService.getConnectedRepo(gid), opts);
    },
    getRun: async (gid, runId) => {
        positiveId(runId, 'runId');
        return getRunForRepo(await repoService.getConnectedRepo(gid), runId);
    },
};

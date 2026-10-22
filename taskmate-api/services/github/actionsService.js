// Phase 4: GitHub Actions of the group's repository inside TaskMate — workflow runs, their jobs and
// steps. GitHub is the source of truth: nothing here is stored, every call reads it live.
const { StringDecoder } = require('string_decoder');
const { AppError } = require('../../helpers/errors');
const cicdModel = require('../../models/cicd.model');
const { githubApp, PERMISSIONS } = require('./githubApp');
const repoService = require('./repoService');
const { redactSecrets } = require('./repoSnapshot');
const { WORKFLOW_PATH } = require('./pipelineSpec');

const RUNS_PER_PAGE = 20;
const MAX_PAGE = 50;
const MAX_JOBS = 100;
const MAX_TITLE = 300;
const RUN_STATUSES = new Set([
    'queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending',
    'success', 'failure', 'cancelled', 'skipped', 'timed_out', 'action_required', 'neutral', 'stale',
]);

// Job logs: GitHub answers with a redirect to a short-lived storage URL. The whole log is streamed
// (up to MAX_LOG_DOWNLOAD) but only its tail is kept: that is where a failure shows up.
const MAX_LOG_DOWNLOAD = 20 * 1024 * 1024;
const LOG_TAIL_BYTES = 256 * 1024;
const MAX_LOG_LINES = 3000;
const MAX_LOG_LINE = 2000;
const LOG_TIMEOUT_MS = 20 * 1000;
const LOG_HOST_SUFFIXES = ['.actions.githubusercontent.com', '.blob.core.windows.net', '.githubusercontent.com'];
const MAX_ANNOTATIONS = 50;
const MAX_ANNOTATION_TEXT = 1000;
const WORKFLOW_FILE = WORKFLOW_PATH.slice(WORKFLOW_PATH.lastIndexOf('/') + 1);
const RERUNNABLE = new Set(['failure', 'cancelled', 'timed_out', 'startup_failure']);

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

// ---------------------------------------------------------------- logs and annotations

const isAllowedLogUrl = (value) => {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && LOG_HOST_SUFFIXES.some((suffix) => url.hostname.endsWith(suffix));
    } catch {
        return false;
    }
};

const logUnavailable = () => new AppError('LOG_NOT_AVAILABLE', 'The log of this job is not available (still running or expired)', 404);

// Keeps the last LOG_TAIL_BYTES of a streamed body. → {buffer, truncated}
const readTail = async (body) => {
    const reader = body.getReader();
    let chunks = [];
    let kept = 0;
    let total = 0;
    let truncated = false;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.length;
            chunks.push(Buffer.from(value));
            kept += value.length;
            while (kept - chunks[0].length >= LOG_TAIL_BYTES) {
                kept -= chunks[0].length;
                chunks.shift();
                truncated = true;
            }
            if (total > MAX_LOG_DOWNLOAD) {
                truncated = true;
                break;
            }
        }
    } finally {
        reader.cancel().catch(() => {});
    }
    let buffer = Buffer.concat(chunks);
    if (buffer.length > LOG_TAIL_BYTES) {
        buffer = buffer.subarray(buffer.length - LOG_TAIL_BYTES);
        truncated = true;
    }
    return { buffer, truncated };
};

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z ?/;

/** Log text → {lines, errors}: no timestamps, no ANSI colors, secrets redacted, at most MAX_LOG_LINES. */
const parseLog = (text, { truncated = false } = {}) => {
    let lines = text.split(/\r?\n/);
    // A cut tail starts in the middle of a line.
    if (truncated && lines.length > 1) lines = lines.slice(1);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines = lines.map((line) => redactSecrets(line.replace(ANSI_RE, '').replace(TIMESTAMP_RE, '')).slice(0, MAX_LOG_LINE));
    if (lines.length > MAX_LOG_LINES) {
        lines = lines.slice(lines.length - MAX_LOG_LINES);
        truncated = true;
    }
    const errors = lines.filter((line) => line.startsWith('##[error]')).map((line) => line.slice('##[error]'.length));
    return { lines, errors, truncated };
};

/** The end of a job's log: {jobId, lines, errors, truncated}. */
const getJobLogForRepo = async (repo, jobId) => {
    const id = positiveId(jobId, 'jobId');
    const { status, headers } = await githubApp.request(repoAuth(repo), 'GET', `${repoPath(repo)}/actions/jobs/${id}/logs`, {
        ...scope(repo, PERMISSIONS.actionsRead),
        redirect: 'manual',
        allowStatus: [301, 302, 307, 404, 410],
    });
    const location = headers.get('location');
    if (status === 404 || status === 410 || !location) throw logUnavailable();
    if (!isAllowedLogUrl(location)) throw new AppError('GITHUB_ERROR', 'GitHub returned an unexpected log location', 502);

    let res;
    try {
        res = await githubApp.fetch(location, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(LOG_TIMEOUT_MS) });
    } catch {
        throw new AppError('GITHUB_ERROR', 'The job log could not be downloaded', 502);
    }
    if (res.status === 404 || res.status === 410) throw logUnavailable();
    if (!res.ok || !res.body) throw new AppError('GITHUB_ERROR', 'The job log could not be downloaded', 502);
    const { buffer, truncated } = await readTail(res.body);
    const text = new StringDecoder('utf8').end(buffer);
    return { jobId: id, ...parseLog(text, { truncated }) };
};

const ANNOTATION_LEVELS = new Set(['notice', 'warning', 'failure']);

/** Annotations of a job (errors and warnings with file and line). A job id is also its check run id. */
const getJobAnnotationsForRepo = async (repo, jobId) => {
    const id = positiveId(jobId, 'jobId');
    const { data } = await githubApp.request(repoAuth(repo), 'GET', `${repoPath(repo)}/check-runs/${id}/annotations`, {
        ...scope(repo, PERMISSIONS.checksRead),
        query: { per_page: MAX_ANNOTATIONS },
        notFoundCode: 'NOT_FOUND',
    });
    return (Array.isArray(data) ? data : []).slice(0, MAX_ANNOTATIONS).map((a) => ({
        path: typeof a.path === 'string' ? a.path : null,
        startLine: Number(a.start_line) || null,
        endLine: Number(a.end_line) || null,
        level: ANNOTATION_LEVELS.has(a.annotation_level) ? a.annotation_level : 'notice',
        title: a.title ? redactSecrets(String(a.title)).slice(0, 200) : null,
        message: redactSecrets(String(a.message || '')).slice(0, MAX_ANNOTATION_TEXT),
    }));
};

// ---------------------------------------------------------------- run, re-run, cancel

// Deploy runs dispatched by TaskMate (production promotions, rollbacks) are admin-only to
// re-run or cancel: re-running an old production deploy would be a rollback by a member.
const isDeployRun = (run) => run.isTaskmate && run.event === 'workflow_dispatch' && /^Deploy a /.test(run.title || '');

const assertCanControl = (run, isAdmin) => {
    if (isDeployRun(run) && !isAdmin) {
        throw new AppError('NOT_GROUP_ADMIN', 'Only the group admin can re-run or cancel a deploy', 403);
    }
};

const requirePipeline = async (repo) => {
    const pipeline = await cicdModel.getPipeline(repo.repoId);
    if (!pipeline) throw new AppError('PIPELINE_NOT_CONFIGURED', 'This repository has no TaskMate pipeline yet', 409);
    return pipeline;
};

/** Runs the TaskMate pipeline (CI only) on a branch. */
const dispatchPipelineForRepo = async (repo, { ref } = {}) => {
    const branch = validateRef(ref);
    if (!branch || /^[0-9a-f]{7,40}$/i.test(branch)) throw invalid('ref must be a branch name');
    await requirePipeline(repo);
    const encoded = branch.split('/').map(encodeURIComponent).join('/');
    await githubApp.request(repoAuth(repo), 'GET', `${repoPath(repo)}/branches/${encoded}`, {
        ...scope(repo),
        notFoundCode: 'BRANCH_NOT_FOUND',
    });
    const { status, data } = await githubApp.request(repoAuth(repo), 'POST', `${repoPath(repo)}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
        ...scope(repo, PERMISSIONS.actionsWrite),
        body: { ref: branch, inputs: { environment: 'none' } },
        allowStatus: [404, 422],
        notFoundCode: 'PIPELINE_NOT_CONFIGURED',
    });
    if (status === 404) throw new AppError('PIPELINE_NOT_CONFIGURED', 'The TaskMate workflow is not on GitHub', 409);
    if (status === 422) {
        const message = data && typeof data.message === 'string' ? data.message : '';
        if (/workflow_dispatch/i.test(message)) throw new AppError('PIPELINE_OUTDATED', 'The workflow on that branch cannot be run from TaskMate', 409);
        throw new AppError('GITHUB_ERROR', 'GitHub rejected the run', 502);
    }
    return { dispatched: true, ref: branch };
};

const fetchRun = async (repo, runId) => {
    const { data } = await githubApp.request(repoAuth(repo), 'GET', `${repoPath(repo)}/actions/runs/${runId}`, {
        ...scope(repo, PERMISSIONS.actionsRead),
        notFoundCode: 'RUN_NOT_FOUND',
    });
    if (!data || !data.id) throw new AppError('RUN_NOT_FOUND', 'Workflow run not found', 404);
    return formatRun(data);
};

/** Re-runs the failed jobs of a finished run. */
const rerunFailedForRepo = async (repo, runId, { isAdmin = false } = {}) => {
    const id = positiveId(runId, 'runId');
    const run = await fetchRun(repo, id);
    assertCanControl(run, isAdmin);
    if (run.status !== 'completed' || !RERUNNABLE.has(run.conclusion)) {
        throw new AppError('RUN_NOT_RERUNNABLE', 'Only a finished run with failed jobs can be re-run', 409);
    }
    const { status } = await githubApp.request(repoAuth(repo), 'POST', `${repoPath(repo)}/actions/runs/${id}/rerun-failed-jobs`, {
        ...scope(repo, PERMISSIONS.actionsWrite),
        allowStatus: [403, 409, 422],
    });
    if (status === 403 || status === 409 || status === 422) {
        throw new AppError('RUN_NOT_RERUNNABLE', 'GitHub cannot re-run this run (too old, or already running)', 409);
    }
    return { rerun: true, runId: id };
};

/** Cancels a queued or running run. */
const cancelRunForRepo = async (repo, runId, { isAdmin = false } = {}) => {
    const id = positiveId(runId, 'runId');
    const run = await fetchRun(repo, id);
    assertCanControl(run, isAdmin);
    if (run.status === 'completed') throw new AppError('RUN_NOT_CANCELLABLE', 'The run already finished', 409);
    const { status } = await githubApp.request(repoAuth(repo), 'POST', `${repoPath(repo)}/actions/runs/${id}/cancel`, {
        ...scope(repo, PERMISSIONS.actionsWrite),
        allowStatus: [409],
    });
    if (status === 409) throw new AppError('RUN_NOT_CANCELLABLE', 'The run already finished', 409);
    return { cancelled: true, runId: id };
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
    parseLog,
    isAllowedLogUrl,
    isDeployRun,
    getJobLogForRepo,
    getJobAnnotationsForRepo,
    dispatchPipelineForRepo,
    rerunFailedForRepo,
    cancelRunForRepo,
    getJobLog: async (gid, jobId) => {
        positiveId(jobId, 'jobId');
        return getJobLogForRepo(await repoService.getConnectedRepo(gid), jobId);
    },
    getJobAnnotations: async (gid, jobId) => {
        positiveId(jobId, 'jobId');
        return getJobAnnotationsForRepo(await repoService.getConnectedRepo(gid), jobId);
    },
    dispatchPipeline: async (gid, opts = {}) => {
        validateRef(opts.ref);
        return dispatchPipelineForRepo(await repoService.getConnectedRepo(gid), opts);
    },
    rerunFailed: async (gid, runId, opts = {}) => {
        positiveId(runId, 'runId');
        return rerunFailedForRepo(await repoService.getConnectedRepo(gid), runId, opts);
    },
    cancelRun: async (gid, runId, opts = {}) => {
        positiveId(runId, 'runId');
        return cancelRunForRepo(await repoService.getConnectedRepo(gid), runId, opts);
    },
};

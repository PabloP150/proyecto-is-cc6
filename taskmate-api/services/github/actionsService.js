// Phase 4: GitHub Actions of the group's repository inside TaskMate — workflow runs, their jobs and
// steps. GitHub is the source of truth: nothing here is stored, every call reads it live.
const { StringDecoder } = require('string_decoder');
const { AppError } = require('../../helpers/errors');
const cicdModel = require('../../models/cicd.model');
const { githubApp, PERMISSIONS, rateLimitError } = require('./githubApp');
const repoService = require('./repoService');
const { redactSecrets, REDACTED } = require('./repoSnapshot');
const { WORKFLOW_PATH } = require('./pipelineSpec');

const RUNS_PER_PAGE = 20;
const MAX_PAGE = 50;
const MAX_JOBS = 100;
const MAX_TITLE = 300;
const RUN_STATUSES = new Set([
    'queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending',
    'success', 'failure', 'cancelled', 'skipped', 'timed_out', 'action_required', 'neutral', 'stale',
]);

// Job logs: GitHub answers with a redirect to a short-lived storage URL. Only the tail of the log is
// kept, that is where a failure shows up: a long log is asked for with a Range header, and a server
// that ignores it is streamed (up to MAX_LOG_DOWNLOAD) keeping only the last bytes.
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
const downloadFailed = () => new AppError('GITHUB_ERROR', 'The job log could not be downloaded', 502);

/**
 * Keeps the last LOG_TAIL_BYTES of a streamed body, reading at most MAX_LOG_DOWNLOAD (plus the chunk
 * that crosses it). → {buffer, truncated, endMissing}; endMissing: the cap stopped the read before
 * the end, so the bytes kept are not the end of the log.
 */
const readTail = async (body) => {
    const reader = body.getReader();
    const chunks = [];
    let kept = 0;
    let total = 0;
    let truncated = false;
    let endMissing = false;
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
                endMissing = true;
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
    return { buffer, truncated, endMissing };
};

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z ?/;
const KEY_BEGIN_RE = /-----BEGIN [A-Z0-9 ]*KEY( BLOCK)?-----/;
const KEY_END_RE = /-----END [A-Z0-9 ]*KEY( BLOCK)?-----/;
// The lines a printed key is made of: base64 (an armor checksum starts with '=') and PEM/PGP headers.
const KEY_BASE64_RE = /^\s*=?[A-Za-z0-9+/]+={0,2}\s*$/;
const KEY_HEADER_RE = /^\s*(Proc-Type|DEK-Info|Version|Comment|Hash|Charset):/i;
const KEY_LINE_MIN = 16;

// A tool that prefixes its output ("#5 0.123 " in BuildKit, "web-1  | " in compose, indentation)
// puts the prefix of the marker line, digits aside, on every line of the key: it is skipped.
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const linePrefix = (prefix) => new RegExp(`^${escapeRegExp(prefix).replace(/\d+/g, '\\d+')}`);

/**
 * How many lines from `start` are the body of a printed key. A short base64 line counts only where
 * the key ends (END line next, or the end of the text: a tail cut by the download cap), and a blank
 * line only before more key lines (after the headers of an encrypted key), so a "Done" or a blank
 * line after a lone BEGIN marker is still shown.
 */
const keyBodyLength = (lines, start, prefix) => {
    const content = (line) => (line === undefined ? undefined : line.replace(prefix, ''));
    const isFull = (text) => text !== undefined && KEY_BASE64_RE.test(text) && text.trim().length >= KEY_LINE_MIN;
    let i = start;
    for (; i < lines.length; i += 1) {
        const text = content(lines[i]);
        const next = lines[i + 1];
        if (isFull(text) || KEY_HEADER_RE.test(text)) continue;
        if (KEY_BASE64_RE.test(text) && (next === undefined || KEY_END_RE.test(next))) continue;
        if (!text.trim() && isFull(content(next))) continue;
        break;
    }
    return i - start;
};

/**
 * A private key printed over several lines becomes one "[REDACTED]" line: its BEGIN line, its body
 * and its END line. A BEGIN marker with no key after it (a secret scanner's finding, a test) only
 * hides the rest of its own line, so the lines after it, ##[error] included, stay visible.
 */
const redactKeyBlocks = (lines) => {
    const out = [];
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const begin = KEY_BEGIN_RE.exec(line);
        // A key on one line ("\n" escapes in JSON) is left to redactSecrets.
        if (!begin || KEY_END_RE.test(line.slice(begin.index))) {
            out.push(line);
            continue;
        }
        const prefix = line.slice(0, begin.index);
        let last = i + keyBodyLength(lines, i + 1, linePrefix(prefix));
        let rest = '';
        const end = last + 1 < lines.length ? KEY_END_RE.exec(lines[last + 1]) : null;
        if (end) {
            last += 1;
            rest = lines[last].slice(end.index + end[0].length);
        }
        out.push(`${prefix}${REDACTED}${rest}`);
        i = last;
    }
    return out;
};

// A tail cut inside a private key starts with the rest of its body and its END line, with no BEGIN
// before them: those lines are hidden. An END marker after ordinary lines hides nothing.
const hideCutKey = (lines) => {
    const at = lines.findIndex((line) => KEY_END_RE.test(line));
    if (at === -1) return lines;
    const endLine = lines[at];
    const end = KEY_END_RE.exec(endLine);
    if (keyBodyLength(lines, 0, linePrefix(endLine.slice(0, end.index))) !== at) return lines;
    return [`${endLine.slice(0, end.index)}${REDACTED}${endLine.slice(end.index + end[0].length)}`, ...lines.slice(at + 1)];
};

/** Log text → {lines, errors}: no timestamps, no ANSI colors, secrets redacted, at most MAX_LOG_LINES. */
const parseLog = (text, { truncated = false } = {}) => {
    let lines = text.split(/\r?\n/);
    // A cut tail starts in the middle of a line.
    if (truncated && lines.length > 1) lines = lines.slice(1);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines = lines.map((line) => line.replace(ANSI_RE, '').replace(TIMESTAMP_RE, ''));
    if (truncated) lines = hideCutKey(lines);
    // Keys span lines and go first; every other secret is redacted line by line, so no pattern
    // reaches into the next line.
    lines = redactKeyBlocks(lines);
    if (lines.length > MAX_LOG_LINES) {
        lines = lines.slice(lines.length - MAX_LOG_LINES);
        truncated = true;
    }
    lines = lines.map((line) => redactSecrets(line).slice(0, MAX_LOG_LINE));
    const errors = lines.filter((line) => line.startsWith('##[error]')).map((line) => line.slice('##[error]'.length));
    return { lines, errors, truncated };
};

const fetchLog = async (location, signal, range) => {
    try {
        return await githubApp.fetch(location, {
            method: 'GET',
            headers: range ? { Range: range } : {},
            redirect: 'error',
            signal,
        });
    } catch {
        throw downloadFailed();
    }
};

const contentLength = (res) => {
    const value = res.headers.get('content-length');
    const n = value === null ? NaN : Number(value);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
};

/**
 * The end of a job's log: {jobId, lines, errors, truncated, endMissing}. truncated: the start of the
 * log is left out; endMissing: the log is over MAX_LOG_DOWNLOAD and its storage ignored the Range
 * header, so the lines are not its end (rare: GitHub's log storage is Azure Blob, which honours it).
 */
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

    // One deadline for the whole download, the ranged request included.
    const signal = AbortSignal.timeout(LOG_TIMEOUT_MS);
    let res = await fetchLog(location, signal);
    if (res.status === 404 || res.status === 410) throw logUnavailable();
    if (!res.ok || !res.body) throw downloadFailed();
    let ranged = false;
    const length = contentLength(res);
    if (length !== null && length > LOG_TAIL_BYTES) {
        res.body.cancel().catch(() => {});
        res = await fetchLog(location, signal, `bytes=${length - LOG_TAIL_BYTES}-`);
        if (res.status === 404 || res.status === 410) throw logUnavailable();
        // 206: only the tail came. 200: Range was ignored, the whole log is streamed below.
        if ((res.status !== 206 && res.status !== 200) || !res.body) throw downloadFailed();
        ranged = res.status === 206;
    }
    let tail;
    try {
        tail = await readTail(res.body);
    } catch {
        // The connection dropped ("terminated") or the deadline passed mid-download.
        throw downloadFailed();
    }
    const text = new StringDecoder('utf8').end(tail.buffer);
    return { jobId: id, ...parseLog(text, { truncated: tail.truncated || ranged }), endMissing: tail.endMissing };
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

// A 422 about the workflow or its inputs: the branch has no TaskMate workflow, or one older than the
// inputs TaskMate sends ("does not have 'workflow_dispatch' trigger", "Unexpected inputs provided",
// "not in the list of allowed values"...). Merging the default branch into it fixes it.
const WORKFLOW_REJECTED_RE = /workflow_dispatch|unexpected inputs|allowed values|input/i;

/** Runs the TaskMate pipeline (CI only) on a branch. */
const dispatchPipelineForRepo = async (repo, { ref } = {}) => {
    const branch = validateRef(ref);
    if (!branch) throw invalid('ref must be a branch name');
    await requirePipeline(repo);
    // Names that look like a commit ('deadbeef', '20261022') are valid branch names; a real commit
    // SHA is not a branch and this lookup answers 404.
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
        // "No ref found for: x": deleted (or renamed) since the lookup above. Checked first because
        // the message carries the branch name, and 'feature/input-form' is not a workflow problem.
        if (/no ref found/i.test(message)) throw new AppError('BRANCH_NOT_FOUND', 'Branch not found', 404);
        // "Cannot trigger a 'workflow_dispatch' on a disabled workflow": repository-wide, merging
        // the default branch does not fix it.
        if (/disabled/i.test(message)) {
            throw new AppError('WORKFLOW_DISABLED', 'The TaskMate workflow is disabled on GitHub; enable it in the Actions tab', 409);
        }
        if (WORKFLOW_REJECTED_RE.test(message)) {
            throw new AppError('BRANCH_WORKFLOW_OUTDATED', 'The TaskMate workflow on that branch is missing or out of date; merge the default branch into it', 409);
        }
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
    const { status, data, headers } = await githubApp.request(repoAuth(repo), 'POST', `${repoPath(repo)}/actions/runs/${id}/rerun-failed-jobs`, {
        ...scope(repo, PERMISSIONS.actionsWrite),
        allowStatus: [403, 409, 422],
    });
    if (status === 403 || status === 409 || status === 422) {
        // A secondary rate limit is a 403 too: it is "try again later", not "cannot be re-run".
        throw rateLimitError(status, headers, data, githubApp.now())
            || new AppError('RUN_NOT_RERUNNABLE', 'GitHub cannot re-run this run (too old, or already running)', 409);
    }
    return { rerun: true, runId: id };
};

/** Cancels a queued or running run. */
const cancelRunForRepo = async (repo, runId, { isAdmin = false } = {}) => {
    const id = positiveId(runId, 'runId');
    const run = await fetchRun(repo, id);
    assertCanControl(run, isAdmin);
    if (run.status === 'completed') throw new AppError('RUN_NOT_CANCELLABLE', 'The run already finished', 409);
    // Only a 409 means "already finished"; a 403 is not accepted here, so a rate limit still becomes
    // GITHUB_RATE_LIMITED (and any other 403 REPO_NOT_ACCESSIBLE) in githubApp.
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

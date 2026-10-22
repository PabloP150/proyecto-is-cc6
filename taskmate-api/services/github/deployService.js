// Phase 4, step 3: continuous delivery from TaskMate. Staging is deployed by the workflow itself on
// every push to the default branch that passes CI; production deploys, promotions and rollbacks are
// dispatched from here. The deploy history is GitHub's (Deployments with task deploy:taskmate,
// written by the workflow with the exact commit); TaskMate only stores the production requests that
// wait for a group admin (DeployRequests).
const { AppError, isAppError } = require('../../helpers/errors');
const cicdModel = require('../../models/cicd.model');
const { githubApp, PERMISSIONS } = require('./githubApp');
const repoService = require('./repoService');
const { WORKFLOW_PATH, DEPLOY_TASK, ENVIRONMENTS } = require('./pipelineSpec');
const { requestEvent } = require('./cicdEvents');
const pipelineService = require('./pipelineService');
const { realtime } = require('../realtime');

const SHA_RE = /^[0-9a-f]{40}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Per environment: frequent staging deploys must never push production out of the history.
const HISTORY_SIZE = 20;
const MAX_ROLLBACK_CANDIDATES = 10;
const MAX_NOTE = 500;
const MAX_USERNAME = 40;
const WORKFLOW_FILE = WORKFLOW_PATH.slice(WORKFLOW_PATH.lastIndexOf('/') + 1);
const ACTIVE_STATES = new Set(['queued', 'pending', 'in_progress', 'waiting']);
const DEPLOYED_STATES = new Set(['success', 'inactive']);
// The workflow creates the deployment (in_progress) at the start of the build job (timeout 30 min)
// and marks it success at the end of the deploy job (timeout 20 min, after waiting for a runner), so
// a live deploy can stay in progress for about 50 minutes. One still unfinished after an hour was
// abandoned (runner lost, run cancelled before its failure step) and counts as failed.
const ABANDONED_STATES = new Set(['pending', 'queued', 'in_progress']);
const ABANDONED_AFTER_MS = 60 * 60 * 1000;
// The CI job of the generated workflow is named "CI (Node.js)", "CI (Python)" or "CI (sitio estático)".
const CI_CHECK_PREFIX = 'CI (';
const CI_APP_SLUG = 'github-actions';
const MAX_CHECK_RUNS = 100;

const STALE_REPOSITORY_NOTE = 'El grupo cambió de repositorio.';
const STALE_STAGING_NOTE = 'La versión de staging cambió; pide de nuevo.';
const DISPATCH_FAILED_NOTE = 'No se pudo iniciar el deploy en GitHub; pide de nuevo.';

// GitHub's check runs and compare results lag a few seconds behind a push, so a negative answer
// is asked once more before a version is refused. Replaceable in tests.
const timing = {
    retryDelayMs: 2000,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const { repoAuth, repoPath, scope } = repoService;
const invalid = (message) => new AppError('VALIDATION_ERROR', message, 400);
const short = (sha) => (typeof sha === 'string' ? sha.slice(0, 7) : null);
const githubUrl = (value) => (typeof value === 'string' && value.startsWith('https://github.com/') ? value : null);
const httpsUrl = (value) => (typeof value === 'string' && value.startsWith('https://') ? value : null);
const encodeRef = (ref) => String(ref).split('/').map(encodeURIComponent).join('/');

const DEPLOYMENTS_QUERY = `query($owner: String!, $name: String!, $first: Int!) {
  repository(owner: $owner, name: $name) {
    staging: deployments(first: $first, environments: ["staging"], orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes { ...TaskmateDeploy }
    }
    production: deployments(first: $first, environments: ["production"], orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes { ...TaskmateDeploy }
    }
  }
}
fragment TaskmateDeploy on Deployment {
  databaseId environment task commitOid createdAt description payload
  creator { login }
  latestStatus { state environmentUrl logUrl createdAt }
}`;

const validateEnvironment = (environment) => {
    if (!ENVIRONMENTS.includes(environment)) throw invalid(`environment must be one of ${ENVIRONMENTS.join(', ')}`);
    return environment;
};

const validateVersion = (version) => {
    if (typeof version !== 'string' || !SHA_RE.test(version)) throw invalid('version must be a full 40-character commit SHA');
    return version.toLowerCase();
};

const validateRequestId = (requestId) => {
    if (typeof requestId !== 'string' || !UUID_RE.test(requestId)) throw invalid('requestId must be a valid UUID');
    return requestId;
};

const cleanUsername = (username) => String(username || '').replace(/[^A-Za-z0-9_.@ -]/g, '').slice(0, MAX_USERNAME);

// The workflow stores the payload as an object, but GitHub may hand it back JSON-encoded once or twice.
const parsePayload = (value) => {
    let payload = value;
    for (let i = 0; i < 3 && typeof payload === 'string'; i += 1) {
        try {
            payload = JSON.parse(payload);
        } catch {
            return null;
        }
    }
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
};

// A deploy with no final status long after it was created is reported as failed ("error",
// abandoned: true) instead of "deploying" forever.
const isAbandoned = (state, createdAt, now) => {
    const created = Date.parse(createdAt || '');
    return ABANDONED_STATES.has(state) && Number.isFinite(created) && now - created > ABANDONED_AFTER_MS;
};

const toDeploy = (node, { now = Date.now() } = {}) => {
    const status = node.latestStatus || {};
    const payload = parsePayload(node.payload) || {};
    const requestedBy = typeof payload.requestedBy === 'string' && payload.requestedBy ? payload.requestedBy.slice(0, MAX_USERNAME) : null;
    const reported = typeof status.state === 'string' ? status.state.toLowerCase() : 'pending';
    const abandoned = isAbandoned(reported, node.createdAt, now);
    return {
        id: Number(node.databaseId) || null,
        environment: node.environment,
        sha: node.commitOid,
        shortSha: short(node.commitOid),
        state: abandoned ? 'error' : reported,
        abandoned,
        createdAt: node.createdAt || null,
        finishedAt: status.createdAt || null,
        url: httpsUrl(status.environmentUrl),
        logUrl: githubUrl(status.logUrl),
        requestedBy,
        automatic: !requestedBy,
    };
};

const nodesOf = (connection) => (connection && Array.isArray(connection.nodes) ? connection.nodes : []);

/** TaskMate deploys of the repository, newest first (one GraphQL request, each environment on its own). */
const fetchDeploys = async (repo) => {
    const { data } = await githubApp.request(repoAuth(repo), 'POST', '/graphql', {
        ...scope(repo, PERMISSIONS.deploymentsRead),
        body: { query: DEPLOYMENTS_QUERY, variables: { owner: repo.owner, name: repo.name, first: HISTORY_SIZE } },
    });
    if (!data || data.errors || !data.data || !data.data.repository) {
        throw new AppError('GITHUB_ERROR', 'GitHub could not list the deployments', 502);
    }
    const { staging, production } = data.data.repository;
    const now = Date.now();
    return [...nodesOf(staging), ...nodesOf(production)]
        .filter((node) => node && node.task === DEPLOY_TASK && ENVIRONMENTS.includes(node.environment) && SHA_RE.test(node.commitOid || ''))
        .map((node) => toDeploy(node, { now }))
        .sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0) || (b.id || 0) - (a.id || 0));
};

/** {staging: {live, inProgress}, production: {...}} from the history (newest first). */
const summarize = (history) => Object.fromEntries(ENVIRONMENTS.map((environment) => {
    const own = history.filter((deploy) => deploy.environment === environment);
    // Older staging deploys turn "inactive"; older production ones stay "success", so the newest wins.
    const live = own.find((deploy) => deploy.state === 'success') || null;
    const inProgress = own.length && ACTIVE_STATES.has(own[0].state) ? own[0] : null;
    const failed = own.length && (own[0].state === 'failure' || own[0].state === 'error') ? own[0] : null;
    return [environment, { live, inProgress, lastFailed: failed }];
}));

const rollbackCandidates = (history, live) => {
    const seen = new Set(live ? [live.sha] : []);
    const candidates = [];
    for (const deploy of history) {
        if (deploy.environment !== 'production' || !DEPLOYED_STATES.has(deploy.state) || seen.has(deploy.sha)) continue;
        seen.add(deploy.sha);
        candidates.push(deploy);
        if (candidates.length >= MAX_ROLLBACK_CANDIDATES) break;
    }
    return candidates;
};

const requireDeployPipeline = async (repo) => {
    const pipeline = await cicdModel.getPipeline(repo.repoId);
    if (!pipeline || !pipeline.spec || !pipeline.spec.deploy) {
        throw new AppError('DEPLOY_NOT_CONFIGURED', 'The TaskMate pipeline of this repository does not deploy', 409);
    }
    return pipeline;
};

// compare/{sha}...{default branch}: "ahead" means the default branch contains the commit plus newer
// ones, "identical" that it is its head. "behind"/"diverged" (a feature branch or fork commit) and
// 404 (unknown commit) are not on the default branch.
const isOnDefaultBranch = async (repo, sha) => {
    const { status, data } = await githubApp.request(repoAuth(repo), 'GET', `${repoPath(repo)}/compare/${sha}...${encodeRef(repo.defaultBranch)}`, {
        ...scope(repo, PERMISSIONS.read),
        query: { per_page: 1 },
        allowStatus: [404],
    });
    return status !== 404 && Boolean(data) && (data.status === 'ahead' || data.status === 'identical');
};

// The CI job's own check run, not the workflow run: a deploy dispatched from TaskMate runs the
// workflow with the CI job skipped and still ends "success" on the default branch head.
const passedTaskmateCi = async (repo, sha) => {
    const { status, data } = await githubApp.request(repoAuth(repo), 'GET', `${repoPath(repo)}/commits/${sha}/check-runs`, {
        ...scope(repo, PERMISSIONS.checksRead),
        query: { filter: 'latest', per_page: MAX_CHECK_RUNS },
        allowStatus: [404, 422],
    });
    if (status === 404 || status === 422) return false;
    const runs = data && Array.isArray(data.check_runs) ? data.check_runs : [];
    return runs.some((run) => run
        && typeof run.name === 'string' && run.name.startsWith(CI_CHECK_PREFIX)
        && run.app && run.app.slug === CI_APP_SLUG
        && run.status === 'completed' && run.conclusion === 'success'
        && String(run.head_sha || '').toLowerCase() === sha);
};

const verifiedOnGitHub = async (repo, sha) => (await isOnDefaultBranch(repo, sha)) && passedTaskmateCi(repo, sha);

/**
 * Only verified versions are deployed: one TaskMate already deployed (rollbacks, promotions), or a
 * commit of the default branch whose TaskMate CI job passed.
 */
const assertVersionPassedCi = async (repo, version, history) => {
    const sha = String(version).toLowerCase();
    if (history && history.some((deploy) => deploy.sha === sha && DEPLOYED_STATES.has(deploy.state))) return;
    if (await verifiedOnGitHub(repo, sha)) return;
    await timing.sleep(timing.retryDelayMs);
    if (await verifiedOnGitHub(repo, sha)) return;
    throw new AppError('VERSION_NOT_VERIFIED', 'That commit is not on the default branch with a passing TaskMate CI', 409);
};

const liveStagingSha = (history) => {
    const live = summarize(history).staging.live;
    return live ? String(live.sha).toLowerCase() : null;
};

const dispatchDeploy = async (repo, { environment, version, username }) => {
    const { status, data } = await githubApp.request(repoAuth(repo), 'POST', `${repoPath(repo)}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
        ...scope(repo, PERMISSIONS.actionsWrite),
        body: { ref: repo.defaultBranch, inputs: { environment, version, requested_by: cleanUsername(username) } },
        allowStatus: [404, 422],
    });
    if (status === 404) throw new AppError('PIPELINE_NOT_CONFIGURED', 'The TaskMate workflow is not on GitHub', 409);
    if (status === 422) {
        const message = data && typeof data.message === 'string' ? data.message : '';
        if (/input|workflow_dispatch/i.test(message)) {
            throw new AppError('PIPELINE_OUTDATED', 'The workflow on the default branch cannot deploy from TaskMate; configure the pipeline again', 409);
        }
        throw new AppError('GITHUB_ERROR', 'GitHub rejected the deploy', 502);
    }
};

const publishRequest = (gid, request) => {
    realtime.publish(gid, 'deploy_request', requestEvent(request))
        .catch((err) => console.error('Realtime publish failed:', err && err.message));
};

// ---------------------------------------------------------------- operations used by the routes

/** Environments (live version, deploy in progress, last failure), history, rollback candidates and requests. */
const getDeployments = async (gid) => {
    const repo = await repoService.getConnectedRepo(gid);
    const pipeline = await cicdModel.getPipeline(repo.repoId);
    const deploys = Boolean(pipeline && pipeline.spec && pipeline.spec.deploy);
    // Requests made for a repository the group used before are not shown.
    const requests = await cicdModel.listDeployRequests(gid, { repoId: repo.repoId });
    if (!deploys) return { deploys: false, environments: null, history: [], rollbackCandidates: [], requests, pages: null };
    const history = await fetchDeploys(repo);
    const environments = summarize(history);
    return {
        deploys: true,
        environments,
        history: history.slice(0, 15),
        rollbackCandidates: rollbackCandidates(history, environments.production.live),
        requests,
        pages: await pipelineService.getPagesStatus(repo),
    };
};

/** Admin: deploy a verified version to an environment right away (also used for rollbacks). */
const deployNow = async ({ gid, username, environment, version }) => {
    validateEnvironment(environment);
    const sha = validateVersion(version);
    const repo = await repoService.getConnectedRepo(gid);
    await requireDeployPipeline(repo);
    await assertVersionPassedCi(repo, sha, await fetchDeploys(repo));
    await dispatchDeploy(repo, { environment, version: sha, username });
    return { dispatched: true, environment, version: sha };
};

/**
 * Member: ask the admins to promote the version live in staging to production. That is the only
 * request a member can make; any other version or environment goes through an admin's deployNow.
 */
const requestDeploy = async ({ gid, uid, environment = 'production', version }) => {
    validateEnvironment(environment);
    if (environment !== 'production') throw invalid('members can only ask to promote the staging version to production');
    const sha = validateVersion(version);
    const repo = await repoService.getConnectedRepo(gid);
    await requireDeployPipeline(repo);
    const history = await fetchDeploys(repo);
    if (liveStagingSha(history) !== sha) {
        throw new AppError('VERSION_NOT_STAGING', 'Only the version live in staging can be requested for production', 409);
    }
    await assertVersionPassedCi(repo, sha, history);
    const request = await cicdModel.createDeployRequest({ gid, repoId: repo.repoId, environment, versionSha: sha, requestedBy: uid });
    publishRequest(gid, request);
    return request;
};

const loadPendingRequest = async (gid, requestId) => {
    validateRequestId(requestId);
    const request = await cicdModel.getDeployRequest(requestId);
    if (!request || String(request.gid).toLowerCase() !== String(gid).toLowerCase()) {
        throw new AppError('DEPLOY_REQUEST_NOT_FOUND', 'Deploy request not found', 404);
    }
    if (request.status !== 'pending') throw new AppError('DEPLOY_REQUEST_DECIDED', 'The request was already decided', 409);
    return request;
};

const decided = (request) => {
    if (!request) throw new AppError('DEPLOY_REQUEST_DECIDED', 'The request was already decided', 409);
    return request;
};

// A request that no longer applies is closed (cancelled, with the reason for the requester) instead
// of deploying something nobody asked for.
const closeStaleRequest = async ({ gid, uid, requestId, note }) => {
    const cancelled = decided(await cicdModel.decideDeployRequest({ requestId, gid, status: 'cancelled', decidedBy: uid, note }));
    publishRequest(gid, cancelled);
    throw new AppError('DEPLOY_REQUEST_STALE', 'The request no longer applies and was cancelled', 409);
};

// The dispatch failed after the approval: the request goes back to pending so an admin can retry.
// When that is impossible (a new request took the pending slot meanwhile, the group switched
// repositories, or the database failed) it is closed as cancelled, never left "approved" for a
// deploy that did not start.
const undoApproval = async (gid, requestId) => {
    try {
        if (await cicdModel.reopenDeployRequest({ requestId, gid })) return;
    } catch (err) {
        if (!isAppError(err) || err.code !== 'DEPLOY_REQUEST_PENDING') {
            console.error('Reopening the deploy request after a failed dispatch failed:', err && err.message);
        }
    }
    try {
        const cancelled = await cicdModel.cancelApprovedDeployRequest({ requestId, gid, note: DISPATCH_FAILED_NOTE });
        if (cancelled) publishRequest(gid, cancelled);
    } catch (err) {
        console.error('Cancelling the deploy request after a failed dispatch failed:', err && err.message);
    }
};

/**
 * Admin: approve a pending request and dispatch its deploy. The request must still apply: same
 * repository, and its version still the one live in staging (otherwise it is cancelled). The
 * approval is written first (so two admins cannot both dispatch); if GitHub refuses the dispatch
 * the request goes back to pending.
 */
const approveRequest = async ({ gid, uid, username, requestId }) => {
    const pending = await loadPendingRequest(gid, requestId);
    const repo = await repoService.getConnectedRepo(gid);
    if (Number(pending.repoId) !== Number(repo.repoId)) {
        await closeStaleRequest({ gid, uid, requestId, note: STALE_REPOSITORY_NOTE });
    }
    await requireDeployPipeline(repo);
    const history = await fetchDeploys(repo);
    const version = String(pending.versionSha).toLowerCase();
    if (liveStagingSha(history) !== version) {
        await closeStaleRequest({ gid, uid, requestId, note: STALE_STAGING_NOTE });
    }
    await assertVersionPassedCi(repo, version, history);
    const approved = decided(await cicdModel.decideDeployRequest({ requestId, gid, status: 'approved', decidedBy: uid }));
    try {
        await dispatchDeploy(repo, { environment: pending.environment, version, username: pending.requestedByUsername || username });
    } catch (err) {
        await undoApproval(gid, requestId);
        throw err;
    }
    publishRequest(gid, approved);
    return approved;
};

/** Admin: reject a pending request, with an optional note for the requester. */
const rejectRequest = async ({ gid, uid, requestId, note }) => {
    if (note !== undefined && note !== null && typeof note !== 'string') throw invalid('note must be a string');
    await loadPendingRequest(gid, requestId);
    const clean = typeof note === 'string' && note.trim() ? note.trim().slice(0, MAX_NOTE) : null;
    const rejected = decided(await cicdModel.decideDeployRequest({ requestId, gid, status: 'rejected', decidedBy: uid, note: clean }));
    publishRequest(gid, rejected);
    return rejected;
};

/** Requester: withdraw their own pending request. */
const cancelRequest = async ({ gid, uid, requestId }) => {
    const pending = await loadPendingRequest(gid, requestId);
    if (String(pending.requestedBy).toLowerCase() !== String(uid).toLowerCase()) {
        throw new AppError('NOT_REQUESTER', 'Only who asked for the deploy can cancel the request', 403);
    }
    const cancelled = decided(await cicdModel.decideDeployRequest({ requestId, gid, status: 'cancelled', decidedBy: uid }));
    publishRequest(gid, cancelled);
    return cancelled;
};

module.exports = {
    parsePayload,
    toDeploy,
    summarize,
    rollbackCandidates,
    fetchDeploys,
    assertVersionPassedCi,
    getDeployments,
    deployNow,
    requestDeploy,
    approveRequest,
    rejectRequest,
    cancelRequest,
    _timing: timing,
};

// Phase 4, step 3: continuous delivery from TaskMate. Staging is deployed by the workflow itself on
// every push to the default branch that passes CI; production deploys, promotions and rollbacks are
// dispatched from here. The deploy history is GitHub's (Deployments with task deploy:taskmate,
// written by the workflow with the exact commit); TaskMate only stores the production requests that
// wait for a group admin (DeployRequests).
const { AppError } = require('../../helpers/errors');
const cicdModel = require('../../models/cicd.model');
const { githubApp, PERMISSIONS } = require('./githubApp');
const repoService = require('./repoService');
const { WORKFLOW_PATH, DEPLOY_TASK, ENVIRONMENTS } = require('./pipelineSpec');
const { requestEvent } = require('./cicdEvents');
const pipelineService = require('./pipelineService');
const { realtime } = require('../realtime');

const SHA_RE = /^[0-9a-f]{40}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HISTORY_SIZE = 30;
const MAX_ROLLBACK_CANDIDATES = 10;
const MAX_NOTE = 500;
const MAX_USERNAME = 40;
const WORKFLOW_FILE = WORKFLOW_PATH.slice(WORKFLOW_PATH.lastIndexOf('/') + 1);
const ACTIVE_STATES = new Set(['queued', 'pending', 'in_progress', 'waiting']);
const DEPLOYED_STATES = new Set(['success', 'inactive']);

const { repoAuth, repoPath, scope } = repoService;
const invalid = (message) => new AppError('VALIDATION_ERROR', message, 400);
const short = (sha) => (typeof sha === 'string' ? sha.slice(0, 7) : null);
const githubUrl = (value) => (typeof value === 'string' && value.startsWith('https://github.com/') ? value : null);
const httpsUrl = (value) => (typeof value === 'string' && value.startsWith('https://') ? value : null);

const DEPLOYMENTS_QUERY = `query($owner: String!, $name: String!, $first: Int!) {
  repository(owner: $owner, name: $name) {
    deployments(first: $first, environments: ["staging", "production"], orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes {
        databaseId environment task commitOid createdAt description payload
        creator { login }
        latestStatus { state environmentUrl logUrl createdAt }
      }
    }
  }
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

const toDeploy = (node) => {
    const status = node.latestStatus || {};
    const payload = parsePayload(node.payload) || {};
    const requestedBy = typeof payload.requestedBy === 'string' && payload.requestedBy ? payload.requestedBy.slice(0, MAX_USERNAME) : null;
    return {
        id: Number(node.databaseId) || null,
        environment: node.environment,
        sha: node.commitOid,
        shortSha: short(node.commitOid),
        state: typeof status.state === 'string' ? status.state.toLowerCase() : 'pending',
        createdAt: node.createdAt || null,
        finishedAt: status.createdAt || null,
        url: httpsUrl(status.environmentUrl),
        logUrl: githubUrl(status.logUrl),
        requestedBy,
        automatic: !requestedBy,
    };
};

/** TaskMate deploys of the repository, newest first (one GraphQL request). */
const fetchDeploys = async (repo) => {
    const { data } = await githubApp.request(repoAuth(repo), 'POST', '/graphql', {
        ...scope(repo, PERMISSIONS.deploymentsRead),
        body: { query: DEPLOYMENTS_QUERY, variables: { owner: repo.owner, name: repo.name, first: HISTORY_SIZE } },
    });
    if (!data || data.errors || !data.data || !data.data.repository) {
        throw new AppError('GITHUB_ERROR', 'GitHub could not list the deployments', 502);
    }
    const nodes = data.data.repository.deployments ? data.data.repository.deployments.nodes || [] : [];
    return nodes
        .filter((node) => node && node.task === DEPLOY_TASK && ENVIRONMENTS.includes(node.environment) && SHA_RE.test(node.commitOid || ''))
        .map(toDeploy);
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

/**
 * Only versions that passed the TaskMate CI (or were already deployed by it) are deployed:
 * a successful TaskMate workflow run for that exact commit.
 */
const assertVersionPassedCi = async (repo, version, history) => {
    if (history && history.some((deploy) => deploy.sha === version && DEPLOYED_STATES.has(deploy.state))) return;
    const { data } = await githubApp.request(repoAuth(repo), 'GET', `${repoPath(repo)}/actions/workflows/${WORKFLOW_FILE}/runs`, {
        ...scope(repo, PERMISSIONS.actionsRead),
        query: { head_sha: version, status: 'success', per_page: 1 },
        notFoundCode: 'PIPELINE_NOT_CONFIGURED',
    });
    if (!data || !Number(data.total_count)) {
        throw new AppError('VERSION_NOT_VERIFIED', 'That commit has no successful run of the TaskMate pipeline', 409);
    }
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
    const requests = await cicdModel.listDeployRequests(gid);
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

/** Member: ask the admins to deploy a verified version (production by default). */
const requestDeploy = async ({ gid, uid, environment = 'production', version }) => {
    validateEnvironment(environment);
    const sha = validateVersion(version);
    const repo = await repoService.getConnectedRepo(gid);
    await requireDeployPipeline(repo);
    await assertVersionPassedCi(repo, sha, await fetchDeploys(repo));
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

/**
 * Admin: approve a pending request and dispatch its deploy. The approval is written first (so two
 * admins cannot both dispatch); if GitHub refuses the dispatch the request goes back to pending.
 */
const approveRequest = async ({ gid, uid, username, requestId }) => {
    const pending = await loadPendingRequest(gid, requestId);
    const repo = await repoService.getConnectedRepo(gid);
    await requireDeployPipeline(repo);
    const approved = decided(await cicdModel.decideDeployRequest({ requestId, gid, status: 'approved', decidedBy: uid }));
    try {
        await dispatchDeploy(repo, { environment: pending.environment, version: pending.versionSha, username: pending.requestedByUsername || username });
    } catch (err) {
        await cicdModel.reopenDeployRequest({ requestId, gid }).catch(() => {});
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
};

// Phase 4: the small, safe payloads TaskMate pushes to the browser for CI/CD activity (webhooks for
// runs, jobs and deploys; the API itself for deploy requests). Only what the UI needs, never the
// raw GitHub payload.
const { WORKFLOW_PATH, DEPLOY_TASK } = require('./pipelineSpec');

const MAX_TEXT = 300;
const text = (value) => (value === null || value === undefined ? null : String(value).slice(0, MAX_TEXT));
const short = (sha) => (typeof sha === 'string' ? sha.slice(0, 7) : null);

const githubUrl = (value) => (typeof value === 'string' && value.startsWith('https://github.com/') ? value : null);
const httpsUrl = (value) => (typeof value === 'string' && value.startsWith('https://') ? value : null);

const isTaskmatePath = (path) => typeof path === 'string' && path.split('@')[0] === WORKFLOW_PATH;

/** workflow_run webhook → 'ci_run' event data. */
const runEvent = (run, action) => {
    if (!run || !run.id) return null;
    const title = text(run.display_title || run.name);
    const isTaskmate = isTaskmatePath(run.path);
    return {
        action: text(action),
        runId: Number(run.id),
        name: text(run.name),
        title,
        event: text(run.event),
        status: text(run.status),
        conclusion: text(run.conclusion),
        branch: text(run.head_branch),
        shortSha: short(run.head_sha),
        actor: text((run.triggering_actor && run.triggering_actor.login) || (run.actor && run.actor.login)),
        htmlUrl: githubUrl(run.html_url),
        isTaskmate,
        isDeploy: isTaskmate && run.event === 'workflow_dispatch' && /^Deploy a /.test(title || ''),
    };
};

/** workflow_job webhook → 'ci_job' event data. */
const jobEvent = (job, action) => {
    if (!job || !job.id) return null;
    return {
        action: text(action),
        runId: Number(job.run_id) || null,
        jobId: Number(job.id),
        name: text(job.name),
        status: text(job.status),
        conclusion: text(job.conclusion),
    };
};

const requestedByOf = (deployment) => {
    let payload = deployment && deployment.payload;
    if (typeof payload === 'string') {
        try {
            payload = JSON.parse(payload);
        } catch {
            payload = null;
        }
    }
    return payload && typeof payload === 'object' && payload.requestedBy ? text(payload.requestedBy) : null;
};

/** deployment_status webhook of a TaskMate deploy → 'deployment' event data (null for others). */
const deploymentEvent = (deployment, status) => {
    if (!deployment || !status || deployment.task !== DEPLOY_TASK) return null;
    return {
        deploymentId: Number(deployment.id),
        environment: text(deployment.environment),
        state: text(status.state),
        sha: typeof deployment.sha === 'string' ? deployment.sha : null,
        shortSha: short(deployment.sha),
        url: httpsUrl(status.environment_url),
        logUrl: githubUrl(status.log_url),
        requestedBy: requestedByOf(deployment),
    };
};

/** A deploy request row → 'deploy_request' event data. */
const requestEvent = (request) => ({
    requestId: request.requestId,
    environment: request.environment,
    versionSha: request.versionSha,
    shortSha: short(request.versionSha),
    status: request.status,
    requestedBy: request.requestedBy,
    requestedByUsername: request.requestedByUsername,
    decidedByUsername: request.decidedByUsername,
    note: request.note,
});

module.exports = { runEvent, jobEvent, deploymentEvent, requestEvent };

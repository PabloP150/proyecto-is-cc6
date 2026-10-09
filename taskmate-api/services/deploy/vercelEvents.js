// Translates Vercel webhook payloads into the shape dbo.Deployments stores.
//
// Vercel sends one event type per lifecycle stage rather than a single event with a state
// field, so the event name *is* the state. Keeping the map explicit means an unknown event
// is ignored rather than guessed at.
const EVENT_STATES = {
    'deployment.created': 'queued',
    'deployment.building': 'building',
    'deployment.succeeded': 'ready',
    'deployment.ready': 'ready',
    'deployment.error': 'error',
    'deployment.canceled': 'canceled',
    'deployment.promoted': 'ready',
};

const SHA_RE = /^[0-9a-f]{40}$/i;

const str = (value, max) => {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text ? text.slice(0, max) : null;
};

const isDeploymentEvent = (type) => Object.hasOwn(EVENT_STATES, type);

// Vercel nests the git metadata under meta.* with provider-prefixed keys
// (githubCommitRef, gitlabCommitRef, ...). Only the GitHub ones matter here.
const gitMeta = (deployment) => {
    const meta = (deployment && deployment.meta) || {};
    const sha = str(meta.githubCommitSha || meta.commitSha, 40);
    return {
        branch: str(meta.githubCommitRef || meta.branch, 255),
        commitSha: sha && SHA_RE.test(sha) ? sha.toLowerCase() : null,
    };
};

// Vercel marks anything that is not a production deployment as "preview".
const environmentOf = (deployment, payload) => {
    const target = (deployment && deployment.target) || (payload && payload.target);
    return target === 'production' ? 'production' : 'preview';
};

const urlOf = (deployment) => {
    const url = str(deployment && deployment.url, 500);
    if (!url) return null;
    return url.startsWith('http') ? url : `https://${url}`;
};

/**
 * Map one webhook body to a deployment record, or null when it is not a deployment event.
 *
 * `gid` is not resolved here: the payload carries a Vercel project id, and turning that into
 * a TaskMate group is a database lookup the caller does.
 */
const toDeploymentRecord = (body) => {
    const type = body && body.type;
    if (!isDeploymentEvent(type)) return null;

    const payload = (body && body.payload) || {};
    const deployment = payload.deployment || {};

    const deploymentId = str(deployment.id || payload.deploymentId || payload.id, 128);
    const projectRef = str(
        (payload.project && payload.project.id) || payload.projectId || deployment.projectId,
        128,
    );
    if (!deploymentId || !projectRef) return null;

    const { branch, commitSha } = gitMeta(deployment);
    const state = EVENT_STATES[type];

    return {
        deploymentId,
        projectRef,
        provider: 'vercel',
        state,
        environment: environmentOf(deployment, payload),
        branch,
        commitSha,
        url: urlOf(deployment),
        // Only failures carry a message; a later success must clear it, hence the explicit null.
        errorMessage: state === 'error' ? str(payload.errorMessage || payload.error, 1024) : null,
        // `createdAt` here is the event timestamp, used for ordering out-of-order retries.
        updatedAt: body.createdAt ? new Date(Number(body.createdAt) || body.createdAt) : new Date(),
    };
};

module.exports = { EVENT_STATES, isDeploymentEvent, toDeploymentRecord };

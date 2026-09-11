const { AppError, isAppError, sendError } = require('../../helpers/errors');
const githubModel = require('../../models/github.model');
const transaction = require('../../helpers/transaction');
const { githubApp, PERMISSIONS } = require('./githubApp');
const { verifyWebhookSignature } = require('./webhookSignature');
const { isForkPullRequest, applyPullRequestInTx } = require('./pullRequestProcessor');

const RESPONSE_DEADLINE_MS = 8 * 1000;
const MAX_ADDED_REPOS = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const describeError = (err) => {
    const text = isAppError(err) ? `${err.code}: ${err.message}` : `${(err && err.name) || 'Error'}: ${(err && err.message) || ''}`;
    return text.slice(0, 500);
};

const repositoryRecord = (repository, installationId) => ({
    repoId: Number(repository.id),
    installationId: Number(installationId),
    name: String(repository.name),
    defaultBranch: String(repository.default_branch),
    isPrivate: Boolean(repository.private),
});

// Runs `work` in a transaction that also marks the delivery processed; a FK violation means the
// installation/repository is unknown to TaskMate, so the delivery is only logged as ignored.
const inTransaction = async (deliveryId, work) => {
    try {
        await transaction.withTransaction(async (tx) => {
            await work(tx);
            await githubModel.finishDelivery(deliveryId, 'processed', { tx });
        });
        return 'processed';
    } catch (err) {
        if (!transaction.isFkViolation(err)) throw err;
        await githubModel.finishDelivery(deliveryId, 'ignored');
        return 'ignored';
    }
};

const ignore = async (deliveryId) => {
    await githubModel.finishDelivery(deliveryId, 'ignored');
    return 'ignored';
};

const handleInstallation = async (deliveryId, action, payload) => {
    const installationId = Number(payload.installation && payload.installation.id);
    if (!installationId) return ignore(deliveryId);
    if (action === 'deleted') {
        githubApp.invalidateInstallation(installationId);
        return inTransaction(deliveryId, (tx) => githubModel.deleteInstallation(installationId, { tx }));
    }
    if (action === 'suspend' || action === 'unsuspend') {
        githubApp.invalidateInstallation(installationId);
        const suspendedAt = action === 'suspend' ? new Date(payload.installation.suspended_at || Date.now()) : null;
        return inTransaction(deliveryId, (tx) => githubModel.setInstallationSuspended(installationId, suspendedAt, { tx }));
    }
    return ignore(deliveryId);
};

// installation_repositories payloads carry no default_branch, so added repos are read from
// the API first (never inside the transaction).
const fetchAddedRepositories = async (installationId, added) => {
    const records = [];
    for (const repo of added.slice(0, MAX_ADDED_REPOS)) {
        const [owner, name] = String(repo.full_name || '').split('/');
        if (!owner || !name) continue;
        try {
            const { data } = await githubApp.request({ installationId }, 'GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, {
                repoIds: [Number(repo.id)],
                permissions: PERMISSIONS.read,
            });
            if (data && data.id) records.push(repositoryRecord(data, installationId));
        } catch {
            // Skipped: the repo is upserted again when a group connects it.
        }
    }
    return records;
};

const handleInstallationRepositories = async (deliveryId, action, payload) => {
    const installationId = Number(payload.installation && payload.installation.id);
    if (!installationId) return ignore(deliveryId);
    if (action === 'removed') {
        const removed = (payload.repositories_removed || []).map((r) => Number(r.id)).filter(Boolean);
        githubApp.invalidateInstallation(installationId);
        return inTransaction(deliveryId, async (tx) => {
            for (const repoId of removed) await githubModel.deleteRepository(repoId, { tx });
        });
    }
    if (action === 'added') {
        const records = await fetchAddedRepositories(installationId, payload.repositories_added || []);
        return inTransaction(deliveryId, async (tx) => {
            for (const record of records) await githubModel.upsertRepository(record, { tx });
        });
    }
    return ignore(deliveryId);
};

const handlePullRequest = async (deliveryId, payload) => {
    const { pull_request: pr, repository, installation } = payload;
    if (!pr || !repository || !installation || !pr.head || !pr.base) return ignore(deliveryId);
    if (isForkPullRequest(pr, repository.id)) return ignore(deliveryId);

    const repo = repositoryRecord(repository, installation.id);
    return inTransaction(deliveryId, async (tx) => {
        await githubModel.upsertRepository(repo, { tx });
        await applyPullRequestInTx(pr, { repoId: repo.repoId, defaultBranch: repo.defaultBranch }, { tx });
    });
};

const route = async (delivery) => {
    const { deliveryId, event, action, payload } = delivery;
    if (event === 'installation') return handleInstallation(deliveryId, action, payload);
    if (event === 'installation_repositories') return handleInstallationRepositories(deliveryId, action, payload);
    if (event === 'pull_request') return handlePullRequest(deliveryId, payload);
    return ignore(deliveryId);
};

// Never rejects: failures are recorded on the delivery (GitHub does not retry automatically;
// POST /groups/:gid/sync reconciles).
const processDelivery = async (delivery) => {
    try {
        return await route(delivery);
    } catch (err) {
        await githubModel.failDelivery(delivery.deliveryId, describeError(err)).catch(() => {});
        return 'failed';
    }
};

// Expects req.body to be the raw Buffer (mount with express.raw before express.json).
const createWebhookHandler = ({ deadlineMs = RESPONSE_DEADLINE_MS } = {}) => async (req, res) => {
    const rawBody = req.body;
    if (!verifyWebhookSignature(rawBody, req.get('x-hub-signature-256'))) {
        return sendError(res, new AppError('UNAUTHENTICATED', 'Invalid webhook signature', 401));
    }

    const event = req.get('x-github-event');
    const deliveryId = req.get('x-github-delivery');
    if (!event || !deliveryId || !UUID_RE.test(deliveryId)) {
        return sendError(res, new AppError('VALIDATION_ERROR', 'Missing GitHub delivery headers', 400));
    }
    if (event === 'ping') return res.status(200).json({ status: 'pong' });

    let payload;
    try {
        payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
        return sendError(res, new AppError('VALIDATION_ERROR', 'Invalid JSON payload', 400));
    }
    const action = typeof payload.action === 'string' ? payload.action : null;
    const installationId = payload.installation && payload.installation.id ? Number(payload.installation.id) : null;

    try {
        const { duplicate } = await githubModel.beginDelivery({ deliveryId, event, action, installationId });
        if (duplicate) return res.status(200).json({ status: 'duplicate' });
    } catch (err) {
        return sendError(res, err);
    }

    let timer;
    const deadline = new Promise((resolve) => {
        timer = setTimeout(() => resolve('timeout'), deadlineMs);
        if (timer.unref) timer.unref();
    });
    const outcome = await Promise.race([processDelivery({ deliveryId, event, action, payload }), deadline]);
    clearTimeout(timer);

    if (outcome === 'timeout') return res.status(202).json({ status: 'accepted' });
    // A 5xx marks the delivery as failed in GitHub, so it can be redelivered by hand.
    if (outcome === 'failed') {
        return res.status(500).json({ success: false, error: 'Webhook processing failed', code: 'INTERNAL_ERROR' });
    }
    return res.status(200).json({ status: outcome });
};

module.exports = {
    createWebhookHandler,
    githubWebhookHandler: createWebhookHandler(),
    processDelivery,
    RESPONSE_DEADLINE_MS,
};

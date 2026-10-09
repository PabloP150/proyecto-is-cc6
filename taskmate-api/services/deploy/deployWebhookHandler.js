const crypto = require('crypto');
const { AppError, sendError } = require('../../helpers/errors');
const deploymentModel = require('../../models/deployment.model');
const githubModel = require('../../models/github.model');
const { verifyVercelSignature } = require('./deploySignature');
const { toDeploymentRecord } = require('./vercelEvents');

// Same budget as the GitHub webhook: answer the provider before it times out and retries.
const RESPONSE_DEADLINE_MS = 8 * 1000;

const describeError = (err) => String((err && err.message) || err || 'unknown error').slice(0, 1024);

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Apply one Vercel event.
 *
 * Returns the delivery status rather than throwing, so the caller records it either way:
 *   ignored   -- not a deployment event, or its project is not linked to a group
 *   processed -- stored (or deliberately skipped as a stale retry)
 */
const processEvent = async (body) => {
    const record = toDeploymentRecord(body);
    if (!record) return { status: 'ignored', reason: 'not a deployment event' };

    const gid = await deploymentModel.findGroupByProjectRef(record.provider, record.projectRef);
    if (!gid) return { status: 'ignored', reason: 'project is not linked to any group' };

    // The repository link is optional context: a deployment is worth recording without it.
    let repoId = null;
    try {
        const repo = await githubModel.getGroupRepository(gid);
        repoId = repo ? repo.repoId : null;
    } catch {
        repoId = null;
    }

    const outcome = await deploymentModel.applyDeployment({ ...record, gid, repoId });
    return { status: 'processed', gid, state: record.state, stale: outcome.stale };
};

// Never rejects: a failure is recorded on the delivery row, like the GitHub handler.
const processDelivery = async (deliveryId, body) => {
    try {
        const result = await processEvent(body);
        await deploymentModel.finishDelivery(deliveryId, result.status, result.reason || null).catch(() => {});
        return result.status;
    } catch (err) {
        await deploymentModel.finishDelivery(deliveryId, 'failed', describeError(err)).catch(() => {});
        return 'failed';
    }
};

/**
 * POST /api/deploy/webhook/vercel
 *
 * Expects req.body to be the raw Buffer (mount with express.raw before express.json), because
 * the signature covers the exact bytes received.
 *
 * A factory rather than a plain (req, res, deadlineMs) handler: Express calls route handlers
 * with (req, res, next), so a third parameter would receive `next` -- and a function passed as
 * a setTimeout delay is coerced to 0, firing the deadline immediately on every request. The
 * GitHub webhook handler is built the same way for the same reason.
 */
const createVercelWebhookHandler = ({ deadlineMs = RESPONSE_DEADLINE_MS } = {}) => async (req, res) => {
    const rawBody = req.body;
    if (!verifyVercelSignature(rawBody, req.get('x-vercel-signature'))) {
        return sendError(res, new AppError('UNAUTHENTICATED', 'Invalid webhook signature', 401));
    }

    let body;
    try {
        body = JSON.parse(rawBody.toString('utf8'));
    } catch {
        body = undefined;
    }
    if (!isPlainObject(body) || typeof body.type !== 'string') {
        return sendError(res, new AppError('VALIDATION_ERROR', 'Invalid JSON payload', 400));
    }

    // Vercel has no delivery-id header, so the body hash is the idempotency key. Two identical
    // retries collapse; two genuinely different events never collide.
    const deliveryId = typeof body.id === 'string' && body.id
        ? body.id.slice(0, 128)
        : crypto.createHash('sha256').update(rawBody).digest('hex');

    const claimed = await deploymentModel.beginDelivery({
        deliveryId,
        provider: 'vercel',
        event: body.type.slice(0, 50),
    });
    if (!claimed) return res.status(200).json({ status: 'duplicate' });

    // Answer within the deadline even if the database is slow; the delivery row keeps the
    // real outcome, and Vercel retries on a non-2xx.
    let timer;
    const deadline = new Promise((resolve) => {
        timer = setTimeout(() => resolve('timeout'), deadlineMs);
        if (timer.unref) timer.unref();
    });
    const status = await Promise.race([processDelivery(deliveryId, body), deadline]);
    clearTimeout(timer);

    return res.status(200).json({ status });
};

const vercelWebhookHandler = createVercelWebhookHandler();

module.exports = { vercelWebhookHandler, createVercelWebhookHandler, processEvent, RESPONSE_DEADLINE_MS };

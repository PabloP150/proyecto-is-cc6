// Deployment routes. Not mounted here — see the mounting order in app.js:
// webhook (express.raw) → deployRouter (authenticated).
const express = require('express');
const { AppError, sendError } = require('../helpers/errors');
const requireAuth = require('../middleware/auth.middleware');
const { requireGroupMember, requireGroupAdmin } = require('../middleware/groupAccess');
const { createLimiter } = require('../middleware/rateLimit');
const deploymentModel = require('../models/deployment.model');
const { vercelWebhookHandler, createVercelWebhookHandler } = require('../services/deploy/deployWebhookHandler');

const PROJECT_REF_RE = /^[A-Za-z0-9_-]{1,128}$/;

const route = (handler) => async (req, res) => {
    try {
        await handler(req, res);
    } catch (err) {
        sendError(res, err);
    }
};

const parseProvider = (value) => {
    const provider = String(value || 'vercel').toLowerCase();
    if (!deploymentModel.PROVIDERS.includes(provider)) {
        throw new AppError('VALIDATION_ERROR', `provider must be one of: ${deploymentModel.PROVIDERS.join(', ')}`, 400);
    }
    return provider;
};

const createDeployRouter = ({ auth = requireAuth } = {}) => {
    const router = express.Router();
    const writeLimiter = createLimiter({ windowMs: 60 * 1000, limit: 10, keyByUser: true });

    router.use(auth);

    // Link this group to a project on the deploy provider. Admin-only, like connecting a
    // repository: it decides which group a provider's webhooks land in.
    router.put('/groups/:gid/target', requireGroupAdmin('gid'), writeLimiter, route(async (req, res) => {
        const { provider, projectRef } = req.body || {};
        const parsed = parseProvider(provider);
        if (typeof projectRef !== 'string' || !PROJECT_REF_RE.test(projectRef)) {
            throw new AppError('VALIDATION_ERROR', 'projectRef must be 1-128 characters of [A-Za-z0-9_-]', 400);
        }
        try {
            const target = await deploymentModel.linkDeployTarget({
                gid: req.groupId,
                provider: parsed,
                projectRef,
                connectedBy: req.user.userId,
            });
            res.json({ data: target });
        } catch (err) {
            if (err && err.code === 'DEPLOY_TARGET_TAKEN') {
                throw new AppError('CONFLICT', err.message, 409);
            }
            throw err;
        }
    }));

    router.get('/groups/:gid/target', requireGroupMember('gid'), route(async (req, res) => {
        const provider = parseProvider(req.query.provider);
        res.json({ data: await deploymentModel.getDeployTarget(req.groupId, provider) });
    }));

    router.delete('/groups/:gid/target', requireGroupAdmin('gid'), route(async (req, res) => {
        const provider = parseProvider(req.query.provider);
        const removed = await deploymentModel.unlinkDeployTarget(req.groupId, provider);
        res.json({ data: { removed } });
    }));

    // The panel: recent deployments, newest first.
    router.get('/groups/:gid/deployments', requireGroupMember('gid'), route(async (req, res) => {
        const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
        if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
            throw new AppError('VALIDATION_ERROR', 'limit must be between 1 and 100', 400);
        }
        res.json({ data: await deploymentModel.listDeployments(req.groupId, { limit }) });
    }));

    return router;
};

module.exports = {
    deployRouter: createDeployRouter(),
    vercelWebhookHandler,
    createVercelWebhookHandler,
    createDeployRouter,
};

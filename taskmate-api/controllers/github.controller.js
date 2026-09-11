// GitHub integration routes. Not mounted here — see the mounting order in app.js:
// webhook (express.raw) → githubCallbackRouter → githubRouter (authenticated).
const express = require('express');
const { AppError, sendError } = require('../helpers/errors');
const requireAuth = require('../middleware/auth.middleware');
const { requireGroupMember, requireGroupAdmin, requireResourceMember } = require('../middleware/groupAccess');
const { createLimiter } = require('../middleware/rateLimit');
const githubModel = require('../models/github.model');
const installFlow = require('../services/github/installFlow');
const repoService = require('../services/github/repoService');
const branchService = require('../services/github/branchService');
const syncService = require('../services/github/syncService');
const { githubWebhookHandler } = require('../services/github/webhookHandler');

const SELECTION_ID_RE = /^[A-Za-z0-9_-]{43}$/;

// GitHub rate limits are relayed with Retry-After so the client can back off.
const sendGitHubError = (res, err) => {
    if (err && err.details && Number.isFinite(err.details.retryAfterSec)) {
        res.set('Retry-After', String(err.details.retryAfterSec));
    }
    return sendError(res, err);
};

const route = (handler) => async (req, res) => {
    try {
        await handler(req, res);
    } catch (err) {
        sendGitHubError(res, err);
    }
};

const formatRepository = (repo) => (repo ? {
    ...repo,
    aiAnalysisEnabled: repo.aiAnalysisEnabled === true,
    htmlUrl: `https://github.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`,
    installation: { accountLogin: repo.owner, suspended: Boolean(repo.suspendedAt) },
} : null);

const queryString = (req, name) => {
    const value = req.query[name];
    if (value === undefined) return undefined;
    if (typeof value !== 'string') throw new AppError('VALIDATION_ERROR', `${name} must be a single value`, 400);
    return value;
};

const createGithubRouter = ({ auth = requireAuth } = {}) => {
    const router = express.Router();
    // All limits are per user (these routes run after auth). The hourly browse cap keeps one member from
    // draining the installation's shared GitHub budget (githubApp.js) for every other group on it.
    const installLimiter = createLimiter({ windowMs: 60 * 1000, limit: 10, keyByUser: true });
    const browseLimiter = [
        createLimiter({ windowMs: 60 * 1000, limit: 60, keyByUser: true }),
        createLimiter({ windowMs: 60 * 60 * 1000, limit: 600, keyByUser: true }),
    ];
    const branchLimiter = createLimiter({ windowMs: 60 * 1000, limit: 20, keyByUser: true });
    const syncLimiter = createLimiter({ windowMs: 30 * 1000, limit: 1, keyByUser: true, message: 'Sync is limited to once every 30 seconds.' });

    router.use(auth);

    router.post('/groups/:gid/install', requireGroupAdmin('gid'), installLimiter, route(async (req, res) => {
        res.json({ data: installFlow.createInstallUrls({ gid: req.groupId, uid: req.user.userId }) });
    }));

    router.get('/selections/:id', route(async (req, res) => {
        res.json({ data: installFlow.getSelection(req.params.id, req.user.userId) });
    }));

    router.post('/groups/:gid/repository', requireGroupAdmin('gid'), installLimiter, route(async (req, res) => {
        const { selectionId, repoId } = req.body || {};
        if (typeof selectionId !== 'string' || !SELECTION_ID_RE.test(selectionId)) {
            throw new AppError('VALIDATION_ERROR', 'selectionId is required', 400);
        }
        const id = Number(repoId);
        if (!Number.isSafeInteger(id) || id <= 0) throw new AppError('VALIDATION_ERROR', 'repoId must be a positive integer', 400);
        const repo = await installFlow.completeSelection({ gid: req.groupId, uid: req.user.userId, selectionId, repoId: id });
        res.status(201).json({ data: formatRepository(repo) });
    }));

    router.get('/groups/:gid/repository', requireGroupMember('gid'), route(async (req, res) => {
        res.json({ data: formatRepository(await githubModel.getGroupRepository(req.groupId)) });
    }));

    router.delete('/groups/:gid/repository', requireGroupAdmin('gid'), route(async (req, res) => {
        await githubModel.unlinkGroupRepository(req.groupId);
        res.status(204).end();
    }));

    // Opt-in per group: repository content is only sent to the AI provider once an admin enables it.
    router.put('/groups/:gid/ai-analysis', requireGroupAdmin('gid'), route(async (req, res) => {
        const enabled = req.body && req.body.enabled;
        if (typeof enabled !== 'boolean') throw new AppError('VALIDATION_ERROR', 'enabled must be a boolean', 400);
        const result = await githubModel.setAiAnalysisEnabled(req.groupId, enabled);
        if (result === false || result === 0 || result === null) {
            throw new AppError('REPO_NOT_CONNECTED', 'This group has no connected repository', 409);
        }
        const value = result && typeof result === 'object' && typeof result.aiAnalysisEnabled === 'boolean' ? result.aiAnalysisEnabled : enabled;
        res.json({ data: { aiAnalysisEnabled: value } });
    }));

    router.get('/groups/:gid/tree', requireGroupMember('gid'), browseLimiter, route(async (req, res) => {
        res.json({ data: await repoService.getTree(req.groupId, { ref: queryString(req, 'ref') }) });
    }));

    router.get('/groups/:gid/file', requireGroupMember('gid'), browseLimiter, route(async (req, res) => {
        res.json({ data: await repoService.getFile(req.groupId, { path: queryString(req, 'path'), ref: queryString(req, 'ref') }) });
    }));

    router.get('/groups/:gid/readme', requireGroupMember('gid'), browseLimiter, route(async (req, res) => {
        res.json({ data: await repoService.getReadme(req.groupId, { ref: queryString(req, 'ref') }) });
    }));

    router.get('/groups/:gid/commits', requireGroupMember('gid'), browseLimiter, route(async (req, res) => {
        res.json({ data: await repoService.getCommits(req.groupId, { ref: queryString(req, 'ref'), perPage: queryString(req, 'perPage') }) });
    }));

    router.post('/tasks/:tid/branch', requireResourceMember('task', 'tid', { notFoundCode: 'TASK_NOT_FOUND' }), branchLimiter, route(async (req, res) => {
        const { status, data } = await branchService.createTaskBranch({ tid: req.resourceId, gid: req.groupId, uid: req.user.userId });
        res.status(status).json({ data });
    }));

    router.get('/groups/:gid/task-links', requireGroupMember('gid'), route(async (req, res) => {
        res.json({ data: await githubModel.getTaskLinksByGroup(req.groupId) });
    }));

    router.post('/groups/:gid/sync', requireGroupMember('gid'), syncLimiter, route(async (req, res) => {
        res.json({ data: await syncService.syncGroup(req.groupId) });
    }));

    return router;
};

const createGithubCallbackRouter = () => {
    const router = express.Router();
    const callbackLimiter = createLimiter({ windowMs: 60 * 1000, limit: 30, keyByUser: false });
    // Public: the signed single-use `state` is what authenticates this request.
    router.get('/callback', callbackLimiter, async (req, res) => {
        const target = await installFlow.handleCallback(req.query);
        res.set('Cache-Control', 'no-store');
        res.set('Referrer-Policy', 'no-referrer');
        res.redirect(302, target);
    });
    return router;
};

module.exports = {
    githubRouter: createGithubRouter(),
    githubCallbackRouter: createGithubCallbackRouter(),
    githubWebhookHandler,
    createGithubRouter,
    createGithubCallbackRouter,
    formatRepository,
};

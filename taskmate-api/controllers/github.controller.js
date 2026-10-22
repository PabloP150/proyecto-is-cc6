// GitHub integration routes. Not mounted here — see the mounting order in app.js:
// webhook (express.raw) → githubCallbackRouter → githubRouter (authenticated).
const express = require('express');
const { AppError, sendError } = require('../helpers/errors');
const requireAuth = require('../middleware/auth.middleware');
const { requireGroupMember, requireGroupAdmin, requireResourceMember } = require('../middleware/groupAccess');
const accessModel = require('../models/access.model');
const { createLimiter } = require('../middleware/rateLimit');
const githubModel = require('../models/github.model');
const installFlow = require('../services/github/installFlow');
const repoService = require('../services/github/repoService');
const branchService = require('../services/github/branchService');
const syncService = require('../services/github/syncService');
const pipelineService = require('../services/github/pipelineService');
const actionsService = require('../services/github/actionsService');
const { githubWebhookHandler } = require('../services/github/webhookHandler');

const SELECTION_ID_RE = /^[A-Za-z0-9_-]{43}$/;
const MAX_PROJECT_DIR = 200;

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

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const bodySpec = (req) => {
    const spec = req.body && req.body.spec;
    if (!isPlainObject(spec)) throw new AppError('VALIDATION_ERROR', 'spec must be an object', 400);
    return spec;
};

// Optional project switch for a new proposal: both strings (validated again against the repository).
const bodyProject = (req) => {
    const { dir, stack } = req.body || {};
    if (dir !== undefined && (typeof dir !== 'string' || !dir || dir.length > MAX_PROJECT_DIR)) {
        throw new AppError('VALIDATION_ERROR', 'dir must be a non-empty string', 400);
    }
    if (stack !== undefined && typeof stack !== 'string') throw new AppError('VALIDATION_ERROR', 'stack must be a string', 400);
    return { dir, stack };
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
    // A proposal or an apply reads several files of the repository; previews only re-render.
    const pipelineLimiter = createLimiter({ windowMs: 60 * 1000, limit: 10, keyByUser: true });
    const previewLimiter = createLimiter({ windowMs: 60 * 1000, limit: 60, keyByUser: true });
    // Running, re-running or cancelling uses the repository's Actions minutes: a few per minute.
    const controlLimiter = createLimiter({ windowMs: 60 * 1000, limit: 10, keyByUser: true });

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

    // ------------------------------------------------------------ Phase 4: CI/CD

    router.get('/groups/:gid/pipeline', requireGroupMember('gid'), browseLimiter, route(async (req, res) => {
        res.json({ data: await pipelineService.getPipeline(req.groupId) });
    }));

    router.post('/groups/:gid/pipeline/proposal', requireGroupAdmin('gid'), pipelineLimiter, route(async (req, res) => {
        const { dir, stack } = bodyProject(req);
        res.json({ data: await pipelineService.proposePipeline({ gid: req.groupId, uid: req.user.userId, dir, stack }) });
    }));

    router.post('/groups/:gid/pipeline/preview', requireGroupAdmin('gid'), previewLimiter, route(async (req, res) => {
        res.json({ data: await pipelineService.previewPipeline({ gid: req.groupId, uid: req.user.userId, spec: bodySpec(req) }) });
    }));

    router.put('/groups/:gid/pipeline', requireGroupAdmin('gid'), pipelineLimiter, route(async (req, res) => {
        const spec = bodySpec(req);
        res.json({
            data: await pipelineService.applyPipeline({ gid: req.groupId, uid: req.user.userId, username: req.user.username, spec }),
        });
    }));

    router.get('/groups/:gid/actions/workflows', requireGroupMember('gid'), browseLimiter, route(async (req, res) => {
        res.json({ data: await actionsService.listWorkflows(req.groupId) });
    }));

    router.get('/groups/:gid/actions/runs', requireGroupMember('gid'), browseLimiter, route(async (req, res) => {
        res.json({
            data: await actionsService.listRuns(req.groupId, {
                branch: queryString(req, 'branch'),
                status: queryString(req, 'status'),
                workflow: queryString(req, 'workflow'),
                page: queryString(req, 'page'),
            }),
        });
    }));

    router.get('/groups/:gid/actions/runs/:runId', requireGroupMember('gid'), browseLimiter, route(async (req, res) => {
        res.json({ data: await actionsService.getRun(req.groupId, req.params.runId) });
    }));

    router.get('/groups/:gid/actions/jobs/:jobId/logs', requireGroupMember('gid'), browseLimiter, route(async (req, res) => {
        res.json({ data: await actionsService.getJobLog(req.groupId, req.params.jobId) });
    }));

    router.get('/groups/:gid/actions/jobs/:jobId/annotations', requireGroupMember('gid'), browseLimiter, route(async (req, res) => {
        res.json({ data: await actionsService.getJobAnnotations(req.groupId, req.params.jobId) });
    }));

    // Any member runs the CI on a branch; deploys go through /deployments (Phase 4, step 3).
    router.post('/groups/:gid/actions/runs', requireGroupMember('gid'), controlLimiter, route(async (req, res) => {
        const ref = req.body && req.body.ref;
        if (typeof ref !== 'string' || !ref) throw new AppError('VALIDATION_ERROR', 'ref is required', 400);
        res.status(202).json({ data: await actionsService.dispatchPipeline(req.groupId, { ref }) });
    }));

    // Members re-run or cancel CI runs; deploy runs dispatched by TaskMate need the group admin.
    router.post('/groups/:gid/actions/runs/:runId/rerun-failed', requireGroupMember('gid'), controlLimiter, route(async (req, res) => {
        const isAdmin = await accessModel.isGroupAdmin(req.user.userId, req.groupId);
        res.status(202).json({ data: await actionsService.rerunFailed(req.groupId, req.params.runId, { isAdmin }) });
    }));

    router.post('/groups/:gid/actions/runs/:runId/cancel', requireGroupMember('gid'), controlLimiter, route(async (req, res) => {
        const isAdmin = await accessModel.isGroupAdmin(req.user.userId, req.groupId);
        res.status(202).json({ data: await actionsService.cancelRun(req.groupId, req.params.runId, { isAdmin }) });
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

const express = require('express');
const helmet = require('helmet');

const requireAuth = require('./middleware/auth.middleware');
const { corsMiddleware } = require('./middleware/cors');
const { apiLimiter } = require('./middleware/rateLimit');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const tasksController = require('./controllers/tasks.controller');
const userController = require('./controllers/user.controller');
const nodesController = require('./controllers/nodes.controller');
const groupController = require('./controllers/group.controller');
const edgesController = require('./controllers/edges.controller');
const completeController = require('./controllers/complete.controller');
const deleteController = require('./controllers/delete.controller');
const userTaskController = require('./controllers/usertask.controller');
const userGroupRolesController = require('./controllers/userGroupRoles.controller');
const groupRolesController = require('./controllers/groupRoles.controller');
const analyticsController = require('./controllers/analytics.controller');
const utilsController = require('./controllers/utils.controller');
const { githubRouter, githubCallbackRouter, githubWebhookHandler } = require('./controllers/github.controller');

function createApp() {
    const app = express();

    app.use(helmet());
    app.use(corsMiddleware());

    // The webhook verifies an HMAC over the exact request bytes, so it must be mounted
    // before express.json() consumes the body.
    app.post('/api/github/webhook', express.raw({ type: '*/*', limit: '1mb' }), githubWebhookHandler);

    app.use(express.json());

    // Register and login are public (rate limited inside the router); everything else requires a token.
    app.use('/api/users', userController);

    const authenticated = [requireAuth, apiLimiter];
    app.use('/api/tasks', authenticated, tasksController);
    app.use('/api/groups', authenticated, groupController);
    app.use('/api/nodes', authenticated, nodesController);
    app.use('/api/edges', authenticated, edgesController);
    app.use('/api/completados', authenticated, completeController);
    app.use('/api/delete', authenticated, deleteController);
    app.use('/api/usertask', authenticated, userTaskController);
    app.use('/api/usergrouproles', authenticated, userGroupRolesController);
    app.use('/api/grouproles', authenticated, groupRolesController);
    app.use('/api/analytics', authenticated, analyticsController.router);
    app.use('/api/utils', authenticated, utilsController);
    // The OAuth callback is a browser redirect from GitHub (no Bearer token; the signed state
    // authenticates it), so it has to be matched before the authenticated GitHub router.
    app.use('/api/github', githubCallbackRouter);
    app.use('/api/github', authenticated, githubRouter);

    app.use(notFoundHandler);
    app.use(errorHandler);

    return app;
}

const app = createApp();

module.exports = app;
module.exports.createApp = createApp;

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const http = require('http');

// IMPORTANT: Load environment variables BEFORE requiring modules that read process.env
// Load .env from taskmate-api first (optional)
dotenv.config();
console.log('Loaded .env from taskmate-api:', { LLM_PROVIDER: process.env.LLM_PROVIDER, LLM_API_KEY: process.env.LLM_API_KEY, LLM_TEMPERATURE: process.env.LLM_TEMPERATURE });
// Then load root-level env files if present
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: false });
console.log('Loaded root-level .env (if present):', { LLM_PROVIDER: process.env.LLM_PROVIDER, LLM_API_KEY: process.env.LLM_API_KEY, LLM_TEMPERATURE: process.env.LLM_TEMPERATURE });

const WebSocketServer = require('./services/WebSocketServer');
const tasksController = require('./controllers/tasks.controller');
const userController = require('./controllers/user.controller');
const nodesController = require('./controllers/nodes.controller');
const groupController = require('./controllers/group.controller');
const edgesController = require('./controllers/edges.controller');
const completeController = require('./controllers/complete.controller');
const deleteController = require('./controllers/delete.controller');
const userTaskController = require('./controllers/usertask.controller');
const analyticsController = require('./controllers/analytics.controller');


const {
    API_PORT = 9000,
    SERVER_TAG = 'API EXPRESS'
} = process.env;

const app = express();

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
    console.log(`Request client URL: ${req.get('host')}${req.originalUrl} >>>> ${SERVER_TAG}`);
    next();
});

app.use('/api/tasks', tasksController);
app.use('/api/users', userController);
app.use('/api/groups', groupController);
app.use('/api/nodes', nodesController);
app.use('/api/edges', edgesController);
app.use('/api/completados', completeController);
app.use('/api/delete', deleteController);
app.use('/api/usertask', userTaskController);

// Analytics routes
app.get('/api/analytics/user/:userId', analyticsController.getUserAnalytics);
app.get('/api/analytics/team/:groupId', analyticsController.getTeamAnalytics);
app.get('/api/analytics/workload/:groupId', analyticsController.getWorkloadDistribution);
app.get('/api/analytics/trends/:userId', analyticsController.getUserCompletionTrends);
app.get('/api/analytics/expertise/:groupId', analyticsController.getCategoryExpertiseRankings);
app.get('/api/analytics/config/:groupId', analyticsController.getAnalyticsConfig);
app.put('/api/analytics/config/:groupId', analyticsController.updateAnalyticsConfig);
app.get('/api/analytics/dashboard/:groupId', analyticsController.getDashboardData);
app.post('/api/analytics/recommendations', analyticsController.getTaskRecommendations);
app.post('/api/analytics/assignment', analyticsController.recordTaskAssignment);
app.post('/api/analytics/completion', analyticsController.recordTaskCompletion);
app.post('/api/analytics/batch-update', analyticsController.batchUpdateMetrics);


// Create HTTP server
const server = http.createServer(app);

// Initialize WebSocket server
const wsServer = new WebSocketServer(server);

server.listen(API_PORT, () => {
    console.log(`API running on PORT ${API_PORT}`);
    console.log(`WebSocket server available at ws://localhost:${API_PORT}/chat`);
});

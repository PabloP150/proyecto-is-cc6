const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const WebSocketServer = require('./services/WebSocketServer');
const tasksController = require('./controllers/tasks.controller');
const userController = require('./controllers/user.controller');
const nodesController = require('./controllers/nodes.controller');
const groupController = require('./controllers/group.controller');
const edgesController = require('./controllers/edges.controller');
const completeController = require('./controllers/complete.controller');
const deleteController = require('./controllers/delete.controller');
const userTaskController = require('./controllers/usertask.controller');
dotenv.config();

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

// Create HTTP server
const server = http.createServer(app);

// Initialize WebSocket server
const wsServer = new WebSocketServer(server);

server.listen(API_PORT, () => {
    console.log(`API running on PORT ${API_PORT}`);
    console.log(`WebSocket server available at ws://localhost:${API_PORT}/chat`);
});

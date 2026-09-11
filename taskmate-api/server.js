const dotenv = require('dotenv');
const path = require('path');
const http = require('http');

// IMPORTANT: Load environment variables BEFORE requiring modules that read process.env
// Load .env from taskmate-api first (optional)
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: false });

if (!process.env.JWT_SECRET) {
    if (require.main === module) {
        console.error('FATAL: JWT_SECRET is not defined in environment variables. Server will not start.');
        process.exit(1);
    }
    throw new Error('JWT_SECRET is not defined in environment variables.');
}

const app = require('./app');
const WebSocketServer = require('./services/WebSocketServer');

const { API_PORT = 9000 } = process.env;

// HTTP server + the single WebSocket server (/chat and /insights) on the same port.
function createServer() {
    const server = http.createServer(app);
    const wsServer = new WebSocketServer(server);
    server.on('close', () => wsServer.close());
    return { server, wsServer };
}

if (require.main === module) {
    const { initialize: initPool } = require('./helpers/pool');
    const { server } = createServer();

    initPool()
        .then(() => {
            server.listen(API_PORT, () => {
                console.log(`API running on PORT ${API_PORT}`);
                console.log(`WebSocket server available at ws://localhost:${API_PORT}/chat and /insights`);
            });
        })
        .catch(err => {
            console.error('FATAL: Could not initialize DB connection pool:', err.message);
            process.exit(1);
        });
}

module.exports = { app, createServer };

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

const MIN_JWT_SECRET_LENGTH = 32;
const PLACEHOLDER_SECRET_RE = /change[-_ ]?me|your[-_ ]?secret|secret[-_ ]?key|placeholder|example|replace[-_ ]?me/i;

// Anyone who guesses the secret can mint tokens for any user, so refuse to serve with a weak one.
function assertStrongJwtSecret(secret = process.env.JWT_SECRET) {
    if (!secret || secret.length < MIN_JWT_SECRET_LENGTH || PLACEHOLDER_SECRET_RE.test(secret)) {
        throw new Error(`JWT_SECRET must be a random value of at least ${MIN_JWT_SECRET_LENGTH} characters (not a placeholder).`);
    }
}

// HTTP server + the single WebSocket server (/chat and /insights) on the same port.
function createServer() {
    assertStrongJwtSecret();
    const server = http.createServer(app);
    const wsServer = new WebSocketServer(server);
    server.on('close', () => wsServer.close());
    return { server, wsServer };
}

if (require.main === module) {
    const { initialize: initPool } = require('./helpers/pool');
    let server;
    try {
        ({ server } = createServer());
    } catch (err) {
        console.error(`FATAL: ${err.message} Server will not start.`);
        process.exit(1);
    }

    initPool()
        .then(() => {
            server.listen(API_PORT, () => {
                console.log(`API running on PORT ${API_PORT}`);
                console.log(`WebSocket server available at ws://localhost:${API_PORT}/chat and /insights`);
                // Periodic metrics recompute (opt-in via ANALYTICS_BATCH_ENABLED=true).
                require('./services/AnalyticsBatchJob').start();
            });
        })
        .catch(err => {
            console.error('FATAL: Could not initialize DB connection pool:', err.message);
            process.exit(1);
        });
}

module.exports = { app, createServer, assertStrongJwtSecret };

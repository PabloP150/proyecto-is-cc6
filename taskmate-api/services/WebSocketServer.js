const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const SessionManager = require('./SessionManager');
const UserSession = require('./UserSession');
const llmService = require('./LLMService'); // Import LLMService for insights
const { verifyAccessToken } = require('../helpers/tokens');
const { AppError, isAppError } = require('../helpers/errors');
const { isAllowedOrigin } = require('../middleware/cors');
const { realtime, subscribedMessage } = require('./realtime');

const MAX_PAYLOAD_BYTES = 64 * 1024;
const TOKEN_EXPIRED_CLOSE_CODE = 4001;
const MAX_TIMER_MS = 2 ** 31 - 1; // setTimeout limit
// Each subscribe checks membership of up to 50 groups: one per second per socket is plenty.
const SUBSCRIBE_INTERVAL_MS = 1000;
// A page sends a few per load (its groups, then again when they change); more is a flood.
const SUBSCRIBES_PER_MINUTE = 20;
// One /events socket per open tab; past this the user's oldest one is closed.
const MAX_EVENT_SOCKETS_PER_USER = 10;
// An evicted socket whose peer ignores the close frame would linger for ws's 30 s close timeout.
const EVICTED_CLOSE_GRACE_MS = 5000;

const rejectUpgrade = (socket, status) => {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
};

class WebSocketServer {
    constructor(server) {
        this.sessionManager = new SessionManager();
        this.insightsClients = new Map(); // Store clients for the /insights endpoint
        this.eventSockets = new Map(); // userId → Map(ws → drop) of its open /events sockets, oldest first
        this.evictedCloseGraceMs = EVICTED_CLOSE_GRACE_MS;

        // Create WebSocket server without a specific path. Client messages are small JSON commands;
        // the 100 MiB default would let one client exhaust memory and flood the shared Python link.
        this.wss = new WebSocket.Server({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

        // Handle server upgrades to route connections
        server.on('upgrade', this.handleUpgrade.bind(this));

        this.setupEventHandlers();
        this.setupHeartbeat();
        console.log('WebSocket server initialized to handle /chat, /insights and /events');
    }

    handleUpgrade(request, socket, head) {
        // Fixed base: the Host header is attacker-controlled and `new URL` throws on values like '%'.
        let url;
        try {
            url = new URL(request.url, 'http://localhost');
        } catch {
            rejectUpgrade(socket, '400 Bad Request');
            return;
        }
        const pathname = url.pathname;

        // Browsers always send Origin on WebSocket handshakes; reject pages from other sites.
        if (!isAllowedOrigin(request.headers.origin)) {
            rejectUpgrade(socket, '403 Forbidden');
            return;
        }

        // Authenticate before upgrading the connection (same rules as requireAuth: HS256, access tokens only)
        const token = url.searchParams.get('token');
        let userId;

        try {
            if (!token) throw new Error('No token provided');
            userId = verifyAccessToken(token).userId;
        } catch (error) {
            console.log(`WebSocket upgrade rejected for ${pathname}: ${error.message}`);
            rejectUpgrade(socket, '401 Unauthorized');
            return;
        }

        request.userId = userId; // Attach userId to the request for later use
        request.tokenExpiresAt = jwt.decode(token).exp * 1000; // verified above; access tokens always carry exp

        if (pathname === '/chat') {
            this.wss.handleUpgrade(request, socket, head, (ws) => {
                this.wss.emit('connection', ws, request, 'chat');
            });
        } else if (pathname === '/insights') {
            this.wss.handleUpgrade(request, socket, head, (ws) => {
                this.wss.emit('connection', ws, request, 'insights');
            });
        } else if (pathname === '/events') {
            this.wss.handleUpgrade(request, socket, head, (ws) => {
                this.wss.emit('connection', ws, request, 'events');
            });
        } else {
            console.log(`No handler for WebSocket path: ${pathname}`);
            rejectUpgrade(socket, '404 Not Found');
        }
    }

    setupEventHandlers() {
        this.wss.on('connection', (ws, req, connectionType) => {
            ws.isAlive = true;
            ws.on('pong', () => { ws.isAlive = true; });

            // The token was only checked at the handshake: end the session when it expires.
            const ttl = Math.min(Math.max(req.tokenExpiresAt - Date.now(), 0), MAX_TIMER_MS);
            const expiryTimer = setTimeout(() => ws.close(TOKEN_EXPIRED_CLOSE_CODE, 'Token expired'), ttl);
            expiryTimer.unref();
            ws.on('close', () => clearTimeout(expiryTimer));

            if (connectionType === 'chat') {
                this.handleChatConnection(ws, req);
            } else if (connectionType === 'insights') {
                this.handleInsightsConnection(ws, req);
            } else if (connectionType === 'events') {
                this.handleEventsConnection(ws, req);
            }
        });

        this.wss.on('error', (error) => {
            console.error('WebSocket server error:', error);
        });
    }

    // Existing method to handle chat connections
    async handleChatConnection(ws, req) {
        try {
            const userId = req.userId;
            const session = await this.sessionManager.connect(ws, userId);

            ws.on('message', async (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    session.handleMessage(message);
                } catch (error) {
                    console.error('Error parsing chat message:', error);
                    session.sendMessage({ type: 'error', content: 'Invalid message format' });
                }
            });

            ws.on('close', () => {
                this.sessionManager.disconnect(ws);
            });

            ws.on('error', (error) => {
                console.error(`Chat WebSocket error for user ${userId}:`, error);
                this.sessionManager.disconnect(ws);
            });

        } catch (error) {
            console.error('Error handling chat connection:', error);
            ws.close(1011, 'Server error during connection setup');
        }
    }
    
    // New method to handle insights connections
    handleInsightsConnection(ws, req) {
        const userId = req.userId;
        const clientId = uuidv4();

        this.insightsClients.set(clientId, { ws, userId });

        // Forward messages from the LLM service to this specific client
        const llmListener = (response) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(response));
            }
        };
        llmService.on(clientId, llmListener);

        ws.on('message', async (data) => {
            let request;
            try {
                request = JSON.parse(data.toString());
            } catch (error) {
                console.error(`Error parsing insights message for ${userId}:`, error);
                return;
            }
            if (!request || typeof request !== 'object') return;

            if (request.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
                return;
            }

            if (request.type === 'analytics') {
                try {
                    const llmRequest = await this.buildInsightsRequest(request, userId, clientId);
                    if ((await llmService.send(llmRequest)) === false) {
                        throw new AppError('LLM_ERROR', 'The analytics agent is unavailable, please try again later', 503);
                    }
                } catch (error) {
                    if (!isAppError(error)) console.error(`Insights request failed for ${userId}:`, error);
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            event: 'analytics_error',
                            requestId: request.requestId,
                            error: isAppError(error) ? error.message : 'Analytics request failed',
                            code: isAppError(error) ? error.code : 'INTERNAL_ERROR'
                        }));
                    }
                }
            }
        });

        ws.on('close', () => {
            llmService.removeListener(clientId, llmListener);
            this.insightsClients.delete(clientId);
        });

        ws.on('error', (error) => {
            console.error(`Insights WebSocket error for user ${userId}:`, error);
            llmService.removeListener(clientId, llmListener);
            this.insightsClients.delete(clientId);
        });
    }

    // Phase 4: live CI/CD events for the groups the user subscribes to (see services/realtime.js).
    // Client → {type: 'subscribe', groups: [gid…]} | {type: 'ping'}; server → {type: 'subscribed', groups}
    // (plus `pending`: groups whose membership check failed and is retried; sent again when one of
    // them goes live), {type: 'event', event, gid, data} and {type: 'error', code: 'RATE_LIMITED'
    // (with retryAfterMs) | 'SUBSCRIBE_FAILED'}.
    handleEventsConnection(ws, req) {
        const client = realtime.addClient({
            userId: req.userId,
            send: (message) => {
                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
            },
        });

        // Subscribes are never dropped: a page load sends [] and then its groups ~300 ms later, and
        // the second one must win. They run one at a time (replies cannot arrive out of order), at
        // most one per SUBSCRIBE_INTERVAL_MS, and only the latest waiting one runs: each replaces
        // the whole list, so the ones in between are moot.
        let waiting = null; // {groups} of the latest subscribe not applied yet
        let running = false;
        let lastAppliedAt = -Infinity;
        let timer = null;
        let closed = false;
        const accepted = []; // times of the subscribes accepted in the last minute

        const applyNext = async () => {
            if (closed || running || !waiting) return;
            const wait = lastAppliedAt + SUBSCRIBE_INTERVAL_MS - Date.now();
            if (wait > 0) {
                if (!timer) {
                    timer = setTimeout(() => {
                        timer = null;
                        applyNext();
                    }, wait);
                }
                return;
            }
            const { groups: gids } = waiting;
            waiting = null;
            running = true;
            lastAppliedAt = Date.now();
            try {
                client.send(subscribedMessage(await realtime.subscribe(client, gids)));
            } catch (error) {
                // realtime.subscribe absorbs DB errors; this is a bug, but the client must not believe it is live.
                console.error(`Events subscribe failed for user ${req.userId}:`, error && error.message);
                client.send({ type: 'error', code: 'SUBSCRIBE_FAILED' });
            } finally {
                running = false;
            }
            applyNext();
        };

        ws.on('message', (data) => {
            let request;
            try {
                request = JSON.parse(data.toString());
            } catch {
                return;
            }
            if (!request || typeof request !== 'object') return;
            if (request.type === 'ping') {
                client.send({ type: 'pong' });
                return;
            }
            if (request.type === 'subscribe') {
                const now = Date.now();
                while (accepted.length > 0 && now - accepted[0] >= 60 * 1000) accepted.shift();
                if (accepted.length >= SUBSCRIBES_PER_MINUTE) {
                    client.send({ type: 'error', code: 'RATE_LIMITED', retryAfterMs: accepted[0] + 60 * 1000 - now });
                    return;
                }
                accepted.push(now);
                waiting = { groups: request.groups };
                applyNext();
            }
        });

        const drop = () => {
            if (closed) return;
            closed = true;
            clearTimeout(timer);
            realtime.removeClient(client);
            this.untrackEventSocket(req.userId, ws);
        };
        ws.on('close', drop);
        ws.on('error', (error) => {
            console.error(`Events WebSocket error for user ${req.userId}:`, error && error.message);
            drop();
        });
        this.trackEventSocket(req.userId, ws, drop);
    }

    // drop: leaves the hub and the user's list (also run on close; it runs once).
    trackEventSocket(userId, ws, drop) {
        const id = String(userId).toLowerCase();
        const open = this.eventSockets.get(id) || new Map();
        open.set(ws, drop);
        this.eventSockets.set(id, open);
        for (const [oldest, dropOldest] of open) {
            if (open.size <= MAX_EVENT_SOCKETS_PER_USER) break;
            // Out of the hub right away, not when the close handshake ends: the cap must hold even
            // for a peer that never answers the close frame, which is cut off after the grace time.
            dropOldest();
            // 1000 so the evicted tab does not reconnect and evict another one in turn (it falls back to polling).
            oldest.close(1000, 'Too many connections');
            const cutOff = setTimeout(() => oldest.terminate(), this.evictedCloseGraceMs);
            cutOff.unref();
            oldest.once('close', () => clearTimeout(cutOff));
        }
    }

    untrackEventSocket(userId, ws) {
        const id = String(userId).toLowerCase();
        const open = this.eventSockets.get(id);
        if (!open) return;
        open.delete(ws);
        if (open.size === 0) this.eventSockets.delete(id);
    }

    // Same rules as the /chat analytics path (shared helper, per action): team data for a real group
    // requires a team leader and gets the server-built team_context; demo ids (`test-group-*`) go through as-is.
    async buildInsightsRequest(request, userId, clientId) {
        const data = await UserSession.prepareAnalyticsData(userId, request.data, request.action);

        return {
            requestId: request.requestId,
            sessionId: clientId, // Use the unique clientId to route the response back
            type: 'analytics',
            action: request.action,
            data,
            // Add params.message for orchestrator compatibility
            params: {
                message: `Analytics request: ${request.action}`
            }
        };
    }

    getActiveConnections() {
        return this.sessionManager.getActiveSessionCount() + this.insightsClients.size;
    }
    
    broadcast(message) {
        this.wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(message));
            }
        });
    }

    sendToUser(userId, message) {
        const session = this.sessionManager.getUserSession(userId);
        if (session && session.isActive()) {
            session.sendMessage(message);
            return true;
        }
        return false;
    }

    setupHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            this.wss.clients.forEach((ws) => {
                if (ws.readyState !== WebSocket.OPEN) return;
                if (ws.isAlive === false) {
                    ws.terminate();
                    return;
                }
                ws.isAlive = false;
                ws.ping();
            });
        }, 30000);
    }
    
    disconnectUser(userId) {
        return this.sessionManager.disconnectUser(userId);
    }
    
    getSessionInfo() {
        // ... (can be enhanced to show insights clients too)
    }

    close() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        this.sessionManager.cleanup();
        this.wss.close();
    }
}

module.exports = WebSocketServer;
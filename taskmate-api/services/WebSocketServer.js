const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const SessionManager = require('./SessionManager');
const llmService = require('./LLMService'); // Import LLMService for insights

class WebSocketServer {
    constructor(server) {
        this.sessionManager = new SessionManager();
        this.insightsClients = new Map(); // Store clients for the /insights endpoint
        
        // Create WebSocket server without a specific path
        this.wss = new WebSocket.Server({ noServer: true });

        // Handle server upgrades to route connections
        server.on('upgrade', this.handleUpgrade.bind(this));

        this.setupEventHandlers();
        this.setupHeartbeat();
        console.log('WebSocket server initialized to handle /chat and /insights');
    }

    handleUpgrade(request, socket, head) {
        const url = new URL(request.url, `http://${request.headers.host}`);
        const pathname = url.pathname;
        
        // Authenticate before upgrading the connection
        const token = url.searchParams.get('token');
        let userId;

        try {
            if (!token) throw new Error('No token provided');
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
            userId = decoded.userId || decoded.id;
        } catch (error) {
            console.log(`WebSocket upgrade rejected for ${pathname}: ${error.message}`);
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }

        request.userId = userId; // Attach userId to the request for later use

        if (pathname === '/chat') {
            this.wss.handleUpgrade(request, socket, head, (ws) => {
                this.wss.emit('connection', ws, request, 'chat');
            });
        } else if (pathname === '/insights') {
            this.wss.handleUpgrade(request, socket, head, (ws) => {
                this.wss.emit('connection', ws, request, 'insights');
            });
        } else {
            console.log(`No handler for WebSocket path: ${pathname}`);
            socket.destroy();
        }
    }

    setupEventHandlers() {
        this.wss.on('connection', (ws, req, connectionType) => {
            if (connectionType === 'chat') {
                this.handleChatConnection(ws, req);
            } else if (connectionType === 'insights') {
                this.handleInsightsConnection(ws, req);
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
            console.log(`Chat WebSocket connection established for user: ${userId}`);
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
                console.log(`Chat WebSocket connection closed for user: ${userId}`);
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
        console.log(`Insights WebSocket connection established for user: ${userId} (Client ID: ${clientId})`);

        this.insightsClients.set(clientId, { ws, userId });

        // Forward messages from the LLM service to this specific client
        const llmListener = (response) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(response));
            }
        };
        llmService.on(clientId, llmListener);

        ws.on('message', (data) => {
            try {
                const request = JSON.parse(data.toString());

                if (request.type === 'ping') {
                    ws.send(JSON.stringify({ type: 'pong' }));
                    return;
                }

                if (request.type === 'analytics') {
                    const llmRequest = {
                        requestId: request.requestId,
                        sessionId: clientId, // Use the unique clientId to route the response back
                        type: 'analytics',
                        action: request.action,
                        data: request.data,
                        // Add params.message for orchestrator compatibility
                        params: {
                            message: `Analytics request: ${request.action}`
                        }
                    };
                    llmService.send(llmRequest);
                }
            } catch (error) {
                console.error(`Error parsing insights message for ${userId}:`, error);
            }
        });

        ws.on('close', () => {
            console.log(`Insights WebSocket connection closed for user: ${userId}`);
            llmService.removeListener(clientId, llmListener);
            this.insightsClients.delete(clientId);
        });

        ws.on('error', (error) => {
            console.error(`Insights WebSocket error for user ${userId}:`, error);
            llmService.removeListener(clientId, llmListener);
            this.insightsClients.delete(clientId);
        });
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
                if (ws.readyState === WebSocket.OPEN) {
                    ws.ping();
                }
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
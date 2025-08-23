const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const SessionManager = require('./SessionManager');

class WebSocketServer {
    constructor(server) {
        this.sessionManager = new SessionManager();
        
        // Create WebSocket server
        this.wss = new WebSocket.Server({
            server,
            path: '/chat',
            verifyClient: this.verifyClient.bind(this)
        });

        this.setupEventHandlers();
        console.log('WebSocket server initialized on /chat path');
    }

    verifyClient(info) {
        try {
            // Extract token from query parameters or headers
            const url = new URL(info.req.url, `http://${info.req.headers.host}`);
            const token = url.searchParams.get('token') || 
                         info.req.headers.authorization?.replace('Bearer ', '');

            if (!token) {
                console.log('WebSocket connection rejected: No token provided');
                return false;
            }

            // Verify JWT token
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
            
            // Store user info in request for later use
            info.req.userId = decoded.userId || decoded.id;
            
            console.log(`WebSocket connection verified for user: ${info.req.userId}`);
            return true;

        } catch (error) {
            console.log('WebSocket connection rejected: Invalid token', error.message);
            return false;
        }
    }

    setupEventHandlers() {
        this.wss.on('connection', async (ws, req) => {
            try {
                const userId = req.userId;
                console.log(`WebSocket connection established for user: ${userId}`);

                // Create user session
                const session = await this.sessionManager.connect(ws, userId);

                // Handle incoming messages
                ws.on('message', async (data) => {
                    try {
                        const message = JSON.parse(data.toString());
                        await session.handleMessage(message);
                    } catch (error) {
                        console.error('Error parsing message:', error);
                        session.sendMessage({
                            type: 'error',
                            content: 'Invalid message format',
                            timestamp: new Date()
                        });
                    }
                });

                // Handle connection close
                ws.on('close', () => {
                    console.log(`WebSocket connection closed for user: ${userId}`);
                    this.sessionManager.disconnect(ws);
                });

                // Handle connection errors
                ws.on('error', (error) => {
                    console.error(`WebSocket error for user ${userId}:`, error);
                    this.sessionManager.disconnect(ws);
                });

                // Send connection confirmation
                session.sendMessage({
                    type: 'system',
                    content: 'WebSocket connection established successfully',
                    timestamp: new Date()
                });

            } catch (error) {
                console.error('Error handling WebSocket connection:', error);
                ws.close(1011, 'Server error during connection setup');
            }
        });

        this.wss.on('error', (error) => {
            console.error('WebSocket server error:', error);
        });
    }

    getActiveConnections() {
        return this.sessionManager.getActiveSessionCount();
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

    close() {
        this.sessionManager.cleanup();
        this.wss.close();
    }
}

module.exports = WebSocketServer;
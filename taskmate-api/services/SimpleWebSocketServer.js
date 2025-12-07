const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

class SimpleWebSocketServer {
    constructor(server) {
        this.connections = new Map(); // userId -> ws
        
        // Create WebSocket server with minimal configuration
        this.wss = new WebSocket.Server({
            server,
            path: '/chat',
            verifyClient: this.verifyClient.bind(this),
            perMessageDeflate: false
        });

        this.setupEventHandlers();
        console.log('Simple WebSocket server initialized on /chat path');
    }

    verifyClient(info) {
        try {
            // Extract token from query parameters
            const url = new URL(info.req.url, `http://${info.req.headers.host}`);
            const token = url.searchParams.get('token');

            if (!token) {
                console.log('WebSocket connection rejected: No token provided');
                return false;
            }

            // Verify JWT token
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
            
            // Store user info in request for later use
            info.req.userId = decoded.userId || decoded.id;
            console.log(`WebSocket token verified for user: ${info.req.userId}`);
            return true;

        } catch (error) {
            console.log('WebSocket connection rejected: Invalid token', error.message);
            return false;
        }
    }

    setupEventHandlers() {
        this.wss.on('connection', (ws, req) => {
            try {
                const userId = req.userId;
                console.log(`WebSocket connected successfully for user: ${userId}`);
                
                // Store connection
                this.connections.set(userId, ws);

                // Handle incoming messages
                ws.on('message', (data) => {
                    try {
                        const message = JSON.parse(data.toString());
                        console.log(`Received message from user ${userId}:`, message.type);
                        
                        // Simple echo response for testing
                        this.sendToUser(userId, {
                            type: 'assistant',
                            content: `Echo: ${message.content}`,
                            timestamp: new Date()
                        });
                        
                    } catch (error) {
                        console.error('Error parsing message:', error);
                        this.sendToUser(userId, {
                            type: 'error',
                            content: 'Invalid message format',
                            timestamp: new Date()
                        });
                    }
                });

                // Handle connection close
                ws.on('close', (code, reason) => {
                    console.log(`WebSocket disconnected for user ${userId}: ${code} ${reason}`);
                    this.connections.delete(userId);
                });

                // Handle connection errors
                ws.on('error', (error) => {
                    console.error(`WebSocket error for user ${userId}:`, error);
                    this.connections.delete(userId);
                });

                // Send welcome message with delay to avoid race conditions
                setTimeout(() => {
                    this.sendToUser(userId, {
                        type: 'system',
                        content: 'Connected to TaskMate AI Assistant',
                        timestamp: new Date()
                    });
                }, 100);

            } catch (error) {
                console.error('Error handling WebSocket connection:', error);
                ws.close(1011, 'Server error during connection setup');
            }
        });

        this.wss.on('error', (error) => {
            console.error('WebSocket server error:', error);
        });
    }

    sendToUser(userId, message) {
        const ws = this.connections.get(userId);
        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
                const messageStr = JSON.stringify(message);
                console.log(`Sending message to user ${userId}:`, message.type, `(${messageStr.length} chars)`);
                ws.send(messageStr);
                return true;
            } catch (error) {
                console.error(`Error sending message to user ${userId}:`, error);
                this.connections.delete(userId);
                return false;
            }
        } else {
            console.log(`Cannot send to user ${userId}: WebSocket not open (state: ${ws?.readyState})`);
        }
        return false;
    }

    broadcast(message) {
        this.connections.forEach((ws, userId) => {
            if (ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(JSON.stringify(message));
                } catch (error) {
                    console.error(`Error broadcasting to user ${userId}:`, error);
                    this.connections.delete(userId);
                }
            }
        });
    }

    getActiveConnections() {
        return this.connections.size;
    }

    close() {
        this.connections.forEach((ws) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.close(1000, 'Server shutdown');
            }
        });
        this.connections.clear();
        this.wss.close();
    }
}

module.exports = SimpleWebSocketServer;
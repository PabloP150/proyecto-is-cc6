const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

class MinimalWebSocketServer {
    constructor(server) {
        this.connections = new Map();
        
        // Create WebSocket server with absolute minimal configuration
        this.wss = new WebSocket.Server({
            server,
            path: '/chat'
        });

        this.setupEventHandlers();
        console.log('Minimal WebSocket server initialized on /chat path');
    }

    setupEventHandlers() {
        this.wss.on('connection', (ws, req) => {
            console.log('WebSocket connection attempt from:', req.socket.remoteAddress);
            console.log('Request URL:', req.url);
            
            try {
                // Extract and verify token
                const url = new URL(req.url, `http://${req.headers.host}`);
                const token = url.searchParams.get('token');

                if (!token) {
                    console.log('No token provided, closing connection');
                    ws.close(1008, 'Token required');
                    return;
                }

                let userId;
                try {
                    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
                    userId = decoded.userId || decoded.id;
                    console.log('WebSocket token verified for user:', userId);
                } catch (error) {
                    console.log('Invalid token, closing connection:', error.message);
                    ws.close(1008, 'Invalid token');
                    return;
                }

                console.log(`WebSocket connected successfully for user: ${userId}`);
                this.connections.set(userId, ws);

                // Handle messages
                ws.on('message', (data) => {
                    console.log(`Message from user ${userId}:`, data.toString());
                    
                    // Simple echo
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'echo',
                            content: `Received: ${data.toString()}`,
                            timestamp: new Date()
                        }));
                    }
                });

                ws.on('close', (code, reason) => {
                    console.log(`WebSocket disconnected for user ${userId}: ${code} ${reason}`);
                    this.connections.delete(userId);
                });

                ws.on('error', (error) => {
                    console.error(`WebSocket error for user ${userId}:`, error);
                    this.connections.delete(userId);
                });

                // Don't send any automatic messages - let the client initiate

            } catch (error) {
                console.error('Error in connection handler:', error);
                ws.close(1011, 'Server error');
            }
        });

        this.wss.on('error', (error) => {
            console.error('WebSocket server error:', error);
        });
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

module.exports = MinimalWebSocketServer;
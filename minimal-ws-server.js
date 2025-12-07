const WebSocket = require('ws');
const http = require('http');

// Create HTTP server
const server = http.createServer();

// Create WebSocket server
const wss = new WebSocket.Server({
    server,
    path: '/chat',
    perMessageDeflate: false // Disable compression
});

wss.on('connection', (ws, req) => {
    console.log('WebSocket connected');
    
    // Don't send any messages automatically
    
    ws.on('message', (data) => {
        console.log('Received:', data.toString());
        // Echo back the message
        ws.send(JSON.stringify({
            type: 'echo',
            content: data.toString(),
            timestamp: new Date()
        }));
    });
    
    ws.on('close', () => {
        console.log('WebSocket disconnected');
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

server.listen(9001, () => {
    console.log('Minimal WebSocket server running on port 9001');
    console.log('WebSocket available at ws://localhost:9001/chat');
});
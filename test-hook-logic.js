// Test the WebSocket hook logic without React
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

// Create a test JWT token
const testToken = jwt.sign(
    { userId: 'test-user-123' }, 
    process.env.JWT_SECRET || 'your-jwt-secret-key-change-in-production',
    { expiresIn: '1h' }
);

console.log('Testing WebSocket hook logic...');

// Simulate the hook's connection logic
function testWebSocketConnection() {
    const url = 'ws://localhost:9000/chat';
    const token = testToken;
    
    if (!url || !token) {
        console.error('❌ URL and token are required');
        return;
    }

    const wsUrl = `${url}?token=${encodeURIComponent(token)}`;
    console.log('🔌 Connecting to:', wsUrl);
    
    const ws = new WebSocket(wsUrl);
    
    ws.on('open', () => {
        console.log('✅ Connection opened successfully');
        
        // Send a test message
        const message = {
            type: 'user',
            content: 'Test message from hook logic test',
            timestamp: new Date()
        };
        
        ws.send(JSON.stringify(message));
        console.log('📤 Sent test message');
    });
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            console.log('📨 Received:', message);
        } catch (error) {
            console.error('❌ Failed to parse message:', error);
        }
    });
    
    ws.on('close', (code, reason) => {
        console.log(`🔌 Connection closed: ${code} - ${reason}`);
    });
    
    ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error.message);
    });
    
    // Close after 3 seconds
    setTimeout(() => {
        console.log('🔚 Closing connection...');
        ws.close(1000, 'Test complete');
    }, 3000);
}

testWebSocketConnection();
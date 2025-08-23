const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

// Create a test JWT token
const testToken = jwt.sign(
    { userId: 'test-user-123' }, 
    process.env.JWT_SECRET || 'your-jwt-secret-key-change-in-production',
    { expiresIn: '1h' }
);

console.log('Testing WebSocket connection...');
console.log('Test token:', testToken);

// Test connection with valid token
const ws = new WebSocket(`ws://localhost:9000/chat?token=${testToken}`);

ws.on('open', () => {
    console.log('✅ WebSocket connection established successfully');
    
    // Send a test message
    ws.send(JSON.stringify({
        type: 'user',
        content: 'Hello, this is a test message!',
        timestamp: new Date()
    }));
});

ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    console.log('📨 Received message:', message);
});

ws.on('close', (code, reason) => {
    console.log(`🔌 Connection closed: ${code} - ${reason}`);
    process.exit(0);
});

ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error.message);
    process.exit(1);
});

// Close connection after 3 seconds
setTimeout(() => {
    console.log('Closing test connection...');
    ws.close();
}, 3000);
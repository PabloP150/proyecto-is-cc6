const WebSocket = require('ws');

// Test token
const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2MzI0RjVFOC1FRDdELTRGNUUtQjREMy1BQ0M4QTgwRDgzODEiLCJ1c2VybmFtZSI6InRlc3QiLCJpYXQiOjE3NjQ5MjE5NzQsImV4cCI6MTc2NTAwODM3NH0.RYmdDyhktoj8UDd4rzyHMtenAWVBpi6J9LAk-0UIRaI';

console.log('Testing simple WebSocket connection (no messages)...');

const wsUrl = `ws://localhost:9000/chat?token=${encodeURIComponent(token)}`;
const ws = new WebSocket(wsUrl, [], {
    perMessageDeflate: false
});

ws.on('open', () => {
    console.log('✅ WebSocket connected successfully!');
    
    // Don't send any message, just wait for server response
    console.log('Waiting for server messages...');
    
    // Close after 3 seconds
    setTimeout(() => {
        console.log('Closing connection...');
        ws.close();
    }, 3000);
});

ws.on('message', (data) => {
    console.log('📨 Received message:', data.toString());
});

ws.on('close', (code, reason) => {
    console.log('❌ WebSocket closed');
    console.log('Code:', code);
    console.log('Reason:', reason.toString());
});

ws.on('error', (error) => {
    console.error('🚨 WebSocket error:', error);
});

// Timeout after 10 seconds
setTimeout(() => {
    if (ws.readyState !== WebSocket.CLOSED) {
        console.log('⏰ Connection timeout, closing...');
        ws.close();
    }
    process.exit(0);
}, 10000);
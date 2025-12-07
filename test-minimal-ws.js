const WebSocket = require('ws');

console.log('Testing minimal WebSocket server...');

const ws = new WebSocket('ws://localhost:9001/chat', [], {
    perMessageDeflate: false
});

ws.on('open', () => {
    console.log('✅ Connected to minimal server!');
    
    // Send a test message
    ws.send(JSON.stringify({
        type: 'test',
        content: 'Hello minimal server'
    }));
    
    setTimeout(() => {
        ws.close();
    }, 2000);
});

ws.on('message', (data) => {
    console.log('📨 Received:', data.toString());
});

ws.on('close', (code, reason) => {
    console.log('❌ Connection closed:', code, reason.toString());
    process.exit(0);
});

ws.on('error', (error) => {
    console.error('🚨 Error:', error);
    process.exit(1);
});
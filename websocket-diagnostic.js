const WebSocket = require('ws');

// Test token
const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2MzI0RjVFOC1FRDdELTRGNUUtQjREMy1BQ0M4QTgwRDgzODEiLCJ1c2VybmFtZSI6InRlc3QiLCJpYXQiOjE3NjQ5MjE5NzQsImV4cCI6MTc2NTAwODM3NH0.RYmdDyhktoj8UDd4rzyHMtenAWVBpi6J9LAk-0UIRaI';

console.log('🔍 WebSocket Diagnostic Tool');
console.log('============================');

async function runDiagnostic() {
    console.log('\n1. Testing basic HTTP connection to server...');
    
    try {
        const response = await fetch('http://localhost:9000');
        console.log('✅ HTTP server is responding');
    } catch (error) {
        console.log('❌ HTTP server not responding:', error.message);
        return;
    }

    console.log('\n2. Testing WebSocket connection...');
    
    const wsUrl = `ws://localhost:9000/chat?token=${encodeURIComponent(token)}`;
    console.log('WebSocket URL:', wsUrl);
    
    const ws = new WebSocket(wsUrl, [], {
        perMessageDeflate: false,
        maxPayload: 16 * 1024 * 1024
    });

    let connectionEstablished = false;
    let messageReceived = false;
    let errorOccurred = false;

    ws.on('open', () => {
        console.log('✅ WebSocket connection opened');
        connectionEstablished = true;
        
        // Wait a bit before sending a message
        setTimeout(() => {
            if (!errorOccurred) {
                console.log('📤 Sending test message...');
                try {
                    ws.send(JSON.stringify({
                        type: 'user',
                        content: 'Hello, this is a diagnostic test',
                        timestamp: new Date()
                    }));
                } catch (error) {
                    console.log('❌ Error sending message:', error.message);
                }
            }
        }, 1000);
    });

    ws.on('message', (data) => {
        console.log('📨 Message received:', data.toString());
        messageReceived = true;
        
        // Close connection after receiving message
        setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
                console.log('🔚 Closing connection gracefully...');
                ws.close(1000, 'Diagnostic complete');
            }
        }, 1000);
    });

    ws.on('close', (code, reason) => {
        console.log('🔚 WebSocket closed');
        console.log('   Code:', code);
        console.log('   Reason:', reason.toString());
        console.log('   Was clean:', code === 1000);
        
        console.log('\n📊 Diagnostic Summary:');
        console.log('   Connection established:', connectionEstablished);
        console.log('   Message received:', messageReceived);
        console.log('   Error occurred:', errorOccurred);
        
        if (connectionEstablished && messageReceived && !errorOccurred) {
            console.log('✅ WebSocket connection is working correctly!');
        } else {
            console.log('❌ WebSocket connection has issues');
        }
        
        process.exit(0);
    });

    ws.on('error', (error) => {
        console.log('🚨 WebSocket error:', error.message);
        console.log('   Error code:', error.code);
        console.log('   Error type:', error.constructor.name);
        errorOccurred = true;
    });

    ws.on('ping', (data) => {
        console.log('🏓 Ping received:', data.toString());
    });

    ws.on('pong', (data) => {
        console.log('🏓 Pong received:', data.toString());
    });

    // Timeout after 10 seconds
    setTimeout(() => {
        if (ws.readyState !== WebSocket.CLOSED) {
            console.log('⏰ Diagnostic timeout, closing connection...');
            ws.close();
        }
    }, 10000);
}

runDiagnostic().catch(console.error);
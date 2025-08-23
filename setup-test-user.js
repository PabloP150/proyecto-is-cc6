// Script to set up test user in localStorage for WebSocket testing
const jwt = require('jsonwebtoken');

// Create a test JWT token
const testToken = jwt.sign(
    { userId: 'test-user-123' }, 
    process.env.JWT_SECRET || 'your-jwt-secret-key-change-in-production',
    { expiresIn: '1h' }
);

const testUser = {
    id: 'test-user-123',
    username: 'testuser',
    token: testToken
};

console.log('=== WebSocket Test Setup ===');
console.log('Copy and paste these commands in your browser console:');
console.log('');
console.log(`localStorage.setItem('token', '${testToken}');`);
console.log(`localStorage.setItem('user', '${JSON.stringify(testUser)}');`);
console.log('location.reload();');
console.log('');
console.log('Then navigate to: http://localhost:3000/websocket-test');
console.log('Or go to the Chat page to test the integration');
console.log('');
console.log('Token expires in 1 hour');
console.log('User ID: test-user-123');
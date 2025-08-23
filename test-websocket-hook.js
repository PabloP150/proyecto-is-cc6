// Simple test to check if the WebSocket hook is working
const jwt = require('jsonwebtoken');

// Create a test JWT token
const testToken = jwt.sign(
    { userId: 'test-user-123' }, 
    process.env.JWT_SECRET || 'your-jwt-secret-key-change-in-production',
    { expiresIn: '1h' }
);

console.log('Test token for React app:', testToken);
console.log('You can use this token in localStorage to test the WebSocket connection');
console.log('Run this in browser console:');
console.log(`localStorage.setItem('token', '${testToken}');`);
console.log(`localStorage.setItem('user', '{"id": "test-user-123", "username": "testuser"}');`);
console.log('Then refresh the page and go to the chat tab');
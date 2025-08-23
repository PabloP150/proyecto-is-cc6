import React, { useState } from 'react';
import useWebSocket from '../hooks/useWebSocket';

const WebSocketTest = () => {
  const [testToken] = useState('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0LXVzZXItMTIzIiwiaWF0IjoxNzU1OTc3NTM0LCJleHAiOjE3NTU5ODExMzR9.o5A5kkT_fPlHSECnuqE8Z_QdLiXwi7u__Zq_-H1d97g');
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');

  const {
    connectionStatus,
    lastMessage,
    error,
    sendMessage,
    connect,
    disconnect,
    isConnected
  } = useWebSocket('ws://localhost:9000/chat', testToken, {
    onMessage: (message) => {
      console.log('Received message:', message);
      setMessages(prev => [...prev, { ...message, direction: 'received' }]);
    },
    onOpen: () => {
      console.log('WebSocket opened');
    },
    onClose: () => {
      console.log('WebSocket closed');
    },
    onError: (error) => {
      console.error('WebSocket error:', error);
    }
  });

  const handleSendMessage = () => {
    if (inputMessage.trim() && isConnected) {
      const message = {
        type: 'user',
        content: inputMessage.trim(),
        timestamp: new Date()
      };
      
      const success = sendMessage(message);
      if (success) {
        setMessages(prev => [...prev, { ...message, direction: 'sent' }]);
        setInputMessage('');
      }
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h2>WebSocket Test Component</h2>
      
      <div style={{ marginBottom: '20px' }}>
        <strong>Status:</strong> {connectionStatus}
        {error && <div style={{ color: 'red' }}>Error: {error}</div>}
      </div>

      <div style={{ marginBottom: '20px' }}>
        <button onClick={connect} disabled={isConnected}>Connect</button>
        <button onClick={disconnect} disabled={!isConnected} style={{ marginLeft: '10px' }}>Disconnect</button>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <input
          type="text"
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          placeholder="Type a message..."
          style={{ width: '300px', marginRight: '10px' }}
          onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
        />
        <button onClick={handleSendMessage} disabled={!isConnected}>Send</button>
      </div>

      <div style={{ border: '1px solid #ccc', height: '300px', overflow: 'auto', padding: '10px' }}>
        <h4>Messages:</h4>
        {messages.map((msg, index) => (
          <div key={index} style={{ 
            marginBottom: '10px', 
            padding: '5px',
            backgroundColor: msg.direction === 'sent' ? '#e3f2fd' : '#f3e5f5',
            borderRadius: '5px'
          }}>
            <strong>{msg.type}:</strong> {msg.content}
            <br />
            <small>{new Date(msg.timestamp).toLocaleTimeString()}</small>
          </div>
        ))}
      </div>
    </div>
  );
};

export default WebSocketTest;
import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Custom hook for WebSocket connection management with automatic reconnection
 * @param {string} url - WebSocket server URL
 * @param {string} token - JWT authentication token
 * @param {Object} options - Configuration options
 * @returns {Object} WebSocket connection state and methods
 */
const useWebSocket = (url, token, options = {}) => {
  const {
    maxReconnectAttempts = 5,
    initialReconnectDelay = 1000,
    maxReconnectDelay = 30000,
    reconnectDecay = 1.5,
    onMessage = () => { },
    onError = () => { },
    onOpen = () => { },
    onClose = () => { },
    autoConnect = true
  } = options;

  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [lastMessage, setLastMessage] = useState(null);
  const [error, setError] = useState(null);

  const ws = useRef(null);
  const reconnectTimeoutId = useRef(null);
  const reconnectAttempts = useRef(0);
  const reconnectDelay = useRef(initialReconnectDelay);
  const shouldReconnect = useRef(true);
  const isConnecting = useRef(false);
  const currentUrl = useRef(null);
  const currentToken = useRef(null);

  // Clear any existing reconnection timeout
  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutId.current) {
      clearTimeout(reconnectTimeoutId.current);
      reconnectTimeoutId.current = null;
    }
  }, []);

  // Store callbacks in refs to avoid recreating connect function
  const callbacksRef = useRef({ onMessage, onError, onOpen, onClose });
  
  // Update callbacks ref when they change
  useEffect(() => {
    callbacksRef.current = { onMessage, onError, onOpen, onClose };
  }, [onMessage, onError, onOpen, onClose]);

  // Connect to WebSocket server - stable function
  const connect = useCallback(() => {
    const connectUrl = currentUrl.current;
    const connectToken = currentToken.current;

    if (!connectUrl || !connectToken) {
      setError('URL and token are required for WebSocket connection');
      return;
    }

    if (ws.current?.readyState === WebSocket.OPEN || isConnecting.current) {
      console.log('WebSocket already connected or connecting, skipping connection attempt');
      return;
    }

    isConnecting.current = true;

    try {
      setConnectionStatus('Connecting');
      setError(null);

      // Create WebSocket connection with authentication
      const wsUrl = `${connectUrl}?token=${encodeURIComponent(connectToken)}`;
      console.log('Attempting WebSocket connection to:', wsUrl);

      ws.current = new WebSocket(wsUrl);

      ws.current.onopen = (event) => {
        console.log('WebSocket connected successfully');
        isConnecting.current = false;
        setConnectionStatus('Connected');
        reconnectAttempts.current = 0;
        reconnectDelay.current = initialReconnectDelay;
        clearReconnectTimeout();
        callbacksRef.current.onOpen(event);
      };

      ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setLastMessage(data);
          callbacksRef.current.onMessage(data);
        } catch (parseError) {
          console.error('Failed to parse WebSocket message:', parseError);
          setError('Failed to parse message from server');
        }
      };

      ws.current.onclose = (event) => {
        console.log('WebSocket connection closed, code:', event.code, 'reason:', event.reason);
        isConnecting.current = false;
        setConnectionStatus('Disconnected');
        callbacksRef.current.onClose(event);

        // Attempt reconnection if enabled and not a clean close
        if (shouldReconnect.current && event.code !== 1000 && reconnectAttempts.current < maxReconnectAttempts) {
          const delay = Math.min(
            reconnectDelay.current * Math.pow(reconnectDecay, reconnectAttempts.current),
            maxReconnectDelay
          ) + Math.random() * 1000; // Add jitter

          reconnectAttempts.current += 1;

          console.log(`Attempting reconnection ${reconnectAttempts.current}/${maxReconnectAttempts} in ${delay}ms`);
          setConnectionStatus(`Reconnecting (${reconnectAttempts.current}/${maxReconnectAttempts})`);

          reconnectTimeoutId.current = setTimeout(() => {
            connect();
          }, delay);
        } else if (reconnectAttempts.current >= maxReconnectAttempts) {
          setError('Maximum reconnection attempts reached');
          setConnectionStatus('Failed');
        }
      };

      ws.current.onerror = (event) => {
        console.error('WebSocket error:', event);
        console.error('WebSocket readyState:', ws.current?.readyState);
        console.error('WebSocket URL was:', wsUrl);
        isConnecting.current = false;
        setError('WebSocket connection error');
        setConnectionStatus('Error');
        callbacksRef.current.onError(event);
      };

    } catch (connectionError) {
      console.error('Failed to create WebSocket connection:', connectionError);
      isConnecting.current = false;
      setError('Failed to create WebSocket connection');
      setConnectionStatus('Error');
    }
  }, [maxReconnectAttempts, initialReconnectDelay, maxReconnectDelay, reconnectDecay, clearReconnectTimeout]);

  // Disconnect from WebSocket server
  const disconnect = useCallback(() => {
    console.log('Disconnecting WebSocket...');
    shouldReconnect.current = false;
    isConnecting.current = false;
    clearReconnectTimeout();

    if (ws.current) {
      ws.current.close(1000, 'Client disconnect');
      ws.current = null;
    }

    setConnectionStatus('Disconnected');
    reconnectAttempts.current = 0;
    reconnectDelay.current = initialReconnectDelay;
  }, [clearReconnectTimeout, initialReconnectDelay]);

  // Send message through WebSocket
  const sendMessage = useCallback((message) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      try {
        const messageString = typeof message === 'string' ? message : JSON.stringify(message);
        ws.current.send(messageString);
        return true;
      } catch (sendError) {
        console.error('Failed to send WebSocket message:', sendError);
        setError('Failed to send message');
        return false;
      }
    } else {
      setError('WebSocket is not connected');
      return false;
    }
  }, []);

  // Manually trigger reconnection
  const reconnect = useCallback(() => {
    console.log('Manual reconnection triggered');
    disconnect();
    shouldReconnect.current = true;
    reconnectAttempts.current = 0;
    setTimeout(() => {
      connect();
    }, 100);
  }, [connect, disconnect]);

  // Update current URL and token refs when they change
  useEffect(() => {
    currentUrl.current = url;
    currentToken.current = token;
  }, [url, token]);

  // Auto-connect effect - runs when autoConnect, url, or token changes
  useEffect(() => {
    if (autoConnect && url && token) {
      console.log('Auto-connecting WebSocket...');
      shouldReconnect.current = true;

      // If there's an existing connection, close it first
      if (ws.current) {
        ws.current.close(1000, 'Reconnecting with new parameters');
      }

      // Connect after a short delay to allow cleanup
      setTimeout(() => {
        connect();
      }, 100);
    }
  }, [autoConnect, url, token]); // Removed connect from dependencies

  // Cleanup effect - runs only on unmount
  useEffect(() => {
    return () => {
      console.log('Cleaning up WebSocket on component unmount');
      shouldReconnect.current = false;
      isConnecting.current = false;
      if (reconnectTimeoutId.current) {
        clearTimeout(reconnectTimeoutId.current);
        reconnectTimeoutId.current = null;
      }
      if (ws.current) {
        ws.current.close(1000, 'Component unmount');
      }
    };
  }, []); // Empty dependency array - runs only on mount/unmount

  // Return hook interface
  return {
    connectionStatus,
    lastMessage,
    error,
    sendMessage,
    connect,
    disconnect,
    reconnect,
    isConnected: connectionStatus === 'Connected',
    isConnecting: connectionStatus === 'Connecting' || connectionStatus.includes('Reconnecting'),
    isDisconnected: connectionStatus === 'Disconnected',
    isError: connectionStatus === 'Error' || connectionStatus === 'Failed'
  };
};

export default useWebSocket;
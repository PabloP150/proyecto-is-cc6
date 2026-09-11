import { useCallback, useEffect, useRef, useState } from 'react';

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
    autoConnect = true,
    heartbeatInterval = 30000 // 30 seconds
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
  const activeToken = useRef(null); // token used for the current open connection
  const heartbeatIntervalId = useRef(null);
  const connectTimeoutId = useRef(null); // deferred auto-connect, cancelled on unmount

  // Clear any existing reconnection timeout
  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutId.current) {
      clearTimeout(reconnectTimeoutId.current);
      reconnectTimeoutId.current = null;
    }
  }, []);

  // Clear heartbeat interval
  const clearHeartbeat = useCallback(() => {
    if (heartbeatIntervalId.current) {
      clearInterval(heartbeatIntervalId.current);
      heartbeatIntervalId.current = null;
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
      return;
    }

    isConnecting.current = true;

    try {
      setConnectionStatus('Connecting');
      setError(null);

      const wsUrl = `${connectUrl}?token=${encodeURIComponent(connectToken)}`;

      const socket = new WebSocket(wsUrl);
      ws.current = socket;
      // Events from a socket that was already replaced (e.g. token change) must not touch state.
      const isStale = () => ws.current !== null && ws.current !== socket;

      socket.onopen = (event) => {
        if (isStale()) return;
        activeToken.current = connectToken;
        isConnecting.current = false;
        setConnectionStatus('Connected');
        reconnectAttempts.current = 0;
        reconnectDelay.current = initialReconnectDelay;
        clearReconnectTimeout();
        callbacksRef.current.onOpen(event);

        // Start heartbeat
        if (heartbeatInterval > 0) {
          clearHeartbeat();
          heartbeatIntervalId.current = setInterval(() => {
            if (ws.current?.readyState === WebSocket.OPEN) {
              ws.current.send(JSON.stringify({ type: 'ping' }));
            }
          }, heartbeatInterval);
        }
      };

      socket.onmessage = (event) => {
        if (isStale()) return;
        try {
          const data = JSON.parse(event.data);
          // Ignore pong messages
          if (data.type === 'pong') {
            return;
          }
          setLastMessage(data);
          callbacksRef.current.onMessage(data);
        } catch {
          setError('Failed to parse message from server');
        }
      };

      socket.onclose = (event) => {
        if (isStale()) return;
        isConnecting.current = false;
        setConnectionStatus('Disconnected');
        callbacksRef.current.onClose(event);
        clearHeartbeat(); // Stop heartbeat on close

        // Attempt reconnection if enabled and not a clean close
        if (shouldReconnect.current && event.code !== 1000 && reconnectAttempts.current < maxReconnectAttempts) {
          const delay = Math.min(
            reconnectDelay.current * Math.pow(reconnectDecay, reconnectAttempts.current),
            maxReconnectDelay
          ) + Math.random() * 1000; // Add jitter

          reconnectAttempts.current += 1;
          setConnectionStatus(`Reconnecting (${reconnectAttempts.current}/${maxReconnectAttempts})`);

          reconnectTimeoutId.current = setTimeout(() => {
            connect();
          }, delay);
        } else if (reconnectAttempts.current >= maxReconnectAttempts) {
          setError('Maximum reconnection attempts reached');
          setConnectionStatus('Failed');
        }
      };

      socket.onerror = (event) => {
        if (isStale()) return;
        isConnecting.current = false;
        setError('WebSocket connection error');
        setConnectionStatus('Error');
        callbacksRef.current.onError(event);
        clearHeartbeat(); // Stop heartbeat on error
      };

    } catch {
      isConnecting.current = false;
      setError('Failed to create WebSocket connection');
      setConnectionStatus('Error');
    }
  }, [maxReconnectAttempts, initialReconnectDelay, maxReconnectDelay, reconnectDecay, clearReconnectTimeout, heartbeatInterval, clearHeartbeat]);

  // Disconnect from WebSocket server
  const disconnect = useCallback(() => {
    shouldReconnect.current = false;
    isConnecting.current = false;
    clearReconnectTimeout();
    clearHeartbeat(); // Stop heartbeat on disconnect
    if (connectTimeoutId.current) {
      clearTimeout(connectTimeoutId.current);
      connectTimeoutId.current = null;
    }

    if (ws.current) {
      ws.current.close(1000, 'Client disconnect');
      ws.current = null;
    }

    setConnectionStatus('Disconnected');
    reconnectAttempts.current = 0;
    reconnectDelay.current = initialReconnectDelay;
  }, [clearReconnectTimeout, clearHeartbeat, initialReconnectDelay]);

  // Send message through WebSocket
  const sendMessage = useCallback((message) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      try {
        const messageString = typeof message === 'string' ? message : JSON.stringify(message);
        ws.current.send(messageString);
        return true;
      } catch {
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
      shouldReconnect.current = true;

      // Only reconnect if we don't have an active connection, or URL/token changed
      const needsNewConnection = !ws.current ||
                                ws.current.readyState === WebSocket.CLOSED ||
                                ws.current.readyState === WebSocket.CLOSING ||
                                activeToken.current !== token;

      if (needsNewConnection) {
        // If there's an existing connection, close it first
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
          ws.current.close(1000, 'Reconnecting with new parameters');
        }

        // Connect after a short delay to allow cleanup (also avoids opening and immediately
        // closing a socket under React StrictMode's double effect invocation)
        connectTimeoutId.current = setTimeout(() => {
          connectTimeoutId.current = null;
          connect();
        }, 100);
      }
    }
    return () => {
      if (connectTimeoutId.current) {
        clearTimeout(connectTimeoutId.current);
        connectTimeoutId.current = null;
      }
    };
  }, [autoConnect, url, token, connect]);

  // Cleanup effect - runs only on unmount
  useEffect(() => {
    return () => {
      shouldReconnect.current = false;
      isConnecting.current = false;
      if (reconnectTimeoutId.current) {
        clearTimeout(reconnectTimeoutId.current);
        reconnectTimeoutId.current = null;
      }
      if (heartbeatIntervalId.current) {
        clearInterval(heartbeatIntervalId.current);
        heartbeatIntervalId.current = null;
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
import { renderHook, act } from '@testing-library/react';
import useWebSocket from '../useWebSocket';

// Mock WebSocket for testing
let mockWebSocketInstance = null;

const MockWebSocket = jest.fn().mockImplementation((url) => {
  const instance = {
    url,
    readyState: 0, // CONNECTING
    onopen: null,
    onclose: null,
    onmessage: null,
    onerror: null,
    lastSentMessage: null,
    
    send: jest.fn().mockImplementation(function(data) {
      this.lastSentMessage = data;
    }),
    
    close: jest.fn().mockImplementation(function(code = 1000, reason = '') {
      this.readyState = 3; // CLOSED
      if (this.onclose) {
        this.onclose({ code, reason, type: 'close' });
      }
    }),
    
    // Test helpers
    simulateOpen: function() {
      this.readyState = 1; // OPEN
      if (this.onopen) {
        this.onopen({ type: 'open' });
      }
    },
    
    simulateMessage: function(data) {
      if (this.onmessage) {
        this.onmessage({ data: JSON.stringify(data), type: 'message' });
      }
    },
    
    simulateError: function() {
      if (this.onerror) {
        this.onerror({ type: 'error' });
      }
    }
  };
  
  mockWebSocketInstance = instance;
  return instance;
});

// WebSocket constants
MockWebSocket.CONNECTING = 0;
MockWebSocket.OPEN = 1;
MockWebSocket.CLOSING = 2;
MockWebSocket.CLOSED = 3;

global.WebSocket = MockWebSocket;

describe('useWebSocket', () => {
  const mockUrl = 'ws://localhost:8080/chat';
  const mockToken = 'test-jwt-token';
  
  beforeEach(() => {
    MockWebSocket.mockClear();
    mockWebSocketInstance = null;
    jest.clearAllTimers();
    jest.useFakeTimers();
  });
  
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('Basic Functionality', () => {
    it('should initialize with disconnected status when autoConnect is false', () => {
      const { result } = renderHook(() => useWebSocket(mockUrl, mockToken, { autoConnect: false }));
      
      expect(result.current.connectionStatus).toBe('Disconnected');
      expect(result.current.isConnected).toBe(false);
      expect(result.current.isDisconnected).toBe(true);
      expect(MockWebSocket).not.toHaveBeenCalled();
    });

    it('should create WebSocket instance when autoConnect is true', () => {
      renderHook(() => useWebSocket(mockUrl, mockToken));
      
      expect(MockWebSocket).toHaveBeenCalledWith(`${mockUrl}?token=${encodeURIComponent(mockToken)}`);
      expect(mockWebSocketInstance).toBeTruthy();
    });

    it('should handle connection opening', () => {
      const { result } = renderHook(() => useWebSocket(mockUrl, mockToken));
      
      act(() => {
        mockWebSocketInstance.simulateOpen();
      });
      
      expect(result.current.connectionStatus).toBe('Connected');
      expect(result.current.isConnected).toBe(true);
    });

    it('should send messages when connected', () => {
      const { result } = renderHook(() => useWebSocket(mockUrl, mockToken));
      
      act(() => {
        mockWebSocketInstance.simulateOpen();
      });
      
      const testMessage = { type: 'user', content: 'Hello' };
      let sendResult;
      
      act(() => {
        sendResult = result.current.sendMessage(testMessage);
      });
      
      expect(sendResult).toBe(true);
      expect(mockWebSocketInstance.send).toHaveBeenCalledWith(JSON.stringify(testMessage));
    });

    it('should not send messages when disconnected', () => {
      const { result } = renderHook(() => useWebSocket(mockUrl, mockToken, { autoConnect: false }));
      
      let sendResult;
      act(() => {
        sendResult = result.current.sendMessage({ content: 'Hello' });
      });
      
      expect(sendResult).toBe(false);
      expect(result.current.error).toBe('WebSocket is not connected');
    });

    it('should handle incoming messages', () => {
      const onMessage = jest.fn();
      const { result } = renderHook(() => useWebSocket(mockUrl, mockToken, { onMessage }));
      
      act(() => {
        mockWebSocketInstance.simulateOpen();
      });
      
      const testMessage = { type: 'assistant', content: 'Hello back!' };
      
      act(() => {
        mockWebSocketInstance.simulateMessage(testMessage);
      });
      
      expect(result.current.lastMessage).toEqual(testMessage);
      expect(onMessage).toHaveBeenCalledWith(testMessage);
    });

    it('should handle WebSocket errors', () => {
      const onError = jest.fn();
      const { result } = renderHook(() => useWebSocket(mockUrl, mockToken, { onError }));
      
      act(() => {
        mockWebSocketInstance.simulateError();
      });
      
      expect(result.current.connectionStatus).toBe('Error');
      expect(result.current.isError).toBe(true);
      expect(result.current.error).toBe('WebSocket connection error');
      expect(onError).toHaveBeenCalled();
    });

    it('should handle missing URL or token', () => {
      const { result } = renderHook(() => useWebSocket('', mockToken));
      
      act(() => {
        result.current.connect();
      });
      
      expect(result.current.error).toBe('URL and token are required for WebSocket connection');
    });

    it('should disconnect properly', () => {
      const { result } = renderHook(() => useWebSocket(mockUrl, mockToken));
      
      act(() => {
        mockWebSocketInstance.simulateOpen();
      });
      
      act(() => {
        result.current.disconnect();
      });
      
      expect(result.current.connectionStatus).toBe('Disconnected');
      expect(result.current.isDisconnected).toBe(true);
      expect(mockWebSocketInstance.close).toHaveBeenCalledWith(1000, 'Client disconnect');
    });

    it('should cleanup on unmount', () => {
      const { unmount } = renderHook(() => useWebSocket(mockUrl, mockToken));
      
      act(() => {
        mockWebSocketInstance.simulateOpen();
      });
      
      unmount();
      
      expect(mockWebSocketInstance.close).toHaveBeenCalledWith(1000, 'Component unmount');
    });
  });

  describe('Reconnection Logic', () => {
    it('should attempt reconnection on unexpected close', () => {
      const { result } = renderHook(() => useWebSocket(mockUrl, mockToken, {
        maxReconnectAttempts: 2,
        initialReconnectDelay: 100
      }));
      
      act(() => {
        mockWebSocketInstance.simulateOpen();
      });
      
      act(() => {
        mockWebSocketInstance.close(1006, 'Connection lost');
      });
      
      expect(result.current.connectionStatus).toBe('Reconnecting (1/2)');
      
      act(() => {
        jest.advanceTimersByTime(150);
      });
      
      expect(MockWebSocket).toHaveBeenCalledTimes(2);
    });

    it('should not reconnect on clean close', () => {
      const { result } = renderHook(() => useWebSocket(mockUrl, mockToken));
      
      act(() => {
        mockWebSocketInstance.simulateOpen();
      });
      
      act(() => {
        mockWebSocketInstance.close(1000, 'Normal closure');
      });
      
      expect(result.current.connectionStatus).toBe('Disconnected');
      
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      
      expect(MockWebSocket).toHaveBeenCalledTimes(1);
    });
  });

  describe('Callback Handlers', () => {
    it('should call onOpen callback', () => {
      const onOpen = jest.fn();
      renderHook(() => useWebSocket(mockUrl, mockToken, { onOpen }));
      
      act(() => {
        mockWebSocketInstance.simulateOpen();
      });
      
      expect(onOpen).toHaveBeenCalled();
    });

    it('should call onClose callback', () => {
      const onClose = jest.fn();
      const { result } = renderHook(() => useWebSocket(mockUrl, mockToken, { onClose }));
      
      act(() => {
        mockWebSocketInstance.simulateOpen();
      });
      
      act(() => {
        result.current.disconnect();
      });
      
      expect(onClose).toHaveBeenCalled();
    });
  });
});
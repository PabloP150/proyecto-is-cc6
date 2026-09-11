import { renderHook, act } from '@testing-library/react';
import useWebSocket from '../useWebSocket';

// A plain class (not jest.fn().mockImplementation): react-scripts runs Jest with `resetMocks: true`,
// which wiped the module-level mock implementation before every test, so `new WebSocket()` returned
// a bare object without send/close/simulate* and every connected test failed.
const instances = [];

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.onopen = null;
    this.onclose = null;
    this.onmessage = null;
    this.onerror = null;
    this.send = jest.fn();
    this.close = jest.fn((code = 1000, reason = '') => {
      this.readyState = MockWebSocket.CLOSED;
      if (this.onclose) this.onclose({ code, reason, type: 'close' });
    });
    instances.push(this);
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) this.onopen({ type: 'open' });
  }

  simulateMessage(data) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(data), type: 'message' });
  }

  simulateError() {
    if (this.onerror) this.onerror({ type: 'error' });
  }
}

const lastSocket = () => instances[instances.length - 1];

// The hook defers the initial connection by 100 ms (lets a previous socket close first and
// avoids a throwaway socket under StrictMode), so tests advance past that delay.
const CONNECT_DELAY_MS = 100;
const flushConnect = () => act(() => { jest.advanceTimersByTime(CONNECT_DELAY_MS); });

describe('useWebSocket', () => {
  const mockUrl = 'ws://localhost:8080/chat';
  const mockToken = 'test-jwt-token';
  const originalWebSocket = global.WebSocket;

  beforeAll(() => {
    global.WebSocket = MockWebSocket;
  });

  afterAll(() => {
    global.WebSocket = originalWebSocket;
  });

  beforeEach(() => {
    instances.length = 0;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('Basic Functionality', () => {
    it('should initialize with disconnected status when autoConnect is false', () => {
      const { result } = renderHook(() => useWebSocket(mockUrl, mockToken, { autoConnect: false }));
      flushConnect();

      expect(result.current.connectionStatus).toBe('Disconnected');
      expect(result.current.isConnected).toBe(false);
      expect(result.current.isDisconnected).toBe(true);
      expect(instances).toHaveLength(0);
    });

    it('should create WebSocket instance when autoConnect is true', () => {
      renderHook(() => useWebSocket(mockUrl, mockToken));
      expect(instances).toHaveLength(0); // deferred

      flushConnect();

      expect(instances).toHaveLength(1);
      expect(lastSocket().url).toBe(`${mockUrl}?token=${encodeURIComponent(mockToken)}`);
    });

    it('should not open a socket when unmounted before the deferred connect', () => {
      const { unmount } = renderHook(() => useWebSocket(mockUrl, mockToken));
      unmount();
      flushConnect();

      expect(instances).toHaveLength(0);
    });

    it('should handle connection opening', () => {
      const { result } = renderHook(() => useWebSocket(mockUrl, mockToken));
      flushConnect();

      act(() => {
        lastSocket().simulateOpen();
      });

      expect(result.current.connectionStatus).toBe('Connected');
      expect(result.current.isConnected).toBe(true);
    });

    it('should send messages when connected', () => {
      const { result } = renderHook(() => useWebSocket(mockUrl, mockToken));
      flushConnect();

      act(() => {
        lastSocket().simulateOpen();
      });

      const testMessage = { type: 'user', content: 'Hello' };
      let sendResult;

      act(() => {
        sendResult = result.current.sendMessage(testMessage);
      });

      expect(sendResult).toBe(true);
      expect(lastSocket().send).toHaveBeenCalledWith(JSON.stringify(testMessage));
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
      flushConnect();

      act(() => {
        lastSocket().simulateOpen();
      });

      const testMessage = { type: 'assistant', content: 'Hello back!' };

      act(() => {
        lastSocket().simulateMessage(testMessage);
      });

      expect(result.current.lastMessage).toEqual(testMessage);
      expect(onMessage).toHaveBeenCalledWith(testMessage);
    });

    it('should ignore pong messages', () => {
      const onMessage = jest.fn();
      renderHook(() => useWebSocket(mockUrl, mockToken, { onMessage }));
      flushConnect();

      act(() => {
        lastSocket().simulateOpen();
        lastSocket().simulateMessage({ type: 'pong' });
      });

      expect(onMessage).not.toHaveBeenCalled();
    });

    it('should handle WebSocket errors', () => {
      const onError = jest.fn();
      const { result } = renderHook(() => useWebSocket(mockUrl, mockToken, { onError }));
      flushConnect();

      act(() => {
        lastSocket().simulateError();
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
      flushConnect();
      const socket = lastSocket();

      act(() => {
        socket.simulateOpen();
      });

      act(() => {
        result.current.disconnect();
      });

      expect(result.current.connectionStatus).toBe('Disconnected');
      expect(result.current.isDisconnected).toBe(true);
      expect(socket.close).toHaveBeenCalledWith(1000, 'Client disconnect');
    });

    it('should cleanup on unmount', () => {
      const { unmount } = renderHook(() => useWebSocket(mockUrl, mockToken));
      flushConnect();
      const socket = lastSocket();

      act(() => {
        socket.simulateOpen();
      });

      unmount();

      expect(socket.close).toHaveBeenCalledWith(1000, 'Component unmount');
    });
  });

  describe('Reconnection Logic', () => {
    it('should attempt reconnection on unexpected close', () => {
      const { result } = renderHook(() => useWebSocket(mockUrl, mockToken, {
        maxReconnectAttempts: 2,
        initialReconnectDelay: 100
      }));
      flushConnect();

      act(() => {
        lastSocket().simulateOpen();
      });

      act(() => {
        lastSocket().close(1006, 'Connection lost');
      });

      expect(result.current.connectionStatus).toBe('Reconnecting (1/2)');

      // delay = 100 ms backoff + up to 1000 ms jitter
      act(() => {
        jest.advanceTimersByTime(1100);
      });

      expect(instances).toHaveLength(2);
    });

    it('should not reconnect on clean close', () => {
      const { result } = renderHook(() => useWebSocket(mockUrl, mockToken));
      flushConnect();

      act(() => {
        lastSocket().simulateOpen();
      });

      act(() => {
        lastSocket().close(1000, 'Normal closure');
      });

      expect(result.current.connectionStatus).toBe('Disconnected');

      act(() => {
        jest.advanceTimersByTime(5000);
      });

      expect(instances).toHaveLength(1);
    });

    it('should reconnect with the new token and ignore events from the replaced socket', () => {
      const onClose = jest.fn();
      const { result, rerender } = renderHook(
        ({ token }) => useWebSocket(mockUrl, token, { onClose }),
        { initialProps: { token: 'token-a' } }
      );
      flushConnect();
      const first = lastSocket();
      act(() => {
        first.simulateOpen();
      });

      // Real sockets fire onclose asynchronously; detach the synchronous mock behaviour.
      first.close.mockImplementation(() => { first.readyState = MockWebSocket.CLOSING; });
      rerender({ token: 'token-b' });
      flushConnect();

      const second = lastSocket();
      expect(second).not.toBe(first);
      expect(second.url).toBe(`${mockUrl}?token=token-b`);

      act(() => {
        second.simulateOpen();
      });
      act(() => {
        first.readyState = MockWebSocket.CLOSED;
        first.onclose({ code: 1006, reason: 'late close', type: 'close' });
      });

      expect(result.current.connectionStatus).toBe('Connected');
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('Callback Handlers', () => {
    it('should call onOpen callback', () => {
      const onOpen = jest.fn();
      renderHook(() => useWebSocket(mockUrl, mockToken, { onOpen }));
      flushConnect();

      act(() => {
        lastSocket().simulateOpen();
      });

      expect(onOpen).toHaveBeenCalled();
    });

    it('should call onClose callback', () => {
      const onClose = jest.fn();
      const { result } = renderHook(() => useWebSocket(mockUrl, mockToken, { onClose }));
      flushConnect();

      act(() => {
        lastSocket().simulateOpen();
      });

      act(() => {
        result.current.disconnect();
      });

      expect(onClose).toHaveBeenCalled();
    });
  });
});

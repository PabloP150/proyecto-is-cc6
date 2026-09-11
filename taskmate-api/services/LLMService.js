const WebSocket = require('ws');
const EventEmitter = require('events');

const DEFAULT_URL = 'ws://localhost:8001/ws';
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const RECONNECT_DELAY_MS = 5000;

const unavailableError = () => {
  const error = new Error('AI service unavailable');
  error.code = 'LLM_UNAVAILABLE';
  return error;
};

class LLMService extends EventEmitter {
  constructor({ url, connectTimeoutMs, autoConnect = true } = {}) {
    super();
    this.ws = null;
    this.connectionPromise = null;
    this.reconnectTimer = null;
    this.url = url || process.env.LLM_WEBSOCKET_URL || DEFAULT_URL;
    this.connectTimeoutMs = connectTimeoutMs || Number(process.env.LLM_CONNECT_TIMEOUT_MS) || DEFAULT_CONNECT_TIMEOUT_MS;
    // Evita que un 'error' sin listener tumbe el proceso
    this.on('error', (err) => {
      console.error('[LLMService] Unhandled error event:', err.message);
    });
    if (autoConnect) this.connect();
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const ws = new WebSocket(this.url, [], {
      perMessageDeflate: false // Disable compression to avoid RSV1 issues
    });
    this.ws = ws;

    ws.on('open', () => {
      console.log('[LLMService] WebSocket connection established.');
      this.emit('ready');
    });

    ws.on('message', (data) => {
      this.handleMessage(data);
    });

    ws.on('close', () => {
      this.emit('close');
      if (this.ws !== ws) return;
      this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
      if (this.reconnectTimer.unref) this.reconnectTimer.unref();
    });

    ws.on('error', (error) => {
      // No re-emitir 'error': sin listener externo tumbaría el proceso; 'close' se encarga de reconectar.
      console.error('[LLMService] WebSocket error:', error.message);
    });
  }

  // Resolves once the socket is open; rejects with code LLM_UNAVAILABLE after the timeout
  // (it used to wait forever when Python was down).
  ensureConnected(timeoutMs = this.connectTimeoutMs) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
      this.connect();
    }
    if (!this.connectionPromise) {
      this.connectionPromise = new Promise((resolve, reject) => {
        let timer = null;
        const onReady = () => {
          cleanup();
          resolve();
        };
        const cleanup = () => {
          clearTimeout(timer);
          this.removeListener('ready', onReady);
          this.connectionPromise = null;
        };
        timer = setTimeout(() => {
          cleanup();
          reject(unavailableError());
        }, timeoutMs);
        if (timer.unref) timer.unref();
        this.once('ready', onReady);
      });
    }
    return this.connectionPromise;
  }

  handleMessage(data) {
    let response;
    try {
      response = JSON.parse(data);
    } catch (e) {
      console.error('[LLMService] Received a message that is not valid JSON');
      return;
    }
    const sessionId = response && response.sessionId;
    if (sessionId) {
      this.emit(sessionId, response);
    } else {
      console.warn('[LLMService] Received message without a sessionId (event: %s)', response && response.event);
    }
  }

  // Never rejects (callers fire and forget); resolves false when the message could not be sent.
  async send(message) {
    try {
      await this.ensureConnected();
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (err) {
      console.error('[LLMService] Error sending message:', err.message);
      return false;
    }
  }

  close() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) ws.close();
  }
}

module.exports = new LLMService();
module.exports.LLMService = LLMService;

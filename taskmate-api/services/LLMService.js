const WebSocket = require('ws');
const EventEmitter = require('events');

const DEFAULT_URL = 'ws://localhost:8001/ws';
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_DELAY_MS = 5 * 60 * 1000;
const INFLIGHT_TTL_MS = 10 * 60 * 1000;

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
    this.inflight = new Map(); // requestId -> { sessionId, sentAt }
    this.reconnectDelay = RECONNECT_DELAY_MS;
    this.failureStreak = 0; // consecutive attempts that never opened
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

    // The Python service rejects connections without the shared secret.
    const headers = process.env.MCP_SHARED_SECRET ? { 'X-MCP-Secret': process.env.MCP_SHARED_SECRET } : {};
    const ws = new WebSocket(this.url, [], {
      perMessageDeflate: false, // Disable compression to avoid RSV1 issues
      headers
    });
    this.ws = ws;

    let opened = false;

    ws.on('open', () => {
      opened = true;
      this.failureStreak = 0;
      this.reconnectDelay = RECONNECT_DELAY_MS;
      console.log('[LLMService] WebSocket connection established.');
      this.emit('ready');
    });

    ws.on('message', (data) => {
      this.handleMessage(data);
    });

    ws.on('close', () => {
      this.emit('close');
      if (this.ws !== ws) return;
      this.failInflight();
      // A link that never opened (Python down, or 403 for a bad secret) backs off exponentially.
      let delay = RECONNECT_DELAY_MS;
      if (!opened) {
        this.failureStreak += 1;
        delay = this.reconnectDelay;
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
      }
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
      if (this.reconnectTimer.unref) this.reconnectTimer.unref();
    });

    ws.on('error', (error) => {
      // No re-emitir 'error': sin listener externo tumbaría el proceso; 'close' se encarga de reconectar.
      // Logged once per failure streak instead of on every retry.
      if (this.failureStreak > 0) return;
      if (/Unexpected server response: 403/.test(error.message)) {
        console.error('[LLMService] The AI service rejected the connection (403); check MCP_SHARED_SECRET.');
      } else {
        console.error('[LLMService] WebSocket error:', error.message);
      }
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
    const pending = response && response.requestId ? this.inflight.get(response.requestId) : null;
    if (pending && pending.sessionId === sessionId) this.inflight.delete(response.requestId);
    if (sessionId) {
      this.emit(sessionId, response);
    } else {
      console.warn('[LLMService] Received message without a sessionId (event: %s)', response && response.event);
    }
  }

  // Requests still waiting for Python get an error event as soon as the link drops, so no
  // caller waits for an answer that will never come.
  failInflight() {
    const pending = [...this.inflight.entries()];
    this.inflight.clear();
    for (const [requestId, { sessionId }] of pending) {
      this.emit(sessionId, {
        event: 'error',
        sessionId,
        requestId,
        connectionLost: true,
        error: { code: 'LLM_ERROR', message: 'AI service connection lost' }
      });
    }
  }

  trackInflight(message) {
    const now = Date.now();
    for (const [requestId, entry] of this.inflight) {
      if (now - entry.sentAt > INFLIGHT_TTL_MS) this.inflight.delete(requestId);
    }
    this.inflight.set(message.requestId, { sessionId: message.sessionId, sentAt: now });
  }

  // Never rejects (callers fire and forget); resolves false when the message could not be sent.
  // `expectReply: false` for notifications Python does not answer.
  async send(message, { expectReply = true } = {}) {
    try {
      await this.ensureConnected();
      this.ws.send(JSON.stringify(message));
      if (expectReply && message && message.requestId && message.sessionId) this.trackInflight(message);
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

const WebSocket = require('ws');
const EventEmitter = require('events');

class LLMService extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.connectionPromise = null;
    this.url = process.env.LLM_WEBSOCKET_URL || 'ws://localhost:8001/ws';
    this.connect();
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    console.log(`[LLMService] Connecting to ${this.url}...`);
    this.ws = new WebSocket(this.url, [], {
      perMessageDeflate: false // Disable compression to avoid RSV1 issues
    });

    this.ws.on('open', () => {
      console.log('[LLMService] WebSocket connection established.');
      this.emit('ready');
    });

    this.ws.on('message', (data) => {
      this.handleMessage(data);
    });

    this.ws.on('close', () => {
      console.log('[LLMService] WebSocket connection closed. Reconnecting...');
      this.emit('close');
      setTimeout(() => this.connect(), 5000);
    });

    this.ws.on('error', (error) => {
      console.error('[LLMService] WebSocket error:', error.message);
      this.emit('error', error);
    });
  }

  async ensureConnected() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.connectionPromise) {
      return this.connectionPromise;
    }
    this.connectionPromise = new Promise((resolve, reject) => {
      this.once('ready', () => {
        this.connectionPromise = null;
        resolve();
      });
      this.once('error', (err) => {
        this.connectionPromise = null;
        reject(err);
      });
    });
    return this.connectionPromise;
  }

  handleMessage(data) {
    try {
      const response = JSON.parse(data);
      const { sessionId } = response;

      if (sessionId) {
        this.emit(sessionId, response);
      } else {
        console.warn('[LLMService] Received message without a sessionId:', response);
      }
    } catch (e) {
      console.error('[LLMService] Error handling incoming message:', e);
    }
  }

  async send(message) {
    try {
      await this.ensureConnected();
      this.ws.send(JSON.stringify(message));
    } catch (err) {
      console.error('[LLMService] Error sending message:', err);
    }
  }
}

module.exports = new LLMService();

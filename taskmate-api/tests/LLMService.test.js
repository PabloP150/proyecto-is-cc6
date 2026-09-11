// The module exports a connected singleton; `ws` is replaced so no socket is ever opened.
jest.mock('ws', () => {
    const { EventEmitter } = require('events');
    class FakeWebSocket extends EventEmitter {
        constructor(url) {
            super();
            this.url = url;
            this.readyState = FakeWebSocket.CONNECTING;
            this.sent = [];
            FakeWebSocket.instances.push(this);
        }

        send(data) {
            this.sent.push(data);
        }

        close() {
            this.readyState = FakeWebSocket.CLOSED;
            this.emit('close');
        }

        open() {
            this.readyState = FakeWebSocket.OPEN;
            this.emit('open');
        }
    }
    FakeWebSocket.CONNECTING = 0;
    FakeWebSocket.OPEN = 1;
    FakeWebSocket.CLOSING = 2;
    FakeWebSocket.CLOSED = 3;
    FakeWebSocket.instances = [];
    return FakeWebSocket;
});

const WebSocket = require('ws');
const llmSingleton = require('../services/LLMService');

const { LLMService } = llmSingleton;

describe('LLMService', () => {
    let service;

    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        WebSocket.instances.length = 0;
        service = new LLMService({ url: 'ws://python.test/ws', connectTimeoutMs: 50 });
    });

    afterEach(() => {
        service.close();
    });

    test('the module exports a ready-to-use instance and the class', () => {
        expect(llmSingleton).toBeInstanceOf(LLMService);
        expect(typeof llmSingleton.send).toBe('function');
        expect(typeof llmSingleton.on).toBe('function');
    });

    test('connects to the configured URL on construction', () => {
        expect(WebSocket.instances).toHaveLength(1);
        expect(WebSocket.instances[0].url).toBe('ws://python.test/ws');
    });

    test('send waits for the connection and serializes the message', async () => {
        const pending = service.send({ sessionId: 's1', method: 'x' });
        WebSocket.instances[0].open();
        await expect(pending).resolves.toBe(true);
        expect(JSON.parse(WebSocket.instances[0].sent[0])).toEqual({ sessionId: 's1', method: 'x' });
    });

    test('ensureConnected rejects with LLM_UNAVAILABLE after the timeout (no hang)', async () => {
        await expect(service.ensureConnected(20)).rejects.toMatchObject({ code: 'LLM_UNAVAILABLE' });
        expect(service.listenerCount('ready')).toBe(0);
    });

    test('send resolves false (never rejects) when Python is down', async () => {
        await expect(service.send({ sessionId: 's1' })).resolves.toBe(false);
    });

    test('concurrent sends share one pending connection', async () => {
        const a = service.send({ n: 1 });
        const b = service.send({ n: 2 });
        expect(service.listenerCount('ready')).toBe(1);
        WebSocket.instances[0].open();
        await expect(Promise.all([a, b])).resolves.toEqual([true, true]);
        expect(WebSocket.instances[0].sent).toHaveLength(2);
    });

    test('routes incoming messages by sessionId', () => {
        const listener = jest.fn();
        service.on('session-abc', listener);
        service.handleMessage(JSON.stringify({ sessionId: 'session-abc', event: 'response', data: { content: 'hi' } }));
        expect(listener).toHaveBeenCalledWith({ sessionId: 'session-abc', event: 'response', data: { content: 'hi' } });
    });

    test('ignores invalid JSON and messages without a sessionId', () => {
        const listener = jest.fn();
        service.on('undefined', listener);
        expect(() => service.handleMessage('{not json')).not.toThrow();
        expect(() => service.handleMessage(JSON.stringify({ event: 'response' }))).not.toThrow();
        expect(listener).not.toHaveBeenCalled();
    });

    test('reconnects after the socket closes', () => {
        jest.useFakeTimers();
        try {
            WebSocket.instances[0].open();
            WebSocket.instances[0].readyState = WebSocket.CLOSED;
            WebSocket.instances[0].emit('close');
            expect(WebSocket.instances).toHaveLength(1);
            jest.advanceTimersByTime(5000);
            expect(WebSocket.instances).toHaveLength(2);
        } finally {
            jest.useRealTimers();
        }
    });

    test('ensureConnected reconnects immediately when the socket is closed', () => {
        WebSocket.instances[0].readyState = WebSocket.CLOSED;
        service.ensureConnected(20).catch(() => {});
        expect(WebSocket.instances).toHaveLength(2);
    });

    test('socket errors are not re-emitted (no process crash)', () => {
        expect(() => WebSocket.instances[0].emit('error', new Error('ECONNREFUSED'))).not.toThrow();
    });

    test('close() stops reconnecting', () => {
        jest.useFakeTimers();
        try {
            const ws = WebSocket.instances[0];
            service.close();
            jest.advanceTimersByTime(10000);
            expect(ws.readyState).toBe(WebSocket.CLOSED);
            expect(WebSocket.instances).toHaveLength(1);
        } finally {
            jest.useRealTimers();
        }
    });
});

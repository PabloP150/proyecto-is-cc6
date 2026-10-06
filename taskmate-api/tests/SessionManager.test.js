// Factory (not automock): automocking would load the real LLMService and open a socket.
jest.mock('../services/UserSession', () => jest.fn());

const SessionManager = require('../services/SessionManager');
const UserSession = require('../services/UserSession');

const mockWebSocket = (readyState = 1) => ({ readyState, send: jest.fn(), close: jest.fn() });

// Minimal stand-in with the UserSession surface SessionManager relies on.
const fakeSession = (userId, ws) => {
    const session = {
        userId,
        websocket: ws,
        connected: true,
        reconnect: jest.fn(() => { session.connected = true; }),
        markDisconnected: jest.fn(() => { session.connected = false; session.websocket = null; }),
        isDisconnected: jest.fn(() => !session.connected),
        cleanup: jest.fn(),
    };
    return session;
};

describe('SessionManager', () => {
    let manager;

    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        UserSession.mockImplementation((userId, ws) => fakeSession(userId, ws));
        manager = new SessionManager();
    });

    afterEach(() => {
        manager.cleanup();
        jest.useRealTimers();
    });

    test('connect creates one session per user and indexes it by socket and user', async () => {
        const ws = mockWebSocket();
        const session = await manager.connect(ws, 'u1');
        expect(UserSession).toHaveBeenCalledWith('u1', ws);
        expect(manager.getSession(ws)).toBe(session);
        expect(manager.getUserSession('u1')).toBe(session);
        expect(manager.getActiveSessionCount()).toBe(1);
    });

    test('a second connection of the same user reuses the session and restores history', async () => {
        const ws1 = mockWebSocket();
        const ws2 = mockWebSocket();
        const first = await manager.connect(ws1, 'u1');
        const second = await manager.connect(ws2, 'u1');
        expect(second).toBe(first);
        expect(UserSession).toHaveBeenCalledTimes(1);
        expect(first.websocket).toBe(ws2);
        expect(first.reconnect).toHaveBeenCalled();
        expect(manager.getSession(ws1)).toBeUndefined();
        expect(manager.getSession(ws2)).toBe(first);
    });

    test('sessions of different users are isolated', async () => {
        const a = await manager.connect(mockWebSocket(), 'u1');
        const b = await manager.connect(mockWebSocket(), 'u2');
        expect(a).not.toBe(b);
        expect(manager.getUserSession('u2').userId).toBe('u2');
    });

    test('disconnect keeps the session for an hour, then cleans it up', async () => {
        jest.useFakeTimers();
        const ws = mockWebSocket();
        const session = await manager.connect(ws, 'u1');
        manager.disconnect(ws);
        expect(session.markDisconnected).toHaveBeenCalled();
        expect(manager.getActiveSessionCount()).toBe(0);
        expect(manager.getUserSession('u1')).toBe(session);

        jest.advanceTimersByTime(SessionManager.SESSION_RETENTION_MS);
        expect(session.cleanup).toHaveBeenCalled();
        expect(manager.getUserSession('u1')).toBeNull();
    });

    test('reconnecting within the hour cancels the cleanup', async () => {
        jest.useFakeTimers();
        const ws = mockWebSocket();
        const session = await manager.connect(ws, 'u1');
        manager.disconnect(ws);
        await manager.connect(mockWebSocket(), 'u1');
        jest.advanceTimersByTime(SessionManager.SESSION_RETENTION_MS);
        expect(session.cleanup).not.toHaveBeenCalled();
        expect(manager.getUserSession('u1')).toBe(session);
    });

    test('disconnecting an old socket after a reconnect does not affect the live one', async () => {
        const ws1 = mockWebSocket();
        const ws2 = mockWebSocket();
        const session = await manager.connect(ws1, 'u1');
        await manager.connect(ws2, 'u1');
        manager.disconnect(ws1);
        expect(session.markDisconnected).not.toHaveBeenCalled();
        expect(manager.getSession(ws2)).toBe(session);
    });

    test('disconnect of an unknown socket is a no-op', () => {
        expect(() => manager.disconnect(mockWebSocket())).not.toThrow();
    });

    test('disconnectUser closes the socket and removes the session', async () => {
        const ws = mockWebSocket();
        const session = await manager.connect(ws, 'u1');
        expect(manager.disconnectUser('u1')).toBe(true);
        expect(ws.close).toHaveBeenCalledWith(1000, 'User logged out');
        expect(session.cleanup).toHaveBeenCalled();
        expect(manager.getUserSession('u1')).toBeNull();
        expect(manager.disconnectUser('u1')).toBe(false);
    });

    test('cleanup clears every session and pending timer, tolerating errors', async () => {
        jest.useFakeTimers();
        const ws = mockWebSocket();
        const a = await manager.connect(ws, 'u1');
        const b = await manager.connect(mockWebSocket(), 'u2');
        a.cleanup.mockImplementation(() => { throw new Error('boom'); });
        manager.disconnect(ws);
        expect(() => manager.cleanup()).not.toThrow();
        expect(b.cleanup).toHaveBeenCalled();
        expect(manager.cleanupTimers.size).toBe(0);
        expect(jest.getTimerCount()).toBe(0);
        expect(manager.getActiveSessionCount()).toBe(0);
    });

    test('constructor errors propagate from connect', async () => {
        UserSession.mockImplementation(() => { throw new Error('init failed'); });
        await expect(manager.connect(mockWebSocket(), 'u1')).rejects.toThrow('init failed');
    });
});

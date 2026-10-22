// createServer() refuses weak secrets, so this suite runs with a strong one.
process.env.JWT_SECRET = 'ws-suite-7f3c9a1e5b2d8c4f6a0e9b3d7c1f5a2e8b4d6c0a';

const { ids, TEAM_CONTEXT, registerMocks, applyDefaults, tokenFor } = require('./support/mocks');

registerMocks();
// Chat sessions are covered by the SessionManager/UserSession suites; here only the handshake matters.
jest.mock('../../services/SessionManager', () => class {
    async connect() { return { handleMessage() {}, sendMessage() {} }; }
    disconnect() {}
    cleanup() {}
    getActiveSessionCount() { return 0; }
    getUserSession() { return null; }
    disconnectUser() {}
});

const net = require('net');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { signPurposeToken } = require('../../helpers/tokens');
const { createServer, assertStrongJwtSecret } = require('../../server');

let server;
let wsServer;
let port;
let m;
const sockets = [];

beforeAll((done) => {
    ({ server, wsServer } = createServer());
    server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        done();
    });
});

afterAll((done) => {
    sockets.forEach((ws) => ws.terminate());
    server.close(() => done());
});

beforeEach(() => { m = applyDefaults(); });

const connect = (path, { token, origin } = {}) => new Promise((resolve) => {
    const query = token ? `?token=${encodeURIComponent(token)}` : '';
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}${query}`, origin ? { origin } : {});
    sockets.push(ws);
    ws.on('open', () => resolve({ ws, status: 101 }));
    ws.on('unexpected-response', (req, res) => {
        req.destroy();
        resolve({ ws, status: res.statusCode });
    });
    ws.on('error', (error) => resolve({ ws, error }));
});

const nextMessage = (ws) => new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
});

// The next `count` messages of a socket, in arrival order.
const nextMessages = (ws, count) => new Promise((resolve) => {
    const received = [];
    const onMessage = (data) => {
        received.push(JSON.parse(data.toString()));
        if (received.length < count) return;
        ws.off('message', onMessage);
        resolve(received);
    };
    ws.on('message', onMessage);
});

const nextLlmSend = () => new Promise((resolve) => {
    m.llm.send.mockImplementation(async (message) => resolve(message));
});

describe('WebSocket handshake', () => {
    test('rejects a missing token with 401', async () => {
        expect((await connect('/chat')).status).toBe(401);
    });

    test('rejects purpose tokens and non-HS256 tokens with 401', async () => {
        const purpose = signPurposeToken('gh_install_state', { userId: ids.ALICE });
        expect((await connect('/chat', { token: purpose })).status).toBe(401);

        const hs512 = jwt.sign({ userId: ids.ALICE, typ: 'access' }, process.env.JWT_SECRET, { algorithm: 'HS512' });
        expect((await connect('/insights', { token: hs512 })).status).toBe(401);
    });

    test('accepts access tokens; legacy tokens without typ are rejected', async () => {
        expect((await connect('/chat', { token: tokenFor(ids.ALICE) })).status).toBe(101);
        const legacy = jwt.sign({ userId: ids.BOB, username: 'bob' }, process.env.JWT_SECRET, { expiresIn: '1h' });
        expect((await connect('/insights', { token: legacy })).status).toBe(401);
    });

    test('unknown paths answer 404', async () => {
        expect((await connect('/nope', { token: tokenFor(ids.ALICE) })).status).toBe(404);
    });

    test('a hostile Host header or an unparseable URL cannot crash the server', async () => {
        const rawUpgrade = (target, host) => new Promise((resolve) => {
            const socket = net.connect(port, '127.0.0.1', () => {
                socket.write(`GET ${target} HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n`
                    + 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n');
            });
            let head = '';
            socket.on('data', (chunk) => {
                head += chunk.toString();
                if (head.includes('\r\n\r\n')) socket.destroy();
            });
            socket.on('close', () => resolve(head.split('\r\n')[0]));
            socket.on('error', () => resolve(head.split('\r\n')[0]));
        });

        expect(await rawUpgrade(`/chat?token=${tokenFor(ids.ALICE)}`, '%')).toMatch(/^HTTP\/1\.1 101/);
        expect(await rawUpgrade('//[', 'localhost')).toBe('HTTP/1.1 400 Bad Request');
        // Still serving
        expect((await connect('/chat', { token: tokenFor(ids.ALICE) })).status).toBe(101);
    });

    test('rejects browser handshakes from a foreign origin with 403', async () => {
        const token = tokenFor(ids.ALICE);
        expect((await connect('/chat', { token, origin: 'http://evil.example' })).status).toBe(403);
        expect((await connect('/chat', { token, origin: 'http://localhost:3000' })).status).toBe(101);
    });
});

describe('/insights analytics requests', () => {
    const analyticsRequest = (data) => JSON.stringify({
        type: 'analytics',
        requestId: 'req-1',
        action: 'get_task_assignment_recommendations',
        data,
    });

    test('leaders get the server-built team_context (client-supplied one is dropped)', async () => {
        const { ws } = await connect('/insights', { token: tokenFor(ids.ALICE) });
        const sent = nextLlmSend();
        ws.send(analyticsRequest({ group_id: ids.GROUP_A, task_description: 'x', team_context: { forged: true } }));

        const message = await sent;
        expect(m.context.buildTeamContext).toHaveBeenCalledWith(ids.GROUP_A);
        expect(message).toMatchObject({ requestId: 'req-1', type: 'analytics', sessionId: expect.any(String) });
        expect(message.data.team_context).toEqual(TEAM_CONTEXT);

        // Responses are routed back to this client by sessionId
        const reply = nextMessage(ws);
        m.llm.emit(message.sessionId, { event: 'analytics_response', sessionId: message.sessionId, data: { recommendations: [] } });
        expect(await reply).toMatchObject({ event: 'analytics_response' });
    });

    test.each([['a plain member', ids.BOB], ['a non-member', ids.EVE]])(
        '%s gets analytics_error NOT_GROUP_ADMIN and nothing reaches Python', async (_label, userId) => {
            const { ws } = await connect('/insights', { token: tokenFor(userId) });
            const reply = nextMessage(ws);
            ws.send(analyticsRequest({ group_id: ids.GROUP_A, task_description: 'x' }));

            expect(await reply).toEqual({
                event: 'analytics_error',
                requestId: 'req-1',
                error: expect.any(String),
                code: 'NOT_GROUP_ADMIN',
            });
            expect(m.llm.send).not.toHaveBeenCalled();
            expect(m.context.buildTeamContext).not.toHaveBeenCalled();
        });

    test('unknown actions are rejected with VALIDATION_ERROR', async () => {
        const { ws } = await connect('/insights', { token: tokenFor(ids.ALICE) });
        const reply = nextMessage(ws);
        ws.send(JSON.stringify({ type: 'analytics', requestId: 'req-2', action: 'drop_tables', data: { group_id: ids.GROUP_A } }));
        expect(await reply).toMatchObject({ event: 'analytics_error', requestId: 'req-2', code: 'VALIDATION_ERROR' });
        expect(m.llm.send).not.toHaveBeenCalled();
    });

    test('demo groups (non-UUID ids) are forwarded without team_context', async () => {
        const { ws } = await connect('/insights', { token: tokenFor(ids.EVE) });
        const sent = nextLlmSend();
        ws.send(analyticsRequest({ group_id: 'test-group-456', task_description: 'x', team_context: { forged: true } }));

        const message = await sent;
        expect(message.data.group_id).toBe('test-group-456');
        expect(message.data.team_context).toBeUndefined();
        expect(m.context.buildTeamContext).not.toHaveBeenCalled();
    });

    test('an unreachable agent (send() resolves false) answers analytics_error LLM_ERROR', async () => {
        m.llm.send.mockResolvedValue(false);
        const { ws } = await connect('/insights', { token: tokenFor(ids.ALICE) });
        const reply = nextMessage(ws);
        ws.send(analyticsRequest({ group_id: ids.GROUP_A }));

        expect(await reply).toMatchObject({ event: 'analytics_error', requestId: 'req-1', code: 'LLM_ERROR' });
    });

    test('a team_context failure answers a generic analytics_error', async () => {
        m.context.buildTeamContext.mockRejectedValue(new Error('Invalid column name secret_col'));
        const { ws } = await connect('/insights', { token: tokenFor(ids.ALICE) });
        const reply = nextMessage(ws);
        ws.send(analyticsRequest({ group_id: ids.GROUP_A }));

        const error = await reply;
        expect(error).toMatchObject({ event: 'analytics_error', code: 'INTERNAL_ERROR' });
        expect(JSON.stringify(error)).not.toMatch(/secret_col/);
    });
});

describe('connection limits', () => {
    test('messages above 64 KB close the socket (1009) without reaching the session', async () => {
        const { ws } = await connect('/chat', { token: tokenFor(ids.ALICE) });
        const closed = new Promise((resolve) => ws.on('close', (code) => resolve(code)));
        ws.send(JSON.stringify({ type: 'user', content: 'x'.repeat(70 * 1024) }));
        expect(await closed).toBe(1009);
    });

    test('sockets are closed (4001) when the access token expires', async () => {
        const shortLived = jwt.sign({ userId: ids.ALICE, username: 'alice', typ: 'access' }, process.env.JWT_SECRET, { expiresIn: 1 });
        const { ws, status } = await connect('/insights', { token: shortLived });
        expect(status).toBe(101);
        const closed = await new Promise((resolve) => ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() })));
        expect(closed).toEqual({ code: 4001, reason: 'Token expired' });
    });
});

describe('JWT_SECRET strength (real startup path)', () => {
    test.each(['test', 'short-but-random-3f9a', 'change-me-please-this-is-a-long-placeholder-value', 'your-secret-key-goes-here-0123456789abcdef'])(
        'rejects %s', (secret) => {
            expect(() => assertStrongJwtSecret(secret)).toThrow(/JWT_SECRET/);
        });

    test('accepts a long random secret, and createServer enforces the check', () => {
        expect(() => assertStrongJwtSecret('9c1e7b3a5d2f8e4c6a0b9d3f7e1c5a2b8d4f6e0c')).not.toThrow();
        const previous = process.env.JWT_SECRET;
        process.env.JWT_SECRET = 'test';
        try {
            expect(() => createServer()).toThrow(/JWT_SECRET/);
        } finally {
            process.env.JWT_SECRET = previous;
        }
    });
});

describe('/events (Phase 4 live CI/CD events)', () => {
    const { realtime } = require('../../services/realtime');

    const subscribed = async (userId, groups) => {
        const { ws, status } = await connect('/events', { token: tokenFor(userId) });
        expect(status).toBe(101);
        const reply = nextMessage(ws);
        ws.send(JSON.stringify({ type: 'subscribe', groups }));
        return { ws, reply: await reply };
    };

    test('needs a token like the other paths', async () => {
        expect((await connect('/events')).status).toBe(401);
    });

    test('subscribes only to the groups the user belongs to and receives their events', async () => {
        const { ws, reply } = await subscribed(ids.BOB, [ids.GROUP_A, ids.GROUP_B]);
        expect(reply).toEqual({ type: 'subscribed', groups: [ids.GROUP_A] });
        const event = nextMessage(ws);
        await realtime.publish(ids.GROUP_B, 'ci_run', { runId: 2 });
        await realtime.publish(ids.GROUP_A, 'ci_run', { runId: 1 });
        expect(await event).toMatchObject({ type: 'event', event: 'ci_run', gid: ids.GROUP_A, data: { runId: 1 } });
        ws.close();
    });

    test('answers pings and ignores malformed messages', async () => {
        const { ws } = await subscribed(ids.ALICE, [ids.GROUP_A]);
        ws.send('not json');
        ws.send(JSON.stringify(null));
        const pong = nextMessage(ws);
        ws.send(JSON.stringify({ type: 'ping' }));
        expect(await pong).toEqual({ type: 'pong' });
        ws.close();
    });

    test('quick subscribes are not dropped: applied in order, one per second, the latest one wins', async () => {
        // A page load: [] while the groups load, then the groups ~300 ms later (and a change after it).
        const { ws } = await connect('/events', { token: tokenFor(ids.ALICE) });
        const replies = nextMessages(ws, 2);
        const sentAt = Date.now();
        ws.send(JSON.stringify({ type: 'subscribe', groups: [] }));
        ws.send(JSON.stringify({ type: 'subscribe', groups: [ids.GROUP_B] }));
        ws.send(JSON.stringify({ type: 'subscribe', groups: [ids.GROUP_A] }));

        expect(await replies).toEqual([{ type: 'subscribed', groups: [] }, { type: 'subscribed', groups: [ids.GROUP_A] }]);
        expect(Date.now() - sentAt).toBeGreaterThanOrEqual(900);
        // The superseded one never reached the database
        expect(m.access.isGroupMember).not.toHaveBeenCalledWith(ids.ALICE, ids.GROUP_B);
        const event = nextMessage(ws);
        await realtime.publish(ids.GROUP_A, 'ci_run', { runId: 3 });
        expect(await event).toMatchObject({ type: 'event', gid: ids.GROUP_A, data: { runId: 3 } });
        ws.close();
    });

    test('subscribe floods are capped per minute (RATE_LIMITED); the accepted ones still apply', async () => {
        const { ws } = await connect('/events', { token: tokenFor(ids.ALICE) });
        const messages = nextMessages(ws, 7);
        // 20 accepted (the 1st applies at once, the 20th a second later), the last 5 refused
        for (let i = 0; i < 25; i += 1) {
            ws.send(JSON.stringify({ type: 'subscribe', groups: i === 19 ? [ids.GROUP_A] : [] }));
        }
        const received = await messages;
        expect(received.filter((x) => x.type === 'error')).toEqual(
            Array(5).fill({ type: 'error', code: 'RATE_LIMITED', retryAfterMs: expect.any(Number) }));
        expect(received.find((x) => x.type === 'error').retryAfterMs).toBeGreaterThan(50 * 1000);
        expect(received.filter((x) => x.type === 'subscribed')).toEqual([
            { type: 'subscribed', groups: [] },
            { type: 'subscribed', groups: [ids.GROUP_A] },
        ]);
        ws.close();
    });

    test('a DB error in the membership check keeps the group (pending); once confirmed it is announced live', async () => {
        m.access.isGroupMember.mockRejectedValueOnce(new Error('Connection lost'));
        const { ws, reply } = await subscribed(ids.BOB, [ids.GROUP_A]);
        expect(reply).toEqual({ type: 'subscribed', groups: [], pending: [ids.GROUP_A] });

        const messages = nextMessages(ws, 2);
        await realtime.publish(ids.GROUP_A, 'ci_run', { runId: 4 });
        // The new `subscribed` (the page resyncs and stops polling) comes before the event itself
        expect(await messages).toEqual([
            { type: 'subscribed', groups: [ids.GROUP_A] },
            expect.objectContaining({ type: 'event', gid: ids.GROUP_A, data: { runId: 4 } }),
        ]);
        expect(m.access.isGroupMember).toHaveBeenCalledTimes(2);
        ws.close();
    });

    test('a subscribe still waiting for its turn is not applied once the socket closes', async () => {
        const { ws } = await connect('/events', { token: tokenFor(ids.CAROL) });
        const first = nextMessage(ws);
        ws.send(JSON.stringify({ type: 'subscribe', groups: [] }));
        ws.send(JSON.stringify({ type: 'subscribe', groups: [ids.GROUP_B] })); // waits ~1 s
        expect(await first).toEqual({ type: 'subscribed', groups: [] });
        await new Promise((resolve) => { ws.once('close', resolve); ws.close(); });
        await new Promise((r) => setTimeout(r, 1200));
        expect(m.access.isGroupMember).not.toHaveBeenCalled();
    });

    test('a subscribe that throws answers SUBSCRIBE_FAILED (never a silent "live"); the next one works', async () => {
        jest.spyOn(realtime, 'subscribe').mockRejectedValueOnce(new Error('bug'));
        const { ws, reply } = await subscribed(ids.ALICE, [ids.GROUP_A]);
        expect(reply).toEqual({ type: 'error', code: 'SUBSCRIBE_FAILED' });
        const next = nextMessage(ws);
        ws.send(JSON.stringify({ type: 'subscribe', groups: [ids.GROUP_A] }));
        expect(await next).toEqual({ type: 'subscribed', groups: [ids.GROUP_A] });
        ws.close();
    });

    test('refused subscribes do not count toward the per-minute cap', async () => {
        const { ws } = await connect('/events', { token: tokenFor(ids.CAROL) });
        // Sends `count` subscribes and a ping; → the errors answered before the pong (they are synchronous).
        const flood = (count) => new Promise((resolve) => {
            const errors = [];
            const onMessage = (data) => {
                const message = JSON.parse(data.toString());
                if (message.type === 'error') errors.push(message);
                if (message.type !== 'pong') return;
                ws.off('message', onMessage);
                resolve(errors);
            };
            ws.on('message', onMessage);
            for (let i = 0; i < count; i += 1) ws.send(JSON.stringify({ type: 'subscribe', groups: [] }));
            ws.send(JSON.stringify({ type: 'ping' }));
        });
        let clock = Date.now();
        jest.spyOn(Date, 'now').mockImplementation(() => clock);
        try {
            expect(await flood(25)).toHaveLength(5);
            clock += 30 * 1000;
            expect(await flood(5)).toEqual(Array(5).fill({ type: 'error', code: 'RATE_LIMITED', retryAfterMs: 30 * 1000 }));
            clock += 30 * 1000; // the first 20 leave the window; had the refused 5 counted, only 15 would fit
            expect(await flood(21)).toEqual([{ type: 'error', code: 'RATE_LIMITED', retryAfterMs: 60 * 1000 }]);
            // Closed while the clock is still frozen, so no subscribe timer is computed against the real one
            await new Promise((resolve) => { ws.once('close', resolve); ws.close(); });
        } finally {
            Date.now.mockRestore();
        }
    });

    test('past 10 sockets per user the oldest is closed with 1000 (so its tab does not reconnect)', async () => {
        const open = [];
        for (let i = 0; i < 10; i += 1) open.push((await connect('/events', { token: tokenFor(ids.EVE) })).ws);
        const evicted = new Promise((resolve) => {
            open[0].once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
        });
        const { ws: newest, status } = await connect('/events', { token: tokenFor(ids.EVE) });
        expect(status).toBe(101);
        expect(await evicted).toEqual({ code: 1000, reason: 'Too many connections' });
        expect(open.slice(1).every((ws) => ws.readyState === WebSocket.OPEN)).toBe(true);
        expect(wsServer.eventSockets.get(ids.EVE).size).toBe(10);

        const pong = nextMessage(newest);
        newest.send(JSON.stringify({ type: 'ping' }));
        expect(await pong).toEqual({ type: 'pong' });
        await Promise.all([...open.slice(1), newest].map((ws) => new Promise((resolve) => {
            ws.once('close', resolve);
            ws.close();
        })));
        await new Promise((r) => setTimeout(r, 50));
        expect(wsServer.eventSockets.has(ids.EVE)).toBe(false);
    });

    test('an evicted socket leaves the hub at once; a peer that ignores the close frame is cut off', async () => {
        const USER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
        const GROUP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
        m.access.isGroupMember.mockResolvedValue(true);
        wsServer.evictedCloseGraceMs = 300;
        try {
            const { ws: deaf, reply } = await subscribed(USER, [GROUP]);
            expect(reply).toEqual({ type: 'subscribed', groups: [GROUP] });
            const [serverSide] = wsServer.eventSockets.get(USER).keys();
            const cutOff = new Promise((resolve) => serverSide.once('close', resolve));
            deaf.pause(); // never reads, so never answers, the close frame

            const others = [];
            for (let i = 0; i < 10; i += 1) others.push((await connect('/events', { token: tokenFor(USER) })).ws);
            // Still waiting for the close handshake, but already out of the hub and of the user's list
            expect(serverSide.readyState).toBe(WebSocket.CLOSING);
            expect(await realtime.publish(GROUP, 'ci_run', {})).toBe(0);
            expect(wsServer.eventSockets.get(USER).has(serverSide)).toBe(false);
            expect(wsServer.eventSockets.get(USER).size).toBe(10);
            // Cut off after the grace time instead of ws's 30 s close timeout
            await cutOff;

            await Promise.all(others.map((ws) => new Promise((resolve) => {
                ws.once('close', resolve);
                ws.close();
            })));
            await new Promise((r) => setTimeout(r, 50));
            expect(wsServer.eventSockets.has(USER)).toBe(false);
        } finally {
            wsServer.evictedCloseGraceMs = 5000;
        }
    });

    test('closed sockets leave the hub', async () => {
        const { ws } = await subscribed(ids.CAROL, [ids.GROUP_B]);
        expect(await realtime.publish(ids.GROUP_B, 'ci_run', {})).toBe(1);
        await new Promise((resolve) => { ws.once('close', resolve); ws.close(); });
        await new Promise((r) => setTimeout(r, 50));
        expect(await realtime.publish(ids.GROUP_B, 'ci_run', {})).toBe(0);
    });
});

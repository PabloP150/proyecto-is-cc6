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
let port;
let m;
const sockets = [];

beforeAll((done) => {
    ({ server } = createServer());
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

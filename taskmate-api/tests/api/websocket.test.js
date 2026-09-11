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

const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { signPurposeToken } = require('../../helpers/tokens');
const { createServer } = require('../../server');

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

    test('accepts access tokens and legacy tokens without typ', async () => {
        expect((await connect('/chat', { token: tokenFor(ids.ALICE) })).status).toBe(101);
        const legacy = jwt.sign({ userId: ids.BOB, username: 'bob' }, process.env.JWT_SECRET);
        expect((await connect('/insights', { token: legacy })).status).toBe(101);
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

    test('members get the server-built team_context (client-supplied one is dropped)', async () => {
        const { ws } = await connect('/insights', { token: tokenFor(ids.BOB) });
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

    test('non-members get analytics_error NOT_GROUP_MEMBER and nothing reaches Python', async () => {
        const { ws } = await connect('/insights', { token: tokenFor(ids.EVE) });
        const reply = nextMessage(ws);
        ws.send(analyticsRequest({ group_id: ids.GROUP_A, task_description: 'x' }));

        expect(await reply).toEqual({
            event: 'analytics_error',
            requestId: 'req-1',
            error: expect.any(String),
            code: 'NOT_GROUP_MEMBER',
        });
        expect(m.llm.send).not.toHaveBeenCalled();
        expect(m.context.buildTeamContext).not.toHaveBeenCalled();
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
        const { ws } = await connect('/insights', { token: tokenFor(ids.BOB) });
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

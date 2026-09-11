/**
 * LLM fallback: how the Node side behaves when the Python AI service is down, silent,
 * busy or returns garbage. Real LLMService + real UserSession; only the socket and the DB are fake.
 */
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
            this.sent.push(JSON.parse(data));
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
    Object.assign(FakeWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3, instances: [] });
    return FakeWebSocket;
});
jest.mock('../services/ProjectService', () => ({ createProjectFromPlan: jest.fn(), addPlanToGroup: jest.fn() }));
jest.mock('../services/analyticsContext', () => ({ buildTeamContext: jest.fn() }), { virtual: true });
jest.mock('../models/access.model', () => ({ isGroupMember: jest.fn() }), { virtual: true });
jest.mock('../models/group.model', () => ({ getGroupsByUserId: jest.fn() }));
jest.mock('../models/github.model', () => ({ getGroupRepository: jest.fn() }), { virtual: true });
jest.mock('../models/tasks.model', () => ({ getTasksByGroupId: jest.fn() }));
jest.mock('../models/nodes.model', () => ({ getNodesByGroupId: jest.fn() }));
jest.mock('../services/github/repoSnapshot', () => ({
    ...jest.requireActual('../services/github/repoSnapshot'),
    buildRepoSnapshot: jest.fn(),
}));

const WebSocket = require('ws');
const llmService = require('../services/LLMService');
const accessModel = require('../models/access.model');
const groupModel = require('../models/group.model');
const githubModel = require('../models/github.model');
const tasksModel = require('../models/tasks.model');
const nodesModel = require('../models/nodes.model');
const { buildTeamContext } = require('../services/analyticsContext');
const { buildRepoSnapshot } = require('../services/github/repoSnapshot');
const UserSession = require('../services/UserSession');

const UID = '22222222-2222-4222-8222-222222222222';
const GID = '11111111-1111-4111-8111-111111111111';

const clientSocket = () => ({ readyState: 1, send: jest.fn(), close: jest.fn() });
const received = (ws) => ws.send.mock.calls.map(([raw]) => JSON.parse(raw));
const lastOfType = (ws, type) => received(ws).filter((m) => m.type === type).pop();
const pythonSocket = () => WebSocket.instances[WebSocket.instances.length - 1];
const fromPython = (message) => llmService.handleMessage(JSON.stringify(message));
const flush = () => new Promise((r) => setImmediate(r));

describe('LLM fallback (Node side)', () => {
    let ws;
    let session;

    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        llmService.close();
        WebSocket.instances.length = 0;
        llmService.connectTimeoutMs = 30;
        llmService.connect();

        accessModel.isGroupMember.mockResolvedValue(true);
        groupModel.getGroupsByUserId.mockResolvedValue([{ gid: GID, name: 'Demo' }]);
        githubModel.getGroupRepository.mockResolvedValue({ gid: GID, repoId: 1, fullName: 'o/r', defaultBranch: 'main', suspendedAt: null });
        tasksModel.getTasksByGroupId.mockResolvedValue([]);
        nodesModel.getNodesByGroupId.mockResolvedValue([]);
        buildRepoSnapshot.mockResolvedValue({ repo: {}, tree: [], readme: '', manifests: [], commits: [], issues: [] });
        buildTeamContext.mockResolvedValue({ team_members: [] });
        UserSession.lastAnalysisByUser.clear();

        ws = clientSocket();
        session = new UserSession(UID, ws);
    });

    afterEach(() => {
        session.cleanup();
        jest.useRealTimers();
    });

    describe('Python is down', () => {
        test('a chat message ends in an LLM_ERROR for the user instead of hanging', async () => {
            await session.handleMessage({ type: 'user', content: 'hola' });
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'LLM_ERROR', content: expect.any(String) });
        });

        test('an analytics request ends in analytics_error', async () => {
            await session.handleMessage({ type: 'analytics', action: 'x', requestId: 'a1', data: { group_id: GID } });
            expect(lastOfType(ws, 'analytics_error')).toMatchObject({ error: 'LLM_ERROR', requestId: 'a1' });
        });

        test('a repository analysis fails fast and frees the analysis slot', async () => {
            await session.handleMessage({ type: 'repo_analysis', requestId: 'c1', groupId: GID });
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'LLM_ERROR', requestId: 'c1' });
            expect(session.analysis).toBeNull();
        });

        test('recovers once Python is back', async () => {
            await session.handleMessage({ type: 'user', content: 'primero' });
            const pending = session.handleMessage({ type: 'user', content: 'segundo' });
            pythonSocket().open();
            await pending;
            expect(pythonSocket().sent.map((m) => m.params.message)).toEqual(['segundo']);
        });
    });

    describe('Python is up but misbehaves', () => {
        beforeEach(() => pythonSocket().open());

        test('silent analyzer → LLM_TIMEOUT after 90 s and the late answer is dropped', async () => {
            jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
            await session.handleMessage({ type: 'repo_analysis', requestId: 'c1', groupId: GID });
            const request = pythonSocket().sent.find((m) => m.method === 'analyze_repository');
            expect(request).toBeDefined();
            jest.advanceTimersByTime(UserSession.ANALYSIS_TIMEOUT_MS);
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'LLM_TIMEOUT', requestId: 'c1' });

            fromPython({ event: 'repo_analysis_plan', requestId: request.requestId, sessionId: session.sessionId, data: { plan: { tasks: [] } } });
            await flush();
            expect(lastOfType(ws, 'repo_plan')).toBeUndefined();
        });

        test('busy analyzer → LLM_RATE_LIMIT with retryAfterSec', async () => {
            await session.handleMessage({ type: 'repo_analysis', requestId: 'c1', groupId: GID });
            const request = pythonSocket().sent.find((m) => m.method === 'analyze_repository');
            fromPython({ event: 'repo_analysis_error', requestId: request.requestId, sessionId: session.sessionId, error: { code: 'LLM_RATE_LIMIT', message: 'busy', retryAfterSec: 30 } });
            await flush();
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'LLM_RATE_LIMIT', retryAfterSec: 30, requestId: 'c1' });
        });

        test('unusable plan → LLM_INVALID_OUTPUT', async () => {
            await session.handleMessage({ type: 'repo_analysis', requestId: 'c1', groupId: GID });
            const request = pythonSocket().sent.find((m) => m.method === 'analyze_repository');
            fromPython({ event: 'repo_analysis_plan', requestId: request.requestId, sessionId: session.sessionId, data: { plan: { summary: 'x', tasks: [{ name: '', due_date: 'mañana' }] } } });
            await flush();
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'LLM_INVALID_OUTPUT' });
        });

        test('invalid JSON or a missing sessionId is ignored and the session keeps working', async () => {
            expect(() => llmService.handleMessage('{oops')).not.toThrow();
            expect(() => fromPython({ event: 'response', data: { content: 'lost' } })).not.toThrow();
            fromPython({ event: 'response', sessionId: session.sessionId, data: { content: 'sigo aquí' } });
            await flush();
            expect(lastOfType(ws, 'assistant')).toMatchObject({ content: 'sigo aquí' });
        });

        test('a degraded chat answer (friendly text + data.error) is shown as assistant text', async () => {
            fromPython({ event: 'response', sessionId: session.sessionId, requestId: 'r', data: { content: 'El asistente está saturado, intenta en un momento.', error: { code: 'LLM_RATE_LIMIT', retryAfterSec: 10 } } });
            await flush();
            expect(lastOfType(ws, 'assistant')).toMatchObject({ content: 'El asistente está saturado, intenta en un momento.' });
        });

        test('an untyped Python error becomes a generic LLM_ERROR without internals', async () => {
            fromPython({ event: 'error', sessionId: session.sessionId, requestId: 'r', error: 'An unexpected error occurred: KeyError(\'x\')' });
            await flush();
            const error = lastOfType(ws, 'error');
            expect(error.code).toBe('LLM_ERROR');
            expect(JSON.stringify(error)).not.toContain('KeyError');
        });
    });
});

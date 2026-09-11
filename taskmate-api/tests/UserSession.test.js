jest.mock('../services/LLMService', () => {
    const { EventEmitter } = require('events');
    const emitter = new EventEmitter();
    emitter.send = jest.fn();
    return emitter;
});
jest.mock('../services/ProjectService', () => ({ createProjectFromPlan: jest.fn(), addPlanToGroup: jest.fn() }));
jest.mock('../services/analyticsContext', () => ({ buildTeamContext: jest.fn() }), { virtual: true });
jest.mock('../models/access.model', () => ({ isGroupMember: jest.fn(), isGroupAdmin: jest.fn() }), { virtual: true });
jest.mock('../models/group.model', () => ({ getGroupsByUserId: jest.fn() }));
jest.mock('../models/github.model', () => ({ getGroupRepository: jest.fn() }), { virtual: true });
jest.mock('../models/tasks.model', () => ({ getTasksByGroupId: jest.fn() }));
jest.mock('../models/nodes.model', () => ({ getNodesByGroupId: jest.fn() }));
jest.mock('../services/github/repoSnapshot', () => ({
    ...jest.requireActual('../services/github/repoSnapshot'),
    buildRepoSnapshot: jest.fn(),
}));

const llmService = require('../services/LLMService');
const projectService = require('../services/ProjectService');
const { buildTeamContext } = require('../services/analyticsContext');
const accessModel = require('../models/access.model');
const groupModel = require('../models/group.model');
const githubModel = require('../models/github.model');
const tasksModel = require('../models/tasks.model');
const nodesModel = require('../models/nodes.model');
const { buildRepoSnapshot } = require('../services/github/repoSnapshot');
const { localToday } = require('../services/github/repoPlan');
const UserSession = require('../services/UserSession');

const UID = '22222222-2222-4222-8222-222222222222';
const GID = '11111111-1111-4111-8111-111111111111';
const SNAPSHOT = { repo: { fullName: 'octo/demo' }, tree: ['README.md'], readme: '', manifests: [], commits: [], issues: [] };

const mockWebSocket = (readyState = 1) => ({ readyState, send: jest.fn(), close: jest.fn() });
const sent = (ws) => ws.send.mock.calls.map(([raw]) => JSON.parse(raw));
const lastOfType = (ws, type) => sent(ws).filter((m) => m.type === type).pop();
const pythonRequests = () => llmService.send.mock.calls.map(([req]) => req);

const futureDate = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return localToday(d);
};
const validPlan = () => ({
    summary: 'Siguiente paso',
    milestones: [{ key: 'm1', name: 'Beta', description: 'x', target_date: futureDate(20) }],
    tasks: [
        { name: 'Tests de API', description: 'Cubrir rutas', milestone_key: 'm1', due_date: futureDate(10), category: 'testing' },
        { name: 'Existing task', description: 'dup', milestone_key: null, due_date: futureDate(10), category: 'backend' },
    ],
});

describe('UserSession', () => {
    let ws;
    let session;

    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        llmService.removeAllListeners();
        llmService.send.mockResolvedValue(true);
        accessModel.isGroupMember.mockResolvedValue(true);
        groupModel.getGroupsByUserId.mockResolvedValue([{ gid: GID.toUpperCase(), name: 'Mi proyecto', adminId: UID }]);
        githubModel.getGroupRepository.mockResolvedValue({ gid: GID, repoId: 500, fullName: 'octo/demo', defaultBranch: 'main', suspendedAt: null });
        tasksModel.getTasksByGroupId.mockResolvedValue([{ name: 'Existing task', list: 'To Do', percentage: 0 }]);
        nodesModel.getNodesByGroupId.mockResolvedValue([]);
        buildRepoSnapshot.mockResolvedValue(SNAPSHOT);
        projectService.addPlanToGroup.mockResolvedValue({ taskIds: ['t1'], nodeIds: ['n1'] });
        UserSession.lastAnalysisByUser.clear();
        ws = mockWebSocket();
        session = new UserSession(UID, ws);
    });

    afterEach(() => {
        session.cleanup();
        jest.useRealTimers();
    });

    const startAnalysis = async (extra = {}) => {
        await session.handleMessage({ type: 'repo_analysis', requestId: 'client-1', groupId: GID, instructions: 'enfócate en pruebas', ...extra });
        return pythonRequests().find((r) => r.method === 'analyze_repository');
    };
    const replyPlan = async (request, plan = validPlan()) => {
        llmService.emit(session.sessionId, { event: 'repo_analysis_plan', requestId: request.requestId, sessionId: session.sessionId, data: { plan } });
        await new Promise((r) => setImmediate(r));
        return lastOfType(ws, 'repo_plan');
    };

    describe('basics', () => {
        test('initializes and listens to its own session id', () => {
            expect(session.userId).toBe(UID);
            expect(session.websocket).toBe(ws);
            expect(session.context).toBeNull();
            expect(llmService.listenerCount(session.sessionId)).toBe(1);
        });

        test('ping → pong, not stored in history', () => {
            session.handleMessage({ type: 'ping' });
            expect(sent(ws)).toEqual([{ type: 'pong', timestamp: expect.any(String) }]);
            expect(session.chatHistory).toHaveLength(0);
        });

        test('system messages without content do not crash', () => {
            expect(() => session.sendMessage({ type: 'system' })).not.toThrow();
            expect(ws.send).toHaveBeenCalledTimes(1);
        });

        test('messages are kept in history when the socket is closed', () => {
            ws.readyState = 3;
            session.sendMessage({ type: 'assistant', content: 'hola' });
            expect(ws.send).not.toHaveBeenCalled();
            expect(session.chatHistory).toHaveLength(1);
        });

        test('cleanup removes listeners and pending state', () => {
            session.pendingPlans.set('p', {});
            session.cleanup();
            expect(llmService.listenerCount(session.sessionId)).toBe(0);
            expect(session.pendingPlans.size).toBe(0);
            expect(ws.close).toHaveBeenCalled();
        });
    });

    describe('user chat flow (unchanged)', () => {
        test('forwards to handle_user_message and stores the message', async () => {
            await session.handleMessage({ type: 'user', content: 'Quiero una app' });
            expect(pythonRequests()).toEqual([{
                requestId: expect.any(String),
                sessionId: session.sessionId,
                method: 'handle_user_message',
                params: { message: 'Quiero una app', context: { userId: UID } },
            }]);
            expect(session.chatHistory[0]).toMatchObject({ type: 'user', content: 'Quiero una app' });
        });

        test('assistant responses reach the client', async () => {
            llmService.emit(session.sessionId, { event: 'response', sessionId: session.sessionId, data: { content: 'Hola!' } });
            await new Promise((r) => setImmediate(r));
            expect(lastOfType(ws, 'assistant')).toMatchObject({ content: 'Hola!' });
        });

        test('AI service down → error LLM_ERROR instead of silence', async () => {
            llmService.send.mockResolvedValue(false);
            await session.handleMessage({ type: 'user', content: 'hola' });
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'LLM_ERROR', message: expect.any(String), content: expect.any(String) });
        });

        test('Python error events map to {type:"error", code, message}', async () => {
            llmService.emit(session.sessionId, { event: 'error', sessionId: session.sessionId, requestId: 'x', error: 'Traceback: secret internals' });
            await new Promise((r) => setImmediate(r));
            const error = lastOfType(ws, 'error');
            expect(error).toMatchObject({ code: 'LLM_ERROR' });
            expect(JSON.stringify(error)).not.toContain('Traceback');
        });

        test('save_plan → project_created with the name, not the GUID', async () => {
            projectService.createProjectFromPlan.mockResolvedValue({ success: true, groupId: 'AAAA-GUID' });
            llmService.emit(session.sessionId, { event: 'save_plan', sessionId: session.sessionId, requestId: 'r', data: { plan: { project_name: 'Tienda online' }, original_message: 'x' } });
            await new Promise((r) => setImmediate(r));
            const msg = lastOfType(ws, 'system');
            expect(msg).toMatchObject({ event: 'project_created', content: 'Proyecto "Tienda online" creado', groupId: 'AAAA-GUID', groupName: 'Tienda online' });
            expect(msg.content).not.toContain('AAAA-GUID');
        });

        test('save_plan failure → SAVE_FAILED error', async () => {
            projectService.createProjectFromPlan.mockResolvedValue({ success: false, error: 'Database error' });
            llmService.emit(session.sessionId, { event: 'save_plan', sessionId: session.sessionId, data: { plan: {}, original_message: 'x' } });
            await new Promise((r) => setImmediate(r));
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'SAVE_FAILED' });
        });
    });

    describe('set_context', () => {
        test('member → context with repo info', async () => {
            await session.handleMessage({ type: 'set_context', groupId: GID });
            expect(lastOfType(ws, 'context')).toEqual({
                type: 'context', groupId: GID, groupName: 'Mi proyecto', repo: { fullName: 'octo/demo', defaultBranch: 'main' }, timestamp: expect.any(String),
            });
            expect(accessModel.isGroupMember).toHaveBeenCalledWith(UID, GID);
        });

        test('non-member → NOT_GROUP_MEMBER', async () => {
            accessModel.isGroupMember.mockResolvedValue(false);
            await session.handleMessage({ type: 'set_context', groupId: GID });
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'NOT_GROUP_MEMBER' });
            expect(session.context).toBeNull();
        });

        test('null clears the context; invalid ids are rejected', async () => {
            await session.handleMessage({ type: 'set_context', groupId: null });
            expect(lastOfType(ws, 'context')).toMatchObject({ groupId: null, repo: null });
            await session.handleMessage({ type: 'set_context', groupId: 'x; DROP TABLE' });
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'VALIDATION_ERROR' });
        });
    });

    describe('repo_analysis', () => {
        test('sends stages and the analyze_repository request', async () => {
            const request = await startAnalysis();
            const stages = sent(ws).filter((m) => m.type === 'repo_analysis_status');
            expect(stages.map((s) => [s.requestId, s.stage])).toEqual([['client-1', 'fetching_repo'], ['client-1', 'analyzing']]);
            expect(request).toEqual({
                requestId: expect.any(String),
                sessionId: session.sessionId,
                method: 'analyze_repository',
                params: {
                    groupId: GID,
                    instructions: 'enfócate en pruebas',
                    today: localToday(),
                    limits: { maxTasks: 12, maxMilestones: 5 },
                    snapshot: SNAPSHOT,
                    existing: { tasks: [{ name: 'Existing task', list: 'To Do', percentage: 0 }], milestones: [] },
                },
            });
            expect(request.requestId).not.toBe('client-1');
            expect(session.chatHistory.some((m) => m.type === 'repo_analysis_status')).toBe(false);
        });

        test('plan reply (by requestId) → repo_plan, sanitized and deduped, kept for history_restore', async () => {
            const request = await startAnalysis();
            const msg = await replyPlan(request);
            expect(msg).toMatchObject({ type: 'repo_plan', requestId: 'client-1', groupId: GID, groupName: 'Mi proyecto', content: expect.stringContaining('Plan propuesto') });
            expect(msg.planId).toMatch(/^[0-9a-f-]{36}$/);
            expect(new Date(msg.expiresAt).getTime() - Date.now()).toBeGreaterThan(29 * 60 * 1000);
            expect(msg.plan.tasks.map((t) => t.name)).toEqual(['Tests de API']);
            expect(session.analysis).toBeNull();

            const reconnectWs = mockWebSocket();
            session.websocket = reconnectWs;
            session.reconnect();
            const restore = sent(reconnectWs).find((m) => m.type === 'history_restore');
            expect(restore.messages.some((m) => m.type === 'repo_plan' && m.planId === msg.planId)).toBe(true);
        });

        test('non-member → NOT_GROUP_MEMBER, nothing sent to Python, no cooldown consumed', async () => {
            accessModel.isGroupMember.mockResolvedValue(false);
            await startAnalysis();
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'NOT_GROUP_MEMBER', requestId: 'client-1' });
            expect(pythonRequests()).toHaveLength(0);
            expect(UserSession.lastAnalysisByUser.has(UID)).toBe(false);
        });

        test('no repository → REPO_NOT_CONNECTED', async () => {
            githubModel.getGroupRepository.mockResolvedValue(null);
            await startAnalysis();
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'REPO_NOT_CONNECTED' });
        });

        test('invalid groupId or instructions → VALIDATION_ERROR', async () => {
            await session.handleMessage({ type: 'repo_analysis', requestId: 'r', groupId: 'nope' });
            await session.handleMessage({ type: 'repo_analysis', requestId: 'r', groupId: GID, instructions: { x: 1 } });
            expect(sent(ws).filter((m) => m.code === 'VALIDATION_ERROR')).toHaveLength(2);
        });

        test('instructions are capped at 500 characters', async () => {
            const request = await startAnalysis({ instructions: 'a'.repeat(900) });
            expect(request.params.instructions).toHaveLength(500);
        });

        test('one analysis in progress per session', async () => {
            await startAnalysis();
            await session.handleMessage({ type: 'repo_analysis', requestId: 'client-2', groupId: GID });
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'ANALYSIS_IN_PROGRESS', requestId: 'client-2' });
        });

        test('one analysis per user per minute', async () => {
            const request = await startAnalysis();
            await replyPlan(request);
            await session.handleMessage({ type: 'repo_analysis', requestId: 'client-2', groupId: GID });
            const error = lastOfType(ws, 'error');
            expect(error).toMatchObject({ code: 'RATE_LIMITED', requestId: 'client-2' });
            expect(error.retryAfterSec).toBeGreaterThan(0);

            const otherSession = new UserSession(UID, mockWebSocket());
            await otherSession.handleMessage({ type: 'repo_analysis', requestId: 'c3', groupId: GID });
            expect(sent(otherSession.websocket).pop()).toMatchObject({ code: 'RATE_LIMITED' });
            otherSession.cleanup();

            UserSession.lastAnalysisByUser.set(UID, Date.now() - 61 * 1000);
            await session.handleMessage({ type: 'repo_analysis', requestId: 'client-4', groupId: GID });
            expect(pythonRequests().filter((r) => r.method === 'analyze_repository')).toHaveLength(2);
        });

        test('no reply within 90 s → LLM_TIMEOUT; a late reply is ignored', async () => {
            jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
            const request = await startAnalysis();
            jest.advanceTimersByTime(UserSession.ANALYSIS_TIMEOUT_MS);
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'LLM_TIMEOUT', requestId: 'client-1' });
            expect(session.analysis).toBeNull();
            expect(await replyPlan(request)).toBeUndefined();
        });

        test('replies for another requestId are ignored', async () => {
            await startAnalysis();
            llmService.emit(session.sessionId, { event: 'repo_analysis_plan', requestId: 'other', sessionId: session.sessionId, data: { plan: validPlan() } });
            await new Promise((r) => setImmediate(r));
            expect(lastOfType(ws, 'repo_plan')).toBeUndefined();
            expect(session.analysis).not.toBeNull();
        });

        test.each([
            [{ code: 'LLM_RATE_LIMIT', message: 'busy', retryAfterSec: 30 }, 'LLM_RATE_LIMIT', 30],
            [{ code: 'LLM_ERROR', message: 'down' }, 'LLM_ERROR', undefined],
            [{ code: 'INTERNAL_ERROR', message: 'KeyError: x' }, 'ANALYSIS_FAILED', undefined],
        ])('repo_analysis_error %j → %s', async (error, code, retryAfterSec) => {
            const request = await startAnalysis();
            llmService.emit(session.sessionId, { event: 'repo_analysis_error', requestId: request.requestId, sessionId: session.sessionId, error });
            await new Promise((r) => setImmediate(r));
            const msg = lastOfType(ws, 'error');
            expect(msg).toMatchObject({ code, requestId: 'client-1' });
            expect(msg.retryAfterSec).toBe(retryAfterSec);
            expect(JSON.stringify(msg)).not.toContain('KeyError');
        });

        test('an unusable plan → LLM_INVALID_OUTPUT', async () => {
            const request = await startAnalysis();
            await replyPlan(request, { tasks: 'nope' });
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'LLM_INVALID_OUTPUT' });
        });

        test('AI service unreachable → LLM_ERROR', async () => {
            llmService.send.mockResolvedValue(false);
            await startAnalysis();
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'LLM_ERROR', requestId: 'client-1' });
            expect(session.analysis).toBeNull();
        });
    });

    describe('repo_plan_confirm / discard', () => {
        const getPlan = async () => replyPlan(await startAnalysis());

        test('confirm saves through addPlanToGroup once', async () => {
            const { planId, plan } = await getPlan();
            await session.handleMessage({ type: 'repo_plan_confirm', planId });
            expect(projectService.addPlanToGroup).toHaveBeenCalledWith(GID, plan, UID);
            expect(lastOfType(ws, 'repo_plan_saved')).toMatchObject({ planId, groupId: GID, created: { tasks: 1, milestones: 1 } });
        });

        test('double confirm → the second gets REPO_PLAN_NOT_FOUND', async () => {
            const { planId } = await getPlan();
            await Promise.all([
                session.handleMessage({ type: 'repo_plan_confirm', planId }),
                session.handleMessage({ type: 'repo_plan_confirm', planId }),
            ]);
            expect(projectService.addPlanToGroup).toHaveBeenCalledTimes(1);
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'REPO_PLAN_NOT_FOUND', planId });
        });

        test('expired plan → REPO_PLAN_EXPIRED', async () => {
            const { planId } = await getPlan();
            session.pendingPlans.get(planId).expiresAt = Date.now() - 1;
            await session.handleMessage({ type: 'repo_plan_confirm', planId });
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'REPO_PLAN_EXPIRED' });
            expect(projectService.addPlanToGroup).not.toHaveBeenCalled();
        });

        test('membership is re-checked at confirm time', async () => {
            const { planId } = await getPlan();
            accessModel.isGroupMember.mockResolvedValue(false);
            await session.handleMessage({ type: 'repo_plan_confirm', planId });
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'NOT_GROUP_MEMBER' });
            expect(projectService.addPlanToGroup).not.toHaveBeenCalled();
        });

        test('a failed save → SAVE_FAILED and the plan can be confirmed again', async () => {
            const { planId } = await getPlan();
            projectService.addPlanToGroup.mockRejectedValueOnce(new Error('deadlock'));
            await session.handleMessage({ type: 'repo_plan_confirm', planId });
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'SAVE_FAILED', planId });
            await session.handleMessage({ type: 'repo_plan_confirm', planId });
            expect(lastOfType(ws, 'repo_plan_saved')).toMatchObject({ planId });
        });

        test('discard removes the plan', async () => {
            const { planId } = await getPlan();
            await session.handleMessage({ type: 'repo_plan_discard', planId });
            expect(lastOfType(ws, 'repo_plan_discarded')).toMatchObject({ planId });
            await session.handleMessage({ type: 'repo_plan_confirm', planId });
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'REPO_PLAN_NOT_FOUND' });
        });

        test('unknown plan ids → REPO_PLAN_NOT_FOUND', async () => {
            await session.handleMessage({ type: 'repo_plan_discard', planId: 'nope' });
            await session.handleMessage({ type: 'repo_plan_confirm', planId: { $ne: 1 } });
            expect(sent(ws).filter((m) => m.code === 'REPO_PLAN_NOT_FOUND')).toHaveLength(2);
        });
    });

    describe('analytics', () => {
        test('adds the real team_context for members and drops the client one', async () => {
            buildTeamContext.mockResolvedValue({ team_members: [{ uid: UID }] });
            await session.handleMessage({ type: 'analytics', action: 'get_task_assignment_recommendations', requestId: 'a1', data: { group_id: GID, team_context: { team_members: ['forged'] } } });
            expect(pythonRequests()[0]).toMatchObject({ type: 'analytics', requestId: 'a1', data: { group_id: GID, team_context: { team_members: [{ uid: UID }] } } });
        });

        test('non-members get analytics_error NOT_GROUP_MEMBER', async () => {
            accessModel.isGroupMember.mockResolvedValue(false);
            await session.handleMessage({ type: 'analytics', action: 'x', requestId: 'a2', data: { group_id: GID } });
            expect(lastOfType(ws, 'analytics_error')).toMatchObject({ error: 'NOT_GROUP_MEMBER', requestId: 'a2' });
            expect(pythonRequests()).toHaveLength(0);
        });

        test('demo groups keep using the Python mock (no team_context)', async () => {
            await session.handleMessage({ type: 'analytics', action: 'x', requestId: 'a3', data: { group_id: 'test-group-456', team_context: {} } });
            expect(pythonRequests()[0].data).toEqual({ group_id: 'test-group-456' });
            expect(buildTeamContext).not.toHaveBeenCalled();
        });

        test('analytics responses are forwarded with their requestId', async () => {
            llmService.emit(session.sessionId, { event: 'analytics_response', sessionId: session.sessionId, requestId: 'a4', data: { success: true, no_data: true } });
            await new Promise((r) => setImmediate(r));
            expect(lastOfType(ws, 'analytics_response')).toMatchObject({ requestId: 'a4', data: { no_data: true } });
        });
    });
});

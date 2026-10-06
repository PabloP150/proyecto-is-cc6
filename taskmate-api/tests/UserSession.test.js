jest.mock('../services/LLMService', () => {
    const { EventEmitter } = require('events');
    const emitter = new EventEmitter();
    emitter.send = jest.fn();
    return emitter;
});
jest.mock('../services/ProjectService', () => ({ createProjectFromPlan: jest.fn(), addPlanToGroup: jest.fn() }));
jest.mock('../services/analyticsContext', () => ({ buildTeamContext: jest.fn() }));
jest.mock('../models/access.model', () => ({ isGroupMember: jest.fn(), isGroupAdmin: jest.fn(), isGroupLeader: jest.fn() }));
jest.mock('../models/group.model', () => ({ getGroupById: jest.fn() }));
jest.mock('../models/github.model', () => ({ getGroupRepository: jest.fn() }));
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
        accessModel.isGroupLeader.mockResolvedValue(true);
        groupModel.getGroupById.mockResolvedValue({ gid: GID.toUpperCase(), name: 'Mi proyecto', adminId: UID });
        githubModel.getGroupRepository.mockResolvedValue({ gid: GID, repoId: 500, fullName: 'octo/demo', defaultBranch: 'main', suspendedAt: null, aiAnalysisEnabled: true });
        tasksModel.getTasksByGroupId.mockResolvedValue([{ name: 'Existing task', list: 'To Do', percentage: 0 }]);
        nodesModel.getNodesByGroupId.mockResolvedValue([]);
        buildRepoSnapshot.mockResolvedValue(SNAPSHOT);
        projectService.addPlanToGroup.mockResolvedValue({ taskIds: ['t1'], nodeIds: ['n1'] });
        UserSession.lastAnalysisByUser.clear();
        UserSession.chatWindowByUser.clear();
        UserSession.analyticsWindowByUser.clear();
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
            session.awaitingPlanConfirmation = true;
            llmService.emit(session.sessionId, { event: 'save_plan', sessionId: session.sessionId, requestId: 'r', data: { plan: { project_name: 'Tienda online' }, original_message: 'x' } });
            await new Promise((r) => setImmediate(r));
            const msg = lastOfType(ws, 'system');
            expect(msg).toMatchObject({ event: 'project_created', content: 'Proyecto "Tienda online" creado', groupId: 'AAAA-GUID', groupName: 'Tienda online' });
            expect(msg.content).not.toContain('AAAA-GUID');
        });

        test('save_plan failure → SAVE_FAILED error', async () => {
            projectService.createProjectFromPlan.mockResolvedValue({ success: false, error: 'Database error' });
            session.awaitingPlanConfirmation = true;
            llmService.emit(session.sessionId, { event: 'save_plan', sessionId: session.sessionId, data: { plan: {}, original_message: 'x' } });
            await new Promise((r) => setImmediate(r));
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'SAVE_FAILED' });
        });
    });

    describe('set_context', () => {
        test('member → context with repo info', async () => {
            await session.handleMessage({ type: 'set_context', groupId: GID });
            expect(lastOfType(ws, 'context')).toEqual({
                type: 'context', groupId: GID, groupName: 'Mi proyecto', repo: { fullName: 'octo/demo', defaultBranch: 'main', aiAnalysisEnabled: true }, timestamp: expect.any(String),
            });
            expect(accessModel.isGroupMember).toHaveBeenCalledWith(UID, GID);
        });

        test('non-member → NOT_GROUP_MEMBER, shown live only (not kept for history_restore)', async () => {
            accessModel.isGroupMember.mockResolvedValue(false);
            await session.handleMessage({ type: 'set_context', groupId: GID });
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'NOT_GROUP_MEMBER' });
            expect(session.chatHistory).toHaveLength(0);
        });

        test('null clears the context; invalid ids are rejected', async () => {
            await session.handleMessage({ type: 'set_context', groupId: null });
            expect(lastOfType(ws, 'context')).toMatchObject({ groupId: null, repo: null });
            await session.handleMessage({ type: 'set_context', groupId: 'x; DROP TABLE' });
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'VALIDATION_ERROR' });
            expect(session.chatHistory).toHaveLength(0);
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

        test('non-member → NOT_GROUP_MEMBER, nothing sent to Python, no cooldown consumed, nothing kept in history', async () => {
            accessModel.isGroupMember.mockResolvedValue(false);
            await startAnalysis();
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'NOT_GROUP_MEMBER', requestId: 'client-1' });
            expect(pythonRequests()).toHaveLength(0);
            expect(UserSession.lastAnalysisByUser.has(UID)).toBe(false);
            expect(session.chatHistory).toHaveLength(0);
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
            expect(error).toMatchObject({ code: 'RATE_LIMITED', requestId: 'client-2', message: 'Solo se puede pedir un análisis por minuto.' });
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
            expect(session.chatHistory.map((m) => [m.type, m.code || m.content])).toEqual([
                ['user', 'enfócate en pruebas'], ['error', 'LLM_TIMEOUT'],
            ]);
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

    describe('history_restore keeps whole turns (request + outcome)', () => {
        const turns = () => session.chatHistory.map((m) => [m.type, m.code || m.content]);
        const restore = () => {
            const reconnectWs = mockWebSocket();
            session.websocket = reconnectWs;
            session.reconnect();
            return sent(reconnectWs).find((m) => m.type === 'history_restore');
        };

        test('a cooldown refusal is shown live but not restored, so no orphan error comes back', async () => {
            await replyPlan(await startAnalysis());
            await session.handleMessage({ type: 'repo_analysis', requestId: 'client-2', groupId: GID, instructions: 'prioriza las pruebas' });
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'RATE_LIMITED', requestId: 'client-2', retryAfterSec: expect.any(Number) });

            const restored = restore().messages;
            expect(restored.map((m) => m.type)).toEqual(['user', 'repo_plan']);
            // The request keeps its requestId so ChatPage can tell it is already in the restore.
            expect(restored[0]).toMatchObject({ content: 'enfócate en pruebas', requestId: 'client-1' });
            expect(JSON.stringify(restored)).not.toContain('prioriza las pruebas');
        });

        test('ANALYSIS_IN_PROGRESS and VALIDATION_ERROR refusals are not kept either', async () => {
            await startAnalysis();
            await session.handleMessage({ type: 'repo_analysis', requestId: 'client-2', groupId: GID, instructions: 'otra' });
            await session.handleMessage({ type: 'repo_analysis', requestId: 'client-3', groupId: 'nope' });
            expect(sent(ws).filter((m) => m.type === 'error').map((m) => m.code)).toEqual(['ANALYSIS_IN_PROGRESS', 'VALIDATION_ERROR']);
            expect(turns()).toEqual([['user', 'enfócate en pruebas']]);
        });

        test('an analysis without instructions is kept with the text the chat shows', async () => {
            await startAnalysis({ instructions: '' });
            expect(turns()).toEqual([['user', 'Analiza el repositorio de «Mi proyecto» y propón las siguientes tareas.']]);
        });

        test('kept instructions are the cleaned ones sent to the AI', async () => {
            const request = await startAnalysis({ instructions: '  prioriza\u0000las pruebas  ' });
            expect(request.params.instructions).toBe('prioriza las pruebas');
            expect(turns()).toEqual([['user', 'prioriza las pruebas']]);
        });

        test('an error after the analysis was accepted is kept right after its request', async () => {
            githubModel.getGroupRepository.mockResolvedValue(null);
            await startAnalysis();
            expect(turns()).toEqual([['user', 'enfócate en pruebas'], ['error', 'REPO_NOT_CONNECTED']]);
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
            expect(session.chatHistory).toContainEqual(expect.objectContaining({ type: 'error', code: 'REPO_PLAN_NOT_FOUND', planId }));
        });

        test('expired plan → REPO_PLAN_EXPIRED', async () => {
            const { planId } = await getPlan();
            session.pendingPlans.get(planId).expiresAt = Date.now() - 1;
            await session.handleMessage({ type: 'repo_plan_confirm', planId });
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'REPO_PLAN_EXPIRED' });
            expect(projectService.addPlanToGroup).not.toHaveBeenCalled();
            // ChatPage folds it into the restored plan card.
            expect(session.chatHistory).toContainEqual(expect.objectContaining({ type: 'error', code: 'REPO_PLAN_EXPIRED', planId }));
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
        test('adds the real team_context for group leaders and drops the client one', async () => {
            buildTeamContext.mockResolvedValue({ team_members: [{ uid: UID }] });
            await session.handleMessage({ type: 'analytics', action: 'get_task_assignment_recommendations', requestId: 'a1', data: { group_id: GID, team_context: { team_members: ['forged'] } } });
            expect(accessModel.isGroupLeader).toHaveBeenCalledWith(UID, GID);
            expect(pythonRequests()[0]).toMatchObject({ type: 'analytics', requestId: 'a1', data: { group_id: GID, team_context: { team_members: [{ uid: UID }] } } });
        });

        test.each([
            ['get_task_assignment_recommendations'], ['get_team_analytics'], ['get_workload_distribution'], ['get_expertise_rankings'],
        ])('team-level %s requires a group leader', async (action) => {
            accessModel.isGroupLeader.mockResolvedValue(false);
            await session.handleMessage({ type: 'analytics', action, requestId: 'a2', data: { group_id: GID } });
            expect(lastOfType(ws, 'analytics_error')).toMatchObject({ error: 'NOT_GROUP_ADMIN', requestId: 'a2' });
            expect(accessModel.isGroupLeader).toHaveBeenCalledWith(UID, GID);
            expect(buildTeamContext).not.toHaveBeenCalled();
            expect(pythonRequests()).toHaveLength(0);
        });

        test('own user analytics need no leader; another user\'s need leader + membership', async () => {
            accessModel.isGroupLeader.mockResolvedValue(false);
            await session.handleMessage({ type: 'analytics', action: 'get_user_analytics', requestId: 'u1', data: { user_id: UID } });
            expect(pythonRequests()).toHaveLength(1);
            const OTHER = '33333333-3333-4333-8333-333333333333';
            await session.handleMessage({ type: 'analytics', action: 'get_user_analytics', requestId: 'u2', data: { user_id: OTHER, group_id: GID } });
            expect(lastOfType(ws, 'analytics_error')).toMatchObject({ error: 'NOT_GROUP_ADMIN', requestId: 'u2' });
            accessModel.isGroupLeader.mockResolvedValue(true);
            accessModel.isGroupMember.mockResolvedValue(false);
            await session.handleMessage({ type: 'analytics', action: 'get_user_analytics', requestId: 'u3', data: { user_id: OTHER, group_id: GID } });
            expect(lastOfType(ws, 'analytics_error')).toMatchObject({ error: 'NOT_GROUP_MEMBER', requestId: 'u3' });
            expect(pythonRequests()).toHaveLength(1);
        });

        test('more than 10 analytics requests per minute → RATE_LIMITED, nothing reaches Python', async () => {
            for (let i = 1; i <= 10; i += 1) {
                await session.handleMessage({ type: 'analytics', action: 'get_user_analytics', requestId: `r${i}`, data: { user_id: UID } });
            }
            expect(pythonRequests()).toHaveLength(10);
            await session.handleMessage({ type: 'analytics', action: 'get_user_analytics', requestId: 'r11', data: { user_id: UID } });
            expect(lastOfType(ws, 'analytics_error')).toMatchObject({ error: 'RATE_LIMITED', requestId: 'r11' });
            expect(pythonRequests()).toHaveLength(10);
        });

        test('unknown actions are rejected', async () => {
            await session.handleMessage({ type: 'analytics', action: 'drop_everything', requestId: 'a9', data: {} });
            expect(lastOfType(ws, 'analytics_error')).toMatchObject({ error: 'VALIDATION_ERROR' });
        });

        test('legacy callers without an action get the strictest rule', async () => {
            accessModel.isGroupLeader.mockResolvedValue(false);
            await expect(UserSession.prepareAnalyticsData(UID, { group_id: GID })).rejects.toMatchObject({ code: 'NOT_GROUP_ADMIN' });
        });

        test('no answer within 90 s → analytics_error LLM_TIMEOUT', async () => {
            jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
            await session.handleMessage({ type: 'analytics', action: 'get_team_analytics', requestId: 'a5', data: { group_id: GID } });
            jest.advanceTimersByTime(UserSession.REQUEST_TIMEOUT_MS);
            expect(lastOfType(ws, 'analytics_error')).toMatchObject({ error: 'LLM_TIMEOUT', requestId: 'a5' });
        });

        test('demo groups keep using the Python mock (no team_context)', async () => {
            await session.handleMessage({ type: 'analytics', action: 'get_team_analytics', requestId: 'a3', data: { group_id: 'test-group-456', team_context: {} } });
            expect(pythonRequests()[0].data).toEqual({ group_id: 'test-group-456' });
            expect(buildTeamContext).not.toHaveBeenCalled();
        });

        test('analytics responses are forwarded with their requestId', async () => {
            llmService.emit(session.sessionId, { event: 'analytics_response', sessionId: session.sessionId, requestId: 'a4', data: { success: true, no_data: true } });
            await new Promise((r) => setImmediate(r));
            expect(lastOfType(ws, 'analytics_response')).toMatchObject({ requestId: 'a4', data: { no_data: true } });
        });
    });

    describe('chat limits and timeouts', () => {
        test('content over 4000 chars → MESSAGE_TOO_LONG, nothing sent, nothing kept in history', async () => {
            await session.handleMessage({ type: 'user', content: 'x'.repeat(4001), requestId: 'm1' });
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'MESSAGE_TOO_LONG', requestId: 'm1' });
            expect(pythonRequests()).toHaveLength(0);
            expect(session.chatHistory).toHaveLength(0);
        });

        test('non-string or blank content is ignored', async () => {
            await session.handleMessage({ type: 'user', content: { $gt: '' } });
            await session.handleMessage({ type: 'user', content: '   ' });
            expect(pythonRequests()).toHaveLength(0);
        });

        test('more than 20 messages per minute → RATE_LIMITED (per user, across sessions)', async () => {
            for (let i = 0; i < 20; i += 1) await session.handleMessage({ type: 'user', content: `m${i}` });
            const other = new UserSession(UID, mockWebSocket());
            await other.handleMessage({ type: 'user', content: 'one more', requestId: 'm21' });
            expect(sent(other.websocket).pop()).toMatchObject({
                code: 'RATE_LIMITED', requestId: 'm21', retryAfterSec: expect.any(Number), message: 'Estás enviando mensajes muy rápido; espera un momento.',
            });
            expect(pythonRequests()).toHaveLength(20);
            expect(other.chatHistory).toHaveLength(0);
            other.cleanup();
        });

        test('no answer within 90 s → LLM_TIMEOUT with the client requestId, kept after the message', async () => {
            jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
            await session.handleMessage({ type: 'user', content: 'hola', requestId: 'c-9' });
            jest.advanceTimersByTime(UserSession.REQUEST_TIMEOUT_MS);
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'LLM_TIMEOUT', requestId: 'c-9' });
            expect(session.chatHistory.map((m) => [m.type, m.code || m.content])).toEqual([['user', 'hola'], ['error', 'LLM_TIMEOUT']]);
        });

        test('a matching response clears the timeout and carries the requestId', async () => {
            jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
            await session.handleMessage({ type: 'user', content: 'hola', requestId: 'c-10' });
            const { requestId } = pythonRequests()[0];
            llmService.emit(session.sessionId, { event: 'response', requestId, sessionId: session.sessionId, data: { content: 'hey' } });
            await new Promise((r) => setImmediate(r));
            jest.advanceTimersByTime(UserSession.REQUEST_TIMEOUT_MS);
            expect(lastOfType(ws, 'assistant')).toMatchObject({ content: 'hey', requestId: 'c-10' });
            expect(lastOfType(ws, 'error')).toBeUndefined();
        });

        test('connection lost while waiting → LLM_ERROR for that request', async () => {
            await session.handleMessage({ type: 'user', content: 'hola', requestId: 'c-11' });
            const { requestId } = pythonRequests()[0];
            llmService.emit(session.sessionId, { event: 'error', sessionId: session.sessionId, requestId, connectionLost: true, error: { code: 'LLM_ERROR', message: 'lost' } });
            await new Promise((r) => setImmediate(r));
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'LLM_ERROR', requestId: 'c-11' });
            expect(session.pendingRequests.size).toBe(0);
        });

        test('assistant_chunk only forwards text content', async () => {
            llmService.emit(session.sessionId, { event: 'response_chunk', sessionId: session.sessionId, data: { content: 'par' } });
            llmService.emit(session.sessionId, { event: 'response_chunk', sessionId: session.sessionId, data: { weird: true } });
            await new Promise((r) => setImmediate(r));
            const chunks = sent(ws).filter((m) => m.type === 'assistant_chunk');
            expect(chunks).toEqual([expect.objectContaining({ content: 'par' })]);
        });
    });

    describe('save_plan gate', () => {
        const emit = async (msg) => {
            llmService.emit(session.sessionId, { sessionId: session.sessionId, ...msg });
            await new Promise((r) => setImmediate(r));
        };
        const saveResults = () => llmService.send.mock.calls.filter(([m]) => m.method === 'save_plan_result');

        test('save_plan without a plan awaiting confirmation is refused and reported to Python', async () => {
            await emit({ event: 'save_plan', requestId: 'sp1', data: { plan: { project_name: 'X' }, original_message: 'x' } });
            expect(projectService.createProjectFromPlan).not.toHaveBeenCalled();
            expect(saveResults()).toEqual([[
                { requestId: 'sp1', sessionId: session.sessionId, method: 'save_plan_result', params: { success: false, errorCode: 'PLAN_NOT_EXPECTED' } },
                { expectReply: false },
            ]]);
        });

        test('after a response awaiting confirmation, save_plan persists and reports success', async () => {
            projectService.createProjectFromPlan.mockResolvedValue({ success: true, groupId: 'G-1' });
            await emit({ event: 'response', requestId: 'r1', data: { content: 'Plan listo, ¿lo guardo?', awaiting_confirmation: true } });
            await emit({ event: 'save_plan', requestId: 'sp2', data: { plan: { project_name: 'Tienda' }, original_message: 'x' } });
            expect(projectService.createProjectFromPlan).toHaveBeenCalledTimes(1);
            expect(saveResults()[0][0]).toEqual({
                requestId: 'sp2', sessionId: session.sessionId, method: 'save_plan_result', params: { success: true, groupId: 'G-1', groupName: 'Tienda' },
            });
            await emit({ event: 'save_plan', requestId: 'sp3', data: { plan: { project_name: 'Tienda' } } });
            expect(projectService.createProjectFromPlan).toHaveBeenCalledTimes(1);
        });

        test('a failed save is reported to Python as failed', async () => {
            projectService.createProjectFromPlan.mockResolvedValue({ success: false, error: 'db' });
            session.awaitingPlanConfirmation = true;
            await emit({ event: 'save_plan', requestId: 'sp4', data: { plan: {} } });
            expect(saveResults()[0][0].params).toEqual({ success: false, errorCode: 'SAVE_FAILED' });
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'SAVE_FAILED' });
        });

        test('the flag is cleared by the next response without awaiting_confirmation', async () => {
            await emit({ event: 'response', data: { content: 'plan', awaiting_confirmation: true } });
            await emit({ event: 'response', data: { content: '¿Qué cambiamos?' } });
            await emit({ event: 'save_plan', requestId: 'sp5', data: { plan: {} } });
            expect(projectService.createProjectFromPlan).not.toHaveBeenCalled();
        });
    });

    describe('repo analysis opt-in and cooldown', () => {
        test('AI analysis disabled for the group → AI_ANALYSIS_DISABLED, cooldown untouched', async () => {
            githubModel.getGroupRepository.mockResolvedValue({ gid: GID, repoId: 500, fullName: 'octo/demo', defaultBranch: 'main', aiAnalysisEnabled: false });
            await session.handleMessage({ type: 'repo_analysis', requestId: 'c1', groupId: GID });
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'AI_ANALYSIS_DISABLED', requestId: 'c1' });
            expect(buildRepoSnapshot).not.toHaveBeenCalled();
            expect(UserSession.lastAnalysisByUser.has(UID)).toBe(false);
        });

        test('snapshot failure → proper GitHub error and the cooldown is given back', async () => {
            const { AppError } = require('../helpers/errors');
            buildRepoSnapshot.mockRejectedValue(new AppError('REPO_EMPTY', 'empty', 409));
            await session.handleMessage({ type: 'repo_analysis', requestId: 'c1', groupId: GID });
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'REPO_EMPTY', requestId: 'c1' });
            expect(UserSession.lastAnalysisByUser.has(UID)).toBe(false);
            expect(pythonRequests()).toHaveLength(0);
            buildRepoSnapshot.mockResolvedValue(SNAPSHOT);
            await session.handleMessage({ type: 'repo_analysis', requestId: 'c2', groupId: GID });
            expect(pythonRequests()).toHaveLength(1);
        });

        test('Python MESSAGE_TOO_LONG on an analysis passes through', async () => {
            await session.handleMessage({ type: 'repo_analysis', requestId: 'c1', groupId: GID });
            const request = pythonRequests()[0];
            llmService.emit(session.sessionId, { event: 'repo_analysis_error', requestId: request.requestId, sessionId: session.sessionId, error: { code: 'MESSAGE_TOO_LONG', message: 'x' } });
            await new Promise((r) => setImmediate(r));
            expect(lastOfType(ws, 'error')).toMatchObject({ code: 'MESSAGE_TOO_LONG' });
        });
    });
});

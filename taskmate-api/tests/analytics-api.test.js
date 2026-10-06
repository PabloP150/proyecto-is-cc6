// REST analytics endpoints: authentication, ownership/leader checks and response shapes.
const { ids, TEAM_CONTEXT, registerMocks, applyDefaults, bearer } = require('./api/support/mocks');

registerMocks();

const request = require('supertest');
const app = require('../app');

const { ALICE, BOB, EVE, GROUP_A, TASK_A, TASK_B, DONE_A, UNKNOWN } = ids;

let m;
beforeEach(() => { m = applyDefaults(); });

const get = (path, userId) => request(app).get(path).set(bearer(userId));
const post = (path, body, userId) => request(app).post(path).set(bearer(userId)).send(body);

test('analytics routes require a token', async () => {
    const res = await request(app).get(`/api/analytics/dashboard/${GROUP_A}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
});

describe('GET /api/analytics/user/:userId (ownership)', () => {
    test('users can read their own analytics', async () => {
        m.analytics.getUserAnalyticsSummary.mockResolvedValue({ total_tasks: 3 });
        const res = await get(`/api/analytics/user/${BOB}`, BOB);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, data: { total_tasks: 3 } });
        expect(m.execQuery.execReadCommand).not.toHaveBeenCalled();
    });

    test("another member's analytics: only via a group the caller leads, scoped to that group", async () => {
        m.analytics.getTeamAnalyticsSummary.mockResolvedValue({
            group_id: GROUP_A,
            team_members: [{ user_id: BOB.toUpperCase(), username: 'bob', active_tasks: 2, completed_tasks: 1 }],
            updated_at: '2026-09-11T00:00:00.000Z',
        });

        const res = await get(`/api/analytics/user/${BOB}?groupId=${GROUP_A}`, ALICE);
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({
            group_id: GROUP_A, user_id: BOB.toUpperCase(), username: 'bob', active_tasks: 2, completed_tasks: 1,
            updated_at: '2026-09-11T00:00:00.000Z',
        });
        expect(m.analytics.getTeamAnalyticsSummary).toHaveBeenCalledWith(GROUP_A);
        // The cross-group summary is never used for someone else
        expect(m.analytics.getUserAnalyticsSummary).not.toHaveBeenCalled();
    });

    test('without groupId → 400; non-leader → 403; target outside the group → 404', async () => {
        m.analytics.getTeamAnalyticsSummary.mockResolvedValue({ team_members: [{ user_id: ALICE }] });

        expect((await get(`/api/analytics/user/${BOB}`, ALICE)).status).toBe(400);

        const notLeader = await get(`/api/analytics/user/${ALICE}?groupId=${GROUP_A}`, BOB);
        expect(notLeader.status).toBe(403);
        expect(notLeader.body.code).toBe('NOT_GROUP_ADMIN');

        // Leading some group gives nothing about users who are not in it
        const outsider = await get(`/api/analytics/user/${EVE}?groupId=${GROUP_A}`, ALICE);
        expect(outsider.status).toBe(404);
        expect(m.analytics.getUserAnalyticsSummary).not.toHaveBeenCalled();
    });

    test('malformed user id → 400', async () => {
        expect((await get('/api/analytics/user/test-user-123', BOB)).status).toBe(400);
    });
});

describe('GET /api/analytics/trends/:userId', () => {
    test('trends are self-only: the ?requesterId bypass is gone and leaders are refused too', async () => {
        const res = await get(`/api/analytics/trends/${ALICE}?requesterId=${ALICE}`, BOB);
        expect(res.status).toBe(403);
        const leader = await get(`/api/analytics/trends/${BOB}`, ALICE);
        expect(leader.status).toBe(403);
        expect(m.analytics.getUserCompletionTrends).not.toHaveBeenCalled();
    });

    test('own trends, days clamped to 1..365', async () => {
        const res = await get(`/api/analytics/trends/${BOB}?days=9999`, BOB);
        expect(res.status).toBe(200);
        expect(m.analytics.getUserCompletionTrends).toHaveBeenCalledWith(BOB, 365);
    });
});

describe('leader-only endpoints (team, workload, expertise, config, dashboard)', () => {
    const LEADER_PATHS = [
        `/api/analytics/dashboard/${GROUP_A}`,
        `/api/analytics/team/${GROUP_A}`,
        `/api/analytics/workload/${GROUP_A}`,
        `/api/analytics/expertise/${GROUP_A}`,
        `/api/analytics/expertise/${GROUP_A}?requesterId=${ALICE}`,
        `/api/analytics/config/${GROUP_A}`,
    ];

    test.each(LEADER_PATHS)('%s: plain members and outsiders get 403', async (path) => {
        for (const userId of [BOB, EVE]) {
            const res = await get(path, userId);
            expect(res.status).toBe(403);
            expect(res.body).toMatchObject({ success: false, code: 'NOT_GROUP_ADMIN' });
        }
    });

    test.each(LEADER_PATHS)('%s: the group admin is a leader', async (path) => {
        expect((await get(path, ALICE)).status).toBe(200);
    });

    test('a member holding a "leader" role is a leader (access.model.isGroupLeader)', async () => {
        m.access.isGroupLeader.mockImplementation(async (uid) => uid === BOB);
        m.analytics.getTeamAnalyticsSummary.mockResolvedValue({ team_members: [] });
        const res = await get(`/api/analytics/team/${GROUP_A}`, BOB);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, data: { team_members: [] } });
    });

    test('config: defaults when no row exists; PUT ignores requesterId in the body', async () => {
        const read = await get(`/api/analytics/config/${GROUP_A}`, ALICE);
        expect(read.body.data).toMatchObject({ group_id: GROUP_A, analytics_enabled: true, privacy_mode: 'team_leader_only' });

        const forged = await request(app).put(`/api/analytics/config/${GROUP_A}`).set(bearer(BOB))
            .send({ requesterId: ALICE, config: { analytics_enabled: false } });
        expect(forged.status).toBe(403);
        // Authorization comes before body validation: a non-leader learns nothing from a bad body
        const badBody = await request(app).put(`/api/analytics/config/${GROUP_A}`).set(bearer(BOB))
            .send({ config: { privacy_mode: 'everyone' } });
        expect(badBody.status).toBe(403);
        expect(m.execQuery.execWriteCommand).not.toHaveBeenCalled();

        const missing = await request(app).put(`/api/analytics/config/${GROUP_A}`).set(bearer(ALICE)).send({});
        expect(missing.status).toBe(400);

        const ok = await request(app).put(`/api/analytics/config/${GROUP_A}`).set(bearer(ALICE))
            .send({ config: { analytics_enabled: false } });
        expect(ok.status).toBe(200);
        expect(ok.body.success).toBe(true);
        expect(m.execQuery.execWriteCommand).toHaveBeenCalledTimes(1);
    });

    test.each([
        [{ privacy_mode: 'everyone' }],
        [{ data_retention_days: 0 }],
        [{ data_retention_days: 3651 }],
        [{ data_retention_days: 30.5 }],
        [{ data_retention_days: '90' }],
    ])('config PUT validates %j before touching the DB', async (config) => {
        const res = await request(app).put(`/api/analytics/config/${GROUP_A}`).set(bearer(ALICE)).send({ config });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(m.execQuery.execWriteCommand).not.toHaveBeenCalled();
    });

    test('config PUT accepts every valid privacy mode and retention bounds', async () => {
        for (const config of [{ privacy_mode: 'team' }, { privacy_mode: 'private', data_retention_days: 1 }, { data_retention_days: 3650 }]) {
            const res = await request(app).put(`/api/analytics/config/${GROUP_A}`).set(bearer(ALICE)).send({ config });
            expect(res.status).toBe(200);
        }
    });

    test('expertise rejects unknown categories', async () => {
        expect((await get(`/api/analytics/expertise/${GROUP_A}?category=cooking`, ALICE)).status).toBe(400);
    });

    test('service failures are generic 500s', async () => {
        m.analytics.getTeamAnalyticsSummary.mockRejectedValue(new Error("Invalid object name 'dbo.TaskAnalytics'"));
        const res = await get(`/api/analytics/team/${GROUP_A}`, ALICE);
        expect(res.status).toBe(500);
        expect(res.body).toEqual({ success: false, error: 'Failed to retrieve team analytics', code: 'INTERNAL_ERROR' });
    });
});

describe('GET /api/analytics/dashboard/:groupId', () => {
    test('leaders get the dashboard with the same shape as before', async () => {
        m.analytics.getTeamAnalyticsSummary.mockResolvedValue({ team_members: [] });
        m.analytics.getWorkloadDistribution.mockResolvedValue({ workload_distribution: [] });
        m.analytics.getCategoryExpertiseRankings.mockResolvedValue({ frontend: [] });

        const res = await get(`/api/analytics/dashboard/${GROUP_A}`, ALICE);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            success: true,
            data: {
                team_analytics: { team_members: [] },
                workload_distribution: { workload_distribution: [] },
                expertise_rankings: { frontend: [] },
                updated_at: expect.any(String),
            },
        });
    });

    test('plain members and outsiders 403 NOT_GROUP_ADMIN (workload/expertise are leader data), malformed id 400', async () => {
        for (const userId of [BOB, EVE]) {
            const denied = await get(`/api/analytics/dashboard/${GROUP_A}`, userId);
            expect(denied.status).toBe(403);
            expect(denied.body.code).toBe('NOT_GROUP_ADMIN');
        }
        expect(m.analytics.getWorkloadDistribution).not.toHaveBeenCalled();
        expect((await get('/api/analytics/dashboard/test-group-456', ALICE)).status).toBe(400);
    });
});

describe('POST /api/analytics/recommendations', () => {
    const body = { groupId: GROUP_A, taskCategory: 'backend', taskDescription: 'Build the API' };

    test('forwards the real team_context to the agent and returns its answer', async () => {
        m.llm.send.mockImplementation(async (message) => {
            setImmediate(() => m.llm.emit(message.sessionId, {
                event: 'analytics_response',
                data: { recommendations: [{ username: 'alice' }], task_category: 'backend' },
            }));
        });

        const res = await post('/api/analytics/recommendations', body, BOB);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            success: true,
            recommendations: [{ username: 'alice' }],
            suggested_plan: null,
            task_category: 'backend',
        });
        expect(m.context.buildTeamContext).toHaveBeenCalledWith(GROUP_A);
        const sent = m.llm.send.mock.calls[0][0];
        expect(sent).toMatchObject({ type: 'analytics', action: 'get_task_assignment_recommendations' });
        expect(sent.data).toMatchObject({ group_id: GROUP_A, task_category: 'backend', team_context: TEAM_CONTEXT });
    });

    test('membership is checked before the body; then fields are validated', async () => {
        expect((await post('/api/analytics/recommendations', body, EVE)).status).toBe(403);
        expect((await post('/api/analytics/recommendations', { groupId: GROUP_A }, EVE)).status).toBe(403);
        expect((await post('/api/analytics/recommendations', { groupId: GROUP_A }, BOB)).status).toBe(400);
        expect((await post('/api/analytics/recommendations', { ...body, taskCategory: 'cooking' }, BOB)).status).toBe(400);
        expect((await post('/api/analytics/recommendations', { ...body, taskDescription: 'x'.repeat(2001) }, BOB)).status).toBe(400);
        expect((await post('/api/analytics/recommendations', { taskCategory: 'backend' }, BOB)).status).toBe(400);
        expect(m.llm.send).not.toHaveBeenCalled();
    });

    test('quota: 10 requests per minute per user', async () => {
        m.llm.send.mockImplementation(async (message) => {
            setImmediate(() => m.llm.emit(message.sessionId, { event: 'analytics_response', data: {} }));
        });
        for (let i = 0; i < 10; i++) {
            expect((await post('/api/analytics/recommendations', body, ALICE)).status).toBe(200);
        }
        const limited = await post('/api/analytics/recommendations', body, ALICE);
        expect(limited.status).toBe(429);
        expect(limited.body.code).toBe('RATE_LIMITED');
    });

    test('send() resolving false fails immediately instead of waiting for the 30 s timeout', async () => {
        m.llm.send.mockResolvedValue(false);
        const started = Date.now();
        const res = await post('/api/analytics/recommendations', body, BOB);
        expect(res.status).toBe(500);
        expect(res.body).toEqual({ success: false, error: 'Failed to get task recommendations', code: 'INTERNAL_ERROR' });
        expect(Date.now() - started).toBeLessThan(2000);
        expect(m.llm.listenerCount(m.llm.send.mock.calls[0][0].sessionId)).toBe(0);
    });

    test('agent errors become a generic 500', async () => {
        m.llm.send.mockImplementation(async (message) => {
            setImmediate(() => m.llm.emit(message.sessionId, { event: 'analytics_error', error: 'Groq key sk-123 invalid' }));
        });
        const res = await post('/api/analytics/recommendations', body, BOB);
        expect(res.status).toBe(500);
        expect(res.body).toEqual({ success: false, error: 'Failed to get task recommendations', code: 'INTERNAL_ERROR' });
    });
});

describe('manual assignment / completion records', () => {
    test('assignment: caller member, task in the group, assignee member', async () => {
        const ok = await post('/api/analytics/assignment', { taskId: TASK_A, userId: BOB, groupId: GROUP_A, category: 'backend' }, ALICE);
        expect(ok.status).toBe(201);
        expect(m.analytics.recordTaskAssignment).toHaveBeenCalledWith(TASK_A, BOB, GROUP_A, 'backend');

        expect((await post('/api/analytics/assignment', { taskId: TASK_A, userId: BOB, groupId: GROUP_A }, EVE)).status).toBe(403);
        // A non-member learns nothing from validation: an incomplete body is still refused with 403.
        expect((await post('/api/analytics/assignment', { taskId: TASK_A, groupId: GROUP_A }, EVE)).status).toBe(403);
        expect((await post('/api/analytics/assignment', { taskId: TASK_B, userId: BOB, groupId: GROUP_A }, ALICE)).status).toBe(404);
        expect((await post('/api/analytics/assignment', { taskId: TASK_A, userId: EVE, groupId: GROUP_A }, ALICE)).status).toBe(400);
        expect((await post('/api/analytics/assignment', { taskId: '123', userId: BOB, groupId: GROUP_A }, ALICE)).status).toBe(400);
        expect((await post('/api/analytics/assignment', { taskId: TASK_A, userId: BOB, groupId: GROUP_A, category: 'x' }, ALICE)).status).toBe(400);
    });

    test('completion: resolves the task group also for completed tasks', async () => {
        expect((await post('/api/analytics/completion', { taskId: TASK_A }, BOB)).status).toBe(200);
        expect((await post('/api/analytics/completion', { taskId: DONE_A, success: false }, BOB)).status).toBe(200);
        expect(m.analytics.recordTaskCompletion).toHaveBeenLastCalledWith(DONE_A, false);

        expect((await post('/api/analytics/completion', { taskId: TASK_A }, EVE)).status).toBe(403);
        const missing = await post('/api/analytics/completion', { taskId: UNKNOWN }, BOB);
        expect(missing.status).toBe(404);
        expect(missing.body.code).toBe('TASK_NOT_FOUND');
    });
});

test('POST /api/analytics/batch-update is no longer exposed', async () => {
    const res = await post('/api/analytics/batch-update', {}, ALICE);
    expect(res.status).toBe(404);
    expect(m.analytics.batchUpdateUserMetrics).not.toHaveBeenCalled();
});

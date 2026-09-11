const { ids, registerMocks, applyDefaults, bearer } = require('./support/mocks');

registerMocks();

const request = require('supertest');
const app = require('../../app');

const { ALICE, BOB, EVE, GROUP_A, TASK_A, TASK_B, DONE_A, NODE_A, UNKNOWN } = ids;

const NODE_TEXT = { name: 'n', description: 'd', date: '2026-09-11' };

let m;
beforeEach(() => { m = applyDefaults(); });

describe('security headers and CORS', () => {
    test('helmet headers are present and X-Powered-By is gone', async () => {
        const res = await request(app).post('/api/users/login').send({});
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-frame-options']).toBeDefined();
        expect(res.headers['content-security-policy']).toBeDefined();
        expect(res.headers['strict-transport-security']).toBeDefined();
        expect(res.headers['x-powered-by']).toBeUndefined();
    });

    test('the frontend origin (default http://localhost:3000) is allowed', async () => {
        const res = await request(app).get(`/api/tasks?gid=${GROUP_A}`)
            .set('Origin', 'http://localhost:3000').set(bearer(ALICE));
        expect(res.status).toBe(200);
        expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    });

    test('preflight from the frontend origin allows the Authorization header', async () => {
        const res = await request(app).options('/api/tasks')
            .set('Origin', 'http://localhost:3000')
            .set('Access-Control-Request-Method', 'POST')
            .set('Access-Control-Request-Headers', 'authorization,content-type');
        expect(res.status).toBe(204);
        expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
        expect(res.headers['access-control-allow-headers']).toMatch(/authorization/i);
    });

    test('a disallowed origin gets no Access-Control-Allow-Origin header', async () => {
        const res = await request(app).get(`/api/tasks?gid=${GROUP_A}`)
            .set('Origin', 'http://evil.example').set(bearer(ALICE));
        expect(res.headers['access-control-allow-origin']).toBeUndefined();

        const preflight = await request(app).options('/api/tasks')
            .set('Origin', 'http://evil.example').set('Access-Control-Request-Method', 'DELETE');
        expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    });

    test('requests without Origin (curl, server-to-server) still work', async () => {
        const res = await request(app).get(`/api/tasks?gid=${GROUP_A}`).set(bearer(ALICE));
        expect(res.status).toBe(200);
    });
});

describe('404 and error handler', () => {
    test('unknown routes answer the JSON error envelope', async () => {
        const res = await request(app).get('/api/does-not-exist');
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ success: false, error: 'Route not found', code: 'NOT_FOUND' });
    });

    test('malformed JSON is a 400 without parser details', async () => {
        const res = await request(app).post('/api/users/login')
            .set('Content-Type', 'application/json').send('{"username": "a",');
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ success: false, error: 'Malformed JSON body', code: 'VALIDATION_ERROR' });
    });

    test('oversized bodies are rejected with 413', async () => {
        const res = await request(app).post('/api/tasks').set(bearer(ALICE))
            .send({ gid: GROUP_A, description: 'x'.repeat(200 * 1024) });
        expect(res.status).toBe(413);
        expect(res.body.code).toBe('VALIDATION_ERROR');
    });
});

describe('POST /api/tasks/:tid/complete', () => {
    test('completes atomically, answers {data:{tid,status}} and fires the analytics hook', async () => {
        const res = await request(app).post(`/api/tasks/${TASK_A}/complete`).set(bearer(BOB));
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ data: { tid: TASK_A, status: 'completed' } });
        expect(m.tasks.completeTask).toHaveBeenCalledWith(TASK_A, { source: 'manual' });
        expect(m.integration.onTaskCompletion).toHaveBeenCalledWith(TASK_A, true, expect.any(Object));
    });

    test('an already completed task (found in Complete) answers already_completed', async () => {
        m.tasks.completeTask.mockResolvedValue({ status: 'already_completed' });
        const res = await request(app).post(`/api/tasks/${DONE_A}/complete`).set(bearer(BOB));
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ tid: DONE_A, status: 'already_completed' });
        expect(m.integration.onTaskCompletion).not.toHaveBeenCalled();
    });

    test('unknown task → 404 TASK_NOT_FOUND (also when the model says not_found)', async () => {
        const unknown = await request(app).post(`/api/tasks/${UNKNOWN}/complete`).set(bearer(BOB));
        expect(unknown.status).toBe(404);
        expect(unknown.body.code).toBe('TASK_NOT_FOUND');
        expect(m.tasks.completeTask).not.toHaveBeenCalled();

        m.tasks.completeTask.mockResolvedValue({ status: 'not_found' });
        const raced = await request(app).post(`/api/tasks/${TASK_A}/complete`).set(bearer(BOB));
        expect(raced.status).toBe(404);
        expect(raced.body.code).toBe('TASK_NOT_FOUND');
    });

    test('non-members get 403 and malformed ids 400', async () => {
        expect((await request(app).post(`/api/tasks/${TASK_A}/complete`).set(bearer(EVE))).status).toBe(403);
        expect((await request(app).post(`/api/tasks/${TASK_B}/complete`).set(bearer(ALICE))).status).toBe(403);
        expect((await request(app).post('/api/tasks/123/complete').set(bearer(ALICE))).status).toBe(400);
    });

    test('an analytics hook failure does not fail the request', async () => {
        m.integration.onTaskCompletion.mockRejectedValue(new Error('analytics down'));
        const res = await request(app).post(`/api/tasks/${TASK_A}/complete`).set(bearer(BOB));
        expect(res.status).toBe(200);
    });

    test('a model failure is a generic 500', async () => {
        m.tasks.completeTask.mockRejectedValue(new Error('Transaction (Process ID 55) was deadlocked'));
        const res = await request(app).post(`/api/tasks/${TASK_A}/complete`).set(bearer(BOB));
        expect(res.status).toBe(500);
        expect(res.body.error).toBe('Internal server error');
    });
});

describe('PUT /api/tasks/nodes/:id (flow editor)', () => {
    test('a node id that is not a task is accepted without touching Tasks', async () => {
        const res = await request(app).put(`/api/tasks/nodes/${NODE_A}`).set(bearer(BOB)).send(NODE_TEXT);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ data: { rowCount: 0, tid: NODE_A } });
        expect(m.tasks.updateTaskFromNode).not.toHaveBeenCalled();
    });

    test('a task id updates the task', async () => {
        const res = await request(app).put(`/api/tasks/nodes/${TASK_A}`).set(bearer(BOB)).send(NODE_TEXT);
        expect(res.status).toBe(200);
        expect(m.tasks.updateTaskFromNode).toHaveBeenCalledWith(expect.objectContaining({ tid: TASK_A, name: 'n' }));
    });
});

describe('POST /api/utils/populate-assignments/:groupId', () => {
    test('admin only; delegates to populateAssignmentsForGroup', async () => {
        const member = await request(app).post(`/api/utils/populate-assignments/${GROUP_A}`).set(bearer(BOB));
        expect(member.status).toBe(403);
        expect(member.body.code).toBe('NOT_GROUP_ADMIN');
        expect(m.usertask.populateAssignmentsForGroup).not.toHaveBeenCalled();

        const result = { assigned: 3, group: 'A', members: 2, totalTasks: 3 };
        m.usertask.populateAssignmentsForGroup.mockResolvedValue(result);
        const admin = await request(app).post(`/api/utils/populate-assignments/${GROUP_A}`).set(bearer(ALICE));
        expect(admin.status).toBe(200);
        expect(admin.body).toEqual({ success: true, group: 'A', members: 2, totalTasks: 3, assignmentsCreated: 3, data: result });
        expect(m.usertask.populateAssignmentsForGroup).toHaveBeenCalledWith(GROUP_A);
    });

    test('malformed group id → 400', async () => {
        const res = await request(app).post('/api/utils/populate-assignments/test-group-456').set(bearer(ALICE));
        expect(res.status).toBe(400);
    });
});

describe('TRUST_PROXY', () => {
    const { createApp } = require('../../app');
    const withEnv = (value, fn) => {
        const previous = process.env.TRUST_PROXY;
        if (value === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = value;
        try { return fn(); } finally {
            if (previous === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = previous;
        }
    };

    test.each([
        [undefined, false],
        ['false', false],
        ['1', 1],
        ['true', true],
        ['loopback', 'loopback'],
    ])('TRUST_PROXY=%s → trust proxy %s', (value, expected) => {
        withEnv(value, () => expect(createApp().get('trust proxy')).toBe(expected));
    });

});

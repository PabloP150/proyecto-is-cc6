// GET /api/tasks and GET /api/tasks/:id send each task's creation time as createdAt (ISO UTC),
// next to the wall-clock datetime, in the order the model returns them; so do the completed and
// deleted lists.
const { ids, registerMocks, applyDefaults, bearer } = require('./support/mocks');

registerMocks();

const request = require('supertest');
const app = require('../../app');

const { ALICE, GROUP_A, TASK_A } = ids;

const row = (tid, name, createdAt) => ({
    tid, gid: GROUP_A, name, description: 'd', list: 'L', datetimeStr: '2026-09-11 10:00', percentage: 0, createdAt,
});

let m;
beforeEach(() => { m = applyDefaults(); });

describe('task creation time in the tasks API', () => {
    test('the list keeps the model order and sends createdAt as an ISO string', async () => {
        m.tasks.getTasksByGroupId.mockResolvedValue([
            // tedious returns a DATETIMEOFFSET as a Date (the absolute instant).
            row(TASK_A, 'Older', new Date('2026-09-01T16:30:00.123Z')),
            row('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Newer', new Date('2026-09-02T08:00:00Z')),
        ]);

        const res = await request(app).get(`/api/tasks?gid=${GROUP_A}`).set(bearer(ALICE));

        expect(res.status).toBe(200);
        expect(res.body.data.map(t => [t.name, t.createdAt, t.datetime])).toEqual([
            ['Older', '2026-09-01T16:30:00.123Z', '2026-09-11T10:00'],
            ['Newer', '2026-09-02T08:00:00.000Z', '2026-09-11T10:00'],
        ]);
    });

    test('a single task carries createdAt too', async () => {
        m.tasks.getTask.mockResolvedValue([row(TASK_A, 'One', new Date('2026-09-01T16:30:00Z'))]);

        const res = await request(app).get(`/api/tasks/${TASK_A}`).set(bearer(ALICE));

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual(expect.objectContaining({ name: 'One', createdAt: '2026-09-01T16:30:00.000Z' }));
    });

    test.each([
        ['completed', '/api/completados', 'complete', 'getCompletados'],
        ['deleted', '/api/delete', 'deleted', 'getEliminados'],
    ])('the %s list keeps the model order and sends createdAt as an ISO string', async (_, path, model, fn) => {
        m[model][fn].mockResolvedValue([
            { tid: TASK_A, gid: GROUP_A, name: 'Older', datetime: '2026-09-11T10:00', createdAt: new Date('2026-09-01T16:30:00Z') },
            { tid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', gid: GROUP_A, name: 'Newer', datetime: '2026-09-11T10:00', createdAt: new Date('2026-09-02T08:00:00Z') },
        ]);

        const res = await request(app).get(`${path}/${GROUP_A}`).set(bearer(ALICE));

        expect(res.status).toBe(200);
        expect(res.body.data.map(t => [t.name, t.createdAt])).toEqual([
            ['Older', '2026-09-01T16:30:00.000Z'],
            ['Newer', '2026-09-02T08:00:00.000Z'],
        ]);
    });
});

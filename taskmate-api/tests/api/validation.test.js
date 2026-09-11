const { ids, registerMocks, applyDefaults, bearer } = require('./support/mocks');

registerMocks();

const request = require('supertest');
const app = require('../../app');

const { ALICE, BOB, GROUP_A, TASK_A, NODE_A, ROLE_A } = ids;

const TASK = { gid: GROUP_A, name: 'Task', description: 'd', list: 'L', datetime: '2026-09-11T10:00', percentage: 0 };
const NODE = { gid: GROUP_A, name: 'Node', description: 'd', date: '2026-09-11', x_pos: 10, y_pos: 10 };

let m;
beforeEach(() => { m = applyDefaults(); });

const send = (method, path, body, userId = BOB) => request(app)[method](path).set(bearer(userId)).send(body);

const expect400 = async (method, path, body, userId, messagePattern) => {
    const res = await send(method, path, body, userId);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    if (messagePattern) expect(res.body.error).toMatch(messagePattern);
    return res;
};

describe('tasks', () => {
    test.each([
        [{ name: undefined }, /name is required/],
        [{ name: '   ' }, /name is required/],
        [{ name: 'x'.repeat(26) }, /name must be at most 25/],
        [{ name: '😀'.repeat(13) }, /name must be at most 25/], // 26 UTF-16 units: NVARCHAR(25) would truncate
        [{ list: undefined }, /list is required/],
        [{ list: 'l'.repeat(26) }, /list must be at most 25/],
        [{ description: 'd'.repeat(1001) }, /description must be at most 1000/],
        [{ description: 42 }, /description must be text/],
        [{ percentage: 101 }, /percentage must be an integer between 0 and 100/],
        [{ percentage: -1 }, /percentage/],
        [{ percentage: 5.5 }, /percentage/],
        [{ percentage: 'abc' }, /percentage/],
        [{ datetime: undefined }, /datetime is required/],
        [{ datetime: 'tomorrow' }, /datetime must be a date/],
        [{ datetime: '2026-02-30T10:00' }, /datetime is not a valid date/],
        [{ datetime: '2026-09-11T25:00' }, /datetime is not a valid date/],
        [{ datetime: '2080-01-01T00:00' }, /datetime is not a valid date/], // beyond SMALLDATETIME
        [{ datetime: '1899-12-31' }, /datetime is not a valid date/],
    ])('POST /api/tasks %j → 400', async (patch, message) => {
        await expect400('post', '/api/tasks', { ...TASK, ...patch }, BOB, message);
        expect(m.tasks.addTask).not.toHaveBeenCalled();
    });

    test('non-Latin-1 text and numeric-string percentages are accepted', async () => {
        const res = await send('post', '/api/tasks', { ...TASK, name: 'Diseño 設計 ✓', list: 'Лист', percentage: '50' });
        expect(res.status).toBe(200);
        expect(m.tasks.addTask).toHaveBeenCalledWith(expect.objectContaining({ name: 'Diseño 設計 ✓', list: 'Лист', percentage: 50, gid: GROUP_A }));
    });

    test('missing description/percentage get the same defaults the model used', async () => {
        const { description, percentage, ...rest } = TASK;
        expect((await send('post', '/api/tasks', rest)).status).toBe(200);
        expect(m.tasks.addTask).toHaveBeenCalledWith(expect.objectContaining({ description: '', percentage: 0 }));
    });

    test('PUT /api/tasks/:id validates the same fields', async () => {
        await expect400('put', `/api/tasks/${TASK_A}`, { ...TASK, percentage: 150 }, BOB, /percentage/);
        await expect400('put', `/api/tasks/${TASK_A}`, { ...TASK, datetime: '11/09/2026' }, BOB, /datetime/);
        expect(m.tasks.updateTask).not.toHaveBeenCalled();
        expect((await send('put', `/api/tasks/${TASK_A}`, TASK)).status).toBe(200);
    });

    test('PUT /api/tasks/nodes/:id validates name/description/date', async () => {
        await expect400('put', `/api/tasks/nodes/${TASK_A}`, { name: 'n', date: 'nope' }, BOB, /date/);
        await expect400('put', `/api/tasks/nodes/${TASK_A}`, { name: 'n'.repeat(26), date: '2026-09-11' }, BOB, /name/);
        expect(m.tasks.updateTaskFromNode).not.toHaveBeenCalled();
    });
});

describe('nodes', () => {
    test.each([
        [{ date: '2026-13-01' }, /date is not a valid date/],
        [{ date: undefined }, /date is required/],
        [{ name: 'n'.repeat(26) }, /name must be at most 25/],
        [{ description: 'd'.repeat(1001) }, /description must be at most 1000/],
        [{ x_pos: 'left' }, /x_pos must be a number/],
        [{ y_pos: undefined }, /y_pos is required/],
        [{ percentage: 200 }, /percentage/],
        [{ completed: 'maybe' }, /completed must be true\/false or 1\/0/],
    ])('POST /api/nodes %j → 400', async (patch, message) => {
        await expect400('post', '/api/nodes', { ...NODE, ...patch }, BOB, message);
        expect(m.nodes.addNode).not.toHaveBeenCalled();
    });

    test('a valid node is created with normalized values', async () => {
        const res = await send('post', '/api/nodes', { ...NODE, completed: 0, x_pos: '12.5' });
        expect(res.status).toBe(200);
        expect(m.nodes.addNode).toHaveBeenCalledWith(expect.objectContaining({ completed: false, x_pos: 12.5, percentage: 0 }));
    });

    test.each([
        ['put', `/api/nodes/${NODE_A}`, { name: 'n', date: '2026-02-29' }],
        ['put', `/api/nodes/${NODE_A}/coords`, { x_pos: 1 }],
        ['put', `/api/nodes/${NODE_A}/percentage`, { percentage: '101' }],
        ['put', `/api/nodes/${NODE_A}/toggleComplete`, { completed: 2 }],
    ])('%s %s %j → 400', async (method, path, body) => {
        await expect400(method, path, body, BOB);
    });
});

describe('group roles', () => {
    const rolesPath = `/api/grouproles/groups/${GROUP_A}/roles`;

    test.each([
        [{}, /gr_name is required/],
        [{ gr_name: 'r'.repeat(41) }, /gr_name must be at most 40/],
        [{ gr_name: 'Dev', gr_color: 'c'.repeat(21) }, /gr_color must be at most 20/],
        [{ gr_name: 'Dev', gr_icon: 'i'.repeat(41) }, /gr_icon must be at most 40/],
        [{ gr_name: ['Dev'] }, /gr_name must be text/],
    ])('POST roles %j → 400', async (body, message) => {
        await expect400('post', rolesPath, body, ALICE, message);
        expect(m.groupRoles.addGroupRole).not.toHaveBeenCalled();
    });

    test('limits are inclusive and non-Latin-1 names are fine', async () => {
        const res = await send('post', rolesPath, { gr_name: 'Líder 队长', gr_color: '#'.padEnd(20, 'f'), gr_icon: 'i'.repeat(40) }, ALICE);
        expect(res.status).toBe(201);
        expect(m.groupRoles.addGroupRole).toHaveBeenCalledWith(expect.objectContaining({ gr_name: 'Líder 队长', gid: GROUP_A }));
    });

    test('PUT roles requires gr_name too', async () => {
        await expect400('put', `${rolesPath}/${ROLE_A}`, { gr_color: 'red' }, ALICE, /gr_name is required/);
        expect(m.groupRoles.updateGroupRole).not.toHaveBeenCalled();
    });

    test('non-admins are refused before their body is looked at', async () => {
        const res = await send('post', rolesPath, {}, BOB);
        expect(res.status).toBe(403);
    });
});

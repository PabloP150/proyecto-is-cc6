const { ids, registerMocks, applyDefaults, bearer } = require('./support/mocks');

registerMocks();

const request = require('supertest');
const app = require('../../app');

const { ALICE, BOB, EVE, GROUP_A, GROUP_B, TASK_A, TASK_B, NODE_A, NODE_A2, NODE_B, EDGE_A, ROLE_A, ROLE_B, UGR_A, UGR_B, UNKNOWN } = ids;

const TASK_BODY = { name: 'n', list: 'L', datetime: '2026-09-11T10:00', percentage: 0 };
const NODE_TEXT = { name: 'n', description: 'd', date: '2026-09-11' };

const call = (method, path, body, userId) => {
    let req = request(app)[method](path);
    if (userId) req = req.set(bearer(userId));
    return body === undefined ? req : req.send(body);
};

// [method, path, body, expected status for an authorized member]
const MEMBER_ROUTES = [
    ['get', `/api/tasks?gid=${GROUP_A}`, undefined, 200],
    ['get', `/api/tasks/${TASK_A}`, undefined, 200],
    ['post', '/api/tasks', { gid: GROUP_A, ...TASK_BODY }, 200],
    ['put', `/api/tasks/${TASK_A}`, { gid: GROUP_A, ...TASK_BODY }, 200],
    ['put', `/api/tasks/nodes/${TASK_A}`, NODE_TEXT, 200],
    ['post', `/api/tasks/${TASK_A}/complete`, undefined, 200],
    ['delete', `/api/tasks/list/${GROUP_A}/L`, undefined, 200],
    ['get', `/api/groups/${GROUP_A}/members`, undefined, 200],
    ['get', `/api/groups/${GROUP_A}/roles`, undefined, 200],
    ['delete', '/api/groups/leave', { gid: GROUP_A }, 200],
    ['get', `/api/nodes/tasks/${GROUP_A}`, undefined, 200],
    ['get', `/api/nodes/group/${GROUP_A}`, undefined, 200],
    ['get', `/api/nodes/${NODE_A}`, undefined, 200],
    ['post', '/api/nodes', { gid: GROUP_A, ...NODE_TEXT, x_pos: 10, y_pos: 10 }, 200],
    ['put', `/api/nodes/${NODE_A}`, NODE_TEXT, 200],
    ['put', `/api/nodes/${NODE_A}/coords`, { x_pos: 1, y_pos: 2 }, 200],
    ['put', `/api/nodes/${NODE_A}/percentage`, { percentage: 5 }, 200],
    ['put', `/api/nodes/${NODE_A}/toggleComplete`, { completed: 1 }, 200],
    ['delete', `/api/nodes/${NODE_A}`, undefined, 200],
    ['post', '/api/edges', { gid: GROUP_A, sourceId: NODE_A, targetId: NODE_A2 }, 200],
    ['get', `/api/edges/group/${GROUP_A}`, undefined, 200],
    ['get', `/api/edges/${EDGE_A}`, undefined, 200],
    ['put', `/api/edges/${EDGE_A}`, { prerequisite: 0 }, 200],
    ['delete', `/api/edges/${EDGE_A}`, undefined, 200],
    ['delete', `/api/edges/source/${NODE_A}`, undefined, 200],
    ['get', `/api/completados/${GROUP_A}`, undefined, 200],
    ['delete', `/api/completados/${GROUP_A}`, undefined, 200],
    ['get', `/api/delete/${GROUP_A}`, undefined, 200],
    ['delete', `/api/delete/${GROUP_A}`, undefined, 200],
    ['post', '/api/usertask', { uid: BOB, tid: TASK_A, completed: true }, 200],
    ['delete', `/api/usertask?uid=${BOB}&tid=${TASK_A}`, undefined, 200],
    ['get', `/api/usertask?tid=${TASK_A}`, undefined, 200],
    ['get', `/api/grouproles/groups/${GROUP_A}/roles`, undefined, 200],
    ['get', `/api/usergrouproles/groups/${GROUP_A}/userroles`, undefined, 200],
    ['get', `/api/usergrouproles/groups/${GROUP_A}/rolesmatrix`, undefined, 200],
    ['get', `/api/usergrouproles/groups/${GROUP_A}/users/${BOB}/roles`, undefined, 200],
    ['get', `/api/usergrouproles/groups/${GROUP_A}/users/${BOB}/roles/${ROLE_A}`, undefined, 200],
    ['get', `/api/usergrouproles/groups/${GROUP_A}/roles/${ROLE_A}/users`, undefined, 200],
    ['get', `/api/usergrouproles/groups/${GROUP_A}/roles/${ROLE_A}/count`, undefined, 200],
];

const ADMIN_ROUTES = [
    ['post', '/api/groups/join', { uid: EVE, gid: GROUP_A }, 200],
    ['delete', '/api/groups/remove-member', { uid: BOB, gid: GROUP_A }, 200],
    ['delete', '/api/groups/delete', { gid: GROUP_A, adminId: BOB }, 200],
    ['post', `/api/grouproles/groups/${GROUP_A}/roles`, { gr_name: 'leader' }, 201],
    ['put', `/api/grouproles/groups/${GROUP_A}/roles/${ROLE_A}`, { gr_name: 'x' }, 200],
    ['delete', `/api/grouproles/groups/${GROUP_A}/roles/${ROLE_A}`, undefined, 200],
    ['post', `/api/usergrouproles/groups/${GROUP_A}/userroles`, { uid: BOB, gr_id: ROLE_A }, 201],
    ['delete', `/api/usergrouproles/groups/${GROUP_A}/userroles/${UGR_A}`, undefined, 200],
    ['delete', `/api/usergrouproles/groups/${GROUP_A}/userroles`, { uid: BOB, gr_id: ROLE_A }, 200],
    ['post', `/api/utils/populate-assignments/${GROUP_A}`, undefined, 200],
    ['get', `/api/analytics/dashboard/${GROUP_A}`, undefined, 200],
];

let m;
beforeEach(() => { m = applyDefaults(); });

describe('every /api route except register/login requires a token', () => {
    test.each([...MEMBER_ROUTES, ...ADMIN_ROUTES, ['post', '/api/groups/group', { name: 'g' }, 201], ['get', '/api/groups/user-groups', undefined, 200], ['get', '/api/users/getuid?username=x', undefined, 200]])(
        '%s %s → 401', async (method, path, body) => {
            const res = await call(method, path, body);
            expect(res.status).toBe(401);
            expect(res.body.code).toBe('UNAUTHENTICATED');
        });
});

describe('group-scoped routes: members allowed, non-members 403', () => {
    test.each(MEMBER_ROUTES)('%s %s', async (method, path, body, okStatus) => {
        const denied = await call(method, path, body, EVE);
        expect(denied.status).toBe(403);
        expect(denied.body).toMatchObject({ success: false, code: 'NOT_GROUP_MEMBER' });

        const allowed = await call(method, path, body, BOB);
        expect(allowed.status).toBe(okStatus);
    });
});

describe('admin routes: admin allowed, plain members 403', () => {
    test.each(ADMIN_ROUTES)('%s %s', async (method, path, body, okStatus) => {
        const denied = await call(method, path, body, BOB);
        expect(denied.status).toBe(403);
        expect(denied.body.code).toBe('NOT_GROUP_ADMIN');

        const outsider = await call(method, path, body, EVE);
        expect(outsider.status).toBe(403);

        const allowed = await call(method, path, body, ALICE);
        expect(allowed.status).toBe(okStatus);
    });
});

describe('acting user comes from the token, never from the request', () => {
    test('POST /api/groups/group ignores adminId from the body', async () => {
        const res = await call('post', '/api/groups/group', { adminId: EVE, name: 'Mine' }, BOB);
        expect(res.status).toBe(201);
        expect(res.body).toEqual({ message: 'Group created successfully', gid: expect.any(String) });
        expect(m.group.createGroupWithAdmin).toHaveBeenCalledWith({ gid: res.body.gid, adminId: BOB, name: 'Mine' });
        expect(m.group.addGroup).not.toHaveBeenCalled();
    });

    test('GET /api/groups/user-groups ignores ?uid', async () => {
        const res = await call('get', `/api/groups/user-groups?uid=${ALICE}`, undefined, EVE);
        expect(res.status).toBe(200);
        expect(m.group.getGroupsByUserId).toHaveBeenCalledWith(EVE);
    });

    test('DELETE /api/groups/leave removes the caller, not the body uid', async () => {
        const res = await call('delete', '/api/groups/leave', { uid: ALICE, gid: GROUP_A }, BOB);
        expect(res.status).toBe(200);
        expect(m.userGroup.leaveGroup).toHaveBeenCalledWith(BOB, GROUP_A);
    });

    test('DELETE /api/groups/delete uses the caller as adminId even if the body lies', async () => {
        const lie = await call('delete', '/api/groups/delete', { gid: GROUP_A, adminId: ALICE }, BOB);
        expect(lie.status).toBe(403);
        expect(m.group.deleteGroup).not.toHaveBeenCalled();

        const ok = await call('delete', '/api/groups/delete', { gid: GROUP_A, adminId: BOB }, ALICE);
        expect(ok.status).toBe(200);
        expect(m.group.deleteGroup).toHaveBeenCalledWith(GROUP_A, ALICE);
    });

    test('target uids stay in the body: assigning a task / adding a member', async () => {
        await call('post', '/api/usertask', { uid: BOB, tid: TASK_A, completed: true }, ALICE).expect(200);
        expect(m.usertask.addUsertask).toHaveBeenCalledWith(expect.objectContaining({ uid: BOB, tid: TASK_A }));

        await call('post', '/api/groups/join', { uid: EVE, gid: GROUP_A }, ALICE).expect(200);
        expect(m.userGroup.addUserToGroup).toHaveBeenCalledWith({ uid: EVE, gid: GROUP_A });
    });

    test('a target that is not a member of the group is rejected', async () => {
        const res = await call('post', '/api/usertask', { uid: EVE, tid: TASK_A }, ALICE);
        expect(res.status).toBe(400);
        expect(m.usertask.addUsertask).not.toHaveBeenCalled();

        const role = await call('post', `/api/usergrouproles/groups/${GROUP_A}/userroles`, { uid: EVE, gr_id: ROLE_A }, ALICE);
        expect(role.status).toBe(400);
    });
});

describe('validation and not-found', () => {
    test.each([
        ['get', '/api/tasks/not-a-uuid', undefined],
        ['get', '/api/tasks?gid=123', undefined],
        ['get', '/api/tasks', undefined],
        ['get', '/api/nodes/group/undefined', undefined],
        ['put', `/api/nodes/${NODE_A.slice(0, 30)}/coords`, { x_pos: 1 }],
        ['post', '/api/edges', { gid: GROUP_A, sourceId: 'x', targetId: NODE_A2 }],
        ['get', `/api/usergrouproles/groups/${GROUP_A}/users/nope/roles`, undefined],
        ['post', '/api/usertask', { uid: 'nope', tid: TASK_A }],
    ])('%s %s → 400 VALIDATION_ERROR', async (method, path, body) => {
        const res = await call(method, path, body, ALICE);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    test('the same id in query and body must not differ', async () => {
        const res = await call('delete', `/api/usertask?uid=${BOB}&tid=${TASK_A}`, { uid: BOB, tid: TASK_B }, ALICE);
        expect(res.status).toBe(400);
        expect(m.usertask.deleteUsertask).not.toHaveBeenCalled();
    });

    test.each([
        ['get', `/api/tasks/${UNKNOWN}`, undefined, 'TASK_NOT_FOUND'],
        ['post', `/api/tasks/${UNKNOWN}/trash`, undefined, 'TASK_NOT_FOUND'],
        ['put', `/api/nodes/${UNKNOWN}/coords`, { x_pos: 1 }, 'NOT_FOUND'],
        ['delete', `/api/edges/${UNKNOWN}`, undefined, 'NOT_FOUND'],
        ['put', `/api/grouproles/groups/${GROUP_A}/roles/${ROLE_B}`, { gr_name: 'x' }, 'NOT_FOUND'],
        ['delete', `/api/usergrouproles/groups/${GROUP_A}/userroles/${UGR_B}`, undefined, 'NOT_FOUND'],
        ['post', `/api/usergrouproles/groups/${GROUP_A}/userroles`, { uid: BOB, gr_id: ROLE_B }, 'NOT_FOUND'],
    ])('%s %s → 404 %s', async (method, path, body, code) => {
        const res = await call(method, path, body, ALICE);
        expect(res.status).toBe(404);
        expect(res.body.code).toBe(code);
    });

    test('resources of another group are 403, even for an admin of this one', async () => {
        const res = await call('get', `/api/tasks/${TASK_B}`, undefined, ALICE);
        expect(res.status).toBe(403);
        expect(m.tasks.getTask).not.toHaveBeenCalled();
    });

    test.each([
        ['put', `/api/tasks/${TASK_A}`, { gid: GROUP_B, ...TASK_BODY }],
        ['post', '/api/nodes', { gid: GROUP_A, nid: TASK_B, ...NODE_TEXT, x_pos: 1, y_pos: 1 }],
        ['post', '/api/edges', { gid: GROUP_A, sourceId: NODE_A, targetId: NODE_B }],
    ])('cross-group references are rejected: %s %s', async (method, path, body) => {
        const res = await call(method, path, body, ALICE);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    test.each([
        ['post', '/api/completados', { gid: GROUP_A, tid: TASK_A }],
        ['post', '/api/delete', { gid: GROUP_A, tid: TASK_A }],
        ['delete', `/api/tasks/${TASK_A}`, undefined],
        ['get', `/api/usertask/getutid?tid=${TASK_A}&uid=${BOB}`, undefined],
        ['post', '/api/analytics/batch-update', {}],
    ])('removed route %s %s → 404', async (method, path, body) => {
        const res = await call(method, path, body, ALICE);
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('NOT_FOUND');
    });

    test('GET /api/nodes (all nodes of every group) no longer exists', async () => {
        const res = await call('get', '/api/nodes', undefined, ALICE);
        expect(res.status).toBe(404);
        expect(m.nodes.getAllNodes).not.toHaveBeenCalled();
    });
});

describe('500s do not leak driver/database text', () => {
    test.each([
        ['get', `/api/tasks?gid=${GROUP_A}`, undefined, (mm) => mm.tasks.getTasksByGroupId],
        ['post', '/api/edges', { gid: GROUP_A, sourceId: NODE_A, targetId: NODE_A2 }, (mm) => mm.edges.addEdge],
        ['get', `/api/groups/${GROUP_A}/members`, undefined, (mm) => mm.userGroup.getMembersByGroupId],
        ['post', `/api/grouproles/groups/${GROUP_A}/roles`, { gr_name: 'x' }, (mm) => mm.groupRoles.addGroupRole],
    ])('%s %s', async (method, path, body, pick) => {
        pick(m).mockRejectedValue(Object.assign(new Error("Invalid object name 'dbo.Secret'. Login failed for user 'sa'"), { number: 208 }));
        const res = await call(method, path, body, ALICE);
        expect(res.status).toBe(500);
        expect(res.body).toEqual({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    });

    test('an access-model failure is a 500, not a silent 403', async () => {
        m.access.isGroupMember.mockRejectedValue(new Error('ETIMEOUT connecting to db-host:1433'));
        const res = await call('get', `/api/tasks?gid=${GROUP_A}`, undefined, ALICE);
        expect(res.status).toBe(500);
        expect(JSON.stringify(res.body)).not.toMatch(/ETIMEOUT|1433/);
    });
});

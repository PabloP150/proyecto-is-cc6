const { ids, registerMocks, applyDefaults, bearer } = require('./support/mocks');

registerMocks();

const request = require('supertest');
const app = require('../../app');
const { AppError } = require('../../helpers/errors');

const { ALICE, BOB, EVE, GROUP_A, TASK_A, TASK_B, NODE_A, NODE_A2, ROLE_A, UNKNOWN } = ids;

const sqlError = (number, message) => Object.assign(new Error(message), { number });
const uniqueViolation = () => sqlError(2627, "Violation of UNIQUE KEY constraint 'UQ_Secret'. Cannot insert duplicate key in object 'dbo.X'");
const fkViolation = () => sqlError(547, 'The INSERT statement conflicted with the FOREIGN KEY constraint "FK_Secret". table "dbo.Y"');
const busy = () => new AppError('DB_BUSY', 'The database is busy, please try again', 503);

let m;
beforeEach(() => { m = applyDefaults(); });

const call = (method, path, body, userId = ALICE) => {
    const req = request(app)[method](path).set(bearer(userId));
    return body === undefined ? req : req.send(body);
};

describe('POST /api/tasks/:tid/trash', () => {
    test('trashes atomically and refreshes analytics best-effort', async () => {
        const res = await call('post', `/api/tasks/${TASK_A}/trash`, undefined, BOB);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ data: { tid: TASK_A, status: 'deleted' } });
        expect(m.tasks.trashTask).toHaveBeenCalledWith(TASK_A);
        expect(m.integration.onTaskDeletion).toHaveBeenCalledWith(TASK_A);
        expect(m.deleted.addDelete).not.toHaveBeenCalled();
        expect(m.tasks.deleteTask).not.toHaveBeenCalled();
    });

    test('not_found from the model (lost race) → 404 TASK_NOT_FOUND, no hook', async () => {
        m.tasks.trashTask.mockResolvedValue({ status: 'not_found' });
        const res = await call('post', `/api/tasks/${TASK_A}/trash`, undefined, BOB);
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('TASK_NOT_FOUND');
        expect(m.integration.onTaskDeletion).not.toHaveBeenCalled();
    });

    test('unknown task 404, other group 403, non-member 403, malformed 400', async () => {
        expect((await call('post', `/api/tasks/${UNKNOWN}/trash`)).body.code).toBe('TASK_NOT_FOUND');
        expect((await call('post', `/api/tasks/${TASK_B}/trash`)).status).toBe(403);
        expect((await call('post', `/api/tasks/${TASK_A}/trash`, undefined, EVE)).status).toBe(403);
        expect((await call('post', '/api/tasks/nope/trash')).status).toBe(400);
        expect(m.tasks.trashTask).not.toHaveBeenCalled();
    });

    test('a failing analytics hook does not fail the request', async () => {
        m.integration.onTaskDeletion.mockRejectedValue(new Error('metrics down'));
        expect((await call('post', `/api/tasks/${TASK_A}/trash`, undefined, BOB)).status).toBe(200);
    });
});

describe('model AppErrors pass through sendError unchanged', () => {
    test.each([
        ['post', `/api/tasks/${TASK_A}/trash`, undefined, (mm) => mm.tasks.trashTask],
        ['post', `/api/tasks/${TASK_A}/complete`, undefined, (mm) => mm.tasks.completeTask],
        ['delete', `/api/tasks/list/${GROUP_A}/L`, undefined, (mm) => mm.tasks.deleteTasksByList],
        ['delete', `/api/nodes/${NODE_A}`, undefined, (mm) => mm.nodes.deleteNode],
        ['delete', '/api/groups/delete', { gid: GROUP_A }, (mm) => mm.group.deleteGroup],
        ['post', '/api/groups/group', { name: 'g' }, (mm) => mm.group.createGroupWithAdmin],
        ['delete', '/api/groups/leave', { gid: GROUP_A }, (mm) => mm.userGroup.leaveGroup],
        ['delete', `/api/usertask?uid=${BOB}&tid=${TASK_A}`, undefined, (mm) => mm.usertask.deleteUsertask],
        ['delete', `/api/grouproles/groups/${GROUP_A}/roles/${ROLE_A}`, undefined, (mm) => mm.groupRoles.deleteGroupRole],
        ['post', `/api/utils/populate-assignments/${GROUP_A}`, undefined, (mm) => mm.usertask.populateAssignmentsForGroup],
    ])('%s %s → 503 DB_BUSY', async (method, path, body, pick) => {
        pick(m).mockRejectedValue(busy());
        const res = await call(method, path, body);
        expect(res.status).toBe(503);
        expect(res.body).toEqual({ success: false, error: 'The database is busy, please try again', code: 'DB_BUSY' });
    });
});

describe('SQL constraint violations become client errors', () => {
    test.each([
        ['post', `/api/grouproles/groups/${GROUP_A}/roles`, { gr_name: 'Dev' }, (mm) => mm.groupRoles.addGroupRole, 'DUPLICATE_ROLE'],
        ['put', `/api/grouproles/groups/${GROUP_A}/roles/${ROLE_A}`, { gr_name: 'Dev' }, (mm) => mm.groupRoles.updateGroupRole, 'DUPLICATE_ROLE'],
        ['post', `/api/usergrouproles/groups/${GROUP_A}/userroles`, { uid: BOB, gr_id: ROLE_A }, (mm) => mm.userGroupRoles.assignRoleToUser, 'DUPLICATE_ROLE_ASSIGNMENT'],
        ['post', '/api/edges', { gid: GROUP_A, sourceId: NODE_A, targetId: NODE_A2 }, (mm) => mm.edges.addEdge, 'DUPLICATE_EDGE'],
    ])('unique: %s %s → 409 %s', async (method, path, body, pick, code) => {
        pick(m).mockRejectedValue(uniqueViolation());
        const res = await call(method, path, body);
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ success: false, code });
        expect(JSON.stringify(res.body)).not.toMatch(/UQ_Secret|dbo\./);
    });

    test.each([
        ['post', `/api/usergrouproles/groups/${GROUP_A}/userroles`, { uid: BOB, gr_id: ROLE_A }, (mm) => mm.userGroupRoles.assignRoleToUser],
        ['post', '/api/edges', { gid: GROUP_A, sourceId: NODE_A, targetId: NODE_A2 }, (mm) => mm.edges.addEdge],
    ])('foreign key: %s %s → 400 VALIDATION_ERROR', async (method, path, body, pick) => {
        pick(m).mockRejectedValue(fkViolation());
        const res = await call(method, path, body);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(JSON.stringify(res.body)).not.toMatch(/FK_Secret|dbo\./);
    });

    test('driver errors wrapped in AggregateError / cause are still recognised', async () => {
        m.groupRoles.addGroupRole.mockRejectedValue(new AggregateError([uniqueViolation()], 'Multiple errors'));
        expect((await call('post', `/api/grouproles/groups/${GROUP_A}/roles`, { gr_name: 'Dev' })).status).toBe(409);

        m.edges.addEdge.mockRejectedValue(new Error('request failed', { cause: fkViolation() }));
        expect((await call('post', '/api/edges', { gid: GROUP_A, sourceId: NODE_A, targetId: NODE_A2 })).status).toBe(400);
    });

    test('other constraint errors (CHECK) and FK errors on unmapped routes stay generic 500s', async () => {
        m.groupRoles.addGroupRole.mockRejectedValue(sqlError(547, 'The INSERT statement conflicted with the CHECK constraint "CK_Secret"'));
        const check = await call('post', `/api/grouproles/groups/${GROUP_A}/roles`, { gr_name: 'Dev' });
        expect(check.status).toBe(500);
        expect(check.body.code).toBe('INTERNAL_ERROR');

        m.groupRoles.addGroupRole.mockRejectedValue(fkViolation());
        expect((await call('post', `/api/grouproles/groups/${GROUP_A}/roles`, { gr_name: 'Dev' })).status).toBe(500);
    });
});

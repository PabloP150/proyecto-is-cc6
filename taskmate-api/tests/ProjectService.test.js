// Unit tests for ProjectService.addPlanToGroup with the models and the transaction mocked.
// The same flow runs against SQL Server in db/project.dbtest.js.
jest.mock('../models/nodes.model', () => ({ addNode: jest.fn(), getNodeLayout: jest.fn() }));
jest.mock('../models/tasks.model', () => ({ addTask: jest.fn() }));
jest.mock('../models/group.model', () => ({ addGroup: jest.fn() }));
jest.mock('../models/userGroup.model', () => ({ addUserToGroup: jest.fn() }));
jest.mock('../models/groupRoles.model', () => ({ addGroupRole: jest.fn() }));
jest.mock('../models/access.model', () => ({ isGroupMember: jest.fn() }));
jest.mock('../helpers/transaction', () => ({
    withTransaction: jest.fn(), isFkViolation: jest.fn(), isUniqueViolation: jest.fn(),
}));

const projectService = require('../services/ProjectService');
const nodeModel = require('../models/nodes.model');
const taskModel = require('../models/tasks.model');
const { isGroupMember } = require('../models/access.model');
const { withTransaction } = require('../helpers/transaction');

const GID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';
const TX = { id: 'tx' };

const plan = {
    summary: 's',
    milestones: [
        { key: 'm1', name: 'Desarrollo', description: 'd', target_date: '2030-01-10' },
        { key: 'm2', name: 'Pruebas', description: 'd', target_date: '2030-02-10' },
        { key: 'm3', name: 'Despliegue', description: 'd', target_date: '2030-03-10' },
    ],
    tasks: [{ name: 'Login', description: 'd', milestone_key: 'm1', due_date: '2030-01-05' }],
};

const insertedPositions = () => nodeModel.addNode.mock.calls.map(([node]) => ({ x: node.x_pos, y: node.y_pos }));
const row = (y) => [{ x: 0, y }, { x: 250, y }, { x: 500, y }];
// Cards with a one-line description, like the hand-placed ones of E-Component.
const shortCard = (y_pos) => ({ y_pos, descriptionLength: 1 });

beforeEach(() => {
    withTransaction.mockImplementation(async (fn) => fn(TX));
    isGroupMember.mockResolvedValue(true);
    nodeModel.getNodeLayout.mockResolvedValue([]);
    nodeModel.addNode.mockResolvedValue(1);
    taskModel.addTask.mockResolvedValue(1);
});

describe('ProjectService.addPlanToGroup node placement', () => {
    test('a group without nodes gets the plan on the first row (y = 0)', async () => {
        const { nodeIds } = await projectService.addPlanToGroup(GID, plan, UID);
        expect(nodeIds).toHaveLength(3);
        expect(nodeModel.getNodeLayout).toHaveBeenCalledWith(GID, { tx: TX });
        expect(insertedPositions()).toEqual(row(0));
    });

    // [0]: a second analysis of a group holding only the first plan's row; [81, 397]: E-Component's cards.
    test.each([
        [[0, 0, 0], 300],
        [[81, 397], 697],
        [[93.5], 393.5],
        [[-120], 180],
    ])('short cards at y = %p → new row at y = %p, 300 below the lowest, x still 250 apart', async (ys, rowY) => {
        nodeModel.getNodeLayout.mockResolvedValue(ys.map(shortCard));
        await projectService.addPlanToGroup(GID, plan, UID);
        expect(insertedPositions()).toEqual(row(rowY));
    });

    test('a description of a few lines (what the AI writes) keeps the 300 spacing', async () => {
        nodeModel.getNodeLayout.mockResolvedValue([{ y_pos: 397, descriptionLength: 40 }]);
        await projectService.addPlanToGroup(GID, plan, UID);
        expect(insertedPositions()).toEqual(row(697));
    });

    test('a card with a long description pushes the row below its bottom, not just its top', async () => {
        // 600 characters = 40 lines of at most 15: 170 + 23 * 40 = 1090px tall, then a 60px gap.
        nodeModel.getNodeLayout.mockResolvedValue([shortCard(81), { y_pos: 397, descriptionLength: 600 }]);
        await projectService.addPlanToGroup(GID, plan, UID);
        expect(insertedPositions()).toEqual(row(397 + 1090 + 60));
    });

    test('a tall card higher up counts even when a short card sits lower', async () => {
        nodeModel.getNodeLayout.mockResolvedValue([{ y_pos: 81, descriptionLength: 1000 }, shortCard(397)]);
        await projectService.addPlanToGroup(GID, plan, UID);
        expect(insertedPositions()).toEqual(row(81 + 170 + 23 * 67 + 60));
    });

    // Worst case measured in Chrome (two-line name, "✓ Completed"): [description length, card height].
    test.each([
        [1, 191], [20, 214], [40, 237], [50, 237], [100, 306], [200, 444], [400, 698], [600, 951], [1000, 1458],
    ])('a card with a %p-character description (%ppx tall) still leaves a gap', async (descriptionLength, height) => {
        nodeModel.getNodeLayout.mockResolvedValue([{ y_pos: 0, descriptionLength }]);
        await projectService.addPlanToGroup(GID, plan, UID);
        expect(insertedPositions()[0].y).toBeGreaterThanOrEqual(height + 50);
    });

    test('reads the positions inside the transaction, after the membership check and before any insert', async () => {
        await projectService.addPlanToGroup(GID, plan, UID);
        const [readOrder] = nodeModel.getNodeLayout.mock.invocationCallOrder;
        expect(isGroupMember.mock.invocationCallOrder[0]).toBeLessThan(readOrder);
        nodeModel.addNode.mock.invocationCallOrder.forEach(order => expect(order).toBeGreaterThan(readOrder));
        taskModel.addTask.mock.invocationCallOrder.forEach(order => expect(order).toBeGreaterThan(readOrder));
        nodeModel.addNode.mock.calls.forEach(([, options]) => expect(options).toEqual({ tx: TX }));
    });

    test('a plan with only tasks does not read (or lock) the group nodes', async () => {
        const { taskIds, nodeIds } = await projectService.addPlanToGroup(GID, { tasks: plan.tasks }, UID);
        expect(taskIds).toHaveLength(1);
        expect(nodeIds).toEqual([]);
        expect(nodeModel.getNodeLayout).not.toHaveBeenCalled();
        expect(taskModel.addTask).toHaveBeenCalledWith(expect.objectContaining({ list: 'GitHub' }), { tx: TX });
    });

    test('a non-member is rejected before the nodes are read', async () => {
        isGroupMember.mockResolvedValue(false);
        await expect(projectService.addPlanToGroup(GID, plan, UID))
            .rejects.toEqual(expect.objectContaining({ code: 'NOT_GROUP_MEMBER', status: 403 }));
        expect(nodeModel.getNodeLayout).not.toHaveBeenCalled();
        expect(nodeModel.addNode).not.toHaveBeenCalled();
    });

    test('a failed position read writes nothing and propagates', async () => {
        nodeModel.getNodeLayout.mockRejectedValue(new Error('lock timeout'));
        await expect(projectService.addPlanToGroup(GID, plan, UID)).rejects.toThrow('lock timeout');
        expect(nodeModel.addNode).not.toHaveBeenCalled();
        expect(taskModel.addTask).not.toHaveBeenCalled();
    });

    test('a retried transaction places the row from a fresh read', async () => {
        // After a deadlock withTransaction re-runs the whole callback.
        withTransaction.mockImplementation(async (fn) => {
            await fn(TX);
            nodeModel.addNode.mockClear();
            return fn(TX);
        });
        nodeModel.getNodeLayout.mockResolvedValueOnce([shortCard(0)]).mockResolvedValueOnce([shortCard(0), shortCard(600)]);
        await projectService.addPlanToGroup(GID, plan, UID);
        expect(insertedPositions()).toEqual(row(900));
    });
});

describe('ProjectService.fillEmptyGroupFromPlan', () => {
    const groupRolesModel = require('../models/groupRoles.model');
    const recommendations = {
        recommendations: {
            project_name: 'Tienda online',
            roles: [{ name: 'Frontend', color: '#123456', icon: 'code' }, { name: 'Backend' }],
            tasks: [{ name: 'Carrito', description: 'd', due_date: '2030-01-05' }],
            milestones: [{ name: 'MVP', description: 'd', date: '2030-02-01' }],
        },
    };
    const makeTx = (group, roles = []) => ({
        read: jest.fn(async (sql) => (sql.includes('GroupRoles') ? roles : group ? [group] : [])),
        write: jest.fn(async () => 1),
    });
    const EMPTY = { isAdmin: 1, tasks: 0, completed: 0, deleted: 0, nodes: 0, repos: 0 };

    beforeEach(() => {
        groupRolesModel.addGroupRole.mockReset().mockResolvedValue(1);
        taskModel.addTask.mockClear();
        nodeModel.addNode.mockClear();
    });

    test('an empty group the user administers takes the project name, roles, tasks and milestones', async () => {
        const tx = makeTx(EMPTY);
        withTransaction.mockImplementation(async (fn) => fn(tx));
        const result = await projectService.fillEmptyGroupFromPlan(GID, recommendations, 'x', UID);
        expect(result).toEqual({ success: true, groupId: GID, groupName: 'Tienda online', filled: true });
        const [sql, params] = tx.write.mock.calls[0];
        expect(sql).toMatch(/UPDATE dbo\.Groups SET name = @name WHERE gid = @gid/);
        // NVarChar like group.model's INSERT: a VarChar parameter would turn non-Latin-1 characters into '?'.
        expect(params).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'name', value: 'Tienda online', type: require('tedious').TYPES.NVarChar })]));
        expect(groupRolesModel.addGroupRole).toHaveBeenCalledTimes(2);
        expect(taskModel.addTask).toHaveBeenCalledWith(expect.objectContaining({ gid: GID, name: 'Carrito' }), { tx });
        expect(nodeModel.addNode).toHaveBeenCalledWith(expect.objectContaining({ gid: GID, name: 'MVP' }), { tx });
    });

    test.each([
        ['not its admin', { ...EMPTY, isAdmin: 0 }, 'NOT_ADMIN'],
        ['it has tasks', { ...EMPTY, tasks: 1 }, 'NOT_EMPTY'],
        // Regression (review): a group whose tasks were all completed counted as empty and was renamed.
        ['all its tasks are completed', { ...EMPTY, completed: 3 }, 'NOT_EMPTY'],
        ['its tasks are in the trash', { ...EMPTY, deleted: 1 }, 'NOT_EMPTY'],
        ['it has milestones', { ...EMPTY, nodes: 2 }, 'NOT_EMPTY'],
        ['it has a repository', { ...EMPTY, repos: 1 }, 'NOT_EMPTY'],
        ['the group does not exist', null, 'NOT_EMPTY'],
    ])('%s → not filled, nothing written', async (_name, group, reason) => {
        const tx = makeTx(group);
        withTransaction.mockImplementation(async (fn) => fn(tx));
        expect(await projectService.fillEmptyGroupFromPlan(GID, recommendations, 'x', UID)).toEqual({ success: false, notEligible: true, reason });
        expect(tx.write).not.toHaveBeenCalled();
        expect(taskModel.addTask).not.toHaveBeenCalled();
    });

    test('roles the group already has are not added twice', async () => {
        const tx = makeTx(EMPTY, [{ gr_name: 'frontend ' }]); // trailing space: still the same role for SQL
        withTransaction.mockImplementation(async (fn) => fn(tx));
        await projectService.fillEmptyGroupFromPlan(GID, recommendations, 'x', UID);
        expect(groupRolesModel.addGroupRole.mock.calls.map(([role]) => role.gr_name)).toEqual(['Backend']);
    });

    test('an invalid plan is refused before touching the database', async () => {
        expect(await projectService.fillEmptyGroupFromPlan(GID, { recommendations: { project_name: 'X', tasks: 'no' } }, 'x', UID))
            .toMatchObject({ success: false, error: 'Invalid or missing tasks array' });
        expect(withTransaction).not.toHaveBeenCalledWith(expect.any(Function));
    });
});

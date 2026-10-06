const { v4: uuidv4 } = require('uuid');
const { TYPES } = require('tedious');
const projectService = require('../../services/ProjectService');
const nodesModel = require('../../models/nodes.model');
const tasksModel = require('../../models/tasks.model');
const userModel = require('../../models/user.model');
const { execReadCommand } = require('../../helpers/execQuery');
const h = require('./helpers');

const byName = (name) => [{ name: 'name', type: TYPES.VarChar, value: name }];

describe('ProjectService.createProjectFromPlan', () => {
    it('creates group, membership, roles, tasks and milestones; keeps Unicode, truncates to the columns', async () => {
        const user = await h.createUser('prj');
        const name = `P${Date.now() % 1e8}`;
        const result = await projectService.createProjectFromPlan({
            project_name: name,
            roles: [{ name: 'Dev', icon: '💻' }, { name: 'dev' }, { name: 'QA' }],
            tasks: [{ name: 'Diseño 🚀 UI', description: 'x'.repeat(1500), due_date: '2030-05-01' }, { task: 'API' }],
            milestones: [{ name: 'M1', date: '2030-06-01' }, { name: 'M2' }],
        }, 'msg', user.uid);

        expect(result).toEqual({ success: true, groupId: expect.any(String), groupName: name });
        const p = [h.guid('gid', result.groupId)];
        expect(await h.count('dbo.UserGroups WHERE gid = @gid', p)).toBe(1);
        expect(await h.count('dbo.GroupRoles WHERE gid = @gid', p)).toBe(2);
        const tasks = await execReadCommand('SELECT name, LEN(description) AS len FROM dbo.Tasks WHERE gid = @gid ORDER BY name', p);
        expect(tasks).toEqual([{ name: 'API', len: 0 }, { name: 'Diseño 🚀 UI', len: 1000 }]);
        const nodes = await execReadCommand('SELECT name, x_pos FROM dbo.Nodes WHERE gid = @gid ORDER BY x_pos', p);
        expect(nodes).toEqual([{ name: 'M1', x_pos: 0 }, { name: 'M2', x_pos: 250 }]);
    });

    it('is all-or-nothing: a failure on the last insert leaves no rows at all', async () => {
        const user = await h.createUser('prj');
        const name = `F${Date.now() % 1e8}`;
        const spy = jest.spyOn(nodesModel, 'addNode')
            .mockImplementationOnce((node, options) => jest.requireActual('../../models/nodes.model').addNode.call(null, node, options))
            .mockImplementationOnce(async (node, { tx }) => tx.write('SELECT 1/0'));
        try {
            const result = await projectService.createProjectFromPlan({
                project_name: name, roles: [{ name: 'Dev' }], tasks: [{ name: 'T1' }, { name: 'T2' }],
                milestones: [{ name: 'M1' }, { name: 'M2' }],
            }, 'msg', user.uid);
            expect(result.success).toBe(false);
        } finally {
            spy.mockRestore();
        }
        expect(await h.count('dbo.Groups WHERE name = @name', byName(name))).toBe(0);
        expect(await h.count('dbo.UserGroups WHERE uid = @uid', [h.guid('uid', user.uid)])).toBe(0);
    });

    it('reports an unknown user as a reference error', async () => {
        const result = await projectService.createProjectFromPlan({ project_name: 'x', tasks: [] }, 'msg', uuidv4());
        expect(result).toEqual({ success: false, error: 'Invalid user ID or database reference error' });
    });
});

describe('ProjectService.addPlanToGroup', () => {
    const plan = {
        summary: 's',
        milestones: [
            { key: 'm1', name: 'Autenticación y sesiones seguras', description: 'd', target_date: '2030-01-10' },
            { key: 'm2', name: 'Deploy', description: 'd', target_date: '2030-02-10' },
        ],
        tasks: [
            { name: 'Login', description: 'd', milestone_key: 'm1', due_date: '2030-01-05', category: 'backend' },
            { name: 'CI', description: 'd', milestone_key: null, due_date: '2030-01-06', category: 'testing' },
            { name: 'Docker', description: 'd', milestone_key: 'm2', due_date: '2030-02-01', category: 'general' },
        ],
    };

    it('creates nodes at x = 250*i (first row of an empty group) and tasks listed under their milestone or GitHub', async () => {
        const user = await h.createUser('plan');
        const gid = await h.createGroup(user.uid);
        const { taskIds, nodeIds } = await projectService.addPlanToGroup(gid, plan, user.uid);
        expect(taskIds).toHaveLength(3);
        expect(nodeIds).toHaveLength(2);
        const p = [h.guid('gid', gid)];
        const nodes = await execReadCommand('SELECT name, x_pos, y_pos, CONVERT(VARCHAR(10), date, 23) AS date FROM dbo.Nodes WHERE gid = @gid ORDER BY x_pos', p);
        expect(nodes).toEqual([
            { name: 'Autenticación y sesion...', x_pos: 0, y_pos: 0, date: '2030-01-10' },
            { name: 'Deploy', x_pos: 250, y_pos: 0, date: '2030-02-10' },
        ]);
        const tasks = await execReadCommand('SELECT name, list FROM dbo.Tasks WHERE gid = @gid ORDER BY name', p);
        expect(tasks).toEqual([
            { name: 'CI', list: 'GitHub' },
            { name: 'Docker', list: 'Deploy' },
            { name: 'Login', list: 'Autenticación y sesion...' },
        ]);
    });

    it('puts each new plan in a row below the lowest existing milestone instead of on top of them', async () => {
        const user = await h.createUser('plan');
        const gid = await h.createGroup(user.uid);
        expect(await nodesModel.getNodeLayout(gid)).toEqual([]);
        // Hand-placed cards like E-Component's.
        const placed = (name, x_pos, y_pos) => nodesModel.addNode({ nid: uuidv4(), gid, name, description: 'd', date: '2030-01-01', x_pos, y_pos });
        await placed('Testing', 157, 81);
        await placed('Development', 166, 397);

        await projectService.addPlanToGroup(gid, plan, user.uid);
        await projectService.addPlanToGroup(gid, plan, user.uid);

        const nodes = await execReadCommand('SELECT name, x_pos, y_pos FROM dbo.Nodes WHERE gid = @gid ORDER BY y_pos, x_pos', [h.guid('gid', gid)]);
        expect(nodes).toEqual([
            { name: 'Testing', x_pos: 157, y_pos: 81 },
            { name: 'Development', x_pos: 166, y_pos: 397 },
            { name: 'Autenticación y sesion...', x_pos: 0, y_pos: 697 },
            { name: 'Deploy', x_pos: 250, y_pos: 697 },
            { name: 'Autenticación y sesion...', x_pos: 0, y_pos: 997 },
            { name: 'Deploy', x_pos: 250, y_pos: 997 },
        ]);
        const layout = await nodesModel.getNodeLayout(gid);
        expect(layout.map(n => n.y_pos).sort((a, b) => a - b)).toEqual([81, 397, 697, 697, 997, 997]);
        expect(layout.every(n => n.descriptionLength === 1)).toBe(true);
    });

    it('puts the new row below the bottom of a card with a long description', async () => {
        const user = await h.createUser('plan');
        const gid = await h.createGroup(user.uid);
        await nodesModel.addNode({ nid: uuidv4(), gid, name: 'Docs', description: 'palabra '.repeat(75).trim(), date: '2030-01-01', x_pos: 166, y_pos: 397 });

        await projectService.addPlanToGroup(gid, plan, user.uid);

        // 599 characters → at most 40 lines: 170 + 23 * 40 = 1090px tall, plus the 60px gap.
        const rows = await execReadCommand('SELECT DISTINCT y_pos FROM dbo.Nodes WHERE gid = @gid ORDER BY y_pos', [h.guid('gid', gid)]);
        expect(rows).toEqual([{ y_pos: 397 }, { y_pos: 397 + 1090 + 60 }]);
    });

    it('two plans saved at the same time take different rows', async () => {
        const user = await h.createUser('plan');
        const gid = await h.createGroup(user.uid);
        await Promise.all([
            projectService.addPlanToGroup(gid, plan, user.uid),
            projectService.addPlanToGroup(gid, plan, user.uid),
        ]);
        const rows = await execReadCommand('SELECT y_pos, COUNT(*) AS n FROM dbo.Nodes WHERE gid = @gid GROUP BY y_pos ORDER BY y_pos', [h.guid('gid', gid)]);
        expect(rows).toEqual([{ y_pos: 0, n: 2 }, { y_pos: 300, n: 2 }]);
    });

    it('rejects non-members and invalid plans without writing anything', async () => {
        const owner = await h.createUser('plan');
        const outsider = await h.createUser('plan');
        const gid = await h.createGroup(owner.uid);
        await expect(projectService.addPlanToGroup(gid, plan, outsider.uid))
            .rejects.toEqual(expect.objectContaining({ code: 'NOT_GROUP_MEMBER', status: 403 }));
        const badDate = { ...plan, tasks: [...plan.tasks, { name: 'X', due_date: '2030-02-31' }] };
        await expect(projectService.addPlanToGroup(gid, badDate, owner.uid))
            .rejects.toEqual(expect.objectContaining({ code: 'VALIDATION_ERROR', status: 400 }));
        await expect(projectService.addPlanToGroup(gid, { tasks: [] }, owner.uid))
            .rejects.toEqual(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
        expect(await h.count('dbo.Tasks WHERE gid = @gid', [h.guid('gid', gid)])).toBe(0);
        expect(await h.count('dbo.Nodes WHERE gid = @gid', [h.guid('gid', gid)])).toBe(0);
    });

    it('rolls back the nodes when a later task insert fails', async () => {
        const user = await h.createUser('plan');
        const gid = await h.createGroup(user.uid);
        const real = jest.requireActual('../../models/tasks.model').addTask;
        let calls = 0;
        const spy = jest.spyOn(tasksModel, 'addTask').mockImplementation(async (task, options) => {
            calls += 1;
            if (calls === 3) return options.tx.write('SELECT 1/0');
            return real(task, options);
        });
        try {
            await expect(projectService.addPlanToGroup(gid, plan, user.uid)).rejects.toThrow(/divide by zero/i);
        } finally {
            spy.mockRestore();
        }
        expect(await h.count('dbo.Tasks WHERE gid = @gid', [h.guid('gid', gid)])).toBe(0);
        expect(await h.count('dbo.Nodes WHERE gid = @gid', [h.guid('gid', gid)])).toBe(0);
    });
});

describe('user.registerUserWithPersonalGroup', () => {
    it('creates user, personal group and membership atomically; duplicates are VALIDATION_ERROR', async () => {
        const username = `reg_${Date.now() % 1e8}`;
        const make = () => ({ uid: uuidv4(), username, passwordHash: 'h', gid: uuidv4(), groupName: 'Personal' });
        const attempts = [make(), make()];
        const results = await Promise.allSettled(attempts.map(a => userModel.registerUserWithPersonalGroup(a)));
        const ok = results.filter(r => r.status === 'fulfilled');
        const failed = results.filter(r => r.status === 'rejected');
        expect(ok).toHaveLength(1);
        expect(failed).toHaveLength(1);
        expect(failed[0].reason).toEqual(expect.objectContaining({ code: 'VALIDATION_ERROR', status: 400 }));

        const { uid, gid } = ok[0].value;
        expect(await h.count('dbo.Users WHERE username = @name', byName(username))).toBe(1);
        expect(await h.count('dbo.Groups WHERE gid = @gid AND adminId = @uid', [h.guid('gid', gid), h.guid('uid', uid)])).toBe(1);
        expect(await h.count('dbo.UserGroups WHERE gid = @gid AND uid = @uid', [h.guid('gid', gid), h.guid('uid', uid)])).toBe(1);
        const loser = attempts.find(a => a.gid !== gid);
        expect(await h.count('dbo.Groups WHERE gid = @gid', [h.guid('gid', loser.gid)])).toBe(0);
    });
});

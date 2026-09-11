const { v4: uuidv4 } = require('uuid');
const tasksModel = require('../../models/tasks.model');
const nodesModel = require('../../models/nodes.model');
const groupModel = require('../../models/group.model');
const groupRolesModel = require('../../models/groupRoles.model');
const userModel = require('../../models/user.model');
const projectService = require('../../services/ProjectService');
const { execReadCommand } = require('../../helpers/execQuery');
const h = require('./helpers');

// Stored as 'Tarea ? ??' while the columns were VARCHAR (migration 005 made them NVARCHAR).
const TEXT = 'Tarea ✓ 漢字';

describe('NVARCHAR round-trip through the models', () => {
    let user; let gid;
    beforeAll(async () => {
        user = await h.createUser('uni');
        gid = await h.createGroup(user.uid);
    });

    it('tasks, nodes, groups and roles keep non-Latin-1 text', async () => {
        const tid = uuidv4();
        await tasksModel.addTask({ tid, gid, name: TEXT, description: `${TEXT} 🚀`, list: 'Lista ✓', datetime: '2030-01-01', percentage: 0 });
        const [task] = await tasksModel.getTask(tid);
        expect(task).toEqual(expect.objectContaining({ name: TEXT, description: `${TEXT} 🚀`, list: 'Lista ✓' }));
        expect((await tasksModel.getTasksByGroupId(gid)).map(t => t.name)).toContain(TEXT);

        const nid = uuidv4();
        await nodesModel.addNode({ nid, gid, name: '漢字 hito', description: 'ñandú ✓', date: '2030-01-01', x_pos: 0, y_pos: 0 });
        const [node] = await nodesModel.getNode(nid);
        expect(node).toEqual(expect.objectContaining({ name: '漢字 hito', description: 'ñandú ✓' }));

        const newGid = uuidv4();
        await groupModel.createGroupWithAdmin({ gid: newGid, adminId: user.uid, name: 'Equipo ✓ 漢' });
        expect((await groupModel.getGroupById(newGid)).name).toBe('Equipo ✓ 漢');

        await groupRolesModel.addGroupRole({ gr_id: uuidv4(), gid, gr_name: 'Líder ✓ 漢字', gr_color: '#fff', gr_icon: 'integration_instructions' });
        const roles = await groupRolesModel.getGroupRoles(gid);
        expect(roles).toEqual(expect.arrayContaining([expect.objectContaining({ gr_name: 'Líder ✓ 漢字', gr_icon: 'integration_instructions' })]));
    });

    it('Complete and DeleteTask keep the text when a task is completed or trashed', async () => {
        const done = await h.createTask(gid, { name: TEXT, description: '完了 ✓' });
        const trashed = await h.createTask(gid, { name: '削除 ✓', description: TEXT });
        await tasksModel.completeTask(done);
        await tasksModel.trashTask(trashed);
        const [complete] = await execReadCommand('SELECT name, description FROM dbo.Complete WHERE tid = @tid', [h.guid('tid', done)]);
        const [deleted] = await execReadCommand('SELECT name, description FROM dbo.DeleteTask WHERE tid = @tid', [h.guid('tid', trashed)]);
        expect(complete).toEqual({ name: TEXT, description: '完了 ✓' });
        expect(deleted).toEqual({ name: '削除 ✓', description: TEXT });
    });

    it('usernames are Unicode and still unique', async () => {
        const username = `漢字✓${Date.now() % 1e6}`;
        const reg = { uid: uuidv4(), username, passwordHash: 'h', gid: uuidv4(), groupName: 'Personal ✓' };
        await userModel.registerUserWithPersonalGroup(reg);
        const [found] = await userModel.getUserByUsername(username);
        expect(found.username).toBe(username);
        await expect(userModel.registerUserWithPersonalGroup({ ...reg, uid: uuidv4(), gid: uuidv4() }))
            .rejects.toEqual(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    });

    it('AI project creation keeps Unicode names and accepts long icon names', async () => {
        const result = await projectService.createProjectFromPlan({
            project_name: 'Proyecto ✓ 漢字',
            roles: [{ name: 'Integración 🔌', icon: 'integration_instructions' }],
            tasks: [{ name: 'Diseño 🚀 UI', description: '説明' }],
            milestones: [{ name: 'Hito ✓' }],
        }, 'msg', user.uid);
        expect(result).toEqual(expect.objectContaining({ success: true, groupName: 'Proyecto ✓ 漢字' }));
        const p = [h.guid('gid', result.groupId)];
        expect((await execReadCommand('SELECT name FROM dbo.Tasks WHERE gid = @gid', p))[0].name).toBe('Diseño 🚀 UI');
        expect((await execReadCommand('SELECT gr_name, gr_icon FROM dbo.GroupRoles WHERE gid = @gid', p))[0])
            .toEqual({ gr_name: 'Integración 🔌', gr_icon: 'integration_instructions' });
    });

    it('truncation never splits a surrogate pair', async () => {
        const result = await projectService.createProjectFromPlan({
            project_name: 'x', tasks: [{ name: `${'a'.repeat(21)}🚀🚀🚀` }],
        }, 'msg', user.uid);
        const [row] = await execReadCommand('SELECT name FROM dbo.Tasks WHERE gid = @gid', [h.guid('gid', result.groupId)]);
        expect(row.name).toBe(`${'a'.repeat(21)}...`);
    });
});

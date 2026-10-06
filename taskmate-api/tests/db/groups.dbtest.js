const groupModel = require('../../models/group.model');
const userGroupModel = require('../../models/userGroup.model');
const nodesModel = require('../../models/nodes.model');
const groupRolesModel = require('../../models/groupRoles.model');
const access = require('../../models/access.model');
const github = require('../../models/github.model');
const { execReadCommand, execWriteCommand } = require('../../helpers/execQuery');
const h = require('./helpers');

// A group with at least one row in every table that depends on it.
async function populatedGroup() {
    const admin = await h.createUser('grp');
    const member = await h.createUser('grp');
    const gid = await h.createGroup(admin.uid);
    await h.addMember(member.uid, gid);
    const tid = await h.createTask(gid);
    await h.assignTask(member.uid, tid, gid);
    const n1 = await h.createNode(gid);
    const n2 = await h.createNode(gid);
    await h.createEdge(gid, n1, n2);
    const grId = await h.createRole(gid, 'Leader');
    await h.assignRole(member.uid, gid, grId);
    const p = [h.guid('gid', gid)];
    await execWriteCommand(`INSERT INTO dbo.Complete (tid, gid, name, description, percentage, datetime)
                            VALUES (NEWID(), @gid, 'c', 'd', 100, '2030-01-01')`, p);
    await execWriteCommand(`INSERT INTO dbo.DeleteTask (tid, gid, name, description, datetime, percentage)
                            VALUES (NEWID(), @gid, 'x', 'd', '2030-01-01', 0)`, p);
    await execWriteCommand('INSERT INTO dbo.AnalyticsConfig (gid) VALUES (@gid)', p);
    const installationId = h.githubId();
    const repoId = h.githubId();
    await github.upsertInstallation({ installationId, accountLogin: 'octo', accountType: 'Organization' });
    await github.upsertRepository({ repoId, installationId, name: 'r', defaultBranch: 'main', isPrivate: true });
    await github.linkGroupRepository({ gid, repoId, connectedBy: admin.uid });
    await github.insertTaskBranch({ tid, repoId, branchName: `tm/g-${tid.slice(0, 8)}`, baseSha: 'b'.repeat(40), createdBy: member.uid });
    return { admin, member, gid, tid, grId, repoId };
}

const GROUP_TABLES = [
    'dbo.Groups', 'dbo.UserGroups', 'dbo.Tasks', 'dbo.Nodes', 'dbo.Edges', 'dbo.GroupRoles',
    'dbo.UserGroupRoles', 'dbo.Complete', 'dbo.DeleteTask', 'dbo.TaskAnalytics', 'dbo.AnalyticsConfig', 'dbo.GroupRepositories',
];
const remainingRows = async (gid) => {
    const out = {};
    for (const table of GROUP_TABLES) out[table] = await h.count(`${table} WHERE gid = @gid`, [h.guid('gid', gid)]);
    return out;
};
const allZero = (counts) => Object.values(counts).every(n => n === 0);

describe('group.createGroupWithAdmin / getGroupById', () => {
    it('creates the group with its admin as member, atomically', async () => {
        const admin = await h.createUser('new');
        const gid = require('uuid').v4();
        await expect(groupModel.createGroupWithAdmin({ gid, adminId: admin.uid, name: 'Nuevo' })).resolves.toEqual({ gid });
        expect(await access.isGroupAdmin(admin.uid, gid)).toBe(true);
        expect(await groupModel.getGroupById(gid)).toEqual(expect.objectContaining({ name: 'Nuevo' }));
        expect(await groupModel.getGroupById('00000000-0000-0000-0000-000000000000')).toBeNull();

        const ghostGid = require('uuid').v4();
        await expect(groupModel.createGroupWithAdmin({ gid: ghostGid, adminId: require('uuid').v4(), name: 'x' })).rejects.toThrow(/FOREIGN KEY/);
        expect(await groupModel.getGroupById(ghostGid)).toBeNull();
    });
});

describe('group.deleteGroup', () => {
    it('deletes the group and every dependent row in one transaction', async () => {
        const { admin, gid, tid, repoId } = await populatedGroup();
        await expect(groupModel.deleteGroup(gid, admin.uid)).resolves.toEqual({ success: true });
        expect(allZero(await remainingRows(gid))).toBe(true);
        expect(await h.count('dbo.UserTask WHERE tid = @tid', [h.guid('tid', tid)])).toBe(0);
        expect(await h.count('dbo.TaskBranches WHERE tid = @tid', [h.guid('tid', tid)])).toBe(0);
        // The repository itself belongs to the installation, not to the group.
        expect(await github.deleteRepository(repoId)).toBe(true);
    });

    it('refuses a non-admin without touching anything', async () => {
        const { member, gid } = await populatedGroup();
        await expect(groupModel.deleteGroup(gid, member.uid)).rejects.toEqual(expect.objectContaining({ code: 'NOT_GROUP_ADMIN' }));
        expect((await remainingRows(gid))['dbo.Tasks']).toBe(1);
    });
});

describe('userGroup.leaveGroup / removeMemberFromGroup', () => {
    it('a member leaves (their role assignments go too)', async () => {
        const { member, gid } = await populatedGroup();
        await expect(userGroupModel.leaveGroup(member.uid, gid)).resolves.toEqual({ success: true, result: 'left', newAdminId: null });
        expect(await access.isGroupMember(member.uid, gid)).toBe(false);
        expect(await h.count('dbo.UserGroupRoles WHERE uid = @uid', [h.guid('uid', member.uid)])).toBe(0);
    });

    it('the admin leaves: admin passes to the next member', async () => {
        const { admin, member, gid } = await populatedGroup();
        const result = await userGroupModel.leaveGroup(admin.uid, gid);
        expect(result.result).toBe('transferred');
        expect(h.sameId(result.newAdminId, member.uid)).toBe(true);
        expect(await access.isGroupAdmin(member.uid, gid)).toBe(true);
    });

    it('the last member leaves: the whole group is deleted (used to reference dbo.Completados)', async () => {
        const { admin, member, gid } = await populatedGroup();
        await userGroupModel.removeMemberFromGroup(member.uid, gid);
        await expect(userGroupModel.leaveGroup(admin.uid, gid)).resolves.toEqual(expect.objectContaining({ result: 'deleted' }));
        expect(allZero(await remainingRows(gid))).toBe(true);
    });

    it('removing the admin hands the group to the next member', async () => {
        const { admin, member, gid } = await populatedGroup();
        await userGroupModel.removeMemberFromGroup(admin.uid, gid);
        expect(await access.isGroupAdmin(member.uid, gid)).toBe(true);
        expect(await access.isGroupMember(admin.uid, gid)).toBe(false);
    });
});

describe('admin succession', () => {
    // A username like "!a" sorts first alphabetically; it must not inherit the group.
    async function groupWithJoinOrder() {
        const admin = await h.createUser('adm');
        const veteran = await h.createUser('zzz');
        const newcomer = await h.createUser('!a');
        const gid = await h.createGroup(admin.uid);
        await h.addMember(veteran.uid, gid);
        await h.addMember(newcomer.uid, gid);
        await h.setJoinedAt(admin.uid, gid, '2026-01-01T00:00:00Z');
        await h.setJoinedAt(veteran.uid, gid, '2026-02-01T00:00:00Z');
        await h.setJoinedAt(newcomer.uid, gid, '2026-03-01T00:00:00Z');
        return { admin, veteran, newcomer, gid };
    }

    it('leaveGroup hands the group to the earliest member, not the first username', async () => {
        const { admin, veteran, gid } = await groupWithJoinOrder();
        const result = await userGroupModel.leaveGroup(admin.uid, gid);
        expect(result.result).toBe('transferred');
        expect(h.sameId(result.newAdminId, veteran.uid)).toBe(true);
    });

    it('removeMemberFromGroup on the admin follows the same rule; ties go to the lowest uid', async () => {
        const { admin, veteran, newcomer, gid } = await groupWithJoinOrder();
        await h.setJoinedAt(newcomer.uid, gid, '2026-02-01T00:00:00Z');
        await userGroupModel.removeMemberFromGroup(admin.uid, gid);
        const [{ adminId }] = await execReadCommand('SELECT adminId FROM dbo.Groups WHERE gid = @gid', [h.guid('gid', gid)]);
        // SQL Server sorts UNIQUEIDENTIFIER in its own byte order, so the expected tie winner comes from the database.
        const [{ first }] = await execReadCommand(
            'SELECT TOP 1 uid AS first FROM dbo.UserGroups WHERE gid = @gid ORDER BY joined_at, uid', [h.guid('gid', gid)]);
        expect(h.sameId(adminId, first)).toBe(true);
        expect([veteran.uid, newcomer.uid].some(id => h.sameId(id, adminId))).toBe(true);
    });
});

describe('atomic deletes in nodes/groupRoles', () => {
    it('deleteNode removes its edges and the node', async () => {
        const user = await h.createUser('nod');
        const gid = await h.createGroup(user.uid);
        const [a, b, c] = [await h.createNode(gid), await h.createNode(gid), await h.createNode(gid)];
        await h.createEdge(gid, a, b);
        await h.createEdge(gid, c, a);
        await expect(nodesModel.deleteNode(a)).resolves.toBe(1);
        expect(await h.count('dbo.Edges WHERE gid = @gid', [h.guid('gid', gid)])).toBe(0);
    });

    it('deleteGroupRole removes the assignments and the role', async () => {
        const user = await h.createUser('rol');
        const gid = await h.createGroup(user.uid);
        const grId = await h.createRole(gid, 'Dev');
        await h.assignRole(user.uid, gid, grId);
        await groupRolesModel.deleteGroupRole(grId, gid);
        expect(await h.count('dbo.GroupRoles WHERE gid = @gid', [h.guid('gid', gid)])).toBe(0);
        expect(await h.count('dbo.UserGroupRoles WHERE gid = @gid', [h.guid('gid', gid)])).toBe(0);
    });
});

describe('access.model', () => {
    it('membership, admin and resource -> group resolution', async () => {
        const { admin, member, gid, tid, grId } = await populatedGroup();
        const outsider = await h.createUser('out');
        expect(await access.isGroupMember(member.uid, gid)).toBe(true);
        expect(await access.isGroupMember(outsider.uid, gid)).toBe(false);
        expect(await access.isGroupAdmin(admin.uid, gid)).toBe(true);
        expect(await access.isGroupAdmin(member.uid, gid)).toBe(false);
        expect(await access.isGroupMember('not-a-uuid', gid)).toBe(false);

        // Leader = admin, or a role whose name contains "leader" in any case (the fixture's role is 'Leader').
        const plain = await h.createUser('pln');
        await h.addMember(plain.uid, gid);
        expect(await access.isGroupLeader(admin.uid, gid)).toBe(true);
        expect(await access.isGroupLeader(member.uid, gid)).toBe(true);
        expect(await access.isGroupLeader(plain.uid, gid)).toBe(false);
        const teamLead = await h.createRole(gid, 'Co-TEAMLEADER');
        await h.assignRole(plain.uid, gid, teamLead);
        expect(await access.isGroupLeader(plain.uid, gid)).toBe(true);
        expect(await access.isGroupLeader(outsider.uid, gid)).toBe(false);

        expect(h.sameId(await access.resolveGroupId('task', tid), gid)).toBe(true);
        expect(h.sameId(await access.resolveGroupId('groupRole', grId), gid)).toBe(true);
        expect(await access.resolveGroupId('task', '00000000-0000-0000-0000-000000000000')).toBeNull();
        expect(await access.resolveGroupId('node', 'bad')).toBeNull();
        await expect(access.resolveGroupId('nope', tid)).rejects.toThrow(/unknown kind/);
    });
});

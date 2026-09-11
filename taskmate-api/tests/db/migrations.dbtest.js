const { v4: uuidv4 } = require('uuid');
const { TYPES } = require('tedious');
const runner = require('../../migrations/runner');
const { execReadCommand, execWriteCommand } = require('../../helpers/execQuery');
const { isUniqueViolation, isFkViolation } = require('../../helpers/transaction');
const h = require('./helpers');

const LATEST = Math.max(...runner.listMigrations().map(m => m.version));
const objectExists = async (name) => (await execReadCommand(
    'SELECT CASE WHEN OBJECT_ID(@name) IS NULL THEN 0 ELSE 1 END AS ok', [{ name: 'name', type: TYPES.NVarChar, value: name }]
))[0].ok === 1;
const indexExists = async (table, index) => (await execReadCommand(
    'SELECT COUNT(*) AS n FROM sys.indexes WHERE name = @index AND object_id = OBJECT_ID(@table)',
    [{ name: 'index', type: TYPES.NVarChar, value: index }, { name: 'table', type: TYPES.NVarChar, value: table }]
))[0].n === 1;

describe('migrations', () => {
    afterAll(async () => {
        await runner.up();
    });

    it('up / up / down / up', async () => {
        await runner.up();
        await expect(runner.up()).resolves.toEqual([]);
        expect((await runner.status()).every(m => m.applied)).toBe(true);

        const reverted = await runner.down({ to: 0 });
        expect(reverted).toEqual([...Array(LATEST)].map((_, i) => LATEST - i));
        expect(await objectExists('dbo.PullRequests')).toBe(false);
        expect(await objectExists('dbo.AnalyticsConfig')).toBe(false);
        expect(await objectExists('dbo.UpdateTargetNodePercentage')).toBe(false);
        expect(await h.count('dbo.SchemaMigrations')).toBe(0);

        await expect(runner.up()).resolves.toEqual([...Array(LATEST)].map((_, i) => i + 1));
        expect(await objectExists('dbo.PullRequests')).toBe(true);
        expect(await objectExists('dbo.UpdateTargetNodePercentage')).toBe(true);
        expect(await h.count('dbo.SchemaMigrations')).toBe(LATEST);
        expect(await h.count("sys.foreign_keys WHERE parent_object_id = OBJECT_ID('dbo.TaskAnalytics') AND referenced_object_id = OBJECT_ID('dbo.Tasks')")).toBe(0);
    });

    it('skips a UNIQUE it cannot create (keeping the data) and adds it once the data is fixed', async () => {
        await runner.down({ to: 0 });
        const user = await h.createUser('mig');
        const gid = await h.createGroup(user.uid);
        const dup1 = await h.createRole(gid, 'Twin');
        const dup2 = await h.createRole(gid, 'twin');

        const messages = [];
        await runner.up({ log: (m) => messages.push(m) });
        expect(messages.some(m => m.includes('UQ_GroupRoles_Gid_Name skipped'))).toBe(true);
        expect(await objectExists('dbo.UQ_GroupRoles_Gid_Name')).toBe(false);
        expect(await indexExists('dbo.GroupRoles', 'IX_GroupRoles_Gid')).toBe(true);
        expect(await h.count('dbo.GroupRoles WHERE gr_id IN (@a, @b)', [h.guid('a', dup1), h.guid('b', dup2)])).toBe(2);

        await execWriteCommand('DELETE FROM dbo.GroupRoles WHERE gr_id = @id', [h.guid('id', dup2)]);
        await runner.reapply({ version: 1 });
        expect(await objectExists('dbo.UQ_GroupRoles_Gid_Name')).toBe(true);
        expect(await indexExists('dbo.GroupRoles', 'IX_GroupRoles_Gid')).toBe(false);
    });
});

describe('constraints', () => {
    let user; let gid;
    beforeAll(async () => {
        user = await h.createUser('cns');
        gid = await h.createGroup(user.uid);
    });

    it('role names are unique per group (case-insensitive) and assignments per user', async () => {
        const grId = await h.createRole(gid, 'Owner');
        expect(isUniqueViolation(await h.createRole(gid, 'OWNER').catch(e => e))).toBe(true);
        await h.assignRole(user.uid, gid, grId);
        expect(isUniqueViolation(await h.assignRole(user.uid, gid, grId).catch(e => e))).toBe(true);
    });

    it('composite FKs keep gid consistent and roles limited to members', async () => {
        const otherUser = await h.createUser('cns');
        const otherGid = await h.createGroup(otherUser.uid);
        const foreignNode = await h.createNode(otherGid);
        const localNode = await h.createNode(gid);
        expect(isFkViolation(await h.createEdge(gid, localNode, foreignNode).catch(e => e))).toBe(true);

        const grId = await h.createRole(gid, 'Reviewer');
        expect(isFkViolation(await h.assignRole(otherUser.uid, gid, grId).catch(e => e))).toBe(true);
        const foreignRole = await h.createRole(otherGid, 'Reviewer');
        expect(isFkViolation(await h.assignRole(user.uid, gid, foreignRole).catch(e => e))).toBe(true);

        await h.createEdge(gid, localNode, await h.createNode(gid));
    });

    it('edges are unique per (source, target)', async () => {
        const [a, b] = [await h.createNode(gid), await h.createNode(gid)];
        await h.createEdge(gid, a, b);
        expect(isUniqueViolation(await h.createEdge(gid, a, b).catch(e => e))).toBe(true);
    });

    it('analytics facts survive their task (no FK to Tasks)', async () => {
        await execWriteCommand(
            `INSERT INTO dbo.TaskAnalytics (tid, uid, gid, success_status) VALUES (@tid, @uid, @gid, 'failed')`,
            [h.guid('tid', uuidv4()), h.guid('uid', user.uid), h.guid('gid', gid)]
        );
    });

    it('the progress trigger averages progressor sources into the target node', async () => {
        const [s1, s2, target] = [await h.createNode(gid), await h.createNode(gid), await h.createNode(gid)];
        await h.createEdge(gid, s1, target, { prerequisite: false });
        await h.createEdge(gid, s2, target, { prerequisite: false });
        await execWriteCommand('UPDATE dbo.Nodes SET percentage = 50 WHERE nid = @nid', [h.guid('nid', s1)]);
        const [row] = await execReadCommand('SELECT percentage FROM dbo.Nodes WHERE nid = @nid', [h.guid('nid', target)]);
        expect(row.percentage).toBe(25);
    });

    it('migration 004 hands orphaned groups to their first remaining member', async () => {
        const admin = await h.createUser('aaa');
        const member = await h.createUser('zzz');
        const orphan = await h.createGroup(admin.uid);
        await h.addMember(member.uid, orphan);
        await execWriteCommand('DELETE FROM dbo.UserGroups WHERE uid = @uid AND gid = @gid', [h.guid('uid', admin.uid), h.guid('gid', orphan)]);
        await runner.reapply({ version: 4 });
        const [group] = await execReadCommand('SELECT adminId FROM dbo.Groups WHERE gid = @gid', [h.guid('gid', orphan)]);
        expect(h.sameId(group.adminId, member.uid)).toBe(true);
    });
});

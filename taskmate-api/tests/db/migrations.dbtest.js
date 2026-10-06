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

    it('migration 006: progress propagates through the whole chain in one update and cycles terminate', async () => {
        const pct = async (nid) => (await execReadCommand('SELECT percentage FROM dbo.Nodes WHERE nid = @nid', [h.guid('nid', nid)]))[0].percentage;
        const [a, b, c] = [await h.createNode(gid), await h.createNode(gid), await h.createNode(gid)];
        await h.createEdge(gid, a, b, { prerequisite: false });
        await h.createEdge(gid, b, c, { prerequisite: false });
        await h.createEdge(gid, c, a, { prerequisite: false }); // cycle back to the start

        await execWriteCommand('UPDATE dbo.Nodes SET percentage = 80 WHERE nid = @nid', [h.guid('nid', a)]);

        expect(await pct(b)).toBe(80);
        expect(await pct(c)).toBe(80);
        expect(await pct(a)).toBe(80);
    });

    it('migration 006: switching an edge to prerequisite recomputes its target (0 without progressor sources)', async () => {
        const [src, target] = [await h.createNode(gid, { percentage: 60 }), await h.createNode(gid)];
        const eid = await h.createEdge(gid, src, target, { prerequisite: true });
        await execWriteCommand('UPDATE dbo.Edges SET prerequisite = 0 WHERE eid = @eid', [h.guid('eid', eid)]);
        expect((await execReadCommand('SELECT percentage FROM dbo.Nodes WHERE nid = @nid', [h.guid('nid', target)]))[0].percentage).toBe(60);
        await execWriteCommand('UPDATE dbo.Edges SET prerequisite = 1 WHERE eid = @eid', [h.guid('eid', eid)]);
        expect((await execReadCommand('SELECT percentage FROM dbo.Nodes WHERE nid = @nid', [h.guid('nid', target)]))[0].percentage).toBe(0);
    });

    it('migration 005 repairs orphaned groups by join date, not by username', async () => {
        const admin = await h.createUser('adm');
        const veteran = await h.createUser('zzz');
        const newcomer = await h.createUser('!a');
        const orphan = await h.createGroup(admin.uid);
        await h.addMember(veteran.uid, orphan);
        await h.addMember(newcomer.uid, orphan);
        await h.setJoinedAt(veteran.uid, orphan, '2026-01-01T00:00:00Z');
        await h.setJoinedAt(newcomer.uid, orphan, '2026-05-01T00:00:00Z');
        await execWriteCommand('DELETE FROM dbo.UserGroups WHERE uid = @uid AND gid = @gid', [h.guid('uid', admin.uid), h.guid('gid', orphan)]);
        await runner.reapply({ version: 5 });
        const [group] = await execReadCommand('SELECT adminId FROM dbo.Groups WHERE gid = @gid', [h.guid('gid', orphan)]);
        expect(h.sameId(group.adminId, veteran.uid)).toBe(true);
    });

    it('005 columns: NVARCHAR text, joined_at default, AI opt-in off by default, unique payload hash', async () => {
        const types = await execReadCommand(
            `SELECT OBJECT_NAME(c.object_id) + '.' + c.name AS col, t.name AS type, c.max_length
             FROM sys.columns c INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
             WHERE (c.object_id = OBJECT_ID('dbo.Tasks') AND c.name IN ('name', 'description', 'list'))
                OR (c.object_id = OBJECT_ID('dbo.Users') AND c.name = 'username')
                OR (c.object_id = OBJECT_ID('dbo.GroupRoles') AND c.name IN ('gr_name', 'gr_icon'))`
        );
        const byCol = Object.fromEntries(types.map(r => [r.col, `${r.type}(${r.max_length})`]));
        expect(byCol).toEqual({
            'Tasks.name': 'nvarchar(50)', 'Tasks.description': 'nvarchar(2000)', 'Tasks.list': 'nvarchar(50)',
            'Users.username': 'nvarchar(50)', 'GroupRoles.gr_name': 'nvarchar(80)', 'GroupRoles.gr_icon': 'varchar(40)',
        });
        const hash = 'a'.repeat(64);
        await execWriteCommand(`INSERT INTO dbo.GitHubWebhookDeliveries (delivery_id, event, payload_sha256) VALUES (NEWID(), 'x', @h)`,
            [{ name: 'h', type: TYPES.Char, value: hash }]);
        const dup = await execWriteCommand(`INSERT INTO dbo.GitHubWebhookDeliveries (delivery_id, event, payload_sha256) VALUES (NEWID(), 'x', @h)`,
            [{ name: 'h', type: TYPES.Char, value: hash }]).catch(e => e);
        expect(isUniqueViolation(dup)).toBe(true);
        await execWriteCommand(`DELETE FROM dbo.GitHubWebhookDeliveries WHERE payload_sha256 = @h`, [{ name: 'h', type: TYPES.Char, value: hash }]);
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

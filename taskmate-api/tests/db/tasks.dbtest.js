const { v4: uuidv4 } = require('uuid');
const tasksModel = require('../../models/tasks.model');
const completeModel = require('../../models/complete.model');
const deleteModel = require('../../models/delete.model');
const usertaskModel = require('../../models/usertask.model');
const github = require('../../models/github.model');
const { TYPES } = require('tedious');
const runner = require('../../migrations/runner');
const { execReadCommand, execWriteCommand } = require('../../helpers/execQuery');
const { withTransaction } = require('../../helpers/transaction');
const h = require('./helpers');

const SHA = 'a'.repeat(40);

async function linkedRepo(gid, uid) {
    const installationId = h.githubId();
    const repoId = h.githubId();
    await github.upsertInstallation({ installationId, accountLogin: 'octo', accountType: 'User' });
    await github.upsertRepository({ repoId, installationId, name: 'repo', defaultBranch: 'main', isPrivate: false });
    await github.linkGroupRepository({ gid, repoId, connectedBy: uid });
    return repoId;
}

// A repository the group is NOT linked to. A branch row pointing there (left by an old link)
// must never be reported for cleanup: the branch would be deleted in the wrong repository.
async function otherRepo() {
    const installationId = h.githubId();
    const repoId = h.githubId();
    await github.upsertInstallation({ installationId, accountLogin: 'someone', accountType: 'User' });
    await github.upsertRepository({ repoId, installationId, name: 'elsewhere', defaultBranch: 'main', isPrivate: false });
    return repoId;
}

// tid/gid come back upper-cased from SQL Server; expectSameIds compares them.
const branchLink = (repoId, branchName) => ({
    tid: expect.any(String), gid: expect.any(String), repoId, owner: 'octo', repoName: 'repo', branchName, baseSha: SHA,
});

const expectSameIds = (link, tid, gid) => {
    expect(h.sameId(link.tid, tid)).toBe(true);
    expect(h.sameId(link.gid, gid)).toBe(true);
};

const facts = (tid) => execReadCommand(
    'SELECT uid, success_status, completed_at, completion_time_hours FROM dbo.TaskAnalytics WHERE tid = @tid',
    [h.guid('tid', tid)]
);

describe('tasks.completeTask', () => {
    let user; let gid; let repoId;
    beforeAll(async () => {
        user = await h.createUser('cmp');
        gid = await h.createGroup(user.uid);
        repoId = await linkedRepo(gid, user.uid);
    });

    it('moves the task to Complete, closes the facts, removes assignments and the branch', async () => {
        const tid = await h.createTask(gid, { name: 'Ship it', percentage: 40 });
        await h.assignTask(user.uid, tid, gid, { category: 'backend' });
        await github.insertTaskBranch({ tid, repoId, branchName: `tm/ship-${tid.slice(0, 8)}`, baseSha: SHA, createdBy: user.uid });

        const result = await tasksModel.completeTask(tid, { source: 'github_pr' });

        expect(result.status).toBe('completed');
        expect(result.task).toEqual(expect.objectContaining({ name: 'Ship it', percentage: 100 }));
        expect(result.branch).toEqual(branchLink(repoId, `tm/ship-${tid.slice(0, 8)}`));
        expectSameIds(result.branch, tid, gid);
        const p = [h.guid('tid', tid)];
        expect(await h.count('dbo.Tasks WHERE tid = @tid', p)).toBe(0);
        expect(await h.count('dbo.UserTask WHERE tid = @tid', p)).toBe(0);
        expect(await h.count('dbo.TaskBranches WHERE tid = @tid', p)).toBe(0);
        const [complete] = await execReadCommand('SELECT name, percentage FROM dbo.Complete WHERE tid = @tid', p);
        expect(complete).toEqual({ name: 'Ship it', percentage: 100 });
        const [fact] = await facts(tid);
        expect(fact.success_status).toBe('completed');
        expect(fact.completed_at).toBeInstanceOf(Date);
        expect(fact.completion_time_hours).toBeGreaterThanOrEqual(1.9);
    });

    it('two concurrent completions: one completes, the other sees already_completed', async () => {
        const tid = await h.createTask(gid);
        await h.assignTask(user.uid, tid, gid);
        const results = await Promise.all([tasksModel.completeTask(tid), tasksModel.completeTask(tid)]);
        expect(results.map(r => r.status).sort()).toEqual(['already_completed', 'completed']);
        expect(await h.count('dbo.Complete WHERE tid = @tid', [h.guid('tid', tid)])).toBe(1);
    });

    it('reports no branch for a task without one, or with one in a repository the group is not linked to', async () => {
        const plain = await h.createTask(gid);
        await expect(tasksModel.completeTask(plain)).resolves.toEqual(expect.objectContaining({ status: 'completed', branch: null }));

        const stale = await h.createTask(gid);
        const elsewhere = await otherRepo();
        await github.insertTaskBranch({ tid: stale, repoId: elsewhere, branchName: `tm/old-${stale.slice(0, 8)}`, baseSha: SHA, createdBy: user.uid });
        const result = await tasksModel.completeTask(stale);
        expect(result).toEqual(expect.objectContaining({ status: 'completed', branch: null }));
        expect(await h.count('dbo.TaskBranches WHERE tid = @tid', [h.guid('tid', stale)])).toBe(0);
    });

    it('the loser of two concurrent completions reports no branch', async () => {
        const tid = await h.createTask(gid);
        await github.insertTaskBranch({ tid, repoId, branchName: `tm/race-${tid.slice(0, 8)}`, baseSha: SHA, createdBy: user.uid });
        const results = await Promise.all([tasksModel.completeTask(tid), tasksModel.completeTask(tid)]);
        const winner = results.find(r => r.status === 'completed');
        const loser = results.find(r => r.status === 'already_completed');
        expect(winner.branch).toEqual(expect.objectContaining({ branchName: `tm/race-${tid.slice(0, 8)}` }));
        expect(loser).toEqual({ status: 'already_completed' });
    });

    // The one interleaving the lock on the links protects against: a branch linked after the links
    // were read and before the Tasks delete would be cascaded away unreported (orphaned on GitHub).
    it('a branch linked between reading the links and deleting the task waits, then fails on the FK', async () => {
        const tid = await h.createTask(gid);
        const branchName = `tm/late-${tid.slice(0, 8)}`;
        let reachDelete;
        const atDelete = new Promise(resolve => { reachDelete = resolve; });
        let releaseDelete;
        const deleteGate = new Promise(resolve => { releaseDelete = resolve; });
        const holdBeforeTasksDelete = (tx) => ({
            read: (sql, params) => tx.read(sql, params),
            query: (sql, params) => tx.query(sql, params),
            write: async (sql, params) => {
                if (/^DELETE FROM dbo\.Tasks WHERE/.test(sql)) {
                    reachDelete();
                    await deleteGate;
                }
                return tx.write(sql, params);
            },
        });

        const completing = withTransaction(tx => tasksModel.completeTask(tid, { tx: holdBeforeTasksDelete(tx) }));
        await atDelete;
        const inserting = github.insertTaskBranch({ tid, repoId, branchName, baseSha: SHA, createdBy: user.uid })
            .then(() => 'inserted', err => err);
        const meanwhile = await Promise.race([inserting, new Promise(resolve => setTimeout(() => resolve('waiting'), 500))]);
        releaseDelete();
        const result = await completing;
        const inserted = await inserting;

        expect(meanwhile).toBe('waiting');
        expect(inserted).toEqual(expect.objectContaining({ code: 'TASK_NOT_FOUND' }));
        expect(result).toEqual(expect.objectContaining({ status: 'completed', branch: null }));
        expect(await h.count('dbo.TaskBranches WHERE tid = @tid', [h.guid('tid', tid)])).toBe(0);
    });

    it('returns not_found for an unknown task and rejects an unknown source', async () => {
        await expect(tasksModel.completeTask('00000000-0000-0000-0000-000000000000')).resolves.toEqual({ status: 'not_found' });
        await expect(tasksModel.completeTask('00000000-0000-0000-0000-000000000000', { source: 'x' })).rejects.toThrow(TypeError);
    });

    it('refreshes a Complete row left behind by the old two-request flow', async () => {
        const tid = await h.createTask(gid, { name: 'Half done' });
        await execReadCommand(
            `INSERT INTO dbo.Complete (tid, gid, name, description, percentage, datetime)
             VALUES (@tid, @gid, 'stale', 'd', 10, '2030-01-01')`,
            [h.guid('tid', tid), h.guid('gid', gid)]
        );
        await expect(tasksModel.completeTask(tid)).resolves.toEqual(expect.objectContaining({ status: 'completed' }));
        const [row] = await execReadCommand('SELECT name, percentage FROM dbo.Complete WHERE tid = @tid', [h.guid('tid', tid)]);
        expect(row).toEqual({ name: 'Half done', percentage: 100 });
    });

    it('lists the completed task with the same wall-clock datetime string as the active one', async () => {
        const tid = await h.createTask(gid, { name: 'Wall clock' });
        const [active] = await tasksModel.getTask(tid);
        await tasksModel.completeTask(tid);

        const completed = (await completeModel.getCompletados(gid)).find(r => h.sameId(r.tid, tid));
        expect(active.datetimeStr).toBe('2030-01-01 00:00');
        expect(completed.datetime).toBe(active.datetimeStr.replace(' ', 'T'));
    });
});

describe('tasks deletion', () => {
    let user; let gid; let repoId;
    beforeAll(async () => {
        user = await h.createUser('del');
        gid = await h.createGroup(user.uid);
        repoId = await linkedRepo(gid, user.uid);
    });

    it('trashTask keeps the analytics fact as failed and removes dependents (incl. the branch)', async () => {
        const tid = await h.createTask(gid);
        await h.assignTask(user.uid, tid, gid);
        await github.insertTaskBranch({ tid, repoId, branchName: `tm/del-${tid.slice(0, 8)}`, baseSha: SHA, createdBy: user.uid });

        const result = await tasksModel.trashTask(tid);
        expect(result).toEqual(expect.objectContaining({ status: 'deleted' }));
        expect(result.branch).toEqual(branchLink(repoId, `tm/del-${tid.slice(0, 8)}`));
        expectSameIds(result.branch, tid, gid);
        const p = [h.guid('tid', tid)];
        expect(await h.count('dbo.Tasks WHERE tid = @tid', p)).toBe(0);
        expect(await h.count('dbo.UserTask WHERE tid = @tid', p)).toBe(0);
        expect(await h.count('dbo.TaskBranches WHERE tid = @tid', p)).toBe(0);
        expect((await facts(tid)).map(f => f.success_status)).toEqual(['failed']);
        await expect(tasksModel.trashTask(tid)).resolves.toEqual({ status: 'not_found' });
    });

    it('trashTask reports no branch for one in a repository the group is not linked to', async () => {
        const tid = await h.createTask(gid);
        const elsewhere = await otherRepo();
        await github.insertTaskBranch({ tid, repoId: elsewhere, branchName: `tm/old-${tid.slice(0, 8)}`, baseSha: SHA, createdBy: user.uid });
        await expect(tasksModel.trashTask(tid)).resolves.toEqual(expect.objectContaining({ status: 'deleted', branch: null }));
        expect(await h.count('dbo.TaskBranches WHERE tid = @tid', [h.guid('tid', tid)])).toBe(0);
    });

    it('trashTask archives into DeleteTask and deletes atomically', async () => {
        const tid = await h.createTask(gid, { name: 'Trash me', percentage: 30 });
        await h.assignTask(user.uid, tid, gid);

        const result = await tasksModel.trashTask(tid);
        expect(result).toEqual(expect.objectContaining({ status: 'deleted', branch: null }));
        expect(result.task).toEqual(expect.objectContaining({ name: 'Trash me', percentage: 30 }));
        const p = [h.guid('tid', tid)];
        const [archived] = await execReadCommand('SELECT name, percentage FROM dbo.DeleteTask WHERE tid = @tid', p);
        expect(archived).toEqual({ name: 'Trash me', percentage: 30 });
        expect(await h.count('dbo.Tasks WHERE tid = @tid', p)).toBe(0);
        expect(await h.count('dbo.UserTask WHERE tid = @tid', p)).toBe(0);
        expect((await facts(tid)).map(f => f.success_status)).toEqual(['failed']);
        await expect(tasksModel.trashTask(tid)).resolves.toEqual({ status: 'not_found' });
    });

    it('lists the trashed task with the same wall-clock datetime string as the active one', async () => {
        const tid = await h.createTask(gid, { name: 'Wall clock trash' });
        const [active] = await tasksModel.getTask(tid);
        await tasksModel.trashTask(tid);

        const trashed = (await deleteModel.getEliminados(gid)).find(r => h.sameId(r.tid, tid));
        expect(active.datetimeStr).toBe('2030-01-01 00:00');
        expect(trashed.datetime).toBe(active.datetimeStr.replace(' ', 'T'));
    });

    it('deleteTasksByList handles assignments, facts and branches (used to fail on the FK)', async () => {
        const list = `L-${Date.now() % 100000}`;
        const t1 = await h.createTask(gid, { list });
        const t2 = await h.createTask(gid, { list });
        const other = await h.createTask(gid, { list: 'Keep' });
        await h.assignTask(user.uid, t1, gid);
        await h.assignTask(user.uid, t2, gid);
        await github.insertTaskBranch({ tid: t1, repoId, branchName: `tm/list-${t1.slice(0, 8)}`, baseSha: SHA, createdBy: user.uid });

        const result = await tasksModel.deleteTasksByList(gid, list);
        expect(result).toEqual({ rowCount: 2, branches: [branchLink(repoId, `tm/list-${t1.slice(0, 8)}`)] });
        expectSameIds(result.branches[0], t1, gid);
        expect(await h.count('dbo.Tasks WHERE gid = @gid', [h.guid('gid', gid)])).toBeGreaterThanOrEqual(1);
        expect(await h.count('dbo.Tasks WHERE tid = @tid', [h.guid('tid', other)])).toBe(1);
        expect(await h.count('dbo.TaskBranches WHERE tid = @tid', [h.guid('tid', t1)])).toBe(0);
        expect((await facts(t1)).map(f => f.success_status)).toEqual(['failed']);
        expect((await facts(t2)).map(f => f.success_status)).toEqual(['failed']);
    });

    it('deleteTasksByList reports only the list\'s branches in the linked repository', async () => {
        const list = `B-${Date.now() % 100000}`;
        const linked = await h.createTask(gid, { list });
        const stale = await h.createTask(gid, { list });
        await h.createTask(gid, { list });
        const outside = await h.createTask(gid, { list: 'Keep' });
        const elsewhere = await otherRepo();
        await github.insertTaskBranch({ tid: linked, repoId, branchName: `tm/in-${linked.slice(0, 8)}`, baseSha: SHA, createdBy: user.uid });
        await github.insertTaskBranch({ tid: stale, repoId: elsewhere, branchName: `tm/old-${stale.slice(0, 8)}`, baseSha: SHA, createdBy: user.uid });
        await github.insertTaskBranch({ tid: outside, repoId, branchName: `tm/keep-${outside.slice(0, 8)}`, baseSha: SHA, createdBy: user.uid });

        const result = await tasksModel.deleteTasksByList(gid, list);
        expect(result.rowCount).toBe(3);
        expect(result.branches.map(b => b.branchName)).toEqual([`tm/in-${linked.slice(0, 8)}`]);
        expectSameIds(result.branches[0], linked, gid);
        expect(await h.count('dbo.TaskBranches WHERE tid = @tid', [h.guid('tid', outside)])).toBe(1);

        await expect(tasksModel.deleteTasksByList(gid, list)).resolves.toEqual({ rowCount: 0, branches: [] });
    });

    it('deleteUsertask closes only that user\'s pending fact as reassigned', async () => {
        const other = await h.createUser('oth');
        await h.addMember(other.uid, gid);
        const tid = await h.createTask(gid);
        await h.assignTask(user.uid, tid, gid);
        await h.assignTask(other.uid, tid, gid);

        await expect(usertaskModel.deleteUsertask(other.uid, tid)).resolves.toBe(1);
        const byUser = Object.fromEntries((await facts(tid)).map(f => [String(f.uid).toLowerCase(), f.success_status]));
        expect(byUser[user.uid]).toBe('pending');
        expect(byUser[other.uid]).toBe('reassigned');
    });
});

describe('usertask.populateAssignmentsForGroup', () => {
    it('assigns every unassigned task once, with a fact per assignment', async () => {
        const admin = await h.createUser('pop');
        const member = await h.createUser('pop');
        const gid = await h.createGroup(admin.uid);
        await h.addMember(member.uid, gid);
        const done = await h.createTask(gid, { percentage: 100 });
        const open = await h.createTask(gid, { percentage: 10 });
        const alreadyAssigned = await h.createTask(gid);
        await h.assignTask(admin.uid, alreadyAssigned, gid);

        const [first, second] = await Promise.all([
            usertaskModel.populateAssignmentsForGroup(gid),
            usertaskModel.populateAssignmentsForGroup(gid),
        ]);
        expect(first.assigned + second.assigned).toBe(2);
        expect(first.members).toBe(2);
        expect(await h.count('dbo.UserTask ut INNER JOIN dbo.Tasks t ON t.tid = ut.tid WHERE t.gid = @gid', [h.guid('gid', gid)])).toBe(3);
        expect((await facts(done)).map(f => f.success_status)).toEqual(['completed']);
        expect((await facts(open)).map(f => f.success_status)).toEqual(['pending']);
    });

    it('throws NOT_FOUND for an unknown group', async () => {
        await expect(usertaskModel.populateAssignmentsForGroup('00000000-0000-0000-0000-000000000001'))
            .rejects.toEqual(expect.objectContaining({ code: 'NOT_FOUND', status: 404 }));
    });
});

describe('tasks.created_at (migration 008)', () => {
    let user; let gid;
    beforeAll(async () => {
        user = await h.createUser('crt');
        gid = await h.createGroup(user.uid);
    });

    // table: Tasks, or Complete / DeleteTask for a task that was completed or trashed.
    const createdAt = async (tid, table = 'Tasks') => (await execReadCommand(
        `SELECT created_at FROM dbo.${table} WHERE tid = @tid`, [h.guid('tid', tid)]
    ))[0].created_at;
    const setCreatedAt = (tid, date) => execWriteCommand(
        'UPDATE dbo.Tasks SET created_at = @at WHERE tid = @tid',
        [h.guid('tid', tid), { name: 'at', type: TYPES.DateTimeOffset, value: new Date(date) }]
    );
    const serverNow = async () => (await execReadCommand('SELECT SYSDATETIMEOFFSET() AS now'))[0].now;

    it('is a NOT NULL DATETIMEOFFSET(7) with a default in Tasks, Complete and DeleteTask; an INSERT that does not name it gets the time', async () => {
        const cols = await execReadCommand(
            `SELECT OBJECT_NAME(c.object_id) AS tbl, t.name AS type, c.scale, c.is_nullable, dc.name AS df
             FROM sys.columns c
             INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
             LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
             WHERE c.object_id IN (OBJECT_ID('dbo.Tasks'), OBJECT_ID('dbo.Complete'), OBJECT_ID('dbo.DeleteTask'))
               AND c.name = 'created_at'
             ORDER BY tbl`
        );
        const column = (tbl) => ({ tbl, type: 'datetimeoffset', scale: 7, is_nullable: false, df: `DF_${tbl}_CreatedAt` });
        expect(cols).toEqual([column('Complete'), column('DeleteTask'), column('Tasks')]);

        const tid = uuidv4();
        const before = await serverNow();
        await tasksModel.addTask({ tid, gid, name: 'Fresh', description: '', list: 'To Do', datetime: '2030-01-01', percentage: 0 });
        const after = await serverNow();
        const at = await createdAt(tid);
        expect(at).toBeInstanceOf(Date);
        expect(at.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(at.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('getTasksByGroupId lists oldest first and both reads return createdAt', async () => {
        const group = await h.createGroup(user.uid, 'Order group');
        const late = await h.createTask(group, { name: 'Late' });
        const early = await h.createTask(group, { name: 'Early' });
        const middle = await h.createTask(group, { name: 'Middle' });
        await setCreatedAt(late, '2026-03-01T00:00:00Z');
        await setCreatedAt(early, '2026-01-01T00:00:00Z');
        await setCreatedAt(middle, '2026-02-01T12:30:00.250Z');

        const rows = await tasksModel.getTasksByGroupId(group);
        expect(rows.map(r => r.name)).toEqual(['Early', 'Middle', 'Late']);
        expect(rows[1].createdAt.toISOString()).toBe('2026-02-01T12:30:00.250Z');
        const [one] = await tasksModel.getTask(middle);
        expect(one.createdAt.toISOString()).toBe('2026-02-01T12:30:00.250Z');
    });

    it('completing or trashing a task keeps its created_at, and those lists are oldest first too', async () => {
        const group = await h.createGroup(user.uid, 'Archive order group');
        const late = await h.createTask(group, { name: 'Late' });
        const early = await h.createTask(group, { name: 'Early' });
        const middle = await h.createTask(group, { name: 'Middle' });
        await setCreatedAt(late, '2026-03-01T00:00:00Z');
        await setCreatedAt(early, '2026-01-01T00:00:00Z');
        await setCreatedAt(middle, '2026-02-01T12:30:00.250Z');
        const lateTrash = await h.createTask(group, { name: 'Late trash' });
        const earlyTrash = await h.createTask(group, { name: 'Early trash' });
        await setCreatedAt(lateTrash, '2026-05-01T00:00:00Z');
        await setCreatedAt(earlyTrash, '2026-04-01T00:00:00Z');

        // Completed or trashed in the opposite order, so the lists cannot follow the archive order.
        for (const tid of [late, middle, early]) {
            expect((await tasksModel.completeTask(tid)).status).toBe('completed');
        }
        for (const tid of [lateTrash, earlyTrash]) {
            expect((await tasksModel.trashTask(tid)).status).toBe('deleted');
        }

        expect((await createdAt(middle, 'Complete')).toISOString()).toBe('2026-02-01T12:30:00.250Z');
        expect((await createdAt(earlyTrash, 'DeleteTask')).toISOString()).toBe('2026-04-01T00:00:00.000Z');
        const completed = await completeModel.getCompletados(group);
        expect(completed.map(r => r.name)).toEqual(['Early', 'Middle', 'Late']);
        expect(completed[1].createdAt.toISOString()).toBe('2026-02-01T12:30:00.250Z');
        const trashed = await deleteModel.getEliminados(group);
        expect(trashed.map(r => r.name)).toEqual(['Early trash', 'Late trash']);
        expect(trashed[0].createdAt.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    });

    it('tasks created in the same instant keep their insertion order (created_seq), also once completed', async () => {
        const group = await h.createGroup(user.uid, 'Tie group');
        const tids = [];
        for (const name of ['Uno', 'Dos', 'Tres', 'Cuatro']) tids.push(await h.createTask(group, { name }));
        for (const tid of tids) await setCreatedAt(tid, '2026-06-01T00:00:00Z');

        expect((await tasksModel.getTasksByGroupId(group)).map(r => r.name)).toEqual(['Uno', 'Dos', 'Tres', 'Cuatro']);
        const seqOf = async (tid, table) => (await execReadCommand(
            `SELECT created_seq FROM dbo.${table} WHERE tid = @tid`, [h.guid('tid', tid)]
        ))[0].created_seq;
        const seq = await seqOf(tids[1], 'Tasks');
        for (const tid of [tids[3], tids[1], tids[0], tids[2]]) await tasksModel.completeTask(tid);
        expect(await seqOf(tids[1], 'Complete')).toBe(seq);
        expect((await completeModel.getCompletados(group)).map(r => r.name)).toEqual(['Uno', 'Dos', 'Tres', 'Cuatro']);
    });

    it('refreshing a Complete or DeleteTask row left by the old two-request flow takes the task\'s created_at', async () => {
        const done = await h.createTask(gid, { name: 'Old done' });
        const trashed = await h.createTask(gid, { name: 'Old trash' });
        await setCreatedAt(done, '2026-01-02T00:00:00Z');
        await setCreatedAt(trashed, '2026-01-03T00:00:00Z');
        // Rows from before the move, stamped by their DEFAULT (now).
        await execWriteCommand(
            `INSERT INTO dbo.Complete (tid, gid, name, description, percentage, datetime)
             VALUES (@tid, @gid, 'stale', 'd', 10, '2030-01-01')`,
            [h.guid('tid', done), h.guid('gid', gid)]
        );
        await execWriteCommand(
            `INSERT INTO dbo.DeleteTask (tid, gid, name, description, datetime, percentage)
             VALUES (@tid, @gid, 'stale', 'd', '2030-01-01', 0)`,
            [h.guid('tid', trashed), h.guid('gid', gid)]
        );

        expect((await tasksModel.completeTask(done)).status).toBe('completed');
        expect((await tasksModel.trashTask(trashed)).status).toBe('deleted');

        expect((await createdAt(done, 'Complete')).toISOString()).toBe('2026-01-02T00:00:00.000Z');
        expect((await createdAt(trashed, 'DeleteTask')).toISOString()).toBe('2026-01-03T00:00:00.000Z');
    });

    it('the backfill moves a task back to its first assignment, never forward (reapplying 008)', async () => {
        const assigned = await h.createTask(gid, { name: 'Assigned' });
        await h.assignTask(user.uid, assigned, gid); // assigned_at = two hours ago
        const unassigned = await h.createTask(gid, { name: 'Unassigned' });
        const assignedLater = await h.createTask(gid, { name: 'Assigned later' });
        await h.assignTask(user.uid, assignedLater, gid);
        await setCreatedAt(assignedLater, '2020-01-01T00:00:00Z'); // created long before its assignment
        // The facts outlive the task, so completed and trashed ones are backfilled the same way.
        const done = await h.createTask(gid, { name: 'Assigned done' });
        await h.assignTask(user.uid, done, gid);
        await tasksModel.completeTask(done);
        const trashed = await h.createTask(gid, { name: 'Assigned trash' });
        await h.assignTask(user.uid, trashed, gid);
        await tasksModel.trashTask(trashed);
        const before = {
            assigned: await createdAt(assigned),
            unassigned: await createdAt(unassigned),
            done: await createdAt(done, 'Complete'),
            trashed: await createdAt(trashed, 'DeleteTask'),
        };

        await runner.reapply({ version: 8 });

        // GETDATE() (assigned_at) and SYSDATETIMEOFFSET() agree once the server's offset is applied.
        const expectMovedBackTwoHours = (was, now) => {
            const movedBy = was.getTime() - now.getTime();
            expect(movedBy).toBeGreaterThan(119 * 60 * 1000);
            expect(movedBy).toBeLessThan(121 * 60 * 1000);
        };
        expectMovedBackTwoHours(before.assigned, await createdAt(assigned));
        expectMovedBackTwoHours(before.done, await createdAt(done, 'Complete'));
        expectMovedBackTwoHours(before.trashed, await createdAt(trashed, 'DeleteTask'));
        expect((await createdAt(unassigned)).getTime()).toBe(before.unassigned.getTime());
        expect((await createdAt(assignedLater)).toISOString()).toBe('2020-01-01T00:00:00.000Z');
    });
});

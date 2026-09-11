const tasksModel = require('../../models/tasks.model');
const usertaskModel = require('../../models/usertask.model');
const github = require('../../models/github.model');
const { execReadCommand } = require('../../helpers/execQuery');
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
});

describe('tasks deletion', () => {
    let user; let gid; let repoId;
    beforeAll(async () => {
        user = await h.createUser('del');
        gid = await h.createGroup(user.uid);
        repoId = await linkedRepo(gid, user.uid);
    });

    it('deleteTask keeps the analytics fact as failed and removes dependents', async () => {
        const tid = await h.createTask(gid);
        await h.assignTask(user.uid, tid, gid);
        await github.insertTaskBranch({ tid, repoId, branchName: `tm/del-${tid.slice(0, 8)}`, baseSha: SHA, createdBy: user.uid });

        await expect(tasksModel.deleteTask(tid)).resolves.toBe(1);
        const p = [h.guid('tid', tid)];
        expect(await h.count('dbo.Tasks WHERE tid = @tid', p)).toBe(0);
        expect(await h.count('dbo.UserTask WHERE tid = @tid', p)).toBe(0);
        expect(await h.count('dbo.TaskBranches WHERE tid = @tid', p)).toBe(0);
        expect((await facts(tid)).map(f => f.success_status)).toEqual(['failed']);
        await expect(tasksModel.deleteTask(tid)).resolves.toBe(0);
    });

    it('trashTask archives into DeleteTask and deletes atomically', async () => {
        const tid = await h.createTask(gid, { name: 'Trash me', percentage: 30 });
        await h.assignTask(user.uid, tid, gid);

        const result = await tasksModel.trashTask(tid);
        expect(result).toEqual(expect.objectContaining({ status: 'deleted' }));
        expect(result.task).toEqual(expect.objectContaining({ name: 'Trash me', percentage: 30 }));
        const p = [h.guid('tid', tid)];
        const [archived] = await execReadCommand('SELECT name, percentage FROM dbo.DeleteTask WHERE tid = @tid', p);
        expect(archived).toEqual({ name: 'Trash me', percentage: 30 });
        expect(await h.count('dbo.Tasks WHERE tid = @tid', p)).toBe(0);
        expect(await h.count('dbo.UserTask WHERE tid = @tid', p)).toBe(0);
        expect((await facts(tid)).map(f => f.success_status)).toEqual(['failed']);
        await expect(tasksModel.trashTask(tid)).resolves.toEqual({ status: 'not_found' });
    });

    it('deleteTasksByList handles assignments, facts and branches (used to fail on the FK)', async () => {
        const list = `L-${Date.now() % 100000}`;
        const t1 = await h.createTask(gid, { list });
        const t2 = await h.createTask(gid, { list });
        const other = await h.createTask(gid, { list: 'Keep' });
        await h.assignTask(user.uid, t1, gid);
        await h.assignTask(user.uid, t2, gid);
        await github.insertTaskBranch({ tid: t1, repoId, branchName: `tm/list-${t1.slice(0, 8)}`, baseSha: SHA, createdBy: user.uid });

        await expect(tasksModel.deleteTasksByList(gid, list)).resolves.toBe(2);
        expect(await h.count('dbo.Tasks WHERE gid = @gid', [h.guid('gid', gid)])).toBeGreaterThanOrEqual(1);
        expect(await h.count('dbo.Tasks WHERE tid = @tid', [h.guid('tid', other)])).toBe(1);
        expect((await facts(t1)).map(f => f.success_status)).toEqual(['failed']);
        expect((await facts(t2)).map(f => f.success_status)).toEqual(['failed']);
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

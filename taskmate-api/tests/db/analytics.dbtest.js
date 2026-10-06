const AnalyticsService = require('../../services/AnalyticsService');
const AnalyticsIntegration = require('../../services/AnalyticsIntegration');
const { buildTeamContext, CATEGORIES } = require('../../services/analyticsContext');
const tasksModel = require('../../models/tasks.model');
const { TYPES } = require('tedious');
const { execReadCommand, execWriteCommand } = require('../../helpers/execQuery');
const h = require('./helpers');

const expertiseOf = async (uid, category) => (await execReadCommand(
    'SELECT tasks_completed, success_rate_percentage, expertise_score FROM dbo.UserExpertise WHERE uid = @uid AND task_category = @cat',
    [h.guid('uid', uid), { name: 'cat', type: TYPES.VarChar, value: category }]
))[0];

describe('analytics on top of the fact table', () => {
    let user; let gid;
    beforeAll(async () => {
        user = await h.createUser('ana');
        gid = await h.createGroup(user.uid);
    });

    it('recordTaskAssignment records one pending fact per user and ignores unknown tasks', async () => {
        const tid = await h.createTask(gid);
        await expect(AnalyticsService.recordTaskAssignment(tid, user.uid, gid, 'testing'))
            .resolves.toEqual(expect.objectContaining({ success: true, category: 'testing' }));
        await expect(AnalyticsService.recordTaskAssignment(tid, user.uid, gid, 'testing'))
            .resolves.toEqual({ success: true, message: 'Assignment already recorded' });
        await expect(AnalyticsService.recordTaskAssignment('00000000-0000-0000-0000-000000000000', user.uid, gid))
            .resolves.toEqual(expect.objectContaining({ message: 'Assignment already recorded' }));
    });

    it('the completion hook after completeTask refreshes expertise once (idempotent)', async () => {
        const tid = await h.createTask(gid);
        await h.assignTask(user.uid, tid, gid, { category: 'backend' });
        await tasksModel.completeTask(tid);

        const first = await AnalyticsIntegration.onTaskCompletion(tid, true);
        expect(first).toEqual(expect.objectContaining({ success: true, status: 'completed', already_recorded: true }));
        await AnalyticsIntegration.onTaskCompletion(tid, true);
        expect(await expertiseOf(user.uid, 'backend')).toEqual(expect.objectContaining({ tasks_completed: 1, success_rate_percentage: 100 }));

        const failedTid = await h.createTask(gid);
        await h.assignTask(user.uid, failedTid, gid, { category: 'backend' });
        await tasksModel.trashTask(failedTid);
        await expect(AnalyticsIntegration.onTaskDeletion(failedTid))
            .resolves.toEqual(expect.objectContaining({ success: true, status: 'failed' }));
        expect(await expertiseOf(user.uid, 'backend')).toEqual(expect.objectContaining({ tasks_completed: 2, success_rate_percentage: 50 }));
    });

    it('hooks for never-assigned tasks are skipped without errors', async () => {
        const tid = await h.createTask(gid);
        await tasksModel.completeTask(tid);
        await expect(AnalyticsIntegration.onTaskCompletion(tid, true)).resolves.toEqual({ success: true, skipped: true });
    });

    it('recordTaskCompletion still closes facts left pending by the old flow', async () => {
        const tid = await h.createTask(gid);
        await h.assignTask(user.uid, tid, gid, { category: 'frontend' });
        await expect(AnalyticsService.recordTaskCompletion(tid, true))
            .resolves.toEqual(expect.objectContaining({ success: true, status: 'completed' }));
        const [fact] = await execReadCommand('SELECT success_status, completion_time_hours FROM dbo.TaskAnalytics WHERE tid = @tid', [h.guid('tid', tid)]);
        expect(fact.success_status).toBe('completed');
        expect(fact.completion_time_hours).toBeGreaterThanOrEqual(1.9);
    });

    it('batchUpdateUserMetrics runs on SQL Server 2019 (no LEAST/GREATEST)', async () => {
        const result = await AnalyticsService.batchUpdateUserMetrics();
        expect(result.errors).toEqual([]);
        expect(result.users_updated).toBeGreaterThanOrEqual(1);
    });

    it('workload counts every assignment of an existing task, whatever UserTask.completed says', async () => {
        const worker = await h.createUser('wrk');
        const team = await h.createGroup(worker.uid);
        const roleId = await h.createRole(team, 'Dev');
        await h.assignRole(worker.uid, team, roleId);
        // The UI sends completed = true meaning "assigned".
        for (const completed of [true, true, false]) {
            const tid = await h.createTask(team);
            await execWriteCommand(
                'INSERT INTO dbo.UserTask (utid, uid, tid, completed) VALUES (NEWID(), @uid, @tid, @completed)',
                [h.guid('uid', worker.uid), h.guid('tid', tid), { name: 'completed', type: TYPES.Bit, value: completed }]
            );
        }
        const done = await h.createTask(team);
        await h.assignTask(worker.uid, done, team);
        await tasksModel.completeTask(done);

        const { team_members: [member] } = await buildTeamContext(team);
        expect(member.current_workload).toBe(3);
        const { workload_distribution: [row] } = await AnalyticsService.getWorkloadDistribution(team);
        expect(row.current_workload).toBe(3);
    });

    it('buildTeamContext returns every member with workload, capacity and all five categories', async () => {
        const member = await h.createUser('ana');
        await h.addMember(member.uid, gid);
        const tid = await h.createTask(gid);
        await h.assignTask(member.uid, tid, gid);

        const { team_members: team } = await buildTeamContext(gid);
        expect(team).toHaveLength(2);
        const byUid = Object.fromEntries(team.map(m => [String(m.uid).toLowerCase(), m]));
        expect(byUid[member.uid]).toEqual(expect.objectContaining({ username: member.username, current_workload: 1, historical_capacity: expect.any(Number) }));
        expect(Object.keys(byUid[member.uid].expertise_by_category).sort()).toEqual([...CATEGORIES].sort());
        expect(byUid[member.uid].expertise_by_category.frontend).toEqual({ expertise_score: 0, success_rate_percentage: 50 });
        expect(byUid[user.uid].expertise_by_category.backend).toEqual({ expertise_score: expect.any(Number), success_rate_percentage: 50 });
    });

    it('buildTeamContext only uses the group\'s own data, so adding someone to a group exposes nothing else', async () => {
        const member = await h.createUser('xgrp');
        const own = await h.createGroup(member.uid);
        const busy = await h.createTask(own);
        await h.assignTask(member.uid, busy, own);
        const done = await h.createTask(own);
        await h.assignTask(member.uid, done, own);
        await tasksModel.completeTask(done);

        const outsider = await h.createUser('ldr');
        const other = await h.createGroup(outsider.uid);
        await h.addMember(member.uid, other);

        const { team_members: inOther } = await buildTeamContext(other);
        const seen = inOther.find(t => String(t.uid).toLowerCase() === member.uid);
        expect(seen.current_workload).toBe(0);
        CATEGORIES.forEach(cat => expect(seen.expertise_by_category[cat]).toEqual({ expertise_score: 0, success_rate_percentage: 50 }));

        const { team_members: [inOwn] } = await buildTeamContext(own);
        expect(inOwn.current_workload).toBe(1);
        expect(Object.values(inOwn.expertise_by_category).some(e => e.success_rate_percentage === 100)).toBe(true);
    });
});

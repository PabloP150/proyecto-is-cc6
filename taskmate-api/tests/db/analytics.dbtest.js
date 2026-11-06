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
        expect(seen.historical_capacity).toBe(3);
        CATEGORIES.forEach(cat => expect(seen.expertise_by_category[cat]).toEqual({ expertise_score: 0, success_rate_percentage: 50 }));

        const { team_members: [inOwn] } = await buildTeamContext(own);
        expect(inOwn.current_workload).toBe(1);
        expect(inOwn.historical_capacity).toBe(2);
        expect(Object.values(inOwn.expertise_by_category).some(e => e.success_rate_percentage === 100)).toBe(true);
    });

    it('the team panel (workload and expertise ranking) only counts the group it shows and lists members without a role', async () => {
        const worker = await h.createUser('both');
        const noRole = await h.createUser('norole');
        const groupA = await h.createGroup(worker.uid, 'A');
        const groupB = await h.createGroup((await h.createUser('ldrb')).uid, 'B');
        await h.addMember(noRole.uid, groupA);
        await h.addMember(worker.uid, groupB);
        // Two roles in A; the one in B must not show up in A
        await h.assignRole(worker.uid, groupA, await h.createRole(groupA, 'QA'));
        await h.assignRole(worker.uid, groupA, await h.createRole(groupA, 'Dev'));
        await h.assignRole(worker.uid, groupB, await h.createRole(groupB, 'Ops'));

        // Open work: one task in A, two in B
        await h.assignTask(worker.uid, await h.createTask(groupA), groupA, { category: 'backend' });
        for (let i = 0; i < 2; i++) {
            await h.assignTask(worker.uid, await h.createTask(groupB), groupB, { category: 'backend' });
        }
        // Finished work: a completed backend task in A and a failed one in B
        const doneA = await h.createTask(groupA);
        await h.assignTask(worker.uid, doneA, groupA, { category: 'backend' });
        await tasksModel.completeTask(doneA);
        await AnalyticsIntegration.onTaskCompletion(doneA, true);
        const failedB = await h.createTask(groupB);
        await h.assignTask(worker.uid, failedB, groupB, { category: 'backend' });
        await tasksModel.trashTask(failedB);
        await AnalyticsIntegration.onTaskDeletion(failedB);

        const byUid = rows => Object.fromEntries(rows.map(r => [String(r.user_id).toLowerCase(), r]));
        // Capacity = the most tasks open at once in that group: 2 in A (open + doneA), 3 in B (2 open +
        // failedB). The hooks above wrote a UserMetrics row that mixes both groups; it must not be used.
        const { workload_distribution: inA } = await AnalyticsService.getWorkloadDistribution(groupA);
        expect(inA).toHaveLength(2);
        expect(byUid(inA)[worker.uid]).toEqual(expect.objectContaining({
            current_workload: 1, capacity: 2, utilization: 50, status: 'moderate', roles: ['Dev', 'QA'], role: 'Dev, QA'
        }));
        expect(byUid(inA)[noRole.uid]).toEqual(expect.objectContaining({ current_workload: 0, capacity: 3, roles: [], role: 'N/A' }));
        const { workload_distribution: inB } = await AnalyticsService.getWorkloadDistribution(groupB);
        expect(byUid(inB)[worker.uid]).toEqual(expect.objectContaining({ current_workload: 2, capacity: 3, utilization: 66.67, roles: ['Ops'] }));
        const { team_members: summaryA } = await AnalyticsService.getTeamAnalyticsSummary(groupA);
        expect(byUid(summaryA)[worker.uid].historical_capacity).toBe(2);
        const { team_members: contextA } = await buildTeamContext(groupA);
        expect(contextA.find(m => String(m.uid).toLowerCase() === worker.uid).historical_capacity).toBe(2);

        // UserExpertise (the user's own analytics) mixes both groups; each group's ranking only its own facts.
        expect(await expertiseOf(worker.uid, 'backend')).toEqual(expect.objectContaining({ tasks_completed: 2, success_rate_percentage: 50 }));
        const { expertise_rankings: rankingA } = await AnalyticsService.getCategoryExpertiseRankings(groupA);
        // 100 % success + a ~2 h time bonus, capped at 100
        expect(rankingA.backend).toEqual([expect.objectContaining({
            username: worker.username, tasks_completed: 1, success_rate_percentage: 100, expertise_score: 100,
        })]);
        expect(rankingA.no_expertise.map(e => e.username)).toEqual([noRole.username]);
        const { expertise_rankings: rankingB } = await AnalyticsService.getCategoryExpertiseRankings(groupB, 'backend');
        // 0 % success + 10 (a failed task has no completion time)
        expect(rankingB).toEqual({ backend: [expect.objectContaining({
            username: worker.username, tasks_completed: 1, success_rate_percentage: 0, expertise_score: 10,
        })] });
    });
});

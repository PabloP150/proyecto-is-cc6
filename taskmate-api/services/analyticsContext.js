// services/analyticsContext.js — real team data sent to the Python analytics agent as
// `data.team_context` (replaces its mock data for real groups).
const { execReadCommand } = require('../helpers/execQuery');
const { TYPES } = require('tedious');

const CATEGORIES = ['frontend', 'backend', 'database', 'testing', 'general'];
const DEFAULT_CAPACITY = 3;
// A category the user has no history in: no expertise, neutral success rate
// (same default AnalyticsService.getUserExpertise uses).
const DEFAULT_EXPERTISE = { expertise_score: 0, success_rate_percentage: 50 };

const num = (value, fallback) => (value === null || value === undefined ? fallback : Number(value));

// Same scoring as AnalyticsService._updateUserExpertise, applied to one group's history:
// score = min(100, success rate + time bonus), bonus = avg hours > 0 ? max(0, 20 - avg/2) : 10.
const expertiseScore = ({ finished, successRate, avgHours }) => {
    if (!finished) return 0;
    const bonus = avgHours > 0 ? Math.max(0, 20 - avgHours / 2) : 10;
    return Math.min(100, Number((successRate + bonus).toFixed(2)));
};

/**
 * buildTeamContext(groupId) → {team_members: [{uid, username, current_workload, historical_capacity,
 *   expertise_by_category: {frontend|backend|database|testing|general: {expertise_score, success_rate_percentage}}}]}
 * Workload and expertise only use THIS group's data: a group admin can add any user to their group, so
 * nothing about the member's other projects may leak into it. current_workload = the member's
 * assignments (UserTask rows) on this group's open tasks (UserTask.completed means "assigned", and
 * completed tasks leave Tasks/UserTask); expertise comes from this group's finished TaskAnalytics facts;
 * historical_capacity = the user's highest daily max_concurrent_tasks (a single number, 3 without history).
 */
async function buildTeamContext(groupId) {
    const params = [{ name: 'gid', type: TYPES.UniqueIdentifier, value: groupId }];
    const [members, history] = await Promise.all([
        execReadCommand(
            `SELECT u.uid, u.username,
                    (SELECT COUNT(*) FROM dbo.UserTask ut INNER JOIN dbo.Tasks t ON t.tid = ut.tid
                      WHERE ut.uid = u.uid AND t.gid = @gid) AS current_workload,
                    (SELECT MAX(um.max_concurrent_tasks) FROM dbo.UserMetrics um WHERE um.uid = u.uid) AS historical_capacity
             FROM dbo.Users u
             INNER JOIN dbo.UserGroups ug ON ug.uid = u.uid
             WHERE ug.gid = @gid
             ORDER BY u.username`,
            params
        ),
        execReadCommand(
            `SELECT ta.uid, ta.task_category,
                    COUNT(*) AS finished,
                    100.0 * SUM(CASE WHEN ta.success_status = 'completed' THEN 1 ELSE 0 END) / COUNT(*) AS success_rate,
                    ISNULL(AVG(CASE WHEN ta.success_status = 'completed' THEN ta.completion_time_hours END), 0) AS avg_hours
             FROM dbo.TaskAnalytics ta
             INNER JOIN dbo.UserGroups ug ON ug.uid = ta.uid AND ug.gid = ta.gid
             WHERE ta.gid = @gid AND ta.success_status IN ('completed', 'failed')
             GROUP BY ta.uid, ta.task_category`,
            params
        ),
    ]);

    const expertiseByUser = new Map();
    history.forEach(row => {
        const key = String(row.uid).toLowerCase();
        if (!expertiseByUser.has(key)) expertiseByUser.set(key, {});
        const successRate = Number(Number(row.success_rate).toFixed(2));
        expertiseByUser.get(key)[row.task_category] = {
            expertise_score: expertiseScore({ finished: num(row.finished, 0), successRate, avgHours: num(row.avg_hours, 0) }),
            success_rate_percentage: successRate,
        };
    });

    return {
        team_members: members.map(m => {
            const known = expertiseByUser.get(String(m.uid).toLowerCase()) || {};
            const byCategory = {};
            CATEGORIES.forEach(cat => { byCategory[cat] = known[cat] || { ...DEFAULT_EXPERTISE }; });
            return {
                uid: m.uid,
                username: m.username,
                current_workload: num(m.current_workload, 0),
                historical_capacity: num(m.historical_capacity, DEFAULT_CAPACITY) || DEFAULT_CAPACITY,
                expertise_by_category: byCategory,
            };
        }),
    };
}

module.exports = { buildTeamContext, expertiseScore, CATEGORIES };

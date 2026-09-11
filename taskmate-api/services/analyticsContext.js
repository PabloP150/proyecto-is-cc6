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

/**
 * buildTeamContext(groupId) → {team_members: [{uid, username, current_workload, historical_capacity,
 *   expertise_by_category: {frontend|backend|database|testing|general: {expertise_score, success_rate_percentage}}}]}
 * current_workload = open assignments (UserTask, completed = 0) across all of the user's groups;
 * historical_capacity = highest daily max_concurrent_tasks recorded (3 when there is no history).
 */
async function buildTeamContext(groupId) {
    const params = [{ name: 'gid', type: TYPES.UniqueIdentifier, value: groupId }];
    const [members, expertise] = await Promise.all([
        execReadCommand(
            `SELECT u.uid, u.username,
                    (SELECT COUNT(*) FROM dbo.UserTask ut WHERE ut.uid = u.uid AND ut.completed = 0) AS current_workload,
                    (SELECT MAX(um.max_concurrent_tasks) FROM dbo.UserMetrics um WHERE um.uid = u.uid) AS historical_capacity
             FROM dbo.Users u
             INNER JOIN dbo.UserGroups ug ON ug.uid = u.uid
             WHERE ug.gid = @gid
             ORDER BY u.username`,
            params
        ),
        execReadCommand(
            `SELECT ue.uid, ue.task_category, ue.expertise_score, ue.success_rate_percentage
             FROM dbo.UserExpertise ue
             INNER JOIN dbo.UserGroups ug ON ug.uid = ue.uid
             WHERE ug.gid = @gid`,
            params
        ),
    ]);

    const expertiseByUser = new Map();
    expertise.forEach(row => {
        const key = String(row.uid).toLowerCase();
        if (!expertiseByUser.has(key)) expertiseByUser.set(key, {});
        expertiseByUser.get(key)[row.task_category] = {
            expertise_score: num(row.expertise_score, DEFAULT_EXPERTISE.expertise_score),
            success_rate_percentage: num(row.success_rate_percentage, DEFAULT_EXPERTISE.success_rate_percentage),
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

module.exports = { buildTeamContext, CATEGORIES };

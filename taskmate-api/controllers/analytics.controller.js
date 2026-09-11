const express = require('express');
const AnalyticsService = require('../services/AnalyticsService');
const AccessModel = require('../models/access.model');
const { buildTeamContext } = require('../services/analyticsContext');
const { execReadCommand, execWriteCommand } = require('../helpers/execQuery');
const { AppError, isAppError, sendError } = require('../helpers/errors');
const { assertUuid, sameId } = require('../middleware/groupAccess');
const { createLimiter } = require('../middleware/rateLimit');
const { TYPES } = require('tedious');
const { v4: uuidv4 } = require('uuid');
const llmService = require('../services/LLMService');

const TASK_CATEGORIES = ['frontend', 'backend', 'database', 'testing', 'general'];
const PRIVACY_MODES = ['team_leader_only', 'team', 'private'];
const MAX_TASK_DESCRIPTION = 2000; // it becomes part of the LLM prompt

// Known client errors keep their code; anything else becomes a generic 500 with the endpoint's message.
const fail = (res, error, message) => {
    if (isAppError(error)) return sendError(res, error);
    console.error(`${message}:`, error);
    return res.status(500).json({ success: false, error: message, code: 'INTERNAL_ERROR' });
};

const leaderOnly = (message) => new AppError('NOT_GROUP_ADMIN', message, 403);

/**
 * Analytics Controller
 * Provides REST API endpoints for analytics data access
 * Implements requirements 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 6.4
 */
class AnalyticsController {
    
    /**
     * Get user analytics summary
     * GET /api/analytics/user/:userId
     * Requirement 5.1: Individual user analytics data access
     */
    static async getUserAnalytics(req, res) {
        try {
            const userId = assertUuid(req.params.userId, 'userId');

            let analytics;
            if (sameId(req.user.userId, userId)) {
                analytics = await AnalyticsService.getUserAnalyticsSummary(userId);
            } else {
                // Another member: only through a group the caller leads, and only that group's slice
                // (the global summary would expose what the user does in every other group).
                const groupId = req.query.groupId;
                if (groupId === undefined) {
                    throw new AppError('VALIDATION_ERROR', 'groupId is required to view another member\'s analytics', 400);
                }
                assertUuid(groupId, 'groupId');
                if (!(await AnalyticsController._checkTeamAccess(req.user.userId, groupId))) {
                    throw leaderOnly('Access denied. Only team leaders can view the analytics of their team members.');
                }
                const team = await AnalyticsService.getTeamAnalyticsSummary(groupId);
                const member = (team && team.team_members || []).find(m => sameId(String(m.user_id), userId));
                if (!member) {
                    throw new AppError('NOT_FOUND', 'The user is not a member of this group', 404);
                }
                analytics = { group_id: groupId, ...member, updated_at: team.updated_at };
            }

            res.status(200).json({
                success: true,
                data: analytics
            });

        } catch (error) {
            fail(res, error, 'Failed to retrieve user analytics');
        }
    }
    
    /**
     * Get team analytics summary
     * GET /api/analytics/team/:groupId
     * Requirement 5.2: Team analytics dashboard with privacy controls
     */
    static async getTeamAnalytics(req, res) {
        try {
            const groupId = assertUuid(req.params.groupId, 'groupId');

            const hasAccess = await AnalyticsController._checkTeamAccess(req.user.userId, groupId);
            if (!hasAccess) {
                throw leaderOnly('Access denied. Only team leaders can view team analytics.');
            }

            const analytics = await AnalyticsService.getTeamAnalyticsSummary(groupId);

            res.status(200).json({
                success: true,
                data: analytics
            });

        } catch (error) {
            fail(res, error, 'Failed to retrieve team analytics');
        }
    }
    
    /**
     * Get workload distribution for a team
     * GET /api/analytics/workload/:groupId
     */
    static async getWorkloadDistribution(req, res) {
        try {
            const groupId = assertUuid(req.params.groupId, 'groupId');

            const hasAccess = await AnalyticsController._checkTeamAccess(req.user.userId, groupId);
            if (!hasAccess) {
                throw leaderOnly('Access denied. Only team leaders can view workload distribution.');
            }

            const workloadData = await AnalyticsService.getWorkloadDistribution(groupId);

            res.status(200).json({
                success: true,
                data: workloadData
            });

        } catch (error) {
            fail(res, error, 'Failed to retrieve workload distribution');
        }
    }
    
    /**
     * Get user completion trends
     * GET /api/analytics/trends/:userId?days=30
     */
    static async getUserCompletionTrends(req, res) {
        try {
            const userId = assertUuid(req.params.userId, 'userId');
            const parsedDays = Number.parseInt(req.query.days, 10);
            const days = Number.isFinite(parsedDays) ? Math.min(Math.max(parsedDays, 1), 365) : 30;

            // Trends span every group the user belongs to, so they are only shown to the user themself.
            if (!sameId(req.user.userId, userId)) {
                throw leaderOnly('Access denied. You can only view your own completion trends.');
            }

            const trends = await AnalyticsService.getUserCompletionTrends(userId, days);

            res.status(200).json({
                success: true,
                data: trends
            });

        } catch (error) {
            fail(res, error, 'Failed to retrieve completion trends');
        }
    }
    
    /**
     * Get category expertise rankings
     * GET /api/analytics/expertise/:groupId?category=frontend
     */
    static async getCategoryExpertiseRankings(req, res) {
        try {
            const groupId = assertUuid(req.params.groupId, 'groupId');
            const { category } = req.query;
            if (category !== undefined && !TASK_CATEGORIES.includes(category)) {
                throw new AppError('VALIDATION_ERROR', `category must be one of ${TASK_CATEGORIES.join(', ')}`, 400);
            }

            const hasAccess = await AnalyticsController._checkTeamAccess(req.user.userId, groupId);
            if (!hasAccess) {
                throw leaderOnly('Access denied. Only team leaders can view expertise rankings.');
            }

            const expertise = await AnalyticsService.getCategoryExpertiseRankings(groupId, category);

            res.status(200).json({
                success: true,
                data: expertise
            });

        } catch (error) {
            fail(res, error, 'Failed to retrieve expertise rankings');
        }
    }
    
    /**
     * Get analytics configuration
     * GET /api/analytics/config/:groupId
     * Requirement 5.3: Configuration endpoints for enabling/disabling analytics features
     */
    static async getAnalyticsConfig(req, res) {
        try {
            const groupId = assertUuid(req.params.groupId, 'groupId');

            // Only team leaders can view/modify analytics configuration
            const hasAccess = await AnalyticsController._checkTeamAccess(req.user.userId, groupId);
            if (!hasAccess) {
                throw leaderOnly('Access denied. Only team leaders can view analytics configuration.');
            }

            // Get current analytics configuration for the group
            const config = await AnalyticsController._getGroupAnalyticsConfig(groupId);

            res.status(200).json({
                success: true,
                data: config
            });

        } catch (error) {
            fail(res, error, 'Failed to retrieve analytics configuration');
        }
    }
    
    /**
     * Update analytics configuration
     * PUT /api/analytics/config/:groupId
     * Requirement 5.3: Configuration endpoints for enabling/disabling analytics features
     */
    static async updateAnalyticsConfig(req, res) {
        try {
            const groupId = assertUuid(req.params.groupId, 'groupId');

            // Only team leaders can modify analytics configuration (checked before looking at the body)
            if (!(await AnalyticsController._checkTeamAccess(req.user.userId, groupId))) {
                throw leaderOnly('Access denied. Only team leaders can modify analytics configuration.');
            }

            const { config } = req.body || {};
            if (!config || typeof config !== 'object' || Array.isArray(config)) {
                throw new AppError('VALIDATION_ERROR', 'Group ID and configuration data are required', 400);
            }
            // Mirrors the AnalyticsConfig CHECK constraints, which would otherwise surface as a 500
            if (config.privacy_mode !== undefined && !PRIVACY_MODES.includes(config.privacy_mode)) {
                throw new AppError('VALIDATION_ERROR', `privacy_mode must be one of ${PRIVACY_MODES.join(', ')}`, 400);
            }
            const retention = config.data_retention_days;
            if (retention !== undefined && !(Number.isInteger(retention) && retention >= 1 && retention <= 3650)) {
                throw new AppError('VALIDATION_ERROR', 'data_retention_days must be an integer between 1 and 3650', 400);
            }

            // Update analytics configuration
            const result = await AnalyticsController._updateGroupAnalyticsConfig(groupId, config);

            res.status(200).json({
                success: true,
                message: 'Analytics configuration updated successfully',
                data: result
            });

        } catch (error) {
            fail(res, error, 'Failed to update analytics configuration');
        }
    }
    
    /**
     * Get analytics dashboard data
     * GET /api/analytics/dashboard/:groupId
     * Requirement 5.2: Team analytics dashboard endpoints
     */
    static async getDashboardData(req, res) {
        try {
            const groupId = assertUuid(req.params.groupId, 'groupId');

            // Same rule as /team, /workload and /expertise, whose data the dashboard aggregates
            const hasAccess = await AnalyticsController._checkTeamAccess(req.user.userId, groupId);
            if (!hasAccess) {
                throw leaderOnly('Access denied. Only team leaders can view the team dashboard.');
            }

            const [teamAnalytics, workloadDistribution, expertiseRankings] = await Promise.all([
                AnalyticsService.getTeamAnalyticsSummary(groupId),
                AnalyticsService.getWorkloadDistribution(groupId),
                AnalyticsService.getCategoryExpertiseRankings(groupId)
            ]);

            const dashboardData = {
                team_analytics: teamAnalytics,
                workload_distribution: workloadDistribution,
                expertise_rankings: expertiseRankings,
                updated_at: new Date().toISOString()
            };
            
            res.status(200).json({
                success: true,
                data: dashboardData
            });
            
        } catch (error) {
            fail(res, error, 'Failed to retrieve dashboard data');
        }
    }
    
    /**
     * Record task assignment (manual endpoint)
     * POST /api/analytics/assignment
     */
    static async recordTaskAssignment(req, res) {
        try {
            const { taskId, userId, groupId, category } = req.body || {};

            // Membership is checked before the rest of the body so non-members learn nothing from validation errors.
            if (!groupId) {
                throw new AppError('VALIDATION_ERROR', 'Task ID, User ID, and Group ID are required', 400);
            }
            assertUuid(groupId, 'groupId');
            if (!(await AnalyticsController._checkMembership(req.user.userId, groupId))) {
                throw new AppError('NOT_GROUP_MEMBER', 'Access denied. You must be a team member.', 403);
            }

            if (!taskId || !userId) {
                throw new AppError('VALIDATION_ERROR', 'Task ID, User ID, and Group ID are required', 400);
            }
            assertUuid(taskId, 'taskId');
            assertUuid(userId, 'userId');
            if (category !== undefined && !TASK_CATEGORIES.includes(category)) {
                throw new AppError('VALIDATION_ERROR', `category must be one of ${TASK_CATEGORIES.join(', ')}`, 400);
            }

            // The task must be in the group and the assignee (a target user) a member of it.
            const [taskGroup, assigneeIsMember] = await Promise.all([
                AccessModel.resolveGroupId('task', taskId),
                AccessModel.isGroupMember(userId, groupId),
            ]);
            if (!sameId(taskGroup, groupId)) {
                throw new AppError('TASK_NOT_FOUND', 'Task not found', 404);
            }
            if (!assigneeIsMember) {
                throw new AppError('VALIDATION_ERROR', 'The user is not a member of this group', 400);
            }

            const result = await AnalyticsService.recordTaskAssignment(
                taskId,
                userId,
                groupId,
                category || 'general'
            );
            
            res.status(201).json({
                success: true,
                message: 'Task assignment recorded in analytics',
                data: result
            });
            
        } catch (error) {
            fail(res, error, 'Failed to record task assignment');
        }
    }
    
    /**
     * Record task completion (manual endpoint)
     * POST /api/analytics/completion
     */
    static async recordTaskCompletion(req, res) {
        try {
            const { taskId, success = true } = req.body || {};

            if (!taskId) {
                throw new AppError('VALIDATION_ERROR', 'Task ID is required', 400);
            }
            assertUuid(taskId, 'taskId');

            // The task may live on in Complete/DeleteTask; any of them tells us its group.
            const groupId = await AnalyticsController._resolveTaskGroup(taskId);
            if (!groupId) {
                throw new AppError('TASK_NOT_FOUND', 'Task not found', 404);
            }
            if (!(await AnalyticsController._checkMembership(req.user.userId, groupId))) {
                throw new AppError('NOT_GROUP_MEMBER', 'Access denied. You must be a team member.', 403);
            }

            const result = await AnalyticsService.recordTaskCompletion(taskId, success !== false);
            
            res.status(200).json({
                success: true,
                message: 'Task completion recorded in analytics',
                data: result
            });
            
        } catch (error) {
            fail(res, error, 'Failed to record task completion');
        }
    }
    
    /**
     * Get task assignment recommendations
     * POST /api/analytics/recommendations
     * Requirement 2.1, 2.2, 2.3, 2.4: Task assignment recommendations with AI
     */
    static async getTaskRecommendations(req, res) {
        try {
            const { groupId, taskCategory, taskDescription } = req.body || {};

            // Membership first (only the group id is needed for it), then the rest of the body
            assertUuid(groupId, 'groupId');
            const hasAccess = await AnalyticsController._checkMembership(req.user.userId, groupId);
            if (!hasAccess) {
                throw new AppError('NOT_GROUP_MEMBER', 'Access denied. You must be a team member to get recommendations.', 403);
            }

            if (!taskCategory || !taskDescription) {
                throw new AppError('VALIDATION_ERROR', 'Group ID, task category, and task description are required', 400);
            }
            if (!TASK_CATEGORIES.includes(taskCategory)) {
                throw new AppError('VALIDATION_ERROR', `taskCategory must be one of ${TASK_CATEGORIES.join(', ')}`, 400);
            }
            if (typeof taskDescription !== 'string' || taskDescription.length > MAX_TASK_DESCRIPTION) {
                throw new AppError('VALIDATION_ERROR', `taskDescription must be text of at most ${MAX_TASK_DESCRIPTION} characters`, 400);
            }

            const recommendations = await AnalyticsController._getRecommendationsFromAgent(
                groupId, taskCategory, taskDescription, req.body
            );

            res.status(200).json({
                success: true,
                recommendations: recommendations.recommendations || [],
                suggested_plan: recommendations.suggested_plan || null,
                task_category: recommendations.task_category || taskCategory
            });

        } catch (error) {
            fail(res, error, 'Failed to get task recommendations');
        }
    }

    // Private helper methods for access control
    // (the metrics batch runs from AnalyticsBatchJob; it is no longer exposed over HTTP)

    /**
     * Check if the user is a member of the group
     * Requirement 6.4: Proper access controls and data privacy compliance
     */
    static async _checkMembership(requesterId, groupId) {
        return AccessModel.isGroupMember(requesterId, groupId);
    }

    static async _resolveTaskGroup(taskId) {
        for (const kind of ['task', 'completed', 'deleted']) {
            const gid = await AccessModel.resolveGroupId(kind, taskId);
            if (gid) return gid;
        }
        return null;
    }

    // Team leader of this group = its admin or a member holding a role whose name contains "leader".
    static async _checkTeamAccess(requesterId, groupId) {
        return AccessModel.isGroupLeader(requesterId, groupId);
    }

    /**
     * Get analytics configuration for a group
     */
    static async _getGroupAnalyticsConfig(groupId) {
        const rows = await execReadCommand(
            `SELECT * FROM dbo.AnalyticsConfig WHERE gid = @gid`,
            [{ name: 'gid', type: TYPES.UniqueIdentifier, value: groupId }]
        );

        if (rows && rows.length > 0) {
            const r = rows[0];
            return {
                group_id: groupId,
                analytics_enabled: !!r.analytics_enabled,
                track_completion_time: !!r.track_completion_time,
                track_success_rate: !!r.track_success_rate,
                track_workload: !!r.track_workload,
                track_expertise: !!r.track_expertise,
                track_capacity: !!r.track_capacity,
                data_retention_days: r.data_retention_days,
                privacy_mode: r.privacy_mode,
                updated_at: r.updated_at
            };
        }

        // Return defaults if no config exists yet
        return {
            group_id: groupId,
            analytics_enabled: true,
            track_completion_time: true,
            track_success_rate: true,
            track_workload: true,
            track_expertise: true,
            track_capacity: true,
            data_retention_days: 365,
            privacy_mode: 'team_leader_only',
            updated_at: new Date().toISOString()
        };
    }

    /**
     * Update analytics configuration for a group
     */
    static async _updateGroupAnalyticsConfig(groupId, config) {
        const b = (val, def) => (val !== undefined ? (val ? 1 : 0) : def);

        const params = [
            { name: 'gid',                  type: TYPES.UniqueIdentifier, value: groupId },
            { name: 'analytics_enabled',    type: TYPES.Bit,     value: b(config.analytics_enabled, 1) },
            { name: 'track_completion_time',type: TYPES.Bit,     value: b(config.track_completion_time, 1) },
            { name: 'track_success_rate',   type: TYPES.Bit,     value: b(config.track_success_rate, 1) },
            { name: 'track_workload',       type: TYPES.Bit,     value: b(config.track_workload, 1) },
            { name: 'track_expertise',      type: TYPES.Bit,     value: b(config.track_expertise, 1) },
            { name: 'track_capacity',       type: TYPES.Bit,     value: b(config.track_capacity, 1) },
            { name: 'data_retention_days',  type: TYPES.Int,     value: config.data_retention_days || 365 },
            { name: 'privacy_mode',         type: TYPES.VarChar, value: config.privacy_mode || 'team_leader_only' },
        ];

        await execWriteCommand(`
            MERGE dbo.AnalyticsConfig AS target
            USING (SELECT @gid AS gid) AS source ON target.gid = source.gid
            WHEN MATCHED THEN UPDATE SET
                analytics_enabled     = @analytics_enabled,
                track_completion_time = @track_completion_time,
                track_success_rate    = @track_success_rate,
                track_workload        = @track_workload,
                track_expertise       = @track_expertise,
                track_capacity        = @track_capacity,
                data_retention_days   = @data_retention_days,
                privacy_mode          = @privacy_mode,
                updated_at            = SYSDATETIMEOFFSET()
            WHEN NOT MATCHED THEN INSERT
                (gid, analytics_enabled, track_completion_time, track_success_rate,
                 track_workload, track_expertise, track_capacity, data_retention_days, privacy_mode)
            VALUES
                (@gid, @analytics_enabled, @track_completion_time, @track_success_rate,
                 @track_workload, @track_expertise, @track_capacity, @data_retention_days, @privacy_mode);
        `, params);

        return await AnalyticsController._getGroupAnalyticsConfig(groupId);
    }
    
    /**
     * Get recommendations from analytics agent via MCP WebSocket
     */
    static async _getRecommendationsFromAgent(groupId, taskCategory, taskDescription, context) {
        const requestData = {
            group_id: groupId,
            task_category: taskCategory,
            task_description: taskDescription,
            priority: context.priority || 'normal',
            deadline: context.deadline || 'flexible',
            additional_context: context.additional_context || '',
            // Real team data so the agent does not fall back to its demo mock
            team_context: await buildTeamContext(groupId)
        };

        return new Promise((resolve, reject) => {
            const requestId = uuidv4();
            const sessionId = `analytics_${requestId}`;

            const timeout = setTimeout(() => {
                llmService.removeAllListeners(sessionId);
                reject(new Error('Analytics agent request timeout'));
            }, 30000);

            llmService.once(sessionId, (response) => {
                clearTimeout(timeout);
                if (response.event === 'analytics_response') {
                    resolve(response.data);
                } else if (response.event === 'analytics_error') {
                    reject(new Error(response.error || 'Analytics agent error'));
                } else {
                    reject(new Error('Unexpected response from analytics agent'));
                }
            });

            const giveUp = (reason) => {
                clearTimeout(timeout);
                llmService.removeAllListeners(sessionId);
                reject(new Error(`Failed to send analytics request: ${reason}`));
            };

            // send() resolves false when the agent is unreachable: fail now instead of waiting for the timeout
            Promise.resolve(llmService.send({
                requestId,
                sessionId,
                type: 'analytics',
                action: 'get_task_assignment_recommendations',
                data: requestData
            })).then(sent => {
                if (sent === false) giveUp('analytics agent unavailable');
            }).catch(error => giveUp(error.message));
        });
    }
}

// Mounted by app.js at /api/analytics behind requireAuth + apiLimiter.
// Each handler performs its own authorization, so they stay safe if reused elsewhere.
// Every call becomes an LLM request on the shared Python link.
const recommendationsLimiter = createLimiter({
    windowMs: 60 * 1000,
    limit: 10,
    keyByUser: true,
    message: 'Too many recommendation requests, please try again in a minute.',
});

const router = express.Router();
router.get('/user/:userId', AnalyticsController.getUserAnalytics);
router.get('/team/:groupId', AnalyticsController.getTeamAnalytics);
router.get('/workload/:groupId', AnalyticsController.getWorkloadDistribution);
router.get('/trends/:userId', AnalyticsController.getUserCompletionTrends);
router.get('/expertise/:groupId', AnalyticsController.getCategoryExpertiseRankings);
router.get('/config/:groupId', AnalyticsController.getAnalyticsConfig);
router.put('/config/:groupId', AnalyticsController.updateAnalyticsConfig);
router.get('/dashboard/:groupId', AnalyticsController.getDashboardData);
router.post('/recommendations', recommendationsLimiter, AnalyticsController.getTaskRecommendations);
router.post('/assignment', AnalyticsController.recordTaskAssignment);
router.post('/completion', AnalyticsController.recordTaskCompletion);

AnalyticsController.router = router;

module.exports = AnalyticsController;
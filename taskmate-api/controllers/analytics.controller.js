const AnalyticsService = require('../services/AnalyticsService');
const { execReadCommand, execWriteCommand } = require('../helpers/execQuery');
const { TYPES } = require('tedious');
const { v4: uuidv4 } = require('uuid');

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
            const { userId } = req.params;
            
            if (!userId) {
                return res.status(400).json({
                    success: false,
                    error: 'User ID is required'
                });
            }
            
            const analytics = await AnalyticsService.getUserAnalyticsSummary(userId);
            
            res.status(200).json({
                success: true,
                data: analytics
            });
            
        } catch (error) {
            console.error('Error getting user analytics:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve user analytics'
            });
        }
    }
    
    /**
     * Get team analytics summary
     * GET /api/analytics/team/:groupId
     * Requirement 5.2: Team analytics dashboard with privacy controls
     */
    static async getTeamAnalytics(req, res) {
        try {
            const { groupId } = req.params;
            const requesterId = req.user.userId;

            if (!groupId) {
                return res.status(400).json({
                    success: false,
                    error: 'Group ID is required'
                });
            }

            const hasAccess = await AnalyticsController._checkTeamAccess(requesterId, groupId);
            if (!hasAccess) {
                return res.status(403).json({
                    success: false,
                    error: 'Access denied. Only team leaders can view team analytics.'
                });
            }
            
            const analytics = await AnalyticsService.getTeamAnalyticsSummary(groupId);
            
            res.status(200).json({
                success: true,
                data: analytics
            });
            
        } catch (error) {
            console.error('Error getting team analytics:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve team analytics'
            });
        }
    }
    
    /**
     * Get workload distribution for a team
     * GET /api/analytics/workload/:groupId
     */
    static async getWorkloadDistribution(req, res) {
        try {
            const { groupId } = req.params;
            const requesterId = req.user.userId;

            if (!groupId) {
                return res.status(400).json({
                    success: false,
                    error: 'Group ID is required'
                });
            }

            const hasAccess = await AnalyticsController._checkTeamAccess(requesterId, groupId);
            if (!hasAccess) {
                return res.status(403).json({
                    success: false,
                    error: 'Access denied. Only team leaders can view workload distribution.'
                });
            }
            
            const workloadData = await AnalyticsService.getWorkloadDistribution(groupId);
            
            res.status(200).json({
                success: true,
                data: workloadData
            });
            
        } catch (error) {
            console.error('Error getting workload distribution:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve workload distribution'
            });
        }
    }
    
    /**
     * Get user completion trends
     * GET /api/analytics/trends/:userId?days=30
     */
    static async getUserCompletionTrends(req, res) {
        try {
            const { userId } = req.params;
            const { days = 30, requesterId } = req.query;
            
            if (!userId) {
                return res.status(400).json({
                    success: false,
                    error: 'User ID is required'
                });
            }
            
            // Users can view their own trends, or team leaders can view team member trends
            if (requesterId && requesterId !== userId) {
                const hasAccess = await AnalyticsController._checkUserAccess(requesterId, userId);
                if (!hasAccess) {
                    return res.status(403).json({
                        success: false,
                        error: 'Access denied. You can only view your own trends or team member trends if you are a team leader.'
                    });
                }
            }
            
            const trends = await AnalyticsService.getUserCompletionTrends(userId, parseInt(days));
            
            res.status(200).json({
                success: true,
                data: trends
            });
            
        } catch (error) {
            console.error('Error getting user completion trends:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve completion trends'
            });
        }
    }
    
    /**
     * Get category expertise rankings
     * GET /api/analytics/expertise/:groupId?category=frontend
     */
    static async getCategoryExpertiseRankings(req, res) {
        try {
            const { groupId } = req.params;
            const { category, requesterId } = req.query;
            
            if (!groupId) {
                return res.status(400).json({
                    success: false,
                    error: 'Group ID is required'
                });
            }
            
            // Access control check
            if (requesterId) {
                const hasAccess = await AnalyticsController._checkTeamAccess(requesterId, groupId);
                if (!hasAccess) {
                    return res.status(403).json({
                        success: false,
                        error: 'Access denied. Only team leaders can view expertise rankings.'
                    });
                }
            }
            
            const expertise = await AnalyticsService.getCategoryExpertiseRankings(groupId, category);
            
            res.status(200).json({
                success: true,
                data: expertise
            });
            
        } catch (error) {
            console.error('Error getting expertise rankings:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve expertise rankings'
            });
        }
    }
    
    /**
     * Get analytics configuration
     * GET /api/analytics/config/:groupId
     * Requirement 5.3: Configuration endpoints for enabling/disabling analytics features
     */
    static async getAnalyticsConfig(req, res) {
        try {
            const { groupId } = req.params;
            const { requesterId } = req.query;
            
            if (!groupId) {
                return res.status(400).json({
                    success: false,
                    error: 'Group ID is required'
                });
            }
            
            // Only team leaders can view/modify analytics configuration
            if (requesterId) {
                const hasAccess = await AnalyticsController._checkTeamAccess(requesterId, groupId);
                if (!hasAccess) {
                    return res.status(403).json({
                        success: false,
                        error: 'Access denied. Only team leaders can view analytics configuration.'
                    });
                }
            }
            
            // Get current analytics configuration for the group
            const config = await AnalyticsController._getGroupAnalyticsConfig(groupId);
            
            res.status(200).json({
                success: true,
                data: config
            });
            
        } catch (error) {
            console.error('Error getting analytics config:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve analytics configuration'
            });
        }
    }
    
    /**
     * Update analytics configuration
     * PUT /api/analytics/config/:groupId
     * Requirement 5.3: Configuration endpoints for enabling/disabling analytics features
     */
    static async updateAnalyticsConfig(req, res) {
        try {
            const { groupId } = req.params;
            const { requesterId, config } = req.body;
            
            if (!groupId || !config) {
                return res.status(400).json({
                    success: false,
                    error: 'Group ID and configuration data are required'
                });
            }
            
            // Only team leaders can modify analytics configuration
            if (requesterId) {
                const hasAccess = await AnalyticsController._checkTeamAccess(requesterId, groupId);
                if (!hasAccess) {
                    return res.status(403).json({
                        success: false,
                        error: 'Access denied. Only team leaders can modify analytics configuration.'
                    });
                }
            }
            
            // Update analytics configuration
            const result = await AnalyticsController._updateGroupAnalyticsConfig(groupId, config);
            
            res.status(200).json({
                success: true,
                message: 'Analytics configuration updated successfully',
                data: result
            });
            
        } catch (error) {
            console.error('Error updating analytics config:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update analytics configuration'
            });
        }
    }
    
    /**
     * Get analytics dashboard data
     * GET /api/analytics/dashboard/:groupId
     * Requirement 5.2: Team analytics dashboard endpoints
     */
    static async getDashboardData(req, res) {
        try {
            const { groupId } = req.params;
            const requesterId = req.user.userId;

            if (!groupId) {
                return res.status(400).json({
                    success: false,
                    error: 'Group ID is required'
                });
            }

            const hasAccess = await AnalyticsController._checkMembership(requesterId, groupId);
            if (!hasAccess) {
                return res.status(403).json({
                    success: false,
                    error: 'Access denied. You must be a team member to view this dashboard.'
                });
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
            console.error('Error getting dashboard data:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve dashboard data'
            });
        }
    }
    
    /**
     * Record task assignment (manual endpoint)
     * POST /api/analytics/assignment
     */
    static async recordTaskAssignment(req, res) {
        try {
            const { taskId, userId, groupId, category } = req.body;
            
            if (!taskId || !userId || !groupId) {
                return res.status(400).json({
                    success: false,
                    error: 'Task ID, User ID, and Group ID are required'
                });
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
            console.error('Error recording task assignment:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to record task assignment'
            });
        }
    }
    
    /**
     * Record task completion (manual endpoint)
     * POST /api/analytics/completion
     */
    static async recordTaskCompletion(req, res) {
        try {
            const { taskId, success = true } = req.body;
            
            if (!taskId) {
                return res.status(400).json({
                    success: false,
                    error: 'Task ID is required'
                });
            }
            
            const result = await AnalyticsService.recordTaskCompletion(taskId, success);
            
            res.status(200).json({
                success: true,
                message: 'Task completion recorded in analytics',
                data: result
            });
            
        } catch (error) {
            console.error('Error recording task completion:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to record task completion'
            });
        }
    }
    
    /**
     * Get task assignment recommendations
     * POST /api/analytics/recommendations
     * Requirement 2.1, 2.2, 2.3, 2.4: Task assignment recommendations with AI
     */
    static async getTaskRecommendations(req, res) {
        try {
            const { groupId, taskCategory, taskDescription } = req.body;
            const requesterId = req.user.userId;

            if (!groupId || !taskCategory || !taskDescription) {
                return res.status(400).json({
                    success: false,
                    error: 'Group ID, task category, and task description are required'
                });
            }

            const hasAccess = await AnalyticsController._checkMembership(requesterId, groupId);
            if (!hasAccess) {
                return res.status(403).json({
                    success: false,
                    error: 'Access denied. You must be a team member to get recommendations.'
                });
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
            console.error('Error getting task recommendations:', error.message);
            res.status(500).json({
                success: false,
                error: 'Failed to get task recommendations'
            });
        }
    }

    /**
     * Batch update user metrics (admin endpoint)
     * POST /api/analytics/batch-update
     */
    static async batchUpdateMetrics(req, res) {
        try {
            const result = await AnalyticsService.batchUpdateUserMetrics();
            
            res.status(200).json({
                success: true,
                message: 'Batch metrics update completed',
                data: result
            });
            
        } catch (error) {
            console.error('Error in batch metrics update:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update metrics'
            });
        }
    }
    
    // Private helper methods for access control
    
    /**
     * Check if user has access to team analytics (is team leader)
     * Requirement 6.4: Proper access controls and data privacy compliance
     */
    static async _checkMembership(requesterId, groupId) {
        try {
            const result = await execReadCommand(
                `SELECT 1 FROM dbo.UserGroups WHERE uid = @uid AND gid = @gid`,
                [
                    { name: 'uid', type: TYPES.UniqueIdentifier, value: requesterId },
                    { name: 'gid', type: TYPES.UniqueIdentifier, value: groupId }
                ]
            );
            return result && result.length > 0;
        } catch (error) {
            console.error('Error checking membership:', error);
            return false;
        }
    }

    static async _checkTeamAccess(requesterId, groupId) {
        try {
            const query = `
                SELECT ugr.gr_id, gr.gr_name
                FROM dbo.UserGroupRoles ugr
                JOIN dbo.GroupRoles gr ON ugr.gr_id = gr.gr_id
                WHERE ugr.uid = @requesterId AND ugr.gid = @groupId
            `;
            
            const params = [
                { name: 'requesterId', type: TYPES.UniqueIdentifier, value: requesterId },
                { name: 'groupId', type: TYPES.UniqueIdentifier, value: groupId }
            ];
            
            const result = await execReadCommand(query, params);
            
            // Check if user has team leader role
            return result && result.length > 0 && 
                   result.some(role => role.gr_name && role.gr_name.toLowerCase().includes('leader'));
            
        } catch (error) {
            console.error('Error checking team access:', error);
            return false;
        }
    }
    
    /**
     * Check if user has access to another user's analytics
     */
    static async _checkUserAccess(requesterId, targetUserId) {
        try {
            // Users can always access their own data
            if (requesterId === targetUserId) {
                return true;
            }
            
            // Check if requester is a team leader in any group that includes the target user
            const query = `
                SELECT DISTINCT ugr1.gid
                FROM dbo.UserGroupRoles ugr1
                JOIN dbo.GroupRoles gr ON ugr1.gr_id = gr.gr_id
                JOIN dbo.UserGroupRoles ugr2 ON ugr1.gid = ugr2.gid
                WHERE ugr1.uid = @requesterId 
                  AND ugr2.uid = @targetUserId
                  AND gr.gr_name LIKE '%leader%'
            `;
            
            const params = [
                { name: 'requesterId', type: TYPES.UniqueIdentifier, value: requesterId },
                { name: 'targetUserId', type: TYPES.UniqueIdentifier, value: targetUserId }
            ];
            
            const result = await execReadCommand(query, params);
            return result && result.length > 0;
            
        } catch (error) {
            console.error('Error checking user access:', error);
            return false;
        }
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
                updated_at            = GETDATE()
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
     * Get mock dashboard data for demo/testing purposes
     */
    static _getMockDashboardData(groupId) {
        const teamData = {
            'test-group-456': { // Development Team
                team_analytics: {
                    total_members: 5,
                    active_tasks: 14,
                    completion_rate: 87.25,
                    avg_response_time: 2.15
                },
                workload_distribution: [
                    { name: 'Sarah Chen', workload: 4, capacity: 5, utilization: 80 },
                    { name: 'Marcus Johnson', workload: 3, capacity: 5, utilization: 60 },
                    { name: 'Elena Rodriguez', workload: 5, capacity: 6, utilization: 83 },
                    { name: 'David Kim', workload: 2, capacity: 4, utilization: 50 },
                    { name: 'Alex Thompson', workload: 3, capacity: 5, utilization: 60 }
                ],
                expertise_rankings: [
                    { category: 'Frontend', expert: 'Sarah Chen', score: 94 },
                    { category: 'Backend', expert: 'Marcus Johnson', score: 89 },
                    { category: 'Database', expert: 'Elena Rodriguez', score: 91 },
                    { category: 'Testing', expert: 'David Kim', score: 86 }
                ]
            },
            'test-group-789': { // Design Team
                team_analytics: {
                    total_members: 4,
                    active_tasks: 9,
                    completion_rate: 92.50,
                    avg_response_time: 1.75
                },
                workload_distribution: [
                    { name: 'Maya Patel', workload: 3, capacity: 4, utilization: 75 },
                    { name: 'James Wilson', workload: 2, capacity: 5, utilization: 40 },
                    { name: 'Zoe Martinez', workload: 4, capacity: 5, utilization: 80 },
                    { name: 'Ryan Foster', workload: 1, capacity: 3, utilization: 33 }
                ],
                expertise_rankings: [
                    { category: 'UI Design', expert: 'Maya Patel', score: 96 },
                    { category: 'UX Research', expert: 'James Wilson', score: 88 },
                    { category: 'Prototyping', expert: 'Zoe Martinez', score: 92 },
                    { category: 'Visual Design', expert: 'Maya Patel', score: 94 }
                ]
            },
            'test-group-123': { // QA Team
                team_analytics: {
                    total_members: 6,
                    active_tasks: 18,
                    completion_rate: 89.75,
                    avg_response_time: 1.95
                },
                workload_distribution: [
                    { name: 'Lisa Wang', workload: 4, capacity: 5, utilization: 80 },
                    { name: 'Tom Anderson', workload: 3, capacity: 4, utilization: 75 },
                    { name: 'Priya Sharma', workload: 5, capacity: 6, utilization: 83 },
                    { name: 'Jake Miller', workload: 2, capacity: 5, utilization: 40 },
                    { name: 'Nina Kowalski', workload: 3, capacity: 4, utilization: 75 },
                    { name: 'Carlos Mendez', workload: 4, capacity: 5, utilization: 80 }
                ],
                expertise_rankings: [
                    { category: 'Automation', expert: 'Lisa Wang', score: 93 },
                    { category: 'Manual Testing', expert: 'Tom Anderson', score: 87 },
                    { category: 'Performance', expert: 'Priya Sharma', score: 90 },
                    { category: 'Security Testing', expert: 'Carlos Mendez', score: 85 }
                ]
            }
        };

        const currentTeam = teamData[groupId] || teamData['test-group-456'];
        
        return {
            ...currentTeam,
            updated_at: new Date().toISOString()
        };
    }
    
    /**
     * Get recommendations from analytics agent via MCP WebSocket
     */
    static async _getRecommendationsFromAgent(groupId, taskCategory, taskDescription, context) {
        const llmService = require('../services/LLMService');

        const requestData = {
            group_id: groupId,
            task_category: taskCategory,
            task_description: taskDescription,
            priority: context.priority || 'normal',
            deadline: context.deadline || 'flexible',
            additional_context: context.additional_context || ''
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

            llmService.send({
                requestId,
                sessionId,
                type: 'analytics',
                action: 'get_task_assignment_recommendations',
                data: requestData
            }).catch(error => {
                clearTimeout(timeout);
                llmService.removeAllListeners(sessionId);
                reject(new Error(`Failed to send analytics request: ${error.message}`));
            });
        });
    }
}

module.exports = AnalyticsController;
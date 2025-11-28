const { execReadCommand } = require('../helpers/execQuery');
const { TYPES } = require('tedious');

/**
 * Analytics Access Control Middleware
 * Implements requirement 6.4: Proper access controls and data privacy compliance
 */
class AnalyticsAccessMiddleware {
    
    /**
     * Middleware to check if user has team leader access
     * Requirement 5.2: Only team leaders can view team analytics
     */
    static requireTeamLeaderAccess() {
        return async (req, res, next) => {
            try {
                const { groupId } = req.params;
                const { requesterId } = req.query || req.body;
                
                if (!requesterId) {
                    return res.status(401).json({
                        success: false,
                        error: 'Authentication required. Please provide requesterId.'
                    });
                }
                
                if (!groupId) {
                    return res.status(400).json({
                        success: false,
                        error: 'Group ID is required'
                    });
                }
                
                const hasAccess = await AnalyticsAccessMiddleware._checkTeamLeaderAccess(requesterId, groupId);
                
                if (!hasAccess) {
                    return res.status(403).json({
                        success: false,
                        error: 'Access denied. Only team leaders can access team analytics.'
                    });
                }
                
                // Add user info to request for downstream use
                req.analytics = {
                    requesterId,
                    groupId,
                    hasTeamLeaderAccess: true
                };
                
                next();
                
            } catch (error) {
                console.error('Error in team leader access check:', error);
                res.status(500).json({
                    success: false,
                    error: 'Failed to verify access permissions'
                });
            }
        };
    }
    
    /**
     * Middleware to check if user can access individual user analytics
     * Users can access their own data, team leaders can access team member data
     */
    static requireUserAnalyticsAccess() {
        return async (req, res, next) => {
            try {
                const { userId } = req.params;
                const { requesterId } = req.query || req.body;
                
                if (!requesterId) {
                    return res.status(401).json({
                        success: false,
                        error: 'Authentication required. Please provide requesterId.'
                    });
                }
                
                if (!userId) {
                    return res.status(400).json({
                        success: false,
                        error: 'User ID is required'
                    });
                }
                
                // Users can always access their own data
                if (requesterId === userId) {
                    req.analytics = {
                        requesterId,
                        userId,
                        isOwnData: true
                    };
                    return next();
                }\n                \n                // Check if requester is a team leader for the target user
                const hasAccess = await AnalyticsAccessMiddleware._checkUserAnalyticsAccess(requesterId, userId);
                
                if (!hasAccess) {
                    return res.status(403).json({
                        success: false,
                        error: 'Access denied. You can only view your own analytics or team member analytics if you are a team leader.'
                    });
                }\n                \n                req.analytics = {\n                    requesterId,\n                    userId,\n                    isOwnData: false,\n                    hasTeamLeaderAccess: true\n                };\n                \n                next();\n                \n            } catch (error) {\n                console.error('Error in user analytics access check:', error);\n                res.status(500).json({\n                    success: false,\n                    error: 'Failed to verify access permissions'\n                });\n            }\n        };\n    }\n    \n    /**\n     * Middleware for optional authentication\n     * Allows access without authentication but adds user context if provided\n     */\n    static optionalAuth() {\n        return (req, res, next) => {\n            const { requesterId } = req.query || req.body;\n            \n            if (requesterId) {\n                req.analytics = {\n                    requesterId,\n                    authenticated: true\n                };\n            } else {\n                req.analytics = {\n                    authenticated: false\n                };\n            }\n            \n            next();\n        };\n    }\n    \n    /**\n     * Middleware to log analytics access for audit purposes\n     */\n    static logAnalyticsAccess(operation) {\n        return (req, res, next) => {\n            const timestamp = new Date().toISOString();\n            const { requesterId } = req.analytics || {};\n            const { groupId, userId } = req.params;\n            \n            console.log(`[${timestamp}] Analytics Access: ${operation}`, {\n                requesterId,\n                groupId,\n                userId,\n                ip: req.ip,\n                userAgent: req.get('User-Agent')\n            });\n            \n            next();\n        };\n    }\n    \n    /**\n     * Middleware to validate analytics data privacy settings\n     * Ensures data is filtered according to privacy configuration\n     */\n    static enforcePrivacySettings() {\n        return async (req, res, next) => {\n            try {\n                const { groupId } = req.params;\n                \n                if (groupId) {\n                    // Get privacy settings for the group\n                    const privacySettings = await AnalyticsAccessMiddleware._getPrivacySettings(groupId);\n                    \n                    req.analytics = req.analytics || {};\n                    req.analytics.privacySettings = privacySettings;\n                }\n                \n                next();\n                \n            } catch (error) {\n                console.error('Error enforcing privacy settings:', error);\n                // Don't fail the request, just log the error\n                next();\n            }\n        };\n    }\n    \n    // Private helper methods\n    \n    /**\n     * Check if user has team leader access to a group\n     */\n    static async _checkTeamLeaderAccess(requesterId, groupId) {\n        try {\n            const query = `\n                SELECT ugr.role_id, gr.role_name\n                FROM dbo.UserGroupRoles ugr\n                JOIN dbo.GroupRoles gr ON ugr.role_id = gr.role_id\n                WHERE ugr.uid = @requesterId AND ugr.gid = @groupId\n            `;\n            \n            const params = [\n                { name: 'requesterId', type: TYPES.UniqueIdentifier, value: requesterId },\n                { name: 'groupId', type: TYPES.UniqueIdentifier, value: groupId }\n            ];\n            \n            const result = await execReadCommand(query, params);\n            \n            // Check if user has team leader role\n            return result && result.length > 0 && \n                   result.some(role => role.role_name && role.role_name.toLowerCase().includes('leader'));\n            \n        } catch (error) {\n            console.error('Error checking team leader access:', error);\n            return false;\n        }\n    }\n    \n    /**\n     * Check if user can access another user's analytics\n     */\n    static async _checkUserAnalyticsAccess(requesterId, targetUserId) {\n        try {\n            // Check if requester is a team leader in any group that includes the target user\n            const query = `\n                SELECT DISTINCT ugr1.gid\n                FROM dbo.UserGroupRoles ugr1\n                JOIN dbo.GroupRoles gr ON ugr1.role_id = gr.role_id\n                JOIN dbo.UserGroupRoles ugr2 ON ugr1.gid = ugr2.gid\n                WHERE ugr1.uid = @requesterId \n                  AND ugr2.uid = @targetUserId\n                  AND gr.role_name LIKE '%leader%'\n            `;\n            \n            const params = [\n                { name: 'requesterId', type: TYPES.UniqueIdentifier, value: requesterId },\n                { name: 'targetUserId', type: TYPES.UniqueIdentifier, value: targetUserId }\n            ];\n            \n            const result = await execReadCommand(query, params);\n            return result && result.length > 0;\n            \n        } catch (error) {\n            console.error('Error checking user analytics access:', error);\n            return false;\n        }\n    }\n    \n    /**\n     * Get privacy settings for a group\n     */\n    static async _getPrivacySettings(groupId) {\n        // For now, return default privacy settings\n        // In a full implementation, this would query a configuration table\n        return {\n            group_id: groupId,\n            privacy_mode: 'team_leader_only',\n            anonymize_individual_data: false,\n            data_retention_days: 365,\n            allow_cross_team_comparison: false\n        };\n    }\n}\n\nmodule.exports = AnalyticsAccessMiddleware;"
const { execReadCommand } = require('../helpers/execQuery');
const { TYPES } = require('tedious');

class AnalyticsAccessMiddleware {

    static requireTeamLeaderAccess() {
        return async (req, res, next) => {
            try {
                const { groupId } = req.params;
                const { requesterId } = req.query || req.body;

                if (!requesterId) {
                    return res.status(401).json({ success: false, error: 'Authentication required. Please provide requesterId.' });
                }
                if (!groupId) {
                    return res.status(400).json({ success: false, error: 'Group ID is required' });
                }

                const hasAccess = await AnalyticsAccessMiddleware._checkTeamLeaderAccess(requesterId, groupId);
                if (!hasAccess) {
                    return res.status(403).json({ success: false, error: 'Access denied. Only team leaders can access team analytics.' });
                }

                req.analytics = { requesterId, groupId, hasTeamLeaderAccess: true };
                next();
            } catch (error) {
                console.error('Error in team leader access check:', error);
                res.status(500).json({ success: false, error: 'Failed to verify access permissions' });
            }
        };
    }

    static requireUserAnalyticsAccess() {
        return async (req, res, next) => {
            try {
                const { userId } = req.params;
                const { requesterId } = req.query || req.body;

                if (!requesterId) {
                    return res.status(401).json({ success: false, error: 'Authentication required. Please provide requesterId.' });
                }
                if (!userId) {
                    return res.status(400).json({ success: false, error: 'User ID is required' });
                }

                // Users can always access their own data
                if (requesterId === userId) {
                    req.analytics = { requesterId, userId, isOwnData: true };
                    return next();
                }

                // Check if requester is a team leader for the target user
                const hasAccess = await AnalyticsAccessMiddleware._checkUserAnalyticsAccess(requesterId, userId);
                if (!hasAccess) {
                    return res.status(403).json({ success: false, error: 'Access denied. You can only view your own analytics or team member analytics if you are a team leader.' });
                }

                req.analytics = { requesterId, userId, isOwnData: false, hasTeamLeaderAccess: true };
                next();
            } catch (error) {
                console.error('Error in user analytics access check:', error);
                res.status(500).json({ success: false, error: 'Failed to verify access permissions' });
            }
        };
    }

    static optionalAuth() {
        return (req, res, next) => {
            const { requesterId } = req.query || req.body;
            req.analytics = requesterId ? { requesterId, authenticated: true } : { authenticated: false };
            next();
        };
    }

    static logAnalyticsAccess(operation) {
        return (req, res, next) => {
            const { requesterId } = req.analytics || {};
            const { groupId, userId } = req.params;
            console.log(`[${new Date().toISOString()}] Analytics Access: ${operation}`, {
                requesterId, groupId, userId, ip: req.ip, userAgent: req.get('User-Agent')
            });
            next();
        };
    }

    static enforcePrivacySettings() {
        return async (req, res, next) => {
            try {
                const { groupId } = req.params;
                if (groupId) {
                    const privacySettings = await AnalyticsAccessMiddleware._getPrivacySettings(groupId);
                    req.analytics = req.analytics || {};
                    req.analytics.privacySettings = privacySettings;
                }
                next();
            } catch (error) {
                console.error('Error enforcing privacy settings:', error);
                next();
            }
        };
    }

    static async _checkTeamLeaderAccess(requesterId, groupId) {
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
            return result.length > 0 && result.some(role => role.gr_name?.toLowerCase().includes('leader'));
        } catch (error) {
            console.error('Error checking team leader access:', error);
            return false;
        }
    }

    static async _checkUserAnalyticsAccess(requesterId, targetUserId) {
        try {
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
            return result.length > 0;
        } catch (error) {
            console.error('Error checking user analytics access:', error);
            return false;
        }
    }

    static async _getPrivacySettings(groupId) {
        return {
            group_id: groupId,
            privacy_mode: 'team_leader_only',
            anonymize_individual_data: false,
            data_retention_days: 365,
            allow_cross_team_comparison: false
        };
    }
}

module.exports = AnalyticsAccessMiddleware;

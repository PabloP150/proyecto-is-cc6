#!/usr/bin/env node

/**
 * Analytics Bridge - Connects Python Analytics Agent with Node.js AnalyticsService
 * Usage: node analytics_bridge.js <method> <params_json>
 */

const AnalyticsService = require('./services/AnalyticsService');

async function main() {
    try {
        const method = process.argv[2];
        const paramsJson = process.argv[3];
        
        if (!method) {
            console.error(JSON.stringify({ success: false, error: 'Method is required' }));
            process.exit(1);
        }
        
        let params = {};
        if (paramsJson) {
            try {
                params = JSON.parse(paramsJson);
            } catch (e) {
                console.error(JSON.stringify({ success: false, error: 'Invalid JSON parameters' }));
                process.exit(1);
            }
        }
        
        let result;
        
        switch (method) {
            case 'recordTaskAssignment':
                result = await AnalyticsService.recordTaskAssignment(
                    params.task_id,
                    params.user_id,
                    params.group_id,
                    params.category
                );
                break;
                
            case 'recordTaskCompletion':
                result = await AnalyticsService.recordTaskCompletion(
                    params.task_id,
                    params.success
                );
                break;
                
            case 'getCurrentWorkload':
                result = await AnalyticsService.getCurrentWorkload(params.user_id);
                break;
                
            case 'getUserExpertise':
                result = await AnalyticsService.getUserExpertise(params.user_id);
                break;
                
            case 'getHistoricalCapacity':
                result = await AnalyticsService.getHistoricalCapacity(params.user_id);
                break;
                
            case 'getUserAnalyticsSummary':
                const summary = await AnalyticsService.getUserAnalyticsSummary(params.user_id);
                result = { success: true, analytics: summary };
                break;
                
            case 'getTeamAnalyticsSummary':
                const teamSummary = await AnalyticsService.getTeamAnalyticsSummary(params.group_id);
                result = { success: true, team_analytics: teamSummary };
                break;
                
            case 'getWorkloadDistribution':
                const workloadDist = await AnalyticsService.getWorkloadDistribution(params.group_id);
                result = { success: true, workload_distribution: workloadDist };
                break;
                
            case 'getCategoryExpertiseRankings':
                const expertiseRankings = await AnalyticsService.getCategoryExpertiseRankings(
                    params.group_id,
                    params.category
                );
                result = { success: true, expertise_rankings: expertiseRankings };
                break;
                
            case 'getTeamMembers':
                // This would need to be implemented in a separate service
                // For now, return mock data or integrate with existing user service
                result = await getTeamMembersFromDatabase(params.group_id);
                break;
                
            default:
                result = { success: false, error: `Unknown method: ${method}` };
        }
        
        console.log(JSON.stringify(result));
        
    } catch (error) {
        console.error(JSON.stringify({ 
            success: false, 
            error: error.message,
            stack: error.stack 
        }));
        process.exit(1);
    }
}

async function getTeamMembersFromDatabase(groupId) {
    try {
        // This would integrate with the existing user/group service
        // For now, we'll use the database helpers directly
        const { execReadCommand } = require('./helpers/execQuery');
        const { TYPES } = require('tedious');
        
        const query = `
            SELECT u.uid, u.username
            FROM dbo.Users u
            JOIN dbo.UserGroups ug ON u.uid = ug.uid
            WHERE ug.gid = @gid
            ORDER BY u.username
        `;
        
        const params = [
            { name: 'gid', type: TYPES.UniqueIdentifier, value: groupId }
        ];
        
        const results = await execReadCommand(query, params);
        
        return {
            success: true,
            team_members: results.map(row => ({
                uid: row.uid,
                username: row.username
            }))
        };
        
    } catch (error) {
        console.error('Error getting team members:', error);
        return {
            success: false,
            error: error.message,
            team_members: []
        };
    }
}

// Run the main function
main();
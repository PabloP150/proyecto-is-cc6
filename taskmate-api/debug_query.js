const { execReadCommand } = require('./helpers/execQuery');
const { TYPES } = require('tedious');

async function debugWorkloadQuery(groupId) {
    try {
        console.log(`Executing debug query for group ID: ${groupId}`);
        const query = `
            SELECT 
                u.uid,
                u.username,
                MIN(gr.gr_name) as role_name, -- Get a representative role
                COUNT(CASE WHEN ut.completed = 0 THEN 1 END) as current_workload
            FROM dbo.Users u
            JOIN dbo.UserGroups ug ON u.uid = ug.uid AND ug.gid = @gid
            LEFT JOIN dbo.UserTask ut ON u.uid = ut.uid
            LEFT JOIN dbo.UserGroupRoles ugr ON u.uid = ugr.uid AND ugr.gid = @gid
            LEFT JOIN dbo.GroupRoles gr ON ugr.gr_id = gr.gr_id
            WHERE ug.gid = @gid
            GROUP BY u.uid, u.username
            ORDER BY u.username;
        `;
        const params = [
            { name: 'gid', type: TYPES.UniqueIdentifier, value: groupId }
        ];

        const results = await execReadCommand(query, params);
        console.log('--- Direct SQL Query Results (DEBUG) ---');
        console.log(JSON.stringify(results, null, 2));
        console.log('-----------------------------------------');
    } catch (error) {
        console.error('Error during debug query:', error);
    }
}

// Replace with the actual group ID you are testing with
const testGroupId = '05BEECB1-AFF3-4813-8BAC-D68B1D82F8E4'; 
debugWorkloadQuery(testGroupId);

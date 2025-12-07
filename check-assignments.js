// Script to check task assignments in the calor-tracking group
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from taskmate-api directory
dotenv.config({ path: path.join(__dirname, 'taskmate-api', '.env') });

const { execReadCommand } = require('./taskmate-api/helpers/execQuery');
const { TYPES } = require('tedious');

async function checkTaskAssignments() {
    try {
        console.log('🔍 Checking task assignments...\n');

        // 1. Get all groups
        console.log('📋 Groups in database:');
        const groups = await execReadCommand('SELECT gid, name, adminId FROM dbo.Groups', []);
        
        if (groups.length === 0) {
            console.log('  No groups found in database');
            return;
        }
        
        groups.forEach(group => {
            console.log(`  - ${group.name} (ID: ${group.gid})`);
        });

        // 2. Find calor-tracking group (or any group with "calor" in name)
        const calorGroup = groups.find(g => g.name.toLowerCase().includes('calor'));
        if (!calorGroup) {
            console.log('\n❌ No group found with "calor" in the name');
            console.log('Available groups:', groups.map(g => g.name).join(', '));
            
            // Let's check the first group as fallback
            if (groups.length > 0) {
                console.log(`\n🔄 Checking first available group: ${groups[0].name}`);
                await checkGroupAssignments(groups[0]);
            }
            return;
        }

        console.log(`\n🎯 Found group: ${calorGroup.name} (${calorGroup.gid})`);
        await checkGroupAssignments(calorGroup);

    } catch (error) {
        console.error('❌ Error checking assignments:', error);
        console.error('Error details:', error.message);
    }
}

async function checkGroupAssignments(group) {
    try {
        // 3. Get tasks in this group
        const tasks = await execReadCommand(
            'SELECT tid, name, description, list, percentage FROM dbo.Tasks WHERE gid = @gid',
            [{ name: 'gid', type: TYPES.UniqueIdentifier, value: group.gid }]
        );

        console.log(`\n📝 Tasks in ${group.name}:`);
        if (tasks.length === 0) {
            console.log('  No tasks found in this group');
        } else {
            let assignedTasksCount = 0;
            
            for (const task of tasks) {
                console.log(`\n  📌 ${task.name} (${task.percentage}% complete)`);
                console.log(`     Description: ${task.description}`);
                console.log(`     List: ${task.list}`);
                console.log(`     Task ID: ${task.tid}`);

                // 4. Check assignments for this task
                const assignments = await execReadCommand(
                    `SELECT ut.uid, ut.completed, u.username 
                     FROM dbo.UserTask ut 
                     JOIN dbo.Users u ON ut.uid = u.uid 
                     WHERE ut.tid = @tid`,
                    [{ name: 'tid', type: TYPES.UniqueIdentifier, value: task.tid }]
                );

                if (assignments.length === 0) {
                    console.log('     👤 ⚠️  NO USERS ASSIGNED');
                } else {
                    assignedTasksCount++;
                    console.log('     👥 Assigned users:');
                    assignments.forEach(assignment => {
                        const status = assignment.completed ? '✅ Completed' : '⏳ In Progress';
                        console.log(`       - ${assignment.username} (${status})`);
                    });
                }
            }
            
            console.log(`\n📊 Assignment Summary for ${group.name}:`);
            console.log(`  - Total tasks: ${tasks.length}`);
            console.log(`  - Tasks with assignments: ${assignedTasksCount}`);
            console.log(`  - Unassigned tasks: ${tasks.length - assignedTasksCount}`);
        }

        // 5. Get group members
        console.log(`\n👥 Members in ${group.name}:`);
        const members = await execReadCommand(
            `SELECT u.uid, u.username 
             FROM dbo.Users u 
             JOIN dbo.UserGroups ug ON u.uid = ug.uid 
             WHERE ug.gid = @gid`,
            [{ name: 'gid', type: TYPES.UniqueIdentifier, value: group.gid }]
        );

        if (members.length === 0) {
            console.log('  ⚠️  No members found in this group');
        } else {
            members.forEach(member => {
                console.log(`  - ${member.username} (${member.uid})`);
            });
        }

        console.log(`\n📈 Final Summary:`);
        console.log(`  - Group: ${group.name}`);
        console.log(`  - Total tasks: ${tasks.length}`);
        console.log(`  - Total members: ${members.length}`);
        
        if (tasks.length > 0 && members.length > 0) {
            // Count assigned tasks properly
            let assignedCount = 0;
            for (const task of tasks) {
                const assignments = await execReadCommand(
                    'SELECT COUNT(*) as count FROM dbo.UserTask WHERE tid = @tid',
                    [{ name: 'tid', type: TYPES.UniqueIdentifier, value: task.tid }]
                );
                if (assignments[0].count > 0) {
                    assignedCount++;
                }
            }
            
            const unassignedTasks = tasks.length - assignedCount;
            
            if (unassignedTasks > 0) {
                console.log(`  ⚠️  ${unassignedTasks} tasks need user assignments!`);
            } else {
                console.log(`  ✅ All tasks are assigned to users`);
            }
        }

    } catch (error) {
        console.error('❌ Error checking group assignments:', error);
    }
}

// Run the check
checkTaskAssignments().then(() => {
    console.log('\n✅ Assignment check completed');
    process.exit(0);
}).catch(error => {
    console.error('❌ Script failed:', error);
    process.exit(1);
});
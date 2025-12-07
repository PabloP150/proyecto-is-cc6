// Bulk assignment script to assign 80% of unassigned tasks to team members
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from taskmate-api directory
dotenv.config({ path: path.join(__dirname, 'taskmate-api', '.env') });

const { execReadCommand, execWriteCommand } = require('./taskmate-api/helpers/execQuery');
const { TYPES } = require('tedious');
const { v4: uuidv4 } = require('uuid');

// Task categories for smart assignment
const TASK_CATEGORIES = {
    'frontend': ['ui', 'react', 'native', 'mockup', 'wireframe', 'dashboard', 'screen'],
    'backend': ['api', 'backend', 'server', 'auth', 'database', 'deploy'],
    'testing': ['test', 'uat', 'bug', 'performance'],
    'design': ['design', 'mockup', 'wireframe', 'ui/ux'],
    'general': ['doc', 'requirement', 'tech', 'store', 'submit']
};

// User expertise (based on common naming patterns)
const USER_EXPERTISE = {
    'sarah.chen': 'frontend',
    'marcus.johnson': 'backend', 
    'elena.rodriguez': 'backend',
    'david.kim': 'testing',
    'alex.thompson': 'frontend',
    'maya.patel': 'design',
    'james.wilson': 'design',
    'zoe.martinez': 'frontend',
    'ryan.foster': 'backend',
    'lisa.wang': 'testing',
    'tom.anderson': 'backend',
    'priya.sharma': 'frontend',
    'jake.miller': 'testing',
    'nina.kowalski': 'design',
    'carlos.mendez': 'general'
};

function categorizeTask(taskName, taskDescription) {
    const text = (taskName + ' ' + taskDescription).toLowerCase();
    
    for (const [category, keywords] of Object.entries(TASK_CATEGORIES)) {
        if (keywords.some(keyword => text.includes(keyword))) {
            return category;
        }
    }
    return 'general';
}

function getRandomCompletionStatus() {
    // 30% chance of being completed, 70% in progress
    const rand = Math.random();
    if (rand < 0.3) {
        return { completed: true, percentage: 100 };
    } else {
        return { completed: false, percentage: Math.floor(Math.random() * 80) }; // 0-79% for in-progress
    }
}

function getRandomCompletionTime() {
    // Random completion time between 1-12 hours
    return Math.random() * 11 + 1;
}

async function bulkAssignTasks() {
    try {
        console.log('🚀 Starting bulk task assignment...\n');

        // 1. Find Calorie Tracker App group
        const groups = await execReadCommand(
            'SELECT gid, name FROM dbo.Groups WHERE name LIKE @pattern',
            [{ name: 'pattern', type: TYPES.VarChar, value: '%Calorie Tracker%' }]
        );

        if (groups.length === 0) {
            console.log('❌ Calorie Tracker App group not found');
            return;
        }

        const group = groups[0];
        console.log(`🎯 Found group: ${group.name} (${group.gid})`);

        // 2. Get all unassigned tasks
        const unassignedTasks = await execReadCommand(
            `SELECT t.tid, t.name, t.description, t.percentage 
             FROM dbo.Tasks t 
             WHERE t.gid = @gid 
             AND NOT EXISTS (SELECT 1 FROM dbo.UserTask ut WHERE ut.tid = t.tid)`,
            [{ name: 'gid', type: TYPES.UniqueIdentifier, value: group.gid }]
        );

        console.log(`📝 Found ${unassignedTasks.length} unassigned tasks`);

        if (unassignedTasks.length === 0) {
            console.log('✅ All tasks are already assigned!');
            return;
        }

        // 3. Get group members
        const members = await execReadCommand(
            `SELECT u.uid, u.username 
             FROM dbo.Users u 
             JOIN dbo.UserGroups ug ON u.uid = ug.uid 
             WHERE ug.gid = @gid`,
            [{ name: 'gid', type: TYPES.UniqueIdentifier, value: group.gid }]
        );

        console.log(`👥 Found ${members.length} team members`);

        // 4. Calculate how many tasks to assign (80%)
        const tasksToAssign = Math.floor(unassignedTasks.length * 0.8);
        console.log(`🎯 Will assign ${tasksToAssign} out of ${unassignedTasks.length} tasks (80%)\n`);

        // 5. Shuffle tasks for random selection
        const shuffledTasks = [...unassignedTasks].sort(() => Math.random() - 0.5);
        const selectedTasks = shuffledTasks.slice(0, tasksToAssign);

        // 6. Group members by expertise
        const membersByExpertise = {};
        members.forEach(member => {
            const expertise = USER_EXPERTISE[member.username] || 'general';
            if (!membersByExpertise[expertise]) {
                membersByExpertise[expertise] = [];
            }
            membersByExpertise[expertise].push(member);
        });

        console.log('👨‍💻 Team expertise distribution:');
        Object.entries(membersByExpertise).forEach(([expertise, teamMembers]) => {
            console.log(`  ${expertise}: ${teamMembers.map(m => m.username).join(', ')}`);
        });
        console.log('');

        // 7. Assign tasks
        let assignmentsCreated = 0;
        const assignmentSummary = {};

        for (const task of selectedTasks) {
            try {
                // Categorize the task
                const taskCategory = categorizeTask(task.name, task.description);
                
                // Find best members for this task category
                let availableMembers = membersByExpertise[taskCategory] || [];
                if (availableMembers.length === 0) {
                    // Fallback to general members if no specialists available
                    availableMembers = membersByExpertise['general'] || members;
                }
                if (availableMembers.length === 0) {
                    // Ultimate fallback to any member
                    availableMembers = members;
                }

                // Select a random member from the appropriate expertise group
                const selectedMember = availableMembers[Math.floor(Math.random() * availableMembers.length)];
                
                // Get random completion status
                const { completed, percentage } = getRandomCompletionStatus();
                
                // Create UserTask assignment
                const utid = uuidv4();
                await execWriteCommand(
                    'INSERT INTO dbo.UserTask (utid, uid, tid, completed) VALUES (@utid, @uid, @tid, @completed)',
                    [
                        { name: 'utid', type: TYPES.UniqueIdentifier, value: utid },
                        { name: 'uid', type: TYPES.UniqueIdentifier, value: selectedMember.uid },
                        { name: 'tid', type: TYPES.UniqueIdentifier, value: task.tid },
                        { name: 'completed', type: TYPES.Bit, value: completed }
                    ]
                );

                // Update task percentage if it was 0
                if (task.percentage === 0 && percentage > 0) {
                    await execWriteCommand(
                        'UPDATE dbo.Tasks SET percentage = @percentage WHERE tid = @tid',
                        [
                            { name: 'percentage', type: TYPES.Int, value: percentage },
                            { name: 'tid', type: TYPES.UniqueIdentifier, value: task.tid }
                        ]
                    );
                }

                // Create TaskAnalytics record
                const analyticsId = uuidv4();
                const assignedAt = new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000); // Random time in last 7 days
                const completedAt = completed ? new Date(assignedAt.getTime() + Math.random() * 24 * 60 * 60 * 1000) : null;
                const completionTime = completed ? getRandomCompletionTime() : null;
                
                await execWriteCommand(
                    `INSERT INTO dbo.TaskAnalytics 
                     (id, tid, uid, gid, task_category, assigned_at, completed_at, success_status, completion_time_hours) 
                     VALUES (@id, @tid, @uid, @gid, @category, @assigned_at, @completed_at, @status, @completion_time)`,
                    [
                        { name: 'id', type: TYPES.UniqueIdentifier, value: analyticsId },
                        { name: 'tid', type: TYPES.UniqueIdentifier, value: task.tid },
                        { name: 'uid', type: TYPES.UniqueIdentifier, value: selectedMember.uid },
                        { name: 'gid', type: TYPES.UniqueIdentifier, value: group.gid },
                        { name: 'category', type: TYPES.VarChar, value: taskCategory },
                        { name: 'assigned_at', type: TYPES.DateTime2, value: assignedAt },
                        { name: 'completed_at', type: TYPES.DateTime2, value: completedAt },
                        { name: 'status', type: TYPES.VarChar, value: completed ? 'completed' : 'pending' },
                        { name: 'completion_time', type: TYPES.Decimal, value: completionTime }
                    ]
                );

                // Track assignment summary
                if (!assignmentSummary[selectedMember.username]) {
                    assignmentSummary[selectedMember.username] = { total: 0, completed: 0, pending: 0 };
                }
                assignmentSummary[selectedMember.username].total++;
                if (completed) {
                    assignmentSummary[selectedMember.username].completed++;
                } else {
                    assignmentSummary[selectedMember.username].pending++;
                }

                const status = completed ? '✅ Completed' : '⏳ In Progress';
                console.log(`  ✅ "${task.name}" → ${selectedMember.username} (${taskCategory}) ${status}`);
                assignmentsCreated++;

            } catch (error) {
                console.log(`  ❌ Failed to assign "${task.name}": ${error.message}`);
            }
        }

        // 8. Update user expertise based on new assignments
        console.log('\n📊 Updating user expertise...');
        for (const member of members) {
            const memberTasks = await execReadCommand(
                `SELECT ta.task_category, COUNT(*) as task_count, 
                        AVG(CASE WHEN ta.completion_time_hours IS NOT NULL THEN ta.completion_time_hours END) as avg_time,
                        (COUNT(CASE WHEN ta.success_status = 'completed' THEN 1 END) * 100.0 / COUNT(*)) as success_rate
                 FROM dbo.TaskAnalytics ta 
                 WHERE ta.uid = @uid AND ta.gid = @gid
                 GROUP BY ta.task_category`,
                [
                    { name: 'uid', type: TYPES.UniqueIdentifier, value: member.uid },
                    { name: 'gid', type: TYPES.UniqueIdentifier, value: group.gid }
                ]
            );

            for (const categoryData of memberTasks) {
                const expertiseScore = Math.min(100, categoryData.success_rate * 0.7 + (categoryData.task_count * 5));
                
                // Insert or update user expertise
                await execWriteCommand(
                    `MERGE dbo.UserExpertise AS target
                     USING (SELECT @uid as uid, @category as task_category) AS source
                     ON target.uid = source.uid AND target.task_category = source.task_category
                     WHEN MATCHED THEN
                         UPDATE SET expertise_score = @score, tasks_completed = @task_count, 
                                   avg_completion_time_hours = @avg_time, success_rate_percentage = @success_rate,
                                   last_updated = GETDATE()
                     WHEN NOT MATCHED THEN
                         INSERT (id, uid, task_category, expertise_score, tasks_completed, 
                                avg_completion_time_hours, success_rate_percentage, last_updated)
                         VALUES (NEWID(), @uid, @category, @score, @task_count, @avg_time, @success_rate, GETDATE());`,
                    [
                        { name: 'uid', type: TYPES.UniqueIdentifier, value: member.uid },
                        { name: 'category', type: TYPES.VarChar, value: categoryData.task_category },
                        { name: 'score', type: TYPES.Decimal, value: expertiseScore },
                        { name: 'task_count', type: TYPES.Int, value: categoryData.task_count },
                        { name: 'avg_time', type: TYPES.Decimal, value: categoryData.avg_time || 0 },
                        { name: 'success_rate', type: TYPES.Decimal, value: categoryData.success_rate }
                    ]
                );
            }
        }

        // 9. Final summary
        console.log('\n📈 Assignment Summary:');
        console.log(`  - Group: ${group.name}`);
        console.log(`  - Total unassigned tasks: ${unassignedTasks.length}`);
        console.log(`  - Tasks assigned: ${assignmentsCreated}`);
        console.log(`  - Assignment rate: ${((assignmentsCreated / unassignedTasks.length) * 100).toFixed(1)}%`);
        
        console.log('\n👥 Workload Distribution:');
        Object.entries(assignmentSummary).forEach(([username, stats]) => {
            console.log(`  - ${username}: ${stats.total} tasks (${stats.completed} completed, ${stats.pending} pending)`);
        });

        console.log('\n✅ Bulk assignment completed successfully!');
        console.log('🎯 Your analytics dashboard should now show realistic workload data.');

    } catch (error) {
        console.error('❌ Error during bulk assignment:', error);
        console.error('Error details:', error.message);
    }
}

// Run the bulk assignment
bulkAssignTasks().then(() => {
    console.log('\n🎉 Script completed successfully');
    process.exit(0);
}).catch(error => {
    console.error('❌ Script failed:', error);
    process.exit(1);
});
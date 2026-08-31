const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const http = require('http');
const { TYPES } = require('tedious');
const { v4: uuidv4 } = require('uuid');

// IMPORTANT: Load environment variables BEFORE requiring modules that read process.env
// Load .env from taskmate-api first (optional)
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: false });

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not defined in environment variables. Server will not start.');
  process.exit(1);
}

const WebSocketServer = require('./services/WebSocketServer');
const tasksController = require('./controllers/tasks.controller');
const userController = require('./controllers/user.controller');
const nodesController = require('./controllers/nodes.controller');
const groupController = require('./controllers/group.controller');
const edgesController = require('./controllers/edges.controller');
const completeController = require('./controllers/complete.controller');
const deleteController = require('./controllers/delete.controller');
const userTaskController = require('./controllers/usertask.controller');
const userGroupRolesController = require('./controllers/userGroupRoles.controller');
const groupRolesController = require('./controllers/groupRoles.controller');
const analyticsController = require('./controllers/analytics.controller');
const requireAuth = require('./middleware/auth.middleware');
const { execReadCommand, execWriteCommand } = require('./helpers/execQuery');


const {
    API_PORT = 9000,
    SERVER_TAG = 'API EXPRESS'
} = process.env;

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/tasks', tasksController);
app.use('/api/users', userController);
app.use('/api/groups', groupController);
app.use('/api/nodes', nodesController);
app.use('/api/edges', edgesController);
app.use('/api/completados', completeController);
app.use('/api/delete', deleteController);
app.use('/api/usertask', userTaskController);
app.use('/api/usergrouproles', userGroupRolesController);
app.use('/api/grouproles', groupRolesController);

// Analytics routes (all require JWT)
app.get('/api/analytics/user/:userId', requireAuth, analyticsController.getUserAnalytics);
app.get('/api/analytics/team/:groupId', requireAuth, analyticsController.getTeamAnalytics);
app.get('/api/analytics/workload/:groupId', requireAuth, analyticsController.getWorkloadDistribution);
app.get('/api/analytics/trends/:userId', requireAuth, analyticsController.getUserCompletionTrends);
app.get('/api/analytics/expertise/:groupId', requireAuth, analyticsController.getCategoryExpertiseRankings);
app.get('/api/analytics/config/:groupId', requireAuth, analyticsController.getAnalyticsConfig);
app.put('/api/analytics/config/:groupId', requireAuth, analyticsController.updateAnalyticsConfig);
app.get('/api/analytics/dashboard/:groupId', requireAuth, analyticsController.getDashboardData);
app.post('/api/analytics/recommendations', requireAuth, analyticsController.getTaskRecommendations);
app.post('/api/analytics/assignment', requireAuth, analyticsController.recordTaskAssignment);
app.post('/api/analytics/completion', requireAuth, analyticsController.recordTaskCompletion);
app.post('/api/analytics/batch-update', requireAuth, analyticsController.batchUpdateMetrics);

// Utility endpoint to populate task assignments for analytics
app.post('/api/utils/populate-assignments/:groupId', async (req, res) => {
    try {
        const { groupId } = req.params;

        // Get group info
        const groups = await execReadCommand(
            'SELECT gid, name FROM dbo.Groups WHERE gid = @gid',
            [{ name: 'gid', type: TYPES.UniqueIdentifier, value: groupId }]
        );

        if (groups.length === 0) {
            return res.status(404).json({ error: 'Group not found' });
        }

        const group = groups[0];

        // Get members
        const members = await execReadCommand(
            `SELECT u.uid, u.username FROM dbo.Users u 
             JOIN dbo.UserGroups ug ON u.uid = ug.uid 
             WHERE ug.gid = @gid`,
            [{ name: 'gid', type: TYPES.UniqueIdentifier, value: groupId }]
        );

        // Get unassigned tasks
        const unassignedTasks = await execReadCommand(
            `SELECT t.tid, t.name, t.description, t.percentage 
             FROM dbo.Tasks t 
             WHERE t.gid = @gid 
             AND NOT EXISTS (SELECT 1 FROM dbo.UserTask ut WHERE ut.tid = t.tid)`,
            [{ name: 'gid', type: TYPES.UniqueIdentifier, value: groupId }]
        );

        let assignmentsCreated = 0;

        // Assign tasks to random members (UserTask + TaskAnalytics in parallel per task)
        if (members.length > 0) {
            await Promise.all(unassignedTasks.map(async (task) => {
                const randomMember = members[Math.floor(Math.random() * members.length)];
                const isCompleted = task.percentage >= 100;
                const utid = uuidv4();
                const analyticsId = uuidv4();
                const assignedAt = new Date();
                const completedAt = isCompleted ? new Date(assignedAt.getTime() + Math.random() * 24 * 60 * 60 * 1000) : null;

                await Promise.all([
                    execWriteCommand(
                        'INSERT INTO dbo.UserTask (utid, uid, tid, completed) VALUES (@utid, @uid, @tid, @completed)',
                        [
                            { name: 'utid', type: TYPES.UniqueIdentifier, value: utid },
                            { name: 'uid', type: TYPES.UniqueIdentifier, value: randomMember.uid },
                            { name: 'tid', type: TYPES.UniqueIdentifier, value: task.tid },
                            { name: 'completed', type: TYPES.Bit, value: isCompleted }
                        ]
                    ),
                    execWriteCommand(
                        `INSERT INTO dbo.TaskAnalytics
                         (id, tid, uid, gid, task_category, assigned_at, completed_at, success_status, completion_time_hours)
                         VALUES (@id, @tid, @uid, @gid, @category, @assigned_at, @completed_at, @status, @completion_time)`,
                        [
                            { name: 'id', type: TYPES.UniqueIdentifier, value: analyticsId },
                            { name: 'tid', type: TYPES.UniqueIdentifier, value: task.tid },
                            { name: 'uid', type: TYPES.UniqueIdentifier, value: randomMember.uid },
                            { name: 'gid', type: TYPES.UniqueIdentifier, value: groupId },
                            { name: 'category', type: TYPES.VarChar, value: 'general' },
                            { name: 'assigned_at', type: TYPES.DateTime2, value: assignedAt },
                            { name: 'completed_at', type: TYPES.DateTime2, value: completedAt },
                            { name: 'status', type: TYPES.VarChar, value: isCompleted ? 'completed' : 'pending' },
                            { name: 'completion_time', type: TYPES.Decimal, value: completedAt ? Math.random() * 8 + 1 : null }
                        ]
                    )
                ]);
                assignmentsCreated++;
            }));
        }

        res.json({
            success: true,
            group: group.name,
            members: members.length,
            totalTasks: unassignedTasks.length,
            assignmentsCreated
        });

    } catch (error) {
        console.error('Error populating assignments:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create HTTP server
const server = http.createServer(app);

// Initialize a single WebSocket server to handle all connections
const wsServer = new WebSocketServer(server);

const { initialize: initPool } = require('./helpers/pool');

initPool()
    .then(() => {
        server.listen(API_PORT, () => {
            console.log(`API running on PORT ${API_PORT}`);
            console.log(`WebSocket server available at ws://localhost:${API_PORT}/chat and /insights`);
        });
    })
    .catch(err => {
        console.error('FATAL: Could not initialize DB connection pool:', err.message);
        process.exit(1);
    });

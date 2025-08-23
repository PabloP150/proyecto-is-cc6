// Mock database for development when Azure SQL is not available
const mockUsers = [
    {
        uid: 'user-123',
        username: 'testuser',
        password: 'password123' // In real app, this would be hashed
    },
    {
        uid: 'user-456',
        username: 'admin',
        password: 'admin123'
    }
];

const mockGroups = [
    {
        gid: 'group-123',
        adminId: 'user-123',
        name: "testuser's Group"
    },
    {
        gid: 'group-456',
        adminId: 'user-456',
        name: "admin's Group"
    }
];

const mockUserGroups = [
    { uid: 'user-123', gid: 'group-123' },
    { uid: 'user-456', gid: 'group-456' }
];

const mockTasks = [
    {
        tid: 'task-1',
        gid: 'group-123',
        name: 'Sample Task 1',
        description: 'This is a sample task for testing',
        list: 'To Do',
        datetime: new Date('2025-08-25T10:00:00'),
        percentage: 0
    },
    {
        tid: 'task-2',
        gid: 'group-123',
        name: 'Sample Task 2',
        description: 'Another sample task',
        list: 'In Progress',
        datetime: new Date('2025-08-26T14:00:00'),
        percentage: 50
    }
];

const mockNodes = [
    {
        nid: 'node-1',
        gid: 'group-123',
        name: 'Project Start',
        description: 'Initial project setup',
        date: new Date('2025-08-24'),
        completed: true,
        percentage: 100,
        x_pos: 100,
        y_pos: 100
    },
    {
        nid: 'node-2',
        gid: 'group-123',
        name: 'Development Phase',
        description: 'Main development work',
        date: new Date('2025-08-30'),
        completed: false,
        percentage: 30,
        x_pos: 300,
        y_pos: 200
    }
];

const mockEdges = [
    {
        eid: 'edge-1',
        gid: 'group-123',
        sourceId: 'node-1',
        targetId: 'node-2',
        prerequisite: true
    }
];

class MockDatabase {
    static async getUserByUsername(username) {
        const user = mockUsers.find(u => u.username === username);
        return user ? [user] : [];
    }

    static async getidUserByUsername(username) {
        return mockUsers.find(u => u.username === username);
    }

    static async addUser({ uid, username, password }) {
        mockUsers.push({ uid, username, password });
        return { success: true };
    }

    static async addGroup({ gid, adminId, name }) {
        mockGroups.push({ gid, adminId, name });
        return { success: true };
    }

    static async addUserToGroup({ uid, gid }) {
        mockUserGroups.push({ uid, gid });
        return { success: true };
    }

    static async getGroupsByUserId(uid) {
        const userGroups = mockUserGroups.filter(ug => ug.uid === uid);
        const groups = userGroups.map(ug => {
            return mockGroups.find(g => g.gid === ug.gid);
        }).filter(Boolean);
        return groups;
    }

    // Task methods
    static async addTask(taskData) {
        mockTasks.push(taskData);
        return { success: true };
    }

    static async updateTask(taskData) {
        const index = mockTasks.findIndex(t => t.tid === taskData.tid);
        if (index !== -1) {
            mockTasks[index] = { ...mockTasks[index], ...taskData };
            // Also update corresponding node if exists
            const nodeIndex = mockNodes.findIndex(n => n.nid === taskData.tid);
            if (nodeIndex !== -1) {
                mockNodes[nodeIndex] = {
                    ...mockNodes[nodeIndex],
                    name: taskData.name,
                    description: taskData.description,
                    percentage: taskData.percentage
                };
            }
        }
        return { success: true };
    }

    static async updateTaskFromNode(taskData) {
        const index = mockTasks.findIndex(t => t.tid === taskData.tid);
        if (index !== -1) {
            mockTasks[index] = {
                ...mockTasks[index],
                name: taskData.name,
                description: taskData.description,
                datetime: new Date(taskData.date),
                percentage: taskData.percentage
            };
        }
        return { success: true };
    }

    static async deleteTask(tid) {
        const index = mockTasks.findIndex(t => t.tid === tid);
        if (index !== -1) {
            mockTasks.splice(index, 1);
        }
        return { success: true };
    }

    static async getAllTasks() {
        return mockTasks;
    }

    static async getTask(tid) {
        const task = mockTasks.find(t => t.tid === tid);
        return task ? [task] : [];
    }

    static async getTasksByGroupId(gid) {
        return mockTasks.filter(t => t.gid === gid);
    }

    static async deleteTasksByList(gid, list) {
        const tasksToDelete = mockTasks.filter(t => t.gid === gid && t.list === list);
        tasksToDelete.forEach(task => {
            const index = mockTasks.findIndex(t => t.tid === task.tid);
            if (index !== -1) {
                mockTasks.splice(index, 1);
            }
        });
        return { success: true };
    }

    // Node methods
    static async addNode(nodeData) {
        mockNodes.push(nodeData);
        return { success: true };
    }

    static async updateNode(nodeData) {
        const index = mockNodes.findIndex(n => n.nid === nodeData.nid);
        if (index !== -1) {
            mockNodes[index] = { ...mockNodes[index], ...nodeData };
        }
        return { success: true };
    }

    static async updateNodeCoords(nodeData) {
        const index = mockNodes.findIndex(n => n.nid === nodeData.nid);
        if (index !== -1) {
            mockNodes[index].x_pos = nodeData.x_pos;
            mockNodes[index].y_pos = nodeData.y_pos;
        }
        return { success: true };
    }

    static async updateNodeCompleted(nodeData) {
        const index = mockNodes.findIndex(n => n.nid === nodeData.nid);
        if (index !== -1) {
            mockNodes[index].completed = nodeData.completed;
        }
        return { success: true };
    }

    static async updateNodePercentage(nodeData) {
        const index = mockNodes.findIndex(n => n.nid === nodeData.nid);
        if (index !== -1) {
            mockNodes[index].percentage = nodeData.percentage;
            // Also update corresponding task if exists
            const taskIndex = mockTasks.findIndex(t => t.tid === nodeData.nid);
            if (taskIndex !== -1) {
                mockTasks[taskIndex].percentage = nodeData.percentage;
            }
        }
        return { success: true };
    }

    static async deleteNode(nid) {
        const index = mockNodes.findIndex(n => n.nid === nid);
        if (index !== -1) {
            mockNodes.splice(index, 1);
        }
        return { success: true };
    }

    static async getAllNodes() {
        return mockNodes;
    }

    static async getNodesAndTasks(gid) {
        const nodes = mockNodes.filter(n => n.gid === gid).map(n => ({
            name: n.name,
            id: n.nid,
            date: n.date,
            description: n.description
        }));
        const tasks = mockTasks.filter(t => t.gid === gid).map(t => ({
            name: t.name,
            id: t.tid,
            date: t.datetime,
            description: t.description
        }));
        return [...nodes, ...tasks];
    }

    static async getNode(nid) {
        const node = mockNodes.find(n => n.nid === nid);
        return node ? [node] : [];
    }

    static async getNodesByGroupId(gid) {
        return mockNodes.filter(n => n.gid === gid);
    }

    // Edge methods
    static async addEdge(edgeData) {
        mockEdges.push(edgeData);
        // Update source node connections count
        const sourceNode = mockNodes.find(n => n.nid === edgeData.sourceId);
        if (sourceNode) {
            sourceNode.connections = (sourceNode.connections || 0) + 1;
        }
        return { success: true };
    }

    static async getEdgesById(eid) {
        const edge = mockEdges.find(e => e.eid === eid);
        return edge ? [edge] : [];
    }

    static async getEdgesByGroupId(gid) {
        return mockEdges.filter(e => e.gid === gid);
    }

    static async updatePrerequisite(edgeData) {
        const index = mockEdges.findIndex(e => e.eid === edgeData.eid);
        if (index !== -1) {
            mockEdges[index].prerequisite = edgeData.prerequisite;
        }
        return { success: true };
    }

    static async deleteEdge(eid) {
        const index = mockEdges.findIndex(e => e.eid === eid);
        if (index !== -1) {
            mockEdges.splice(index, 1);
        }
        return { success: true };
    }

    static async deleteEdgeBySource(nid) {
        const edgesToDelete = mockEdges.filter(e => e.sourceId === nid);
        edgesToDelete.forEach(edge => {
            const index = mockEdges.findIndex(e => e.eid === edge.eid);
            if (index !== -1) {
                mockEdges.splice(index, 1);
            }
        });
        return { success: true };
    }

    // Additional methods for complete functionality
    static async deleteGroup(gid, adminId) {
        const index = mockGroups.findIndex(g => g.gid === gid && g.adminId === adminId);
        if (index !== -1) {
            mockGroups.splice(index, 1);
            // Also clean up related data
            mockUserGroups.splice(0, mockUserGroups.length, ...mockUserGroups.filter(ug => ug.gid !== gid));
            mockTasks.splice(0, mockTasks.length, ...mockTasks.filter(t => t.gid !== gid));
            mockNodes.splice(0, mockNodes.length, ...mockNodes.filter(n => n.gid !== gid));
            mockEdges.splice(0, mockEdges.length, ...mockEdges.filter(e => e.gid !== gid));
        }
        return { success: true };
    }

    static async getidUser(uid) {
        const user = mockUsers.find(u => u.uid === uid);
        return user ? { uid: user.uid } : null;
    }
}

// Export both the class and the data for direct access
MockDatabase.mockUsers = mockUsers;
MockDatabase.mockGroups = mockGroups;
MockDatabase.mockUserGroups = mockUserGroups;
MockDatabase.mockTasks = mockTasks;
MockDatabase.mockNodes = mockNodes;
MockDatabase.mockEdges = mockEdges;
MockDatabase.mockCompletedTasks = [];
MockDatabase.mockDeletedTasks = [];
MockDatabase.mockUserTasks = [];

module.exports = MockDatabase;
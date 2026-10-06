// Shared fixtures for the supertest suites: call registerMocks() BEFORE requiring app.js, then
// applyDefaults() in beforeEach (jest.config uses resetMocks, which wipes implementations).
const fs = require('fs');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const ROOT = path.resolve(__dirname, '../../..');
// access.model / analyticsContext may not exist yet (written in parallel): mock them virtually then.
const maybeVirtual = (rel) => ({ virtual: !fs.existsSync(path.join(ROOT, `${rel}.js`)) });

const ids = {
    ALICE: '11111111-1111-4111-8111-111111111111', // admin of GROUP_A
    BOB: '22222222-2222-4222-8222-222222222222', // plain member of GROUP_A
    EVE: '33333333-3333-4333-8333-333333333333', // member of no group
    CAROL: '44444444-4444-4444-8444-444444444444', // admin of GROUP_B
    GROUP_A: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    GROUP_B: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    TASK_A: 'a0000000-0000-4000-8000-00000000000a',
    TASK_B: 'b0000000-0000-4000-8000-00000000000b',
    DONE_A: 'a0000000-0000-4000-8000-0000000000d0',
    DELETED_A: 'a0000000-0000-4000-8000-0000000000de',
    NODE_A: 'a1000000-0000-4000-8000-00000000000a',
    NODE_A2: 'a1000000-0000-4000-8000-00000000000b',
    NODE_B: 'b1000000-0000-4000-8000-00000000000b',
    EDGE_A: 'a2000000-0000-4000-8000-00000000000a',
    ROLE_A: 'a3000000-0000-4000-8000-00000000000a',
    ROLE_B: 'b3000000-0000-4000-8000-00000000000b',
    UGR_A: 'a4000000-0000-4000-8000-00000000000a',
    UGR_B: 'b4000000-0000-4000-8000-00000000000b',
    UNKNOWN: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
};

const MEMBERS = { [ids.GROUP_A]: [ids.ALICE, ids.BOB], [ids.GROUP_B]: [ids.CAROL] };
const ADMINS = { [ids.GROUP_A]: ids.ALICE, [ids.GROUP_B]: ids.CAROL };
const RESOURCES = {
    task: { [ids.TASK_A]: ids.GROUP_A, [ids.TASK_B]: ids.GROUP_B },
    completed: { [ids.DONE_A]: ids.GROUP_A },
    deleted: { [ids.DELETED_A]: ids.GROUP_A },
    node: { [ids.NODE_A]: ids.GROUP_A, [ids.NODE_A2]: ids.GROUP_A, [ids.NODE_B]: ids.GROUP_B },
    edge: { [ids.EDGE_A]: ids.GROUP_A },
    groupRole: { [ids.ROLE_A]: ids.GROUP_A, [ids.ROLE_B]: ids.GROUP_B },
    userGroupRole: { [ids.UGR_A]: ids.GROUP_A, [ids.UGR_B]: ids.GROUP_B },
};

const TEAM_CONTEXT = {
    team_members: [{
        uid: ids.ALICE,
        username: 'alice',
        current_workload: 1,
        historical_capacity: 3,
        expertise_by_category: { general: { expertise_score: 50, success_rate_percentage: 80 } },
    }],
};

const norm = (value) => (typeof value === 'string' ? value.toLowerCase() : value);

function registerMocks() {
    jest.mock('../../../models/access.model', () => ({
        isGroupMember: jest.fn(),
        isGroupAdmin: jest.fn(),
        isGroupLeader: jest.fn(),
        resolveGroupId: jest.fn(),
    }), maybeVirtual('models/access.model'));
    jest.mock('../../../services/analyticsContext', () => ({ buildTeamContext: jest.fn() }), maybeVirtual('services/analyticsContext'));
    jest.mock('../../../models/tasks.model', () => ({
        addTask: jest.fn(), updateTask: jest.fn(), updateTaskFromNode: jest.fn(), deleteTask: jest.fn(),
        getAllTasks: jest.fn(), getTask: jest.fn(), getTasksByGroupId: jest.fn(), deleteTasksByList: jest.fn(),
        completeTask: jest.fn(), trashTask: jest.fn(),
    }));
    jest.mock('../../../models/usertask.model', () => ({
        addUsertask: jest.fn(), deleteUsertask: jest.fn(), getUsertasksByTid: jest.fn(), getutid: jest.fn(),
        populateAssignmentsForGroup: jest.fn(),
    }));
    jest.mock('../../../models/nodes.model', () => ({
        addNode: jest.fn(), updateNode: jest.fn(), updateNodeCoords: jest.fn(), updateNodeCompleted: jest.fn(),
        updateNodePercentage: jest.fn(), deleteNode: jest.fn(), getAllNodes: jest.fn(), getNodesAndTasks: jest.fn(),
        getNode: jest.fn(), getNodesByGroupId: jest.fn(),
    }));
    jest.mock('../../../models/edges.model', () => ({
        addEdge: jest.fn(), getEdgesById: jest.fn(), getEdgesByGroupId: jest.fn(), updatePrerequisite: jest.fn(),
        deleteEdge: jest.fn(), deleteEdgeBySource: jest.fn(),
    }));
    jest.mock('../../../models/complete.model', () => ({ addComplete: jest.fn(), getCompletados: jest.fn(), deleteAll: jest.fn() }));
    jest.mock('../../../models/delete.model', () => ({ addDelete: jest.fn(), getEliminados: jest.fn(), deleteAll: jest.fn() }));
    jest.mock('../../../models/group.model', () => ({
        addGroup: jest.fn(), createGroupWithAdmin: jest.fn(), getGroupById: jest.fn(), getGroupsByUserId: jest.fn(), getRolesByGroupId: jest.fn(), deleteGroup: jest.fn(),
    }));
    jest.mock('../../../models/userGroup.model', () => ({
        addUserToGroup: jest.fn(), getMembersByGroupId: jest.fn(), removeMemberFromGroup: jest.fn(), leaveGroup: jest.fn(),
    }));
    jest.mock('../../../models/user.model', () => ({
        addUser: jest.fn(), getUserByUsername: jest.fn(), getidUser: jest.fn(), getidUserByUsername: jest.fn(), registerUserWithPersonalGroup: jest.fn(),
    }));
    jest.mock('../../../models/groupRoles.model', () => ({
        getGroupRoles: jest.fn(), addGroupRole: jest.fn(), updateGroupRole: jest.fn(), deleteGroupRole: jest.fn(),
    }));
    jest.mock('../../../models/userGroupRoles.model', () => ({
        getUserGroupRoles: jest.fn(), assignRoleToUser: jest.fn(), removeRoleFromUser: jest.fn(),
        getRolesOfUserInGroup: jest.fn(), getUsersWithRoleInGroup: jest.fn(), getUserRoleAssignment: jest.fn(),
        countUsersWithRoleInGroup: jest.fn(), getRolesMatrixForGroup: jest.fn(),
    }));
    jest.mock('../../../services/AnalyticsIntegration', () => ({
        onTaskAssignment: jest.fn(), onTaskCompletion: jest.fn(), onTaskDeletion: jest.fn(),
    }));
    jest.mock('../../../services/AnalyticsService', () => ({
        getUserAnalyticsSummary: jest.fn(), getTeamAnalyticsSummary: jest.fn(), getWorkloadDistribution: jest.fn(),
        getUserCompletionTrends: jest.fn(), getCategoryExpertiseRankings: jest.fn(), recordTaskAssignment: jest.fn(),
        recordTaskCompletion: jest.fn(), batchUpdateUserMetrics: jest.fn(),
    }));
    jest.mock('../../../helpers/execQuery', () => ({ execReadCommand: jest.fn(), execWriteCommand: jest.fn() }));
    // The real LLMService opens a WebSocket to the Python agent as soon as it is required.
    jest.mock('../../../services/LLMService', () => {
        const { EventEmitter } = require('events');
        const emitter = new EventEmitter();
        emitter.send = jest.fn();
        return emitter;
    });
}

function getMocks() {
    return {
        access: require('../../../models/access.model'),
        context: require('../../../services/analyticsContext'),
        tasks: require('../../../models/tasks.model'),
        usertask: require('../../../models/usertask.model'),
        nodes: require('../../../models/nodes.model'),
        edges: require('../../../models/edges.model'),
        complete: require('../../../models/complete.model'),
        deleted: require('../../../models/delete.model'),
        group: require('../../../models/group.model'),
        userGroup: require('../../../models/userGroup.model'),
        user: require('../../../models/user.model'),
        groupRoles: require('../../../models/groupRoles.model'),
        userGroupRoles: require('../../../models/userGroupRoles.model'),
        integration: require('../../../services/AnalyticsIntegration'),
        analytics: require('../../../services/AnalyticsService'),
        execQuery: require('../../../helpers/execQuery'),
        llm: require('../../../services/LLMService'),
    };
}

function applyDefaults() {
    const m = getMocks();
    // sendError logs unexpected errors; tests provoke many on purpose (restoreMocks undoes this).
    jest.spyOn(console, 'error').mockImplementation(() => {});

    m.access.isGroupMember.mockImplementation(async (uid, gid) => (MEMBERS[norm(gid)] || []).includes(norm(uid)));
    m.access.isGroupAdmin.mockImplementation(async (uid, gid) => ADMINS[norm(gid)] === norm(uid));
    // Leader = admin (tests that need a member with a "leader" role override this).
    m.access.isGroupLeader.mockImplementation(async (uid, gid) => ADMINS[norm(gid)] === norm(uid));
    // Upper-cased like SQL Server returns GUIDs, to exercise case-insensitive comparisons.
    m.access.resolveGroupId.mockImplementation(async (kind, id) => {
        const gid = (RESOURCES[kind] || {})[norm(id)];
        return gid ? gid.toUpperCase() : null;
    });
    m.context.buildTeamContext.mockResolvedValue(TEAM_CONTEXT);

    const taskRow = { tid: ids.TASK_A, gid: ids.GROUP_A, name: 'Task', description: 'd', list: 'L', datetimeStr: '2026-09-11 10:00', percentage: 0 };
    m.tasks.getTasksByGroupId.mockResolvedValue([taskRow]);
    m.tasks.getTask.mockResolvedValue([taskRow]);
    m.tasks.completeTask.mockResolvedValue({ status: 'completed' });
    m.tasks.trashTask.mockResolvedValue({ status: 'deleted', task: taskRow });
    ['addTask', 'updateTask', 'updateTaskFromNode', 'deleteTask'].forEach((fn) => m.tasks[fn].mockResolvedValue(1));
    m.tasks.deleteTasksByList.mockResolvedValue({ rowCount: 1, branches: [] });

    m.usertask.addUsertask.mockResolvedValue(1);
    m.usertask.deleteUsertask.mockResolvedValue(1);
    m.usertask.getUsertasksByTid.mockResolvedValue([]);
    m.usertask.getutid.mockResolvedValue([]);
    m.usertask.populateAssignmentsForGroup.mockResolvedValue({ assigned: 3 });

    Object.keys(m.nodes).forEach((fn) => m.nodes[fn].mockResolvedValue(1));
    m.nodes.getNode.mockResolvedValue([{ nid: ids.NODE_A, gid: ids.GROUP_A }]);
    m.nodes.getNodesByGroupId.mockResolvedValue([]);
    m.nodes.getNodesAndTasks.mockResolvedValue([]);
    Object.keys(m.edges).forEach((fn) => m.edges[fn].mockResolvedValue(1));
    m.edges.getEdgesByGroupId.mockResolvedValue([]);
    m.edges.getEdgesById.mockResolvedValue([]);

    [m.complete, m.deleted].forEach((model) => Object.keys(model).forEach((fn) => model[fn].mockResolvedValue(1)));
    m.complete.getCompletados.mockResolvedValue([]);
    m.deleted.getEliminados.mockResolvedValue([]);

    m.group.addGroup.mockResolvedValue({ success: true });
    m.group.createGroupWithAdmin.mockImplementation(async ({ gid }) => ({ gid }));
    m.group.getGroupById.mockResolvedValue(null);
    m.group.getGroupsByUserId.mockResolvedValue([{ gid: ids.GROUP_A, adminId: ids.ALICE, name: 'A' }]);
    m.group.getRolesByGroupId.mockResolvedValue([]);
    m.group.deleteGroup.mockResolvedValue({ success: true });
    Object.keys(m.userGroup).forEach((fn) => m.userGroup[fn].mockResolvedValue({ success: true }));
    m.userGroup.getMembersByGroupId.mockResolvedValue([{ uid: ids.ALICE, username: 'alice' }]);

    m.user.addUser.mockResolvedValue({ success: true });
    m.user.getUserByUsername.mockResolvedValue([]);
    m.user.getidUserByUsername.mockResolvedValue(null);
    m.user.getidUser.mockImplementation(async (uid) => ({ uid }));
    m.user.registerUserWithPersonalGroup.mockImplementation(async ({ uid, gid }) => ({ uid, gid }));

    Object.keys(m.groupRoles).forEach((fn) => m.groupRoles[fn].mockResolvedValue({ success: true }));
    m.groupRoles.getGroupRoles.mockResolvedValue([]);
    Object.keys(m.userGroupRoles).forEach((fn) => m.userGroupRoles[fn].mockResolvedValue([]));
    m.userGroupRoles.assignRoleToUser.mockResolvedValue({ success: true });
    m.userGroupRoles.removeRoleFromUser.mockResolvedValue({ success: true });
    m.userGroupRoles.getUserRoleAssignment.mockResolvedValue(null);
    m.userGroupRoles.countUsersWithRoleInGroup.mockResolvedValue(0);

    Object.keys(m.integration).forEach((fn) => m.integration[fn].mockResolvedValue({ success: true }));
    Object.keys(m.analytics).forEach((fn) => m.analytics[fn].mockResolvedValue({}));
    m.execQuery.execReadCommand.mockResolvedValue([]);
    m.execQuery.execWriteCommand.mockResolvedValue(0);
    m.llm.send.mockResolvedValue(undefined);

    return m;
}

const { signAccessToken } = require('../../../helpers/tokens');

const tokenFor = (userId, username = 'user') => signAccessToken({ userId, username });
const bearer = (userId) => ({ Authorization: `Bearer ${tokenFor(userId)}` });

module.exports = { ids, TEAM_CONTEXT, registerMocks, applyDefaults, getMocks, tokenFor, bearer };

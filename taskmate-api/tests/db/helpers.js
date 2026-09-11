// Factories for DB integration tests. Every call creates fresh ids, so test files never collide.
const { v4: uuidv4 } = require('uuid');
const { TYPES } = require('tedious');
const { execReadCommand, execWriteCommand } = require('../../helpers/execQuery');

const guid = (name, value) => ({ name, type: TYPES.UniqueIdentifier, value });
const sameId = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

async function createUser(prefix = 'u') {
    const uid = uuidv4();
    const username = `${prefix}_${uid.slice(0, 8)}`.slice(0, 25);
    await execWriteCommand(
        'INSERT INTO dbo.Users (uid, username, password) VALUES (@uid, @username, @password)',
        [guid('uid', uid), { name: 'username', type: TYPES.VarChar, value: username }, { name: 'password', type: TYPES.VarChar, value: 'x' }]
    );
    return { uid, username };
}

async function addMember(uid, gid) {
    await execWriteCommand('INSERT INTO dbo.UserGroups (uid, gid) VALUES (@uid, @gid)', [guid('uid', uid), guid('gid', gid)]);
}

// Group with `admin` as admin and member.
async function createGroup(adminUid, name = 'Test group') {
    const gid = uuidv4();
    await execWriteCommand(
        'INSERT INTO dbo.Groups (gid, adminId, name) VALUES (@gid, @adminId, @name)',
        [guid('gid', gid), guid('adminId', adminUid), { name: 'name', type: TYPES.VarChar, value: name }]
    );
    await addMember(adminUid, gid);
    return gid;
}

async function createTask(gid, { name = 'Task', list = 'To Do', percentage = 0, description = 'd' } = {}) {
    const tid = uuidv4();
    await execWriteCommand(
        `INSERT INTO dbo.Tasks (tid, gid, name, description, list, datetime, percentage)
         VALUES (@tid, @gid, @name, @description, @list, '2030-01-01', @percentage)`,
        [
            guid('tid', tid), guid('gid', gid),
            { name: 'name', type: TYPES.VarChar, value: name },
            { name: 'description', type: TYPES.VarChar, value: description },
            { name: 'list', type: TYPES.VarChar, value: list },
            { name: 'percentage', type: TYPES.Int, value: percentage },
        ]
    );
    return tid;
}

async function assignTask(uid, tid, gid, { category = 'general' } = {}) {
    await execWriteCommand(
        'INSERT INTO dbo.UserTask (utid, uid, tid, completed) VALUES (NEWID(), @uid, @tid, 0)',
        [guid('uid', uid), guid('tid', tid)]
    );
    await execWriteCommand(
        `INSERT INTO dbo.TaskAnalytics (tid, uid, gid, task_category, assigned_at)
         VALUES (@tid, @uid, @gid, @category, DATEADD(HOUR, -2, GETDATE()))`,
        [guid('tid', tid), guid('uid', uid), guid('gid', gid), { name: 'category', type: TYPES.VarChar, value: category }]
    );
}

async function createNode(gid, { name = 'Node', percentage = 0 } = {}) {
    const nid = uuidv4();
    await execWriteCommand(
        `INSERT INTO dbo.Nodes (nid, gid, name, description, date, completed, x_pos, y_pos, percentage)
         VALUES (@nid, @gid, @name, 'd', '2030-01-01', 0, 0, 0, @percentage)`,
        [guid('nid', nid), guid('gid', gid), { name: 'name', type: TYPES.VarChar, value: name }, { name: 'percentage', type: TYPES.Int, value: percentage }]
    );
    return nid;
}

async function createEdge(gid, sourceId, targetId, { prerequisite = true } = {}) {
    const eid = uuidv4();
    await execWriteCommand(
        'INSERT INTO dbo.Edges (eid, gid, sourceId, targetId, prerequisite) VALUES (@eid, @gid, @s, @t, @p)',
        [guid('eid', eid), guid('gid', gid), guid('s', sourceId), guid('t', targetId), { name: 'p', type: TYPES.Bit, value: prerequisite }]
    );
    return eid;
}

async function createRole(gid, name = 'Leader') {
    const grId = uuidv4();
    await execWriteCommand(
        `INSERT INTO dbo.GroupRoles (gr_id, gid, gr_name, gr_color, gr_icon) VALUES (@gr, @gid, @name, '#000', 'star')`,
        [guid('gr', grId), guid('gid', gid), { name: 'name', type: TYPES.VarChar, value: name }]
    );
    return grId;
}

async function assignRole(uid, gid, grId) {
    const ugrId = uuidv4();
    await execWriteCommand(
        'INSERT INTO dbo.UserGroupRoles (ugr_id, uid, gid, gr_id) VALUES (@ugr, @uid, @gid, @gr)',
        [guid('ugr', ugrId), guid('uid', uid), guid('gid', gid), guid('gr', grId)]
    );
    return ugrId;
}

// count('dbo.Tasks WHERE gid = @gid', [guid('gid', gid)])
async function count(fromWhere, params = []) {
    const rows = await execReadCommand(`SELECT COUNT(*) AS n FROM ${fromWhere}`, params);
    return rows[0].n;
}

let nextGitHubId = Date.now() % 1e9;
const githubId = () => ++nextGitHubId;

module.exports = {
    guid, sameId, createUser, addMember, createGroup, createTask, assignTask,
    createNode, createEdge, createRole, assignRole, count, githubId,
};

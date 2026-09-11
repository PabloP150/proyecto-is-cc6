// models/access.model.js — membership checks and resource → group resolution for authorization.
const { execReadCommand } = require('../helpers/execQuery');
const { TYPES } = require('tedious');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);

const read = (options, query, params) => (options && options.tx
    ? options.tx.read(query, params)
    : execReadCommand(query, params));

const isGroupMember = async (uid, gid, options = {}) => {
    if (!isUuid(uid) || !isUuid(gid)) return false;
    const rows = await read(options,
        `SELECT 1 AS ok FROM dbo.UserGroups WHERE uid = @uid AND gid = @gid`,
        [
            { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
            { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        ]);
    return rows.length > 0;
};

// The admin must also still be a member (getGroupsByUserId repairs orphaned admins lazily).
const isGroupAdmin = async (uid, gid, options = {}) => {
    if (!isUuid(uid) || !isUuid(gid)) return false;
    const rows = await read(options,
        `SELECT 1 AS ok
         FROM dbo.Groups g
         INNER JOIN dbo.UserGroups ug ON ug.gid = g.gid AND ug.uid = g.adminId
         WHERE g.gid = @gid AND g.adminId = @uid`,
        [
            { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
            { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        ]);
    return rows.length > 0;
};

const GROUP_OF = {
    task: 'SELECT gid FROM dbo.Tasks WHERE tid = @id',
    node: 'SELECT gid FROM dbo.Nodes WHERE nid = @id',
    edge: 'SELECT gid FROM dbo.Edges WHERE eid = @id',
    completed: 'SELECT gid FROM dbo.Complete WHERE tid = @id',
    deleted: 'SELECT gid FROM dbo.DeleteTask WHERE tid = @id',
    groupRole: 'SELECT gid FROM dbo.GroupRoles WHERE gr_id = @id',
    userGroupRole: 'SELECT gid FROM dbo.UserGroupRoles WHERE ugr_id = @id',
    userTask: `SELECT t.gid FROM dbo.UserTask ut INNER JOIN dbo.Tasks t ON t.tid = ut.tid WHERE ut.utid = @id`,
};

/**
 * resolveGroupId(kind, id) → gid | null. `id` is the resource key (userTask uses utid).
 * A malformed id resolves to null instead of raising a conversion error.
 */
const resolveGroupId = async (kind, id, options = {}) => {
    const query = GROUP_OF[kind];
    if (!query) throw new Error(`resolveGroupId: unknown kind "${kind}"`);
    if (!isUuid(id)) return null;
    const rows = await read(options, query, [{ name: 'id', type: TYPES.UniqueIdentifier, value: id }]);
    // Same GUID format as every other model (tedious returns them upper-case).
    return rows.length > 0 ? rows[0].gid : null;
};

module.exports = {
    isGroupMember,
    isGroupAdmin,
    resolveGroupId,
    isUuid,
    RESOURCE_KINDS: Object.keys(GROUP_OF),
};

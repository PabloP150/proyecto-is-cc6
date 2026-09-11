// models/group.model.js
const { execReadCommand, execWriteCommand } = require('../helpers/execQuery');
const { useTransaction } = require('../helpers/transaction');
const { AppError } = require('../helpers/errors');
const { TYPES } = require('tedious');

const addGroup = async (groupData, options = {}) => {
    const { gid, adminId, name } = groupData;
    const query = `INSERT INTO dbo.Groups (gid, adminId, name) VALUES (@gid, @adminId, @name)`;
    const params = [
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'adminId', type: TYPES.UniqueIdentifier, value: adminId },
        { name: 'name', type: TYPES.NVarChar, value: name },
    ];
    await (options.tx ? options.tx.write(query, params) : execWriteCommand(query, params));
    return { success: true };
};

// createGroupWithAdmin({gid, adminId, name}) → {gid}: the group and its admin's membership, atomically.
const createGroupWithAdmin = async ({ gid, adminId, name }, options = {}) => useTransaction(options, async (tx) => {
    const params = [
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'adminId', type: TYPES.UniqueIdentifier, value: adminId },
        { name: 'name', type: TYPES.NVarChar, value: name },
    ];
    await tx.write('INSERT INTO dbo.Groups (gid, adminId, name) VALUES (@gid, @adminId, @name)', params);
    await tx.write('INSERT INTO dbo.UserGroups (uid, gid) VALUES (@adminId, @gid)', params);
    return { gid };
});

// Pure read. Admins that stopped being members are fixed once by migration 004 and can no
// longer appear: leaveGroup/removeMemberFromGroup hand the admin role over in the same transaction.
const getGroupsByUserId = async (uid) => {
    const query = `
        SELECT g.gid, g.adminId, g.name
        FROM dbo.Groups g
        INNER JOIN dbo.UserGroups ug ON ug.gid = g.gid
        WHERE ug.uid = @uid
    `;
    const params = [{ name: 'uid', type: TYPES.UniqueIdentifier, value: uid }];
    return execReadCommand(query, params);
};

// getGroupById(gid) → {gid, name, adminId} | null
const getGroupById = async (gid, options = {}) => {
    const query = 'SELECT gid, name, adminId FROM dbo.Groups WHERE gid = @gid';
    const params = [{ name: 'gid', type: TYPES.UniqueIdentifier, value: gid }];
    const rows = await (options.tx ? options.tx.read(query, params) : execReadCommand(query, params));
    return rows.length > 0 ? rows[0] : null;
};

const getRolesByGroupId = async (gid) => {
    const query = `
        SELECT gr_id, gr_name, gr_color, gr_icon
        FROM dbo.GroupRoles
        WHERE gid = @gid
        ORDER BY gr_name
    `;
    const params = [{ name: 'gid', type: TYPES.UniqueIdentifier, value: gid }];
    return execReadCommand(query, params);
};

/**
 * Deletes a group and everything that depends on it, children before parents, inside the
 * caller's transaction. GroupRepositories and AnalyticsConfig go by ON DELETE CASCADE,
 * TaskBranches by the cascade from Tasks. The OR clauses also catch rows whose gid
 * disagrees with their parent's (possible only if migration 001 had to skip a composite FK).
 */
const deleteGroupCascade = async (tx, gid) => {
    const params = [{ name: 'gid', type: TYPES.UniqueIdentifier, value: gid }];
    await tx.write(
        `DELETE FROM dbo.TaskAnalytics WHERE gid = @gid;
         DELETE ut FROM dbo.UserTask ut INNER JOIN dbo.Tasks t ON t.tid = ut.tid WHERE t.gid = @gid;
         DELETE FROM dbo.Tasks WHERE gid = @gid;
         DELETE FROM dbo.Complete WHERE gid = @gid;
         DELETE FROM dbo.DeleteTask WHERE gid = @gid;
         DELETE FROM dbo.Edges
         WHERE gid = @gid
            OR sourceId IN (SELECT nid FROM dbo.Nodes WHERE gid = @gid)
            OR targetId IN (SELECT nid FROM dbo.Nodes WHERE gid = @gid);
         DELETE FROM dbo.Nodes WHERE gid = @gid;
         DELETE FROM dbo.UserGroupRoles
         WHERE gid = @gid OR gr_id IN (SELECT gr_id FROM dbo.GroupRoles WHERE gid = @gid);
         DELETE FROM dbo.GroupRoles WHERE gid = @gid;
         DELETE FROM dbo.UserGroups WHERE gid = @gid;`,
        params
    );
    return tx.write('DELETE FROM dbo.Groups WHERE gid = @gid', params);
};

// Only the group's admin can delete it. Throws NOT_FOUND / NOT_GROUP_ADMIN (AppError).
const deleteGroup = async (gid, adminId, options = {}) => useTransaction(options, async (tx) => {
    const rows = await tx.read(
        `SELECT CASE WHEN adminId = @adminId THEN 1 ELSE 0 END AS isAdmin
         FROM dbo.Groups WITH (UPDLOCK, HOLDLOCK) WHERE gid = @gid`,
        [
            { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
            { name: 'adminId', type: TYPES.UniqueIdentifier, value: adminId },
        ]
    );
    if (rows.length === 0) throw new AppError('NOT_FOUND', 'Group not found', 404);
    if (!rows[0].isAdmin) throw new AppError('NOT_GROUP_ADMIN', 'Not authorized to delete this group', 403);
    await deleteGroupCascade(tx, gid);
    return { success: true };
});

module.exports = {
    addGroup,
    createGroupWithAdmin,
    getGroupsByUserId,
    getGroupById,
    getRolesByGroupId,
    deleteGroup,
    deleteGroupCascade,
};

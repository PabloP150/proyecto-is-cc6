// models/userGroup.model.js
const { execReadCommand, execWriteCommand } = require('../helpers/execQuery');
const { useTransaction } = require('../helpers/transaction');
const { AppError } = require('../helpers/errors');
const { deleteGroupCascade } = require('./group.model');
const { TYPES } = require('tedious');

const addUserToGroup = async (userGroupData, options = {}) => {
  const { uid, gid } = userGroupData;
  const query = `
    IF NOT EXISTS (SELECT 1 FROM dbo.UserGroups WHERE uid = @uid AND gid = @gid)
      INSERT INTO dbo.UserGroups (uid, gid) VALUES (@uid, @gid)
  `;
  const params = [
    { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
    { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
  ];
  await (options.tx ? options.tx.write(query, params) : execWriteCommand(query, params));
  return { success: true };
};

const getMembersByGroupId = async (gid) => {
  const query = `
    SELECT u.uid, u.username
    FROM dbo.Users u
    INNER JOIN dbo.UserGroups ug ON ug.uid = u.uid
    WHERE ug.gid = @gid
  `;
  const params = [{ name: 'gid', type: TYPES.UniqueIdentifier, value: gid }];
  return execReadCommand(query, params);
};

// Next admin when the current one goes away: the longest-standing member (joined_at, then uid).
// Never by username, which users pick themselves (a "!a" user would otherwise inherit the group).
const NEXT_ADMIN_QUERY = `
    SELECT TOP 1 ug.uid
    FROM dbo.UserGroups ug
    WHERE ug.gid = @gid AND ug.uid <> @uid
    ORDER BY ug.joined_at, ug.uid`;

const removeMembership = (tx, params) => tx.write(
  `DELETE FROM dbo.UserGroupRoles WHERE uid = @uid AND gid = @gid;
   DELETE FROM dbo.UserGroups WHERE uid = @uid AND gid = @gid;`,
  params
);

// Removes a member (and their role assignments); if it was the admin, the role passes to the next member.
const removeMemberFromGroup = async (uid, gid, options = {}) => useTransaction(options, async (tx) => {
  const params = [
    { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
    { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
  ];
  const group = await tx.read(
    `SELECT CASE WHEN adminId = @uid THEN 1 ELSE 0 END AS isAdmin
     FROM dbo.Groups WITH (UPDLOCK, HOLDLOCK) WHERE gid = @gid`,
    params
  );
  if (group.length > 0 && group[0].isAdmin) {
    const next = await tx.read(NEXT_ADMIN_QUERY, params);
    if (next.length > 0) {
      await tx.write('UPDATE dbo.Groups SET adminId = @newAdmin WHERE gid = @gid', [
        ...params,
        { name: 'newAdmin', type: TYPES.UniqueIdentifier, value: next[0].uid },
      ]);
    }
  }
  await removeMembership(tx, params);
  return { success: true };
});

/**
 * leaveGroup(uid, gid) → {success, result: 'left' | 'transferred' | 'deleted', newAdminId}
 * A leaving admin hands the group to the next member; the last member leaving deletes the
 * group with everything in it. Throws AppError NOT_FOUND when the group does not exist.
 */
const leaveGroup = async (uid, gid, options = {}) => useTransaction(options, async (tx) => {
  const params = [
    { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
    { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
  ];
  const group = await tx.read(
    `SELECT CASE WHEN adminId = @uid THEN 1 ELSE 0 END AS isAdmin
     FROM dbo.Groups WITH (UPDLOCK, HOLDLOCK) WHERE gid = @gid`,
    params
  );
  if (group.length === 0) throw new AppError('NOT_FOUND', 'Group not found', 404);

  if (!group[0].isAdmin) {
    await removeMembership(tx, params);
    return { success: true, result: 'left', newAdminId: null };
  }

  const next = await tx.read(NEXT_ADMIN_QUERY, params);
  if (next.length > 0) {
    const newAdminId = next[0].uid;
    await tx.write('UPDATE dbo.Groups SET adminId = @newAdmin WHERE gid = @gid', [
      ...params,
      { name: 'newAdmin', type: TYPES.UniqueIdentifier, value: newAdminId },
    ]);
    await removeMembership(tx, params);
    return { success: true, result: 'transferred', newAdminId };
  }

  await deleteGroupCascade(tx, gid);
  return { success: true, result: 'deleted', newAdminId: null };
});

module.exports = {
  addUserToGroup,
  getMembersByGroupId,
  removeMemberFromGroup,
  leaveGroup,
};

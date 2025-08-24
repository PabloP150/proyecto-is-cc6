// models/userGroup.model.js
const { execReadCommand, execWriteCommand } = require('../helpers/execQuery');
const { TYPES } = require('tedious');

const addUserToGroup = async (userGroupData) => {
  const { uid, gid } = userGroupData;
  const query = `INSERT INTO dbo.UserGroups (uid, gid) VALUES (@uid, @gid)`;
  const params = [
    { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
    { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
  ];
  await execWriteCommand(query, params);
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

const removeMemberFromGroup = async (uid, gid) => {
  const query = `DELETE FROM dbo.UserGroups WHERE uid = @uid AND gid = @gid`;
  const params = [
    { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
    { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
  ];
  await execWriteCommand(query, params);
  return { success: true };
};

const leaveGroup = async (uid, gid) => removeMemberFromGroup(uid, gid);

module.exports = {
  addUserToGroup,
  getMembersByGroupId,
  removeMemberFromGroup,
  leaveGroup,
};

// models/userGroup.model.js
const execQuery = require('../helpers/execQuery');
const TYPES = require('tedious').TYPES;

const addUserToGroup = (userGroupData) => {
  const { uid, gid } = userGroupData;
  const query = `
    INSERT INTO [dbo].[UserGroups] (uid, gid) 
    VALUES(@uid, @gid)
  `;
  const params = [
    { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
    { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
  ];
  return execQuery.execWriteCommand(query, params);
};

const getMembersByGroupId = (gid) => {
  const query = `
  SELECT u.uid, u.username
  FROM [dbo].[UserGroups] ug
  JOIN [dbo].[Users] u ON ug.uid = u.uid
  WHERE ug.gid = @gid`;
  const params = [
      { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
  ];
  return execQuery.execReadCommand(query, params);
};

const removeMemberFromGroup = (uid, gid) => {
  const query = `DELETE FROM [dbo].[UserGroups] WHERE uid = @uid AND gid = @gid`;
  const params = [
    { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
    { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
  ];
  return execQuery.execWriteCommand(query, params);
};

const leaveGroup = (uid, gid) => {
  const query = `DELETE FROM [dbo].[UserGroups] WHERE uid = @uid AND gid = @gid`;
  const params = [
    { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
    { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
  ];
  return execQuery.execWriteCommand(query, params);
};

module.exports = {
  addUserToGroup,
  getMembersByGroupId,
  removeMemberFromGroup,
  leaveGroup,
};

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

module.exports = {
  addUserToGroup,
};


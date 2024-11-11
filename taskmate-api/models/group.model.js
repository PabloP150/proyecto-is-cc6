// models/group.model.js
const execQuery = require('../helpers/execQuery');
const TYPES = require('tedious').TYPES;

const addGroup = (groupData) => {
    const { gid, adminId, name } = groupData;
    const query = `
    INSERT INTO [dbo].[Groups] (gid, adminId, name) 
    VALUES(@gid, @adminId, @name)
    `;
    const params = [
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'adminId', type: TYPES.UniqueIdentifier, value: adminId },
        { name: 'name', type: TYPES.VarChar, value: name },
    ];
    return execQuery.execWriteCommand(query, params);
};

const getGroupsByUserId = (uid) => {
    const query = `
    SELECT g.* FROM [dbo].[Groups] g
    JOIN [dbo].[UserGroups] ug ON g.gid = ug.gid
    WHERE ug.uid = @uid`;
    const params = [
        { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
    ];
    return execQuery.execReadCommand(query, params);
};

module.exports = {
    addGroup,
    getGroupsByUserId,
};

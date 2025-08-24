// models/group.model.js
const { execReadCommand, execWriteCommand } = require('../helpers/execQuery');
const { TYPES } = require('tedious');

const addGroup = async (groupData) => {
    const { gid, adminId, name } = groupData;
    const query = `INSERT INTO dbo.Groups (gid, adminId, name) VALUES (@gid, @adminId, @name)`;
    const params = [
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'adminId', type: TYPES.UniqueIdentifier, value: adminId },
        { name: 'name', type: TYPES.VarChar, value: name },
    ];
    await execWriteCommand(query, params);
    return { success: true };
};

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

const deleteGroup = async (gid, adminId) => {
    const query = `DELETE FROM dbo.Groups WHERE gid = @gid AND adminId = @adminId`;
    const params = [
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'adminId', type: TYPES.UniqueIdentifier, value: adminId },
    ];
    await execWriteCommand(query, params);
    return { success: true };
};

module.exports = {
    addGroup,
    getGroupsByUserId,
    deleteGroup,
};

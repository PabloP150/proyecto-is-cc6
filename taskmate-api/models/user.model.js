// models/user.model.js
const execQuery = require('../helpers/execQuery');
const TYPES = require('tedious').TYPES;

const addUser = (userData) => {
    const { uid, username, password } = userData;
    const query = `
    INSERT INTO [dbo].[Users] (uid, username, password) 
    VALUES(@uid, @username, @password)
    `;
    const params = [
        { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
        { name: 'username', type: TYPES.VarChar, value: username },
        { name: 'password', type: TYPES.Char, value: password },
    ];
    return execQuery.execWriteCommand(query, params);
};

const getUserByUsername = (username) => {
    const query = `
    SELECT * FROM [dbo].[Users] WHERE username = @username
    `;
    const params = [
        { name: 'username', type: TYPES.VarChar, value: username },
    ];
    return execQuery.execReadCommand(query, params);
};
const getidUserByUsername = async (username) => {
    const query = `SELECT uid FROM [dbo].[Users] WHERE username = @username`;
    const params = [{ name: 'username', type: TYPES.VarChar, value: username }];
    const result = await execQuery.execReadCommand(query, params);
    return result.length > 0 ? result[0] : null;
};

const getidUser = async (uid) => {
    const query = `
    SELECT uid FROM [dbo].[Users] WHERE uid = @uid
    `;
    const params = [
        { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
    ];
    const result = await execQuery.execReadCommand(query, params);
    return result.length > 0 ? result[0] : null;
};

module.exports = {
    addUser,
    getUserByUsername,
    getidUser,
    getidUserByUsername,
};

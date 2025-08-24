// models/user.model.js
const { execReadCommand, execWriteCommand } = require('../helpers/execQuery');
const { TYPES } = require('tedious');

const addUser = async (userData) => {
    const { uid, username, password } = userData;
    const query = `INSERT INTO dbo.Users (uid, username, password) VALUES (@uid, @username, @password)`;
    const params = [
        { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
        { name: 'username', type: TYPES.VarChar, value: username },
        { name: 'password', type: TYPES.VarChar, value: password },
    ];
    await execWriteCommand(query, params);
    return { success: true };
};

const getUserByUsername = async (username) => {
    const query = `SELECT uid, username, password FROM dbo.Users WHERE username = @username`;
    const params = [{ name: 'username', type: TYPES.VarChar, value: username }];
    return execReadCommand(query, params);
};

const getidUserByUsername = async (username) => {
    const query = `SELECT uid FROM dbo.Users WHERE username = @username`;
    const params = [{ name: 'username', type: TYPES.VarChar, value: username }];
    const rows = await execReadCommand(query, params);
    return rows?.[0] || null;
};

const getidUser = async (uid) => {
    const query = `SELECT uid FROM dbo.Users WHERE uid = @uid`;
    const params = [{ name: 'uid', type: TYPES.UniqueIdentifier, value: uid }];
    const rows = await execReadCommand(query, params);
    return rows?.[0] || null;
};

module.exports = {
    addUser,
    getUserByUsername,
    getidUser,
    getidUserByUsername,
};

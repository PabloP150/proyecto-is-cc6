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

module.exports = {
    addUser,
    getUserByUsername,
};
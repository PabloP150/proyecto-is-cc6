// models/user.model.js
const { execReadCommand, execWriteCommand } = require('../helpers/execQuery');
const { useTransaction, isUniqueViolation } = require('../helpers/transaction');
const { AppError } = require('../helpers/errors');
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

/**
 * registerUserWithPersonalGroup({uid, username, passwordHash, gid, groupName}) → {uid, gid}
 * Creates the user, their personal group and the membership in one transaction.
 * Throws AppError VALIDATION_ERROR (400) when the username is taken.
 */
const registerUserWithPersonalGroup = async ({ uid, username, passwordHash, gid, groupName }, options = {}) => {
    const params = [
        { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
        { name: 'username', type: TYPES.VarChar, value: username },
        { name: 'password', type: TYPES.VarChar, value: passwordHash },
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'groupName', type: TYPES.VarChar, value: String(groupName ?? username).slice(0, 25) },
    ];
    try {
        await useTransaction(options, async (tx) => {
            // The UPDLOCK/HOLDLOCK range lock makes two concurrent sign-ups with the same name serialize.
            const taken = await tx.read('SELECT uid FROM dbo.Users WITH (UPDLOCK, HOLDLOCK) WHERE username = @username', params);
            if (taken.length > 0) throw new AppError('VALIDATION_ERROR', 'Username already exists', 400);
            await tx.write('INSERT INTO dbo.Users (uid, username, password) VALUES (@uid, @username, @password)', params);
            await tx.write('INSERT INTO dbo.Groups (gid, adminId, name) VALUES (@gid, @uid, @groupName)', params);
            await tx.write('INSERT INTO dbo.UserGroups (uid, gid) VALUES (@uid, @gid)', params);
        });
    } catch (err) {
        if (isUniqueViolation(err)) throw new AppError('VALIDATION_ERROR', 'Username already exists', 400);
        throw err;
    }
    return { uid, gid };
};

module.exports = {
    addUser,
    getUserByUsername,
    getidUser,
    getidUserByUsername,
    registerUserWithPersonalGroup,
};

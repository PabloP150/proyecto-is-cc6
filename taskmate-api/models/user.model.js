// models/user.model.js
const MockDatabase = require('../helpers/mockDatabase');

const addUser = async (userData) => {
    return await MockDatabase.addUser(userData);
};

const getUserByUsername = async (username) => {
    return await MockDatabase.getUserByUsername(username);
};
const getidUserByUsername = async (username) => {
    return await MockDatabase.getidUserByUsername(username);
};

const getidUser = async (uid) => {
    // Add getidUser method to MockDatabase if it doesn't exist
    const mockDatabase = require('../helpers/mockDatabase');
    const user = mockDatabase.mockUsers?.find(u => u.uid === uid);
    return user ? { uid: user.uid } : null;
};

module.exports = {
    addUser,
    getUserByUsername,
    getidUser,
    getidUserByUsername,
};

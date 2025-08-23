// models/group.model.js
const MockDatabase = require('../helpers/mockDatabase');

const addGroup = async (groupData) => {
    return await MockDatabase.addGroup(groupData);
};

const getGroupsByUserId = async (uid) => {
    return await MockDatabase.getGroupsByUserId(uid);
};

const deleteGroup = (gid, adminId) => {
    // Add deleteGroup method to MockDatabase if it doesn't exist
    const mockGroups = require('../helpers/mockDatabase');
    const index = mockGroups.mockGroups?.findIndex(g => g.gid === gid && g.adminId === adminId);
    if (index !== -1) {
        mockGroups.mockGroups.splice(index, 1);
        return Promise.resolve({ success: true });
    }
    return Promise.resolve({ success: false, message: 'Group not found' });
};

module.exports = {
    addGroup,
    getGroupsByUserId,
    deleteGroup,
};
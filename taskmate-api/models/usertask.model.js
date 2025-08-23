const MockDatabase = require('../helpers/mockDatabase');

const addUsertask = (usertaskData) => {
    // Add to mock user tasks
    const mockDatabase = require('../helpers/mockDatabase');
    if (!mockDatabase.mockUserTasks) {
        mockDatabase.mockUserTasks = [];
    }
    mockDatabase.mockUserTasks.push(usertaskData);
    return Promise.resolve({ success: true });
};

const deleteUsertask = (uid, tid) => {
    const mockDatabase = require('../helpers/mockDatabase');
    if (mockDatabase.mockUserTasks) {
        const index = mockDatabase.mockUserTasks.findIndex(ut => ut.uid === uid && ut.tid === tid);
        if (index !== -1) {
            mockDatabase.mockUserTasks.splice(index, 1);
        }
    }
    return Promise.resolve({ success: true });
};

const getUsertasksByTid = (tid) => {
    const mockDatabase = require('../helpers/mockDatabase');
    const userTasks = mockDatabase.mockUserTasks || [];
    return Promise.resolve(userTasks.filter(ut => ut.tid === tid));
};


module.exports = {
    addUsertask,
    deleteUsertask,
    getUsertasksByTid,
};
    
const MockDatabase = require('../helpers/mockDatabase');

const addDelete = (deleteData) => {
    // Add to mock deleted tasks
    const mockDatabase = require('../helpers/mockDatabase');
    if (!mockDatabase.mockDeletedTasks) {
        mockDatabase.mockDeletedTasks = [];
    }
    mockDatabase.mockDeletedTasks.push(deleteData);
    return Promise.resolve({ success: true });
};

const getEliminados = (gid) => {
    const mockDatabase = require('../helpers/mockDatabase');
    const deletedTasks = mockDatabase.mockDeletedTasks || [];
    return Promise.resolve(deletedTasks.filter(task => task.gid === gid));
};

const deleteAll = (gid) => {
    const mockDatabase = require('../helpers/mockDatabase');
    if (mockDatabase.mockDeletedTasks) {
        mockDatabase.mockDeletedTasks = mockDatabase.mockDeletedTasks.filter(task => task.gid !== gid);
    }
    return Promise.resolve({ success: true });
};

module.exports = {
    addDelete,
    getEliminados,
    deleteAll
};
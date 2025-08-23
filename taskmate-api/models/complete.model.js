const MockDatabase = require('../helpers/mockDatabase');

const addComplete = (completeData) => {
    // Add to mock completed tasks
    const mockCompletedTasks = require('../helpers/mockDatabase');
    if (!mockCompletedTasks.mockCompletedTasks) {
        mockCompletedTasks.mockCompletedTasks = [];
    }
    mockCompletedTasks.mockCompletedTasks.push(completeData);
    return Promise.resolve({ success: true });
};

const getCompletados = (gid) => {
    const mockCompletedTasks = require('../helpers/mockDatabase');
    const completedTasks = mockCompletedTasks.mockCompletedTasks || [];
    return Promise.resolve(completedTasks.filter(task => task.gid === gid));
};

const deleteAll = (gid) => {
    const mockCompletedTasks = require('../helpers/mockDatabase');
    if (mockCompletedTasks.mockCompletedTasks) {
        mockCompletedTasks.mockCompletedTasks = mockCompletedTasks.mockCompletedTasks.filter(task => task.gid !== gid);
    }
    return Promise.resolve({ success: true });
};


module.exports = {
    addComplete,
    getCompletados,
    deleteAll
};
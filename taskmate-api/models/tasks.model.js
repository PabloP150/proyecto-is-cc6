const MockDatabase = require('../helpers/mockDatabase');

const addTask = (taskData) => {
    return MockDatabase.addTask(taskData);
};

const updateTask = (taskData) => {
    return MockDatabase.updateTask(taskData);
};

const updateTaskFromNode = (taskData) => {
    return MockDatabase.updateTaskFromNode(taskData);
};

const deleteTask = (tid) => {
    return MockDatabase.deleteTask(tid);
};

const getAllTasks = () => {
    return MockDatabase.getAllTasks();
};

const getTask = (tid) => {
    return MockDatabase.getTask(tid);
};

const getTasksByGroupId = (gid) => {
    return MockDatabase.getTasksByGroupId(gid);
};

const deleteTasksByList = (gid, list) => {
    return MockDatabase.deleteTasksByList(gid, list);
};

module.exports = {
    addTask,
    updateTask,
    updateTaskFromNode,
    deleteTask,
    getAllTasks,
    getTask,
    getTasksByGroupId,
    deleteTasksByList,
};
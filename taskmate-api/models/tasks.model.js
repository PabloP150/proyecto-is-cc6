const { execReadCommand, execWriteCommand } = require('../helpers/execQuery');
const { TYPES } = require('tedious');

const addTask = async (taskData) => {
    const { tid, gid, name, description, list, datetime, percentage } = taskData;
    const query = `INSERT INTO dbo.Tasks (tid, gid, name, description, list, datetime, percentage)
                   VALUES (@tid, @gid, @name, @description, @list, @datetime, @percentage)`;
    const params = [
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid },
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'name', type: TYPES.VarChar, value: name },
        { name: 'description', type: TYPES.VarChar, value: description },
        { name: 'list', type: TYPES.VarChar, value: list },
        { name: 'datetime', type: TYPES.SmallDateTime, value: new Date(datetime) },
        { name: 'percentage', type: TYPES.Int, value: percentage ?? 0 },
    ];
    return execWriteCommand(query, params);
};

const updateTask = async (taskData) => {
    const { tid, gid, name, description, list, datetime, percentage } = taskData;
    const query = `UPDATE dbo.Tasks
                   SET gid=@gid, name=@name, description=@description, list=@list,
                       datetime=@datetime, percentage=@percentage
                   WHERE tid=@tid`;
    const params = [
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid },
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'name', type: TYPES.VarChar, value: name },
        { name: 'description', type: TYPES.VarChar, value: description },
        { name: 'list', type: TYPES.VarChar, value: list },
        { name: 'datetime', type: TYPES.SmallDateTime, value: new Date(datetime) },
        { name: 'percentage', type: TYPES.Int, value: percentage ?? 0 },
    ];
    return execWriteCommand(query, params);
};

const updateTaskFromNode = async (taskData) => {
    const { tid, name, description, date, percentage } = taskData;
    const query = `UPDATE dbo.Tasks
                   SET name=@name, description=@description, datetime=@datetime,
                       percentage = COALESCE(@percentage, percentage)
                   WHERE tid=@tid`;
    const params = [
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid },
        { name: 'name', type: TYPES.VarChar, value: name },
        { name: 'description', type: TYPES.VarChar, value: description },
        { name: 'datetime', type: TYPES.SmallDateTime, value: new Date(date) },
        { name: 'percentage', type: TYPES.Int, value: percentage ?? null },
    ];
    return execWriteCommand(query, params);
};

const deleteTask = async (tid) => {
    const query = `DELETE FROM dbo.Tasks WHERE tid=@tid`;
    const params = [{ name: 'tid', type: TYPES.UniqueIdentifier, value: tid }];
    return execWriteCommand(query, params);
};

const getAllTasks = async () => {
    const query = `SELECT tid, gid, name, description, list, datetime, percentage FROM dbo.Tasks`;
    return execReadCommand(query);
};

const getTask = async (tid) => {
    const query = `SELECT tid, gid, name, description, list, datetime, percentage FROM dbo.Tasks WHERE tid=@tid`;
    const params = [{ name: 'tid', type: TYPES.UniqueIdentifier, value: tid }];
    return execReadCommand(query, params);
};

const getTasksByGroupId = async (gid) => {
    const query = `SELECT tid, gid, name, description, list, datetime, percentage FROM dbo.Tasks WHERE gid=@gid`;
    const params = [{ name: 'gid', type: TYPES.UniqueIdentifier, value: gid }];
    return execReadCommand(query, params);
};

const deleteTasksByList = async (gid, list) => {
    const query = `DELETE FROM dbo.Tasks WHERE gid=@gid AND list=@list`;
    const params = [
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'list', type: TYPES.VarChar, value: list },
    ];
    return execWriteCommand(query, params);
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
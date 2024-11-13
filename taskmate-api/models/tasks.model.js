const execQuery = require('../helpers/execQuery');
const TYPES = require('tedious').TYPES;

const addTask = (taskData) => {
    const {
        tid,
        gid,
        name,
        description,
        list,
        datetime
    } = taskData;
    const query = `
    INSERT INTO [dbo].[Tasks] (tid, gid, name, description, list, datetime) 
    VALUES(@tid, @gid, @name, @description, @list, @datetime)
    `;
    const params = [
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid },
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'name', type: TYPES.VarChar, value: name },
        { name: 'description', type: TYPES.Text, value: description },
        { name: 'list', type: TYPES.VarChar, value: list },
        { name: 'datetime', type: TYPES.SmallDateTime, value: datetime },
    ];
    return execQuery.execWriteCommand(query, params);
};

const updateTask = (taskData) => {
    const {
        tid,
        gid,
        name,
        description,
        list,
        datetime
    } = taskData;
    const query = `
    UPDATE [dbo].[Tasks] 
    SET tid=@tid, gid=@gid, name=@name, description=@description, list=@list, datetime=@datetime
    WHERE tid=@tid
    `;
    const params = [
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid },
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'name', type: TYPES.VarChar, value: name },
        { name: 'description', type: TYPES.Text, value: description },
        { name: 'list', type: TYPES.VarChar, value: list },
        { name: 'datetime', type: TYPES.SmallDateTime, value: datetime },
    ];
    return execQuery.execWriteCommand(query, params);
};

const updateTaskFromNode = (taskData) => {
    const {
        tid,
        name,
        description,
        date
    } = taskData;
    const query = `
    UPDATE [dbo].[Tasks] 
    SET name=@name, description=@description, datetime=CONVERT(datetime, @date, 120)
    WHERE tid=@tid
    `;
    const params = [
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid },
        { name: 'name', type: TYPES.VarChar, value: name },
        { name: 'description', type: TYPES.Text, value: description },
        { name: 'date', type: TYPES.SmallDateTime, value: date },
    ];
    return execQuery.execWriteCommand(query, params);
};

const deleteTask = (tid) => {
    const query = `
    DELETE FROM [dbo].[Tasks] WHERE tid = @tid
    `;
    const params = [
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid }
    ];
    return execQuery.execWriteCommand(query, params);
};

const getAllTasks = () => {
    const query = `
    SELECT * FROM [dbo].[Tasks]
    `;
    return execQuery.execReadCommand(query);
};

const getTask = (tid) => {
    const query = `
    SELECT * FROM [dbo].[Tasks] WHERE tid = @tid
    `;
    const params = [
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid }
    ];
    return execQuery.execReadCommand(query, params);
};

const getTasksByGroupId = (gid) => {
    const query = `
    SELECT * FROM [dbo].[Tasks] WHERE gid = @gid
    `;
    const params = [
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
    ];
    return execQuery.execReadCommand(query, params);
};

const deleteTasksByList = (gid, list) => {
    const query = `
    DELETE FROM [dbo].[Tasks] WHERE gid = @gid AND list = @list
    `;
    const params = [
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'list', type: TYPES.VarChar, value: list }
    ];
    return execQuery.execWriteCommand(query, params);
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

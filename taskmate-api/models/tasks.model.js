const execQuery = require('../helpers/execQuery');
const TYPES = require('tedious').TYPES;

const addTask = (taskData) => {
    const {
        tid,
        gid,
        name,
        description,
        list,
        datetime,
        percentage
    } = taskData;
    const query = `
    INSERT INTO [dbo].[Tasks] (tid, gid, name, description, list, datetime, percentage) 
    VALUES(@tid, @gid, @name, @description, @list, @datetime, @percentage)
    `;
    const params = [
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid },
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'name', type: TYPES.VarChar, value: name },
        { name: 'description', type: TYPES.Text, value: description },
        { name: 'list', type: TYPES.VarChar, value: list },
        { name: 'datetime', type: TYPES.SmallDateTime, value: datetime },
        { name: 'percentage', type: TYPES.Int, value: percentage },
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
        datetime,
        percentage
    } = taskData;
    const query = `
    UPDATE [dbo].[Tasks] 
    SET tid=@tid, gid=@gid, name=@name, description=@description, list=@list, datetime=@datetime, percentage=@percentage
    WHERE tid=@tid;
    UPDATE [dbo].[Nodes] 
    SET nid=@tid, gid=@gid, name=@name, description=@description, percentage=@percentage
    WHERE nid=@tid
    `;
    const params = [
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid },
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'name', type: TYPES.VarChar, value: name },
        { name: 'description', type: TYPES.Text, value: description },
        { name: 'list', type: TYPES.VarChar, value: list },
        { name: 'datetime', type: TYPES.SmallDateTime, value: datetime },
        { name: 'percentage', type: TYPES.Int, value: percentage },
    ];
    return execQuery.execWriteCommand(query, params);
};

const updateTaskFromNode = (taskData) => {
    const {
        tid,
        name,
        description,
        date,
        percentage
    } = taskData;
    const query = `
    UPDATE [dbo].[Tasks] 
    SET name=@name, description=@description, datetime=CONVERT(datetime, @date, 120), percentage=@percentage
    WHERE tid=@tid
    `;
    const params = [
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid },
        { name: 'name', type: TYPES.VarChar, value: name },
        { name: 'description', type: TYPES.Text, value: description },
        { name: 'date', type: TYPES.SmallDateTime, value: date },
        { name: 'percentage', type: TYPES.Int, value: percentage },
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
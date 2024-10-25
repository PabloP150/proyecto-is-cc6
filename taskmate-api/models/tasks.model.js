const execQuery = require('../helpers/execQuery');
const TYPES = require('tedious').TYPES;

const addTask = (taskData) => {
    const {
        tid,
        gid,
        name,
        description,
        datetime
    } = taskData;
    const query = `
    INSERT INTO [dbo].[Tasks] (tid, gid, name, description, datetime) 
    VALUES(@tid, @gid, @name, @description, @datetime)
    `;
    const params = [
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid },
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'name', type: TYPES.VarChar, value: name },
        { name: 'description', type: TYPES.Text, value: description },
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
        datetime
    } = taskData;
    const query = `
    UPDATE [dbo].[Tasks] 
    SET tid=@tid, gid=@gid, name=@name, description=@description, datetime=@datetime
    WHERE tid=@tid
    `;
    const params = [
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid },
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'name', type: TYPES.VarChar, value: name },
        { name: 'description', type: TYPES.Text, value: description },
        { name: 'datetime', type: TYPES.SmallDateTime, value: datetime },
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

const getTasksByUserId = (userId) => {
    const query = `
    SELECT * FROM [dbo].[Tasks] WHERE userId = @userId
    `;
    const params = [
        { name: 'userId', type: TYPES.UniqueIdentifier, value: userId },
    ];
    return execQuery.execReadCommand(query, params);
};

module.exports = {
    addTask,
    updateTask,
    deleteTask,
    getAllTasks,
    getTask,
    getTasksByUserId,
};

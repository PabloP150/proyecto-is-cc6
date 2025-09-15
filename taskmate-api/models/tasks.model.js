const { execReadCommand, execWriteCommand } = require('../helpers/execQuery');
const { TYPES } = require('tedious');

// Convierte strings de fecha a Date en hora local sin interpretaciones UTC.
// Soporta: 'YYYY-MM-DD', 'YYYY-MM-DDTHH:mm', 'YYYY-MM-DDTHH:mm:ss', y objetos Date.
const toLocalDate = (dt) => {
    if (!dt) return null;
    if (dt instanceof Date) return dt;
    if (typeof dt === 'string') {
        // Solo fecha
        if (/^\d{4}-\d{2}-\d{2}$/.test(dt)) {
            const [y,m,d] = dt.split('-').map(Number);
            return new Date(y, m - 1, d, 0, 0, 0, 0);
        }
        // Fecha con hora (al menos HH:mm)
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(dt)) {
            const [datePart, timePart] = dt.split('T');
            const [y,m,d] = datePart.split('-').map(Number);
            const [hh,mm,ss] = timePart.split(':').map(Number);
            return new Date(y, m - 1, d, hh || 0, mm || 0, ss || 0, 0);
        }
    }
    // Fallback a parser nativo
    return new Date(dt);
};

const addTask = async (taskData) => {
    const { tid, gid, name, description, list, datetime, percentage } = taskData;
    const safeDescription = (description === undefined || description === null) ? '' : description;
    const query = `INSERT INTO dbo.Tasks (tid, gid, name, description, list, datetime, percentage)
                   VALUES (@tid, @gid, @name, @description, @list, @datetime, @percentage)`;
    const params = [
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid },
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'name', type: TYPES.VarChar, value: name },
    { name: 'description', type: TYPES.VarChar, value: safeDescription },
        { name: 'list', type: TYPES.VarChar, value: list },
        { name: 'datetime', type: TYPES.SmallDateTime, value: toLocalDate(datetime) },
        { name: 'percentage', type: TYPES.Int, value: percentage ?? 0 },
    ];
    return execWriteCommand(query, params);
};

const updateTask = async (taskData) => {
    const { tid, gid, name, description, list, datetime, percentage } = taskData;
    const safeDescription = (description === undefined || description === null) ? '' : description;
    const query = `UPDATE dbo.Tasks
                   SET gid=@gid, name=@name, description=@description, list=@list,
                       datetime=@datetime, percentage=@percentage
                   WHERE tid=@tid`;
    const params = [
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid },
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'name', type: TYPES.VarChar, value: name },
    { name: 'description', type: TYPES.VarChar, value: safeDescription },
        { name: 'list', type: TYPES.VarChar, value: list },
        { name: 'datetime', type: TYPES.SmallDateTime, value: toLocalDate(datetime) },
        { name: 'percentage', type: TYPES.Int, value: percentage ?? 0 },
    ];
    return execWriteCommand(query, params);
};

const updateTaskFromNode = async (taskData) => {
    const { tid, name, description, date, percentage } = taskData;
    const safeDescription = (description === undefined || description === null) ? '' : description;
    const query = `UPDATE dbo.Tasks
                   SET name=@name, description=@description, datetime=@datetime,
                       percentage = COALESCE(@percentage, percentage)
                   WHERE tid=@tid`;
    const params = [
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid },
        { name: 'name', type: TYPES.VarChar, value: name },
    { name: 'description', type: TYPES.VarChar, value: safeDescription },
        { name: 'datetime', type: TYPES.SmallDateTime, value: toLocalDate(date) },
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
    // Devuelve la fecha/hora como string exacto desde SQL (YYYY-MM-DD HH:mm)
    const query = `SELECT tid, gid, name, description, list, CONVERT(VARCHAR(16), datetime, 120) AS datetimeStr, percentage FROM dbo.Tasks`;
    return execReadCommand(query);
};

const getTask = async (tid) => {
    // Devuelve la fecha/hora como string exacto desde SQL (YYYY-MM-DD HH:mm)
    const query = `SELECT tid, gid, name, description, list, CONVERT(VARCHAR(16), datetime, 120) AS datetimeStr, percentage FROM dbo.Tasks WHERE tid=@tid`;
    const params = [{ name: 'tid', type: TYPES.UniqueIdentifier, value: tid }];
    return execReadCommand(query, params);
};

const getTasksByGroupId = async (gid) => {
    // Devuelve la fecha/hora como string exacto desde SQL (YYYY-MM-DD HH:mm)
    const query = `SELECT tid, gid, name, description, list, CONVERT(VARCHAR(16), datetime, 120) AS datetimeStr, percentage FROM dbo.Tasks WHERE gid=@gid`;
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
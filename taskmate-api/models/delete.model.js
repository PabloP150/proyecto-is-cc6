const execQuery = require('../helpers/execQuery');
const TYPES = require('tedious').TYPES;


const addDelete = (deleteData) => {
    const {
        tid,
        gid,
        name,
        description,
        datetime
    } = deleteData;
    const query = `
    INSERT INTO [dbo].[DeleteTask] (tid, gid, name, description, datetime) 
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

const getEliminados = (gid) => {
    const query = `SELECT * FROM [dbo].[DeleteTask] WHERE gid = @gid`;
    const params = [
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid }
    ];
    return execQuery.execReadCommand(query, params);
};

const deleteAll = (gid) => {
    const query = `DELETE FROM [dbo].[DeleteTask] WHERE gid = @gid`;
    const params = [
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid }
    ];
    return execQuery.execWriteCommand(query, params);
};

module.exports = {
    addDelete,
    getEliminados,
    deleteAll
};
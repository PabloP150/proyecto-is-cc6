const { execReadCommand, execWriteCommand } = require('../helpers/execQuery');
const { TYPES } = require('tedious');

const addDelete = async (deleteData) => {
    const { tid, gid, name, description, datetime, percentage } = deleteData;
    const query = `INSERT INTO dbo.DeleteTask (tid, gid, name, description, datetime, percentage)
                   VALUES (@tid, @gid, @name, @description, @datetime, @percentage)`;
    const params = [
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid },
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'name', type: TYPES.VarChar, value: name },
        { name: 'description', type: TYPES.VarChar, value: description ?? '' },
        { name: 'datetime', type: TYPES.SmallDateTime, value: datetime ? new Date(datetime) : new Date(0) },
        { name: 'percentage', type: TYPES.Int, value: percentage ?? 0 },
    ];
    return execWriteCommand(query, params);
};

const getEliminados = async (gid) => {
    const query = `SELECT tid, gid, name, description, datetime, percentage FROM dbo.DeleteTask WHERE gid=@gid`;
    const params = [{ name: 'gid', type: TYPES.UniqueIdentifier, value: gid }];
    return execReadCommand(query, params);
};

const deleteAll = async (gid) => {
    const query = `DELETE FROM dbo.DeleteTask WHERE gid=@gid`;
    const params = [{ name: 'gid', type: TYPES.UniqueIdentifier, value: gid }];
    return execWriteCommand(query, params);
};

module.exports = {
    addDelete,
    getEliminados,
    deleteAll
};
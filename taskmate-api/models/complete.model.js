const { execReadCommand, execWriteCommand } = require('../helpers/execQuery');
const { TYPES } = require('tedious');

const addComplete = async (completeData) => {
    const { tid, gid, name, description, percentage, datetime } = completeData;
    const query = `INSERT INTO dbo.Complete (tid, gid, name, description, percentage, datetime)
                   VALUES (@tid, @gid, @name, @description, @percentage, @datetime)`;
    const params = [
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid },
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'name', type: TYPES.VarChar, value: name },
        { name: 'description', type: TYPES.VarChar, value: description },
        { name: 'percentage', type: TYPES.Int, value: percentage ?? 0 },
        { name: 'datetime', type: TYPES.SmallDateTime, value: new Date(datetime) },
    ];
    return execWriteCommand(query, params);
};

const getCompletados = async (gid) => {
    const query = `SELECT tid, gid, name, description, percentage, datetime FROM dbo.Complete WHERE gid=@gid`;
    const params = [{ name: 'gid', type: TYPES.UniqueIdentifier, value: gid }];
    return execReadCommand(query, params);
};

const deleteAll = async (gid) => {
    const query = `DELETE FROM dbo.Complete WHERE gid=@gid`;
    const params = [{ name: 'gid', type: TYPES.UniqueIdentifier, value: gid }];
    return execWriteCommand(query, params);
};


module.exports = {
    addComplete,
    getCompletados,
    deleteAll
};
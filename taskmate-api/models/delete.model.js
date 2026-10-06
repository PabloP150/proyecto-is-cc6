const { execReadCommand, execWriteCommand } = require('../helpers/execQuery');
const { TYPES } = require('tedious');

// Same wall-clock string as GET /api/tasks ('YYYY-MM-DDTHH:mm'), like complete.model: the raw
// column would reach the client shifted to UTC.
const getEliminados = async (gid) => {
    const query = `SELECT tid, gid, name, description,
                          REPLACE(CONVERT(VARCHAR(16), datetime, 120), ' ', 'T') AS datetime, percentage
                   FROM dbo.DeleteTask WHERE gid=@gid`;
    const params = [{ name: 'gid', type: TYPES.UniqueIdentifier, value: gid }];
    return execReadCommand(query, params);
};

const deleteAll = async (gid) => {
    const query = `DELETE FROM dbo.DeleteTask WHERE gid=@gid`;
    const params = [{ name: 'gid', type: TYPES.UniqueIdentifier, value: gid }];
    return execWriteCommand(query, params);
};

module.exports = {
    getEliminados,
    deleteAll
};
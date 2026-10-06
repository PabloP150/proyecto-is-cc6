const { execReadCommand, execWriteCommand } = require('../helpers/execQuery');
const { TYPES } = require('tedious');

// Same wall-clock string as GET /api/tasks ('YYYY-MM-DDTHH:mm'). The raw column would come back
// as a Date in the API's time zone (useUTC off) and reach the client shifted to UTC.
const getCompletados = async (gid) => {
    const query = `SELECT tid, gid, name, description, percentage,
                          REPLACE(CONVERT(VARCHAR(16), datetime, 120), ' ', 'T') AS datetime
                   FROM dbo.Complete WHERE gid=@gid`;
    const params = [{ name: 'gid', type: TYPES.UniqueIdentifier, value: gid }];
    return execReadCommand(query, params);
};

const deleteAll = async (gid) => {
    const query = `DELETE FROM dbo.Complete WHERE gid=@gid`;
    const params = [{ name: 'gid', type: TYPES.UniqueIdentifier, value: gid }];
    return execWriteCommand(query, params);
};


module.exports = {
    getCompletados,
    deleteAll
};
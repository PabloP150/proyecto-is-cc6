const execQuery = require('../helpers/execQuery');
const TYPES = require('tedious').TYPES;

const addUsertask = (usertaskData) => {
    const { utid, uid, tid, completed } = usertaskData;
    const query = `
        INSERT INTO [dbo].[UserTask] (utid, uid, tid, completed)
        VALUES(@utid, @uid, @tid, @completed)
    `;
    const params = [
        { name: 'utid', type: TYPES.UniqueIdentifier, value: utid },
        { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid },
        { name: 'completed', type: TYPES.Bit, value: completed },
    ];
    return execQuery.execWriteCommand(query, params);
};

const deleteUsertask = (uid, tid) => {
    const query = `
        DELETE FROM [dbo].[UserTask] WHERE uid = @uid AND tid = @tid
    `;
    const params = [
        { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid }
    ];
    return execQuery.execWriteCommand(query, params);
};

const getUsertasksByTid = (tid) => {
    const query = `SELECT * FROM [dbo].[UserTask] WHERE tid = @tid`;
    const params = [
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid }
    ];
    return execQuery.execReadCommand(query, params);
};


module.exports = {
    addUsertask,
    deleteUsertask,
    getUsertasksByTid,
};
    
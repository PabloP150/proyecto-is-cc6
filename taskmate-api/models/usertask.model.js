const { execReadCommand, execWriteCommand } = require('../helpers/execQuery');
const { TYPES } = require('tedious');

const addUsertask = async (usertaskData) => {
    const { utid, uid, tid, completed } = usertaskData;
    // Idempotent: skip insert if (uid, tid) already exists (avoids PK violation)
    const query = `
        INSERT INTO dbo.UserTask (utid, uid, tid, completed)
        SELECT @utid, @uid, @tid, @completed
        WHERE NOT EXISTS (SELECT 1 FROM dbo.UserTask WHERE uid=@uid AND tid=@tid)
    `;
    const params = [
        { name: 'utid', type: TYPES.UniqueIdentifier, value: utid },
        { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid },
        { name: 'completed', type: TYPES.Bit, value: !!completed },
    ];
    return execWriteCommand(query, params);
};

const deleteUsertask = async (uid, tid) => {
    const query = `DELETE FROM dbo.UserTask WHERE uid=@uid AND tid=@tid`;
    const params = [
        { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid },
    ];
    return execWriteCommand(query, params);
};

const deleteAllByTid = async (tid) => {
    const query = `DELETE FROM dbo.UserTask WHERE tid=@tid`;
    const params = [{ name: 'tid', type: TYPES.UniqueIdentifier, value: tid }];
    return execWriteCommand(query, params);
};

const getUsertasksByTid = async (tid) => {
    const query = `SELECT utid, uid, tid, completed FROM dbo.UserTask WHERE tid=@tid`;
    const params = [{ name: 'tid', type: TYPES.UniqueIdentifier, value: tid }];
    return execReadCommand(query, params);
};

const getutid = async (tid, uid) => {
    const query = `SELECT utid FROM dbo.UserTask WHERE tid=@tid AND uid=@uid`;
    const params = [
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid },
        { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
    ];
    return execReadCommand(query, params);
};

module.exports = {
    addUsertask,
    deleteUsertask,
    deleteAllByTid,
    getUsertasksByTid,
    getutid,
};
    
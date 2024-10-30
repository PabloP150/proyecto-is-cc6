const execQuery = require('../helpers/execQuery');
const TYPES = require('tedious').TYPES;

const addEdge = (edgeData) => {
    const { eid, gid, sourceId, targetId } = edgeData;
    const query = `
    INSERT INTO [dbo].[Edges] (eid, gid, sourceId, targetId) 
    VALUES(@eid, @gid, @sourceId, @targetId)
    `;
    const params = [
        { name: 'eid', type: TYPES.UniqueIdentifier, value: eid },
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'sourceId', type: TYPES.UniqueIdentifier, value: sourceId },
        { name: 'targetId', type: TYPES.UniqueIdentifier, value: targetId },
    ];
    return execQuery.execWriteCommand(query, params);
};

const getEdgesByGroupId = (gid) => {
    const query = `
    SELECT * FROM [dbo].[Edges] WHERE gid = @gid
    `;
    const params = [
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
    ];
    return execQuery.execReadCommand(query, params);
};

const deleteEdge = (eid) => {
    const query = `
    DELETE FROM [dbo].[Edges] WHERE eid = @eid
    `;
    const params = [
        { name: 'eid', type: TYPES.UniqueIdentifier, value: eid }
    ];
    return execQuery.execWriteCommand(query, params);
};

module.exports = {
    addEdge,
    getEdgesByGroupId,
    deleteEdge
};

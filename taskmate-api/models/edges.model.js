const execQuery = require('../helpers/execQuery');
const TYPES = require('tedious').TYPES;

const addEdge = (edgeData) => {
    const { eid, gid, sourceId, targetId } = edgeData;
    const query = `
    INSERT INTO [dbo].[Edges] (eid, gid, sourceId, targetId) 
    VALUES(@eid, @gid, @sourceId, @targetId);

    UPDATE [dbo].[Nodes] 
    SET connections = connections + 1
    WHERE nid = @sourceId;
    `;
    const params = [
        { name: 'eid', type: TYPES.UniqueIdentifier, value: eid },
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'sourceId', type: TYPES.UniqueIdentifier, value: sourceId },
        { name: 'targetId', type: TYPES.UniqueIdentifier, value: targetId },
    ];
    return execQuery.execWriteCommand(query, params);
};

const getEdgesById = (eid) => {
    const query = `
    SELECT * FROM [dbo].[Edges] WHERE eid = @eid
    `;
    const params = [
        { name: 'eid', type: TYPES.UniqueIdentifier, value: eid },
    ];
    return execQuery.execReadCommand(query, params);
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

const updatePrerequisite = (edgeData) => {
    const { eid, prerequisite } = edgeData;
    const query = `
    UPDATE [dbo].[Edges]
    SET prerequisite = @prerequisite
    WHERE eid = @eid
    `;
    const params = [
        { name: 'eid', type: TYPES.UniqueIdentifier, value: eid },
        { name: 'prerequisite', type: TYPES.Bit, value: prerequisite },
    ];
    return execQuery.execWriteCommand(query, params);
}

const deleteEdge = (eid) => {
    const query = `
    DELETE FROM [dbo].[Edges] WHERE eid = @eid
    `;
    const params = [
        { name: 'eid', type: TYPES.UniqueIdentifier, value: eid }
    ];
    return execQuery.execWriteCommand(query, params);
};

const deleteEdgeBySource = (nid) => {
    const query = `
    DELETE FROM [dbo].[Edges] WHERE sourceId = @nid
    `;
    const params = [
        { name: 'nid', type: TYPES.UniqueIdentifier, value: nid }
    ];
    return execQuery.execWriteCommand(query, params);
};

module.exports = {
    addEdge,
    getEdgesById,
    getEdgesByGroupId,
    updatePrerequisite,
    deleteEdge,
    deleteEdgeBySource
};

const { execReadCommand, execWriteCommand } = require('../helpers/execQuery');
const { TYPES } = require('tedious');

const addEdge = async (edgeData) => {
    const { eid, gid, sourceId, targetId } = edgeData;
    const query = `INSERT INTO dbo.Edges (eid, gid, sourceId, targetId) VALUES (@eid, @gid, @sourceId, @targetId)`;
    const params = [
        { name: 'eid', type: TYPES.UniqueIdentifier, value: eid },
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'sourceId', type: TYPES.UniqueIdentifier, value: sourceId },
        { name: 'targetId', type: TYPES.UniqueIdentifier, value: targetId },
    ];
    return execWriteCommand(query, params);
};

const getEdgesById = async (eid) => {
    const query = `SELECT eid, gid, sourceId, targetId, prerequisite FROM dbo.Edges WHERE eid=@eid`;
    const params = [{ name: 'eid', type: TYPES.UniqueIdentifier, value: eid }];
    return execReadCommand(query, params);
};

const getEdgesByGroupId = async (gid) => {
    const query = `SELECT eid, gid, sourceId, targetId, prerequisite FROM dbo.Edges WHERE gid=@gid`;
    const params = [{ name: 'gid', type: TYPES.UniqueIdentifier, value: gid }];
    return execReadCommand(query, params);
};

const updatePrerequisite = async (edgeData) => {
    const { eid, prerequisite } = edgeData;
    const query = `UPDATE dbo.Edges SET prerequisite=@prerequisite WHERE eid=@eid`;
    const params = [
        { name: 'eid', type: TYPES.UniqueIdentifier, value: eid },
        { name: 'prerequisite', type: TYPES.Bit, value: prerequisite },
    ];
    return execWriteCommand(query, params);
};

const deleteEdge = async (eid) => {
    const query = `DELETE FROM dbo.Edges WHERE eid=@eid`;
    const params = [{ name: 'eid', type: TYPES.UniqueIdentifier, value: eid }];
    return execWriteCommand(query, params);
};

const deleteEdgeBySource = async (nid) => {
    const query = `DELETE FROM dbo.Edges WHERE sourceId=@nid`;
    const params = [{ name: 'nid', type: TYPES.UniqueIdentifier, value: nid }];
    return execWriteCommand(query, params);
};

module.exports = {
    addEdge,
    getEdgesById,
    getEdgesByGroupId,
    updatePrerequisite,
    deleteEdge,
    deleteEdgeBySource
};
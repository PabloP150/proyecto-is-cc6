const MockDatabase = require('../helpers/mockDatabase');

const addEdge = (edgeData) => {
    return MockDatabase.addEdge(edgeData);
};

const getEdgesById = (eid) => {
    return MockDatabase.getEdgesById(eid);
};

const getEdgesByGroupId = (gid) => {
    return MockDatabase.getEdgesByGroupId(gid);
};

const updatePrerequisite = (edgeData) => {
    return MockDatabase.updatePrerequisite(edgeData);
};

const deleteEdge = (eid) => {
    return MockDatabase.deleteEdge(eid);
};

const deleteEdgeBySource = (nid) => {
    return MockDatabase.deleteEdgeBySource(nid);
};

module.exports = {
    addEdge,
    getEdgesById,
    getEdgesByGroupId,
    updatePrerequisite,
    deleteEdge,
    deleteEdgeBySource
};
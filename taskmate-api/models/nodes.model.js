const MockDatabase = require('../helpers/mockDatabase');

const addNode = async (nodeData) => {
    return MockDatabase.addNode(nodeData);
};

const updateNode = (nodeData) => {
    return MockDatabase.updateNode(nodeData);
};

const updateNodeCoords = (nodeData) => {
    return MockDatabase.updateNodeCoords(nodeData);
};

const updateNodeCompleted = (nodeData) => {
    return MockDatabase.updateNodeCompleted(nodeData);
};

const updateNodePercentage = (nodeData) => {
    return MockDatabase.updateNodePercentage(nodeData);
};

const deleteNode = (nid) => {
    return MockDatabase.deleteNode(nid);
};

const getAllNodes = () => {
    return MockDatabase.getAllNodes();
};

const getNodesAndTasks = (gid) => {
    return MockDatabase.getNodesAndTasks(gid);
};

const getNode = (nid) => {
    return MockDatabase.getNode(nid);
};

const getNodesByGroupId = (gid) => {
    return MockDatabase.getNodesByGroupId(gid);
};

module.exports = {
    addNode,
    updateNode,
    updateNodeCoords,
    updateNodeCompleted,
    updateNodePercentage,
    deleteNode,
    getAllNodes,
    getNodesAndTasks,
    getNode,
    getNodesByGroupId,
};
const { execReadCommand, execWriteCommand } = require('../helpers/execQuery');
const { useTransaction } = require('../helpers/transaction');
const { TYPES } = require('tedious');

const addNode = async (nodeData, options = {}) => {
    const { nid, gid, name, description, date, completed, percentage, x_pos, y_pos } = nodeData;
    const query = `INSERT INTO dbo.Nodes (nid, gid, name, description, date, completed, x_pos, y_pos, percentage)
                   VALUES (@nid, @gid, @name, @description, @date, @completed, @x_pos, @y_pos, @percentage)`;
    const params = [
        { name: 'nid', type: TYPES.UniqueIdentifier, value: nid },
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'name', type: TYPES.NVarChar, value: name },
        { name: 'description', type: TYPES.NVarChar, value: description },
        { name: 'date', type: TYPES.Date, value: new Date(date) },
        { name: 'completed', type: TYPES.Bit, value: completed ?? false },
        { name: 'x_pos', type: TYPES.Float, value: x_pos },
        { name: 'y_pos', type: TYPES.Float, value: y_pos },
        { name: 'percentage', type: TYPES.Int, value: percentage ?? 0 },
    ];
    return options.tx ? options.tx.write(query, params) : execWriteCommand(query, params);
};

const updateNode = async (nodeData) => {
    const { nid, name, description, date } = nodeData;
    const query = `UPDATE dbo.Nodes SET name=@name, description=@description, date=@date WHERE nid=@nid`;
    const params = [
        { name: 'nid', type: TYPES.UniqueIdentifier, value: nid },
        { name: 'name', type: TYPES.NVarChar, value: name },
        { name: 'description', type: TYPES.NVarChar, value: description },
        { name: 'date', type: TYPES.Date, value: new Date(date) },
    ];
    return execWriteCommand(query, params);
};

const updateNodeCoords = async (nodeData) => {
    const { nid, x_pos, y_pos } = nodeData;
    const query = `UPDATE dbo.Nodes SET x_pos=@x_pos, y_pos=@y_pos WHERE nid=@nid`;
    const params = [
        { name: 'nid', type: TYPES.UniqueIdentifier, value: nid },
        { name: 'x_pos', type: TYPES.Float, value: x_pos },
        { name: 'y_pos', type: TYPES.Float, value: y_pos },
    ];
    return execWriteCommand(query, params);
};

const updateNodeCompleted = async (nodeData) => {
    const { nid, completed } = nodeData;
    const query = `UPDATE dbo.Nodes SET completed=@completed WHERE nid=@nid`;
    const params = [
        { name: 'nid', type: TYPES.UniqueIdentifier, value: nid },
        { name: 'completed', type: TYPES.Bit, value: completed },
    ];
    return execWriteCommand(query, params);
};

const updateNodePercentage = async (nodeData) => {
    const { nid, percentage } = nodeData;
    const query = `UPDATE dbo.Nodes SET percentage=@percentage WHERE nid=@nid`;
    const params = [
        { name: 'nid', type: TYPES.UniqueIdentifier, value: nid },
        { name: 'percentage', type: TYPES.Int, value: percentage },
    ];
    return execWriteCommand(query, params);
};

// Edges first (FK), then the node, atomically. Returns the number of Nodes rows deleted.
const deleteNode = async (nid, options = {}) => useTransaction(options, async (tx) => {
    const params = [{ name: 'nid', type: TYPES.UniqueIdentifier, value: nid }];
    await tx.write('DELETE FROM dbo.Edges WHERE sourceId = @nid OR targetId = @nid', params);
    return tx.write('DELETE FROM dbo.Nodes WHERE nid = @nid', params);
});

const getNodesAndTasks = async (gid) => {
    const query = `
        SELECT name, nid AS id, date, description FROM dbo.Nodes WHERE gid=@gid
        UNION ALL
        SELECT name, tid AS id, datetime AS date, description FROM dbo.Tasks WHERE gid=@gid
    `;
    const params = [{ name: 'gid', type: TYPES.UniqueIdentifier, value: gid }];
    return execReadCommand(query, params);
};

const getNode = async (nid) => {
    const query = `SELECT nid, gid, name, description, date, completed, x_pos, y_pos, percentage FROM dbo.Nodes WHERE nid=@nid`;
    const params = [{ name: 'nid', type: TYPES.UniqueIdentifier, value: nid }];
    return execReadCommand(query, params);
};

const getNodesByGroupId = async (gid) => {
    const query = `SELECT nid, gid, name, description, date, completed, x_pos, y_pos, percentage FROM dbo.Nodes WHERE gid=@gid`;
    const params = [{ name: 'gid', type: TYPES.UniqueIdentifier, value: gid }];
    return execReadCommand(query, params);
};

// getNodeLayout(gid) → [{ y_pos, descriptionLength }] of the group's nodes (y grows downward): what
// decides how tall each card is drawn, so new nodes can go below all of them.
// Inside a transaction the range lock makes a concurrent caller for the same group wait for the
// commit, so two plans saved at once do not both take the same free row.
const getNodeLayout = async (gid, options = {}) => {
    const query = `SELECT y_pos, LEN(description) AS descriptionLength
                   FROM dbo.Nodes WITH (UPDLOCK, HOLDLOCK) WHERE gid=@gid`;
    const params = [{ name: 'gid', type: TYPES.UniqueIdentifier, value: gid }];
    return options.tx ? options.tx.read(query, params) : execReadCommand(query, params);
};

module.exports = {
    addNode,
    updateNode,
    updateNodeCoords,
    updateNodeCompleted,
    updateNodePercentage,
    deleteNode,
    getNodesAndTasks,
    getNode,
    getNodesByGroupId,
    getNodeLayout,
};
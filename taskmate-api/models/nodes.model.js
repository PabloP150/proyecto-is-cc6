const execQuery = require('../helpers/execQuery');
const TYPES = require('tedious').TYPES;

const addNode = async (nodeData) => {
    const { nid, gid, name, description, date, completed, x_pos, y_pos } = nodeData;
    const query = `
    INSERT INTO dbo.Nodes (nid, gid, name, description, completed, date, x_pos, y_pos, percentage)
    VALUES (@nid, @gid, @name, @description, @completed, @date, @x_pos, @y_pos, 0)
    `;
    const params = [
        { name: 'nid', type: TYPES.UniqueIdentifier, value: nid },
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'name', type: TYPES.VarChar, value: name },
        { name: 'description', type: TYPES.Text, value: description },
        { name: 'date', type: TYPES.Date, value: date },
        { name: 'completed', type: TYPES.Bit, value: completed },
        { name: 'x_pos', type: TYPES.Float, value: x_pos },
        { name: 'y_pos', type: TYPES.Float, value: y_pos },
    ];
    return execQuery.execWriteCommand(query, params);
};

const updateNode = (nodeData) => {
    const {
        nid,
        name,
        description,
        date
    } = nodeData;
    const query = `
    UPDATE [dbo].[Nodes] 
    SET name=@name, description=@description, date=@date
    WHERE nid=@nid
    `;
    const params = [
        { name: 'nid', type: TYPES.UniqueIdentifier, value: nid },
        { name: 'name', type: TYPES.VarChar, value: name },
        { name: 'description', type: TYPES.Text, value: description },
        { name: 'date', type: TYPES.Date, value: date }
    ];
    return execQuery.execWriteCommand(query, params);
};

const updateNodeCoords = (nodeData) => {
    const {
        nid,
        x_pos,
        y_pos
    } = nodeData;
    const query = `
    UPDATE [dbo].[Nodes] 
    SET x_pos=@x_pos, y_pos=@y_pos
    WHERE nid=@nid
    `;
    const params = [
        { name: 'nid', type: TYPES.UniqueIdentifier, value: nid },
        { name: 'x_pos', type: TYPES.Float, value: x_pos },
        { name: 'y_pos', type: TYPES.Float, value: y_pos },
    ];
    return execQuery.execWriteCommand(query, params);
};

const updateNodeCompleted = (nodeData) => {
    const {
        nid,
        completed
    } = nodeData;
    const query = `
    UPDATE [dbo].[Nodes] 
    SET completed=@completed
    WHERE nid=@nid
    `;
    const params = [
        { name: 'nid', type: TYPES.UniqueIdentifier, value: nid },
        { name: 'completed', type: TYPES.Bit, value: completed },
    ];
    return execQuery.execWriteCommand(query, params);
};

const updateNodePercentage = (nodeData) => {
    const {
        nid,
        percentage
    } = nodeData;
    const query = `
    UPDATE [dbo].[Nodes] 
    SET percentage=@percentage
    WHERE nid=@nid
    `;
    const params = [
        { name: 'nid', type: TYPES.UniqueIdentifier, value: nid },
        { name: 'percentage', type: TYPES.Int, value: percentage },
    ];
    return execQuery.execWriteCommand(query, params);
};

const deleteNode = (nid) => {
    const query = `
    DELETE FROM [dbo].[Nodes] WHERE nid = @nid
    `;
    const params = [
        { name: 'nid', type: TYPES.UniqueIdentifier, value: nid }
    ];
    return execQuery.execWriteCommand(query, params);
};

const getAllNodes = () => {
    const query = `
    SELECT * FROM [dbo].[Nodes]
    `;
    return execQuery.execReadCommand(query);
};

const getNodesAndTasks = (gid) => {
    const query = `
    SELECT DISTINCT name, id, date, description
    FROM (
        SELECT name, nid AS id, date, description 
		FROM dbo.Nodes
		WHERE gid=@gid
        UNION
	    SELECT name, tid AS id, datetime, description 
		FROM dbo.Tasks
		WHERE gid=@gid
    ) AS results;
    `;
    const params = [
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
    ];
    return execQuery.execReadCommand(query, params);
};

const getNode = (nid) => {
    const query = `
    SELECT * FROM [dbo].[Nodes] WHERE nid = @nid
    `;
    const params = [
        { name: 'nid', type: TYPES.UniqueIdentifier, value: nid }
    ];
    return execQuery.execReadCommand(query, params);
};

const getNodesByGroupId = (gid) => {
    const query = `
    SELECT * FROM [dbo].[Nodes] WHERE gid = @gid
    `;
    const params = [
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
    ];
    return execQuery.execReadCommand(query, params);
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

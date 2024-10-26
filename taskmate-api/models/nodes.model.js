const execQuery = require('../helpers/execQuery');
const TYPES = require('tedious').TYPES;

const addNode = (nodeData) => {
    const {
        nid,
        gid,
        name,
        description,
        date
    } = nodeData;
    const query = `
    INSERT INTO [dbo].[Nodes] (nid, gid, name, description, date) 
    VALUES(@nid, @gid, @name, @description, @date)
    `;
    const params = [
        { name: 'nid', type: TYPES.UniqueIdentifier, value: nid },
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'name', type: TYPES.VarChar, value: name },
        { name: 'description', type: TYPES.Text, value: description },
        { name: 'date', type: TYPES.Date, value: date },
    ];
    return execQuery.execWriteCommand(query, params);
};

const updateNode = (nodeData) => {
    const {
        nid,
        gid,
        name,
        description,
        date
    } = nodeData;
    const query = `
    UPDATE [dbo].[Nodes] 
    SET nid=@nid, gid=@gid, name=@name, description=@description, date=@date
    WHERE nid=@nid
    `;
    const params = [
        { name: 'nid', type: TYPES.UniqueIdentifier, value: nid },
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'name', type: TYPES.VarChar, value: name },
        { name: 'description', type: TYPES.Text, value: description },
        { name: 'date', type: TYPES.Date, value: date },
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
    deleteNode,
    getAllNodes,
    getNode,
    getNodesByGroupId,
};

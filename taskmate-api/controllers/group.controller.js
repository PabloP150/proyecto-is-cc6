const groupRoute = require('express').Router();
const GroupModel = require('./../models/group.model');
const UserGroupModel = require('./../models/userGroup.model');
const { v4: uuidv4 } = require('uuid');

// Crear un nuevo grupo
groupRoute.post('/', async (req, res) => {
    const { adminId, name } = req.body;
    const gid = uuidv4();

    try {
        await GroupModel.addGroup({ gid, adminId, name });
        res.status(201).json({ message: 'Group created successfully', gid });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Unirse a un grupo existente
groupRoute.post('/join', async (req, res) => {
    const { uid, gid } = req.body;

    try {
        await UserGroupModel.addUserToGroup({ uid, gid });
        res.status(200).json({ message: 'Joined group successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = groupRoute;

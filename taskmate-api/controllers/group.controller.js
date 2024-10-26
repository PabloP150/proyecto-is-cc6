const groupRoute = require('express').Router();
const GroupModel = require('./../models/group.model');
const UserGroupModel = require('./../models/userGroup.model');
const { v4: uuidv4 } = require('uuid');
const UserModel = require('./../models/user.model'); // Asegúrate de tener un modelo de usuario

// Crear un nuevo grupo
groupRoute.post('/group', async (req, res) => {
    const { adminId, name } = req.body;

    try {
        // Obtén el userId desde la base de datos
        const user = await UserModel.getidUser(adminId);
        if (!user) {
            return res.status(401).json({ error: 'Usuario no encontrado' });
        }

        const gid = uuidv4();

        await GroupModel.addGroup({ gid, adminId: user.uid, name });
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

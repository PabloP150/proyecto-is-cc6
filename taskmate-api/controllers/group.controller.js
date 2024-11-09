const groupRoute = require('express').Router();
const GroupModel = require('./../models/group.model');
const UserGroupModel = require('./../models/userGroup.model');
const { v4: uuidv4 } = require('uuid');
const UserModel = require('./../models/user.model'); // Asegúrate de tener un modelo de usuario

// Crear un nuevo grupo
groupRoute.post('/group', async (req, res) => {
    const { adminId, name } = req.body;
    const gid = uuidv4();

    try {
        // Crear el grupo
        await GroupModel.addGroup({ gid, adminId, name });

        // Agregar el usuario que creó el grupo como miembro
        await UserGroupModel.addUserToGroup({ uid: adminId, gid: gid });

        res.status(201).json({ message: 'Group created successfully', gid: uuidv4() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

//obtener los nombres de usuarios que pertenecen a un grupo
groupRoute.get('/:gid/members', async (req, res) => {
    const { gid } = req.params;
    try {
        const members = await UserGroupModel.getMembersByGroupId(gid);
        res.status(200).json({ members });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

//obtener los grupos de un usuario
groupRoute.get('/user-groups', async (req, res) => {
    const { uid } = req.query;
    if (!uid) {
        return res.status(400).json({ error: 'User ID is required' });
    }
    try {
        const groups = await GroupModel.getGroupsByUserId(uid);
        res.status(200).json({ groups });
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

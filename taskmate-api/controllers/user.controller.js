// controllers/user.controller.js
const userRoute = require('express').Router();
const UserModel = require('./../models/user.model');
const GroupModel = require('./../models/group.model');
const UserGroupModel = require('./../models/userGroup.model');
const { v4: uuidv4 } = require('uuid');

userRoute.post('/', async (req, res) => {
    const uid = uuidv4();
    const { username, password } = req.body;

    try {
        await UserModel.addUser({ uid, username, password });

        // Crear un grupo individual para el usuario
        const gid = uuidv4();
        await GroupModel.addGroup({ gid, adminId: uid, name: `${username}'s Group` });

        // Agregar el usuario al grupo  
        await UserGroupModel.addUserToGroup({ uid, gid });

        res.status(200).json({
            message: 'User and group and userGroup created successfully',
            data: { uid, gid }
        });
    } catch (error) {
        console.error("Error adding user or group:", error);
        res.status(500).json({ error: error.message || "An error occurred" });
    }
});
userRoute.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await UserModel.getUserByUsername(username);

    if (user.length > 0) {
        res.status(200).json({ message: 'Login successful', uid: user[0].uid });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

module.exports = userRoute;

// controllers/user.controller.js
const userRoute = require('express').Router();
const UserModel = require('./../models/user.model');
const GroupModel = require('./../models/group.model');
const UserGroupModel = require('./../models/userGroup.model');
const jwt = require('jsonwebtoken');
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
        // Generate JWT token
        const token = jwt.sign(
            { userId: user[0].uid, username: username },
            process.env.JWT_SECRET || 'your-jwt-secret-key-change-in-production',
            { expiresIn: '24h' }
        );

        res.status(200).json({ 
            message: 'Login successful', 
            uid: user[0].uid,
            token: token
        });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

userRoute.get('/getuid', async (req, res) => {
  const { username } = req.query;
  try {
    const user = await UserModel.getidUserByUsername(username);
    if (user) {
      res.status(200).json({ uid: user.uid });
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



module.exports = userRoute;

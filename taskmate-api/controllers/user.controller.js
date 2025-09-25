// controllers/user.controller.js
const userRoute = require('express').Router();
const UserModel = require('./../models/user.model');
const GroupModel = require('./../models/group.model');
const UserGroupModel = require('./../models/userGroup.model');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

userRoute.post('/', async (req, res) => {
    const uid = uuidv4();
    const { username, password } = req.body;

    try {
        if (!password || password.length < 6) {
          return res.status(400).json({ error: 'Password too short' });
        }
        const hashed = await bcrypt.hash(password, 10);
        await UserModel.addUser({ uid, username, password: hashed });

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
    try {
      const user = await UserModel.getUserByUsername(username);
      if (user.length === 0) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      const stored = user[0];
      const ok = await bcrypt.compare(password, stored.password);
      if (!ok) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      const token = jwt.sign(
        { userId: stored.uid, username: stored.username },
        process.env.JWT_SECRET || 'your-jwt-secret-key-change-in-production',
        { expiresIn: '24h' }
      );
      res.status(200).json({ message: 'Login successful', uid: stored.uid, token });
    } catch (e) {
      console.error('Login error:', e);
      res.status(500).json({ error: 'Server error' });
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

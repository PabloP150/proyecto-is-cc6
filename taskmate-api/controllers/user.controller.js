// controllers/user.controller.js
const userRoute = require('express').Router();
const UserModel = require('./../models/user.model');
const GroupModel = require('./../models/group.model');
const { v4: uuidv4 } = require('uuid');

userRoute.post('/', async (req, res) => {
    const uid = uuidv4();
    const { username, password } = req.body;
    UserModel.addUser({ uid, username, password })
    .then((rowCount, more) => {
        res.status(200).json({
            data: {
                rowCount,
                more,
                uid
            },
        });
    })
    .catch(error => {
        console.error("Error adding user:", error);
        res.status(500).json({ error: error.message || "An error occurred" });
    });
});
userRoute.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await UserModel.getUserByUsername(username);
    if (user.length > 0) {
        const userGroups = await GroupModel.getGroupsByUserId(user[0].uid);
        const hasGroup = userGroups.length > 0;
        res.status(200).json({ message: 'Login successful', hasGroup });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

module.exports = userRoute;

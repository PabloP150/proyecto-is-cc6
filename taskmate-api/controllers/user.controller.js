// controllers/user.controller.js
const userRoute = require('express').Router();
const UserModel = require('./../models/user.model');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const requireAuth = require('../middleware/auth.middleware');
const { authLimiter, apiLimiter } = require('../middleware/rateLimit');
const { signAccessToken } = require('../helpers/tokens');
const { AppError, sendError } = require('../helpers/errors');

const USERNAME_MAX = 25;
// bcrypt ignores everything after 72 bytes; longer passwords would silently collide.
const PASSWORD_MAX_BYTES = 72;

userRoute.post('/', authLimiter, async (req, res) => {
    const { username, password } = req.body || {};
    try {
        if (typeof username !== 'string' || !username.trim() || username.length > USERNAME_MAX) {
            throw new AppError('VALIDATION_ERROR', `Username is required (max ${USERNAME_MAX} characters)`, 400);
        }
        if (typeof password !== 'string' || password.length < 6) {
            throw new AppError('VALIDATION_ERROR', 'Password too short', 400);
        }
        if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
            throw new AppError('VALIDATION_ERROR', 'Password too long', 400);
        }
        const passwordHash = await bcrypt.hash(password, 10);
        // User + personal group + membership in one transaction; a taken username → VALIDATION_ERROR 400.
        const { uid, gid } = await UserModel.registerUserWithPersonalGroup({
            uid: uuidv4(),
            username,
            passwordHash,
            gid: uuidv4(),
            groupName: `${username}'s Group`,
        });

        res.status(200).json({
            message: 'User and group and userGroup created successfully',
            data: { uid, gid }
        });
    } catch (error) {
        sendError(res, error);
    }
});

userRoute.post('/login', authLimiter, async (req, res) => {
    const { username, password } = req.body || {};
    try {
        if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
            throw new AppError('UNAUTHENTICATED', 'Invalid credentials', 401);
        }
        const user = await UserModel.getUserByUsername(username);
        if (!user || user.length === 0) {
            throw new AppError('UNAUTHENTICATED', 'Invalid credentials', 401);
        }
        const stored = user[0];
        const ok = await bcrypt.compare(password, stored.password);
        if (!ok) {
            throw new AppError('UNAUTHENTICATED', 'Invalid credentials', 401);
        }
        const token = signAccessToken({ userId: stored.uid, username: stored.username });
        res.status(200).json({ message: 'Login successful', uid: stored.uid, token });
    } catch (error) {
        sendError(res, error);
    }
});

userRoute.get('/getuid', requireAuth, apiLimiter, async (req, res) => {
    const { username } = req.query;
    try {
        if (typeof username !== 'string' || !username) {
            throw new AppError('VALIDATION_ERROR', 'username is required', 400);
        }
        const user = await UserModel.getidUserByUsername(username);
        if (!user) {
            throw new AppError('NOT_FOUND', 'User not found', 404);
        }
        res.status(200).json({ uid: user.uid });
    } catch (error) {
        sendError(res, error);
    }
});

module.exports = userRoute;

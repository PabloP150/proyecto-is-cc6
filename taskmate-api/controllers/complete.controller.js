// controllers/complete.controller.js
// Completed-task history. Completing a task is POST /api/tasks/:tid/complete (atomic).
const completeRoute = require('express').Router();
const CompleteModel = require('./../models/complete.model');
const { sendError } = require('../helpers/errors');
const { requireGroupMember } = require('../middleware/groupAccess');

completeRoute.get('/:gid', requireGroupMember('gid'), async (req, res) => {
    try {
        const data = await CompleteModel.getCompletados(req.groupId);
        res.status(200).json({ data });
    } catch (error) {
        sendError(res, error);
    }
});

completeRoute.delete('/:gid', requireGroupMember('gid'), async (req, res) => {
    try {
        await CompleteModel.deleteAll(req.groupId);
        res.status(200).json({ message: 'Todos los completados han sido vaciados' });
    } catch (error) {
        sendError(res, error);
    }
});

module.exports = completeRoute;

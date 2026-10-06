// controllers/delete.controller.js
// Trashed-task history. Trashing a task is POST /api/tasks/:tid/trash (atomic).
const deleteRoute = require('express').Router();
const DeleteModel = require('./../models/delete.model');
const { sendError } = require('../helpers/errors');
const { requireGroupMember } = require('../middleware/groupAccess');

deleteRoute.get('/:gid', requireGroupMember('gid'), async (req, res) => {
    try {
        const data = await DeleteModel.getEliminados(req.groupId);
        res.status(200).json({ data });
    } catch (error) {
        sendError(res, error);
    }
});

deleteRoute.delete('/:gid', requireGroupMember('gid'), async (req, res) => {
    try {
        await DeleteModel.deleteAll(req.groupId);
        res.status(200).json({ message: 'Todos los eliminados han sido vaciados' });
    } catch (error) {
        sendError(res, error);
    }
});

module.exports = deleteRoute;

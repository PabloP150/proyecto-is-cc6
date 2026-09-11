// controllers/delete.controller.js
const deleteRoute = require('express').Router();
const DeleteModel = require('./../models/delete.model');
const AccessModel = require('./../models/access.model');
const { AppError, sendError } = require('../helpers/errors');
const { requireGroupMember, assertUuid, sameId } = require('../middleware/groupAccess');

deleteRoute.post('/', requireGroupMember('gid'), async (req, res) => {
    const { name, description, datetime, percentage } = req.body;
    const gid = req.groupId;
    try {
        const tid = assertUuid(req.body.tid, 'tid');
        const taskGroup = await AccessModel.resolveGroupId('task', tid);
        if (taskGroup && !sameId(taskGroup, gid)) {
            throw new AppError('VALIDATION_ERROR', 'tid belongs to another group', 400);
        }
        const rowCount = await DeleteModel.addDelete({ tid, gid, name, description, datetime, percentage });
        res.status(200).json({ data: { rowCount, tid } });
    } catch (error) {
        sendError(res, error);
    }
});

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

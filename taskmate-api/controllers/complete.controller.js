// controllers/complete.controller.js
// Legacy, non-atomic completion kept for compatibility; new clients use POST /api/tasks/:tid/complete.
const completeRoute = require('express').Router();
const CompleteModel = require('./../models/complete.model');
const AccessModel = require('./../models/access.model');
const AnalyticsIntegration = require('../services/AnalyticsIntegration');
const { AppError, sendError } = require('../helpers/errors');
const { requireGroupMember, assertUuid, sameId } = require('../middleware/groupAccess');

completeRoute.post('/', requireGroupMember('gid'), async (req, res) => {
    const {
        name,
        description,
        percentage,
        datetime
    } = req.body;
    const gid = req.groupId;

    try {
        const tid = assertUuid(req.body.tid, 'tid');
        // The UI may already have deleted the task; if it still exists it must be in this group.
        const taskGroup = await AccessModel.resolveGroupId('task', tid);
        if (taskGroup && !sameId(taskGroup, gid)) {
            throw new AppError('VALIDATION_ERROR', 'tid belongs to another group', 400);
        }

        const result = await CompleteModel.addComplete({
            tid,
            gid,
            name,
            description,
            percentage,
            datetime
        });

        // Record task completion in analytics (non-blocking)
        AnalyticsIntegration.onTaskCompletion(tid, true, {
            percentage,
            completedAt: datetime
        }).catch(error => {
            console.error('Analytics tracking failed for task completion:', error);
        });

        res.status(200).json({ data: { rowCount: result, tid } });
    } catch (error) {
        sendError(res, error);
    }
});

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

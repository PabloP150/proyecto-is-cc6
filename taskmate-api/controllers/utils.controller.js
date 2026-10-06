// controllers/utils.controller.js
const utilsRoute = require('express').Router();
const UsertaskModel = require('../models/usertask.model');
const { sendError } = require('../helpers/errors');
const { requireGroupAdmin } = require('../middleware/groupAccess');

// Seeds random assignments for a group's unassigned tasks (analytics demo data): admin only.
utilsRoute.post('/populate-assignments/:groupId', requireGroupAdmin('groupId'), async (req, res) => {
    try {
        const result = await UsertaskModel.populateAssignmentsForGroup(req.groupId);
        // Same fields the old inline route in server.js answered, plus the model result under `data`.
        res.status(200).json({
            success: true,
            group: result.group,
            members: result.members,
            totalTasks: result.totalTasks,
            assignmentsCreated: result.assigned,
            data: result
        });
    } catch (error) {
        sendError(res, error);
    }
});

module.exports = utilsRoute;

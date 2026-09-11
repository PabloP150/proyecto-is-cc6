const tasksRoute = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const TasksModel = require('./../models/tasks.model');
const AnalyticsIntegration = require('../services/AnalyticsIntegration');
const { AppError, sendError } = require('../helpers/errors');
const { requireGroupMember, requireResourceMember, sameId } = require('../middleware/groupAccess');

const TASK_NOT_FOUND = { notFoundCode: 'TASK_NOT_FOUND' };

const withDatetime = (row) => ({
    ...row,
    datetime: row.datetimeStr ? row.datetimeStr.replace(' ', 'T') : null
});

tasksRoute.get('/', requireGroupMember('gid'), async (req, res) => {
    try {
        const data = await TasksModel.getTasksByGroupId(req.groupId);
        res.status(200).json({ data: data.map(withDatetime) });
    } catch (error) {
        sendError(res, error);
    }
});

tasksRoute.get('/:id', requireResourceMember('task', 'id', TASK_NOT_FOUND), async (req, res) => {
    try {
        const data = await TasksModel.getTask(req.resourceId);
        if (!data || data.length === 0) {
            throw new AppError('TASK_NOT_FOUND', 'Task not found', 404);
        }
        res.status(200).json({ data: withDatetime(data[0]) });
    } catch (error) {
        sendError(res, error);
    }
});

tasksRoute.post('/', requireGroupMember('gid'), async (req, res) => {
    const tid = uuidv4();
    const { name, description, list, datetime, percentage } = req.body;
    try {
        const rowCount = await TasksModel.addTask({ tid, gid: req.groupId, name, description, list, datetime, percentage });
        res.status(200).json({ data: { rowCount, tid } });
    } catch (error) {
        sendError(res, error);
    }
});

tasksRoute.put('/:id', requireResourceMember('task', 'id', TASK_NOT_FOUND), async (req, res) => {
    const { gid, name, description, list, datetime, percentage } = req.body;
    try {
        if (!gid) {
            throw new AppError('VALIDATION_ERROR', 'Group ID is required', 400);
        }
        // Tasks cannot be moved between groups through this endpoint.
        if (!sameId(gid, req.groupId)) {
            throw new AppError('VALIDATION_ERROR', 'gid does not match the task group', 400);
        }
        const tid = req.resourceId;
        const rowCount = await TasksModel.updateTask({ tid, gid: req.groupId, name, description, list, datetime, percentage });
        res.status(200).json({ data: { rowCount, tid } });
    } catch (error) {
        sendError(res, error);
    }
});

// Smaller update for nodes. The flow editor calls it with node ids too: a node that is not a
// task is authorized through its own group and simply updates no task.
tasksRoute.put('/nodes/:id', requireResourceMember(['task', 'node'], 'id', TASK_NOT_FOUND), async (req, res) => {
    const tid = req.resourceId;
    const { name, description, date } = req.body;
    try {
        if (req.resourceKind !== 'task') {
            return res.status(200).json({ data: { rowCount: 0, tid } });
        }
        const rowCount = await TasksModel.updateTaskFromNode({ tid, name, description, date });
        res.status(200).json({ data: { rowCount, tid } });
    } catch (error) {
        sendError(res, error);
    }
});

// Atomic completion (moves the task to Complete). Already-completed tasks are still
// authorized through the Complete row so retries answer `already_completed`.
tasksRoute.post('/:tid/complete', requireResourceMember(['task', 'completed'], 'tid', TASK_NOT_FOUND), async (req, res) => {
    const tid = req.resourceId;
    try {
        const result = await TasksModel.completeTask(tid, { source: 'manual' });
        if (!result || result.status === 'not_found') {
            throw new AppError('TASK_NOT_FOUND', 'Task not found', 404);
        }

        if (result.status === 'completed') {
            AnalyticsIntegration.onTaskCompletion(tid, true, { percentage: 100 }).catch(error => {
                console.error('Analytics tracking failed for task completion:', error);
            });
        }

        res.status(200).json({ data: { tid, status: result.status } });
    } catch (error) {
        sendError(res, error);
    }
});

// Atomic "move to trash" (archive in DeleteTask + delete). The model already closes the
// TaskAnalytics facts; the hook afterwards only refreshes derived metrics.
tasksRoute.post('/:tid/trash', requireResourceMember('task', 'tid', TASK_NOT_FOUND), async (req, res) => {
    const tid = req.resourceId;
    try {
        const result = await TasksModel.trashTask(tid);
        if (!result || result.status !== 'deleted') {
            throw new AppError('TASK_NOT_FOUND', 'Task not found', 404);
        }

        AnalyticsIntegration.onTaskDeletion(tid).catch(error => {
            console.error('Analytics tracking failed for task deletion:', error);
        });

        res.status(200).json({ data: { tid, status: 'deleted' } });
    } catch (error) {
        sendError(res, error);
    }
});

tasksRoute.delete('/:id', requireResourceMember('task', 'id', TASK_NOT_FOUND), async (req, res) => {
    const tid = req.resourceId;
    try {
        const result = await TasksModel.deleteTask(tid);

        // Record task deletion in analytics (non-blocking)
        AnalyticsIntegration.onTaskDeletion(tid).catch(error => {
            console.error('Analytics tracking failed for task deletion:', error);
        });

        res.status(200).json({ rowCount: result });
    } catch (error) {
        sendError(res, error);
    }
});

tasksRoute.delete('/list/:gid/:list', requireGroupMember('gid'), async (req, res) => {
    const { list } = req.params;
    try {
        await TasksModel.deleteTasksByList(req.groupId, list);
        res.status(200).json({ message: 'Lista eliminada exitosamente' });
    } catch (error) {
        sendError(res, error);
    }
});

module.exports = tasksRoute;

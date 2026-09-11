// controllers/usertask.controller.js
// `uid` here is always the TARGET user (the assignee), never the caller's identity.
const usertaskRoute = require('express').Router();
const UsertaskModel = require('../models/usertask.model');
const TasksModel = require('../models/tasks.model');
const AccessModel = require('../models/access.model');
const AnalyticsIntegration = require('../services/AnalyticsIntegration');
const { v4: uuidv4 } = require('uuid');
const { AppError, sendError } = require('../helpers/errors');
const { requireResourceMember, readParam, assertUuid } = require('../middleware/groupAccess');

const taskMember = requireResourceMember('task', 'tid', { notFoundCode: 'TASK_NOT_FOUND' });

usertaskRoute.post('/', taskMember, async (req, res) => {
    const { completed } = req.body;
    const tid = req.resourceId;
    const utid = uuidv4();

    try {
        const uid = assertUuid(readParam(req, 'uid'), 'uid');
        if (!(await AccessModel.isGroupMember(uid, req.groupId))) {
            throw new AppError('VALIDATION_ERROR', 'The user is not a member of this group', 400);
        }

        const result = await UsertaskModel.addUsertask({ utid, uid, tid, completed });
        res.status(200).json({ data: { rowCount: result, utid } });

        // Analytics tracking - fully non-blocking, after response is sent
        TasksModel.getTask(tid).then(taskData => {
            if (taskData && taskData.length > 0) {
                const task = taskData[0];
                AnalyticsIntegration.onTaskAssignment(tid, uid, task.gid, {
                    name: task.name,
                    description: task.description,
                    list: task.list
                }).catch(err => console.error('Analytics tracking failed:', err));
            }
        }).catch(err => console.error('Analytics getTask failed:', err));
    } catch (error) {
        sendError(res, error);
    }
});

// uid/tid come from the query string (reliable for DELETE) with the body as fallback
usertaskRoute.delete('/', taskMember, async (req, res) => {
    try {
        const uid = assertUuid(readParam(req, 'uid'), 'uid');
        const rowCount = await UsertaskModel.deleteUsertask(uid, req.resourceId);
        res.status(200).json({ data: { rowCount } });
    } catch (error) {
        sendError(res, error);
    }
});

usertaskRoute.get('/', taskMember, async (req, res) => {
    try {
        const data = await UsertaskModel.getUsertasksByTid(req.resourceId);
        res.status(200).json({ data });
    } catch (error) {
        sendError(res, error);
    }
});

usertaskRoute.get('/getutid', taskMember, async (req, res) => {
    try {
        const uid = assertUuid(readParam(req, 'uid'), 'uid');
        const data = await UsertaskModel.getutid(req.resourceId, uid);
        res.status(200).json({ data });
    } catch (error) {
        sendError(res, error);
    }
});

module.exports = usertaskRoute;

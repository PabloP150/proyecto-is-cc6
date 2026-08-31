// controllers/usertask.controller.js
const usertaskRoute = require('express').Router();
const UsertaskModel = require('../models/usertask.model');
const TasksModel = require('../models/tasks.model');
const AnalyticsIntegration = require('../services/AnalyticsIntegration');
const { v4: uuidv4 } = require('uuid');

usertaskRoute.post('/', async (req, res) => {
    const { uid, tid, completed } = req.body;
    const utid = uuidv4();

    try {
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
        console.error('[usertask POST] error:', error.message, error.stack);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

usertaskRoute.delete('/', async (req, res) => {
    // Read from query string (reliable for DELETE) with body as fallback
    const uid = req.query.uid || req.body?.uid;
    const tid = req.query.tid || req.body?.tid;
    try {
        const rowCount = await UsertaskModel.deleteUsertask(uid, tid);
        res.status(200).json({ data: { rowCount } });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

usertaskRoute.get('/', async (req, res) => {
    const { tid } = req.query;
    try {
        const data = await UsertaskModel.getUsertasksByTid(tid);
        res.status(200).json({ data });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

usertaskRoute.get('/getutid', async (req, res) => {
    const { tid, uid } = req.query;
    try {
        const data = await UsertaskModel.getutid(tid, uid);
        res.status(200).json({ data });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

module.exports = usertaskRoute;

// controllers/usertask.controller.js
const usertaskRoute = require('express').Router();
const UsertaskModel = require('../models/usertask.model');
const TasksModel = require('../models/tasks.model');
const AnalyticsIntegration = require('../services/AnalyticsIntegration');
const { v4: uuidv4 } = require('uuid');

usertaskRoute.post('/', async (req, res) => {
    const {
        uid,
        tid,
        completed
    } = req.body;

    const utid = uuidv4(); // Generar un nuevo utid

    try {
        // Add the user-task assignment
        const result = await UsertaskModel.addUsertask({
            utid,
            uid,
            tid,
            completed
        });

        // Get task data for analytics integration
        const taskData = await TasksModel.getTask(tid);
        if (taskData && taskData.length > 0) {
            const task = taskData[0];
            
            // Record task assignment in analytics (non-blocking)
            AnalyticsIntegration.onTaskAssignment(tid, uid, task.gid, {
                name: task.name,
                description: task.description,
                list: task.list
            }).catch(error => {
                console.error('Analytics tracking failed for task assignment:', error);
                // Don't fail the main operation
            });
        }

        res.status(200).json({
            data: {
                rowCount: result,
                utid
            },
        });
    } catch (error) {
        res.status(500).json({ error });
    }
});

usertaskRoute.delete('/', async (req, res) => {
    const { uid, tid } = req.body;
    UsertaskModel.deleteUsertask(uid, tid)
    .then((rowCount, more) => {
        res.status(200).json({ data: { rowCount, more } });
    })
    .catch(error => {
        res.status(500).json({ error });
    });
});

usertaskRoute.get('/', async (req, res) => {
    const { tid } = req.query;
    UsertaskModel.getUsertasksByTid(tid)
    .then((data) => {
        if (data.length === 0) {
            return res.status(404).json({ message: 'No se encontraron tareas para este tid.' });
        }
        res.status(200).json({ data });
    })  
    .catch(error => {
        res.status(500).json({ error });
    });
});

usertaskRoute.get('/getutid', async (req, res) => {
    const { tid, uid } = req.query;
    UsertaskModel.getutid(tid, uid)
    .then((data) => {
        res.status(200).json({ data });
    });
});

module.exports = usertaskRoute;
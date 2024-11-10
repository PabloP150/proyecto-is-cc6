const tasksRoute = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const TasksModel = require('./../models/tasks.model');

tasksRoute.get('/', async (req, res) => {
    const { gid } = req.query;
    if (!gid) {
        return res.status(400).json({ error: 'Group ID is required' });
    }
    try {
        const data = await TasksModel.getTasksByGroupId(gid);
        res.status(200).json({ data });
    } catch (error) {
        console.error("Error fetching tasks:", error);
        res.status(500).json({ error: error.message || "An error occurred" });
    }
});

tasksRoute.get('/:id', async (req, res) => {
    const { id: tid } = req.params;
    TasksModel.getTask(tid)
        .then(data => {
            if (data.length > 0) {
                res.status(200).json({ data: { ...data[0] } });
            } else {
                res.status(404).json({ error: 'Task not found' });
            }
        })
        .catch(error => {
            res.status(500).json({ error });
        });
});

tasksRoute.post('/', async (req, res) => {
    const tid = uuidv4();
    const {
        gid,
        name,
        description,
        list,
        datetime
    } = req.body;
    TasksModel.addTask({
        tid,
        gid,
        name,
        description,
        list,
        datetime
    })
    .then((rowCount, more) => {
        res.status(200).json({
            data: {
                rowCount,
                more,
                tid
            },
        });
    })
    .catch(error => {
        res.status(500).json({ error });
    });
});

tasksRoute.put('/:id', async (req, res) => {
    const { id: tid } = req.params;
    const {
        gid,
        name,
        description,
        datetime
    } = req.body;
    TasksModel.updateTask({
        tid,
        gid,
        name,
        description,
        datetime
    })
    .then((rowCount, more) => {
        res.status(200).json({
            data: {
                rowCount,
                more,
                tid
            },
        });
    })
    .catch(error => {
        res.status(500).json({ error });
    });
});

tasksRoute.delete('/:id', async (req, res) => {
    const { id: tid } = req.params;
    TasksModel.deleteTask(tid)
    .then((rowCount, more) => {
        res.status(200).json({ rowCount, more });
    })
    .catch(error => {
        res.status(500).json({ error });
    });
});

tasksRoute.delete('/list/:gid/:list', async (req, res) => {
    const { gid, list } = req.params;
    try {
        await TasksModel.deleteTasksByList(gid, list);
        res.status(200).json({ message: 'Lista eliminada exitosamente' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = tasksRoute;

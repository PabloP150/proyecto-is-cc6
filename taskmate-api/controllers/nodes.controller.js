const nodesRoute = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const NodesModel = require('./../models/nodes.model');

nodesRoute.get('/', async (req, res) => {
    try {
        const data = await NodesModel.getAllNodes();
        res.status(200).json({ data });
    } catch (error) {
        console.error("Error fetching nodes:", error);
        res.status(500).json({ error: error.message || "An error occurred" });
    }
});

nodesRoute.get('/:id', async (req, res) => {
    const { id: tid } = req.params;
    NodesModel.getTask(tid)
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

nodesRoute.post('/', async (req, res) => {
    const nid = uuidv4();
    const {
        gid,
        name,
        description,
        date
    } = req.body;

    try {
        await NodesModel.addNode({
            nid,
            gid,
            name,
            description,
            date
        });
        
        res.status(200).json({
            data: {
                nid,
                gid,
                name,
                description,
                date
            }
        });
    } catch (error) {
        console.error("Error adding node:", error);
        res.status(500).json({ error: error.message || "An error occurred" });
    }
});

nodesRoute.put('/:id', async (req, res) => {
    const { id: tid } = req.params;
    const {
        gid,
        name,
        description,
        datetime
    } = req.body;
    NodesModel.updateTask({
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

nodesRoute.delete('/:id', async (req, res) => {
    const { id: tid } = req.params;
    NodesModel.deleteTask(tid)
    .then((rowCount, more) => {
        res.status(200).json({ rowCount, more });
    })
    .catch(error => {
        res.status(500).json({ error });
    });
});

module.exports = nodesRoute;

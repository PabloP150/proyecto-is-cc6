const nodesRoute = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const NodesModel = require('./../models/nodes.model');

// Get all nodes
nodesRoute.get('/', async (req, res) => {
    try {
        const data = await NodesModel.getAllNodes();
        res.status(200).json({ data });
    } catch (error) {
        console.error("Error fetching nodes:", error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

nodesRoute.get('/tasks/:gid', async (req, res) => {
    const { gid } = req.params;
    if (!gid || gid === 'undefined' || gid === 'null') {
        return res.status(400).json({ error: 'Group ID is required' });
    }
    try {
        const data = await NodesModel.getNodesAndTasks(gid);
        res.status(200).json({ data });
    } catch (error) {
        console.error("Error fetching nodes by group ID:", error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

// Get a node by ID
nodesRoute.get('/:id', async (req, res) => {
    const { id: nid } = req.params;
    try {
        const data = await NodesModel.getNode(nid);
        if (data.length > 0) {
            res.status(200).json({ data: data[0] });
        } else {
            res.status(404).json({ error: 'Node not found' });
        }
    } catch (error) {
        console.error("Error fetching node by ID:", error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

// Get nodes by group ID
nodesRoute.get('/group/:gid', async (req, res) => {
    const { gid } = req.params;
    if (!gid || gid === 'undefined' || gid === 'null') {
        return res.status(400).json({ error: 'Group ID is required' });
    }
    try {
        const data = await NodesModel.getNodesByGroupId(gid);
        res.status(200).json({ data });
    } catch (error) {
        console.error("Error fetching nodes by group ID:", error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

// Create a new node
nodesRoute.post('/', async (req, res) => {
    const nid = req.body.nid ? req.body.nid : uuidv4();
    const { gid, name, description, date, completed, x_pos, y_pos } = req.body;
    const percentage = req.body.percentage === undefined ? 0 : req.body.percentage;

    try {
        await NodesModel.addNode({
            nid,
            gid,
            name,
            description,
            date,
            completed,
            percentage,
            x_pos,
            y_pos,
        });

        res.status(200).json({
            data: {
                nid,
                gid,
                name,
                description,
                date,
                completed,
                percentage,
                x_pos,
                y_pos
            }
        });
    } catch (error) {
        console.error("Error adding node: ", error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

//update a node
nodesRoute.put('/:id/', async (req, res) => {
    const { id: nid } = req.params;
    const { name, description, date } = req.body;
    try {
        await NodesModel.updateNode({
            nid,
            name,
            description,
            date
        });

        res.status(200).json({
            message: 'Node coords updated successfully',
            nid
        });
    } catch (error) {
        console.error("Error updating node:", error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

//update a node's coordinates
nodesRoute.put('/:id/coords', async (req, res) => {
    const { id: nid } = req.params;
    const { x_pos, y_pos } = req.body;
    try {
        await NodesModel.updateNodeCoords({
            nid,
            x_pos,
            y_pos
        });

        res.status(200).json({
            message: 'Node coords updated successfully',
            nid
        });
    } catch (error) {
        console.error("Error updating node:", error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

//update a node's percentage
nodesRoute.put('/:id/percentage', async (req, res) => {
    const { id: nid } = req.params;
    const { percentage } = req.body;
    try {
        await NodesModel.updateNodePercentage({
            nid,
            percentage
        });

        res.status(200).json({
            message: 'Node percentage updated successfully',
            nid
        });
    } catch (error) {
        console.error("Error updating node:", error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

// Update a node's complete status
nodesRoute.put('/:id/toggleComplete', async (req, res) => {
    const { id: nid } = req.params;
    const { completed } = req.body;
    try {
        await NodesModel.updateNodeCompleted({
            nid,
            completed
        });

        res.status(200).json({
            message: 'Node set to complete',
            nid
        });
    } catch (error) {
        console.error("Error updating node:", error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

// Delete a node (edges are deleted inside deleteNode in a single batch)
nodesRoute.delete('/:id', async (req, res) => {
    const { id: nid } = req.params;
    try {
        await NodesModel.deleteNode(nid);
        res.status(200).json({ message: 'Node deleted successfully' });
    } catch (error) {
        console.error('[DELETE /nodes/:id] Error deleting node', { nid, error });
        res.status(500).json({ error: error.message || 'Internal server error', nid });
    }
});


module.exports = nodesRoute;

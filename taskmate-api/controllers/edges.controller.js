const edgesRoute = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const EdgesModel = require('./../models/edges.model');

edgesRoute.post('/', async (req, res) => {
    const eid = uuidv4();
    const { gid, sourceId, targetId } = req.body;

    try {
        await EdgesModel.addEdge({
            eid,
            gid,
            sourceId,
            targetId
        });

        res.status(200).json({
            data: {
                eid,
                gid,
                sourceId,
                targetId
            }
        });
    } catch (error) {
        console.error("Error adding edge:", error);
        res.status(500).json({ error: error.message || "An error occurred" });
    }
});

// Nota: declarar primero rutas más específicas
edgesRoute.get('/group/:gid', async (req, res) => {
    const { gid } = req.params;
    try {
        const data = await EdgesModel.getEdgesByGroupId(gid);
        res.status(200).json({ data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

edgesRoute.get('/:eid', async (req, res) => {
    const { eid } = req.params;
    try {
        const data = await EdgesModel.getEdgesById(eid);
        res.status(200).json({ data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

edgesRoute.put('/:eid', async (req, res) => {
    const { eid } = req.params;
    const { prerequisite } = req.body;
    try {
        await EdgesModel.updatePrerequisite({
            eid,
            prerequisite
        });
        res.status(200).json({ message: 'Edge prerequisite updated successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

edgesRoute.delete('/:id', async (req, res) => {
    const { id: eid } = req.params;
    try {
        await EdgesModel.deleteEdge(eid);
        res.status(200).json({ message: 'Edge deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

edgesRoute.delete('/source/:id', async (req, res) => {
    const { id: nid } = req.params;
    try {
        await EdgesModel.deleteEdgeBySource(nid);
        res.status(200).json({ message: 'Edge deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = edgesRoute;

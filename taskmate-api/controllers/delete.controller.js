// controllers/delete.controller.js
const deleteRoute = require('express').Router();
const DeleteModel = require('./../models/delete.model');


deleteRoute.post('/', async (req, res) => {
    const { tid, gid, name, description, datetime, percentage } = req.body;
    try {
        const rowCount = await DeleteModel.addDelete({ tid, gid, name, description, datetime, percentage });
        res.status(200).json({ data: { rowCount, tid } });
    } catch (error) {
        console.error('[delete POST] error:', error.message);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

deleteRoute.get('/:gid', async (req, res) => {
    const { gid } = req.params;
    try {
        const data = await DeleteModel.getEliminados(gid);
        res.status(200).json({ data });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

deleteRoute.delete('/:gid', async (req, res) => {
    const { gid } = req.params;
    try {
        await DeleteModel.deleteAll(gid);
        res.status(200).json({ message: 'Todos los eliminados han sido vaciados' });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});



module.exports = deleteRoute;

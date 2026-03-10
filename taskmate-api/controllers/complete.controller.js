// controllers/complete.controller.js
const completeRoute = require('express').Router();
const CompleteModel = require('./../models/complete.model');
const AnalyticsIntegration = require('../services/AnalyticsIntegration');


completeRoute.post('/', async (req, res) => {
    const {
        tid,
        gid,
        name,
        description,
        percentage,
        datetime
    } = req.body;

    try {
        const result = await CompleteModel.addComplete({
            tid,
            gid,
            name,
            description,
            percentage,
            datetime
        });

        // Record task completion in analytics (non-blocking)
        AnalyticsIntegration.onTaskCompletion(tid, true, {
            percentage,
            completedAt: datetime
        }).catch(error => {
            console.error('Analytics tracking failed for task completion:', error);
        });

        res.status(200).json({ data: { rowCount: result, tid } });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

completeRoute.get('/:gid', async (req, res) => {
    const { gid } = req.params;
    try {
        const data = await CompleteModel.getCompletados(gid);
        res.status(200).json({ data });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

completeRoute.delete('/:gid', async (req, res) => {
    const { gid } = req.params;
    try {
        await CompleteModel.deleteAll(gid);
        res.status(200).json({ message: 'Todos los completados han sido vaciados' });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});



module.exports = completeRoute;

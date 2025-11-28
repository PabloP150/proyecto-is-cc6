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
        // Add to completed tasks
        const result = await CompleteModel.addComplete({ 
            tid,
            gid,
            name,
            description,
            percentage,
            datetime
        });

        // Record task completion in analytics (non-blocking)
        // Assume successful completion if it's moved to Complete table
        AnalyticsIntegration.onTaskCompletion(tid, true, {
            percentage,
            completedAt: datetime
        }).catch(error => {
            console.error('Analytics tracking failed for task completion:', error);
            // Don't fail the main operation
        });

        res.status(200).json({
            data: {
                rowCount: result,
                tid
            },
        });
    } catch (error) {
        res.status(500).json({ error });
    }
});

completeRoute.get('/:gid', async (req, res) => {
    const { gid } = req.params;
    CompleteModel.getCompletados(gid)
    .then((data) => res.status(200).json({ data }));
});

completeRoute.delete('/:gid', async (req, res) => {
  const { gid } = req.params;
  try {
    await CompleteModel.deleteAll(gid); // Implementa esta función en el modelo
    res.status(200).json({ message: 'Todos los completados han sido vaciados' });
  } catch (error) {
    res.status(500).json({ error });
  }
});



module.exports = completeRoute;
// controllers/user.controller.js
const completeRoute = require('express').Router();
const CompleteModel = require('./../models/complete.model');


completeRoute.post('/', async (req, res) => {
    const {
        tid,
        gid,
        name,
        description,
        percentage,
        datetime
    } = req.body;
    CompleteModel.addComplete({ 
        tid,
        gid,
        name,
        description,
        percentage,
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

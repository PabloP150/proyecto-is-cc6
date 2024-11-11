// controllers/user.controller.js
const deleteRoute = require('express').Router();
const DeleteModel = require('./../models/delete.model');


deleteRoute.post('/', async (req, res) => {
    const {
        tid,
        gid,
        name,
        description,
        datetime
    } = req.body;
    DeleteModel.addDelete({ 
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

deleteRoute.get('/:gid', async (req, res) => {
    const { gid } = req.params;
    DeleteModel.getEliminados(gid)
    .then((data) => res.status(200).json({ data }));
});

deleteRoute.delete('/:gid', async (req, res) => {
  const { gid } = req.params;
  try {
    await DeleteModel.deleteAll(gid); // Implementa esta función en el modelo
    res.status(200).json({ message: 'Todos los eliminados han sido vaciados' });
  } catch (error) {
    res.status(500).json({ error });
  }
});



module.exports = deleteRoute;

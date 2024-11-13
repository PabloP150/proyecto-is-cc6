// controllers/user.controller.js
const usertaskRoute = require('express').Router();
const UsertaskModel = require('../models/usertask.model');
const { v4: uuidv4 } = require('uuid');

usertaskRoute.post('/', async (req, res) => {
    const {
        uid,
        tid,
        completed
    } = req.body;

    const utid = uuidv4(); // Generar un nuevo utid

    UsertaskModel.addUsertask({
        utid,
        uid,
        tid,
        completed
    })
    .then((rowCount, more) => {
        res.status(200).json({
            data: {
                rowCount,
                more,
                utid
            },
        });
    })
    .catch(error => {
        res.status(500).json({ error });
    });
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
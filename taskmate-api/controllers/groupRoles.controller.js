
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const GroupRolesModel = require('../models/groupRoles.model');

const router = express.Router();

// Listar todos los roles de un grupo
router.get('/groups/:gid/roles', async (req, res) => {
    const { gid } = req.params;
    try {
        const roles = await GroupRolesModel.getGroupRoles(gid);
        res.status(200).json({ roles });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Crear un nuevo rol en un grupo
router.post('/groups/:gid/roles', async (req, res) => {
	const { gid } = req.params;
	const { gr_name, gr_desc, gr_color, gr_icon } = req.body;
	const gr_id = uuidv4();
	try {
		await GroupRolesModel.addGroupRole({ gr_id, gid, gr_name, gr_desc, gr_color, gr_icon });
		// Importante: devolver el gr_id creado
		res.status(201).json({ message: 'Role created successfully', gr_id });
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
});

// Editar un rol existente
router.put('/groups/:gid/roles/:gr_id', async (req, res) => {
    const { gid, gr_id } = req.params;
    const { gr_name, gr_desc, gr_color, gr_icon } = req.body;
    try {
        await GroupRolesModel.updateGroupRole({ gr_id, gid, gr_name, gr_desc, gr_color, gr_icon });
        res.status(200).json({ message: 'Role updated successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Eliminar un rol
router.delete('/groups/:gid/roles/:gr_id', async (req, res) => {
    const { gid, gr_id } = req.params;
    try {
        await GroupRolesModel.deleteGroupRole(gr_id, gid);
        res.status(200).json({ message: 'Role deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

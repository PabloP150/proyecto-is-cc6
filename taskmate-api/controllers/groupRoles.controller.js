
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const GroupRolesModel = require('../models/groupRoles.model');
const { sendError } = require('../helpers/errors');
const { requireGroupMember, requireGroupAdmin, requireResourceInGroup } = require('../middleware/groupAccess');
const { mapConstraintError } = require('../middleware/errorHandler');

const router = express.Router();

const roleInGroup = requireResourceInGroup('groupRole', 'gr_id');
// UQ(gid, gr_name): role names are unique within a group.
const ROLE_ERRORS = { unique: { code: 'DUPLICATE_ROLE', message: 'A role with that name already exists in this group' } };

// Listar todos los roles de un grupo
router.get('/groups/:gid/roles', requireGroupMember('gid'), async (req, res) => {
    try {
        const roles = await GroupRolesModel.getGroupRoles(req.groupId);
        res.status(200).json({ roles });
    } catch (error) {
        sendError(res, error);
    }
});

// Crear un nuevo rol en un grupo (solo admin)
router.post('/groups/:gid/roles', requireGroupAdmin('gid'), async (req, res) => {
  const { gr_name, gr_color, gr_icon } = req.body;
  const gr_id = uuidv4();
  try {
    await GroupRolesModel.addGroupRole({ gr_id, gid: req.groupId, gr_name, gr_color, gr_icon });
    res.status(201).json({ message: 'Role created successfully', gr_id });
  } catch (error) {
    sendError(res, mapConstraintError(error, ROLE_ERRORS));
  }
});

// Editar un rol existente (solo admin)
router.put('/groups/:gid/roles/:gr_id', requireGroupAdmin('gid'), roleInGroup, async (req, res) => {
    const { gr_name, gr_color, gr_icon } = req.body;
    try {
        await GroupRolesModel.updateGroupRole({ gr_id: req.resourceId, gid: req.groupId, gr_name, gr_color, gr_icon });
        res.status(200).json({ message: 'Role updated successfully' });
    } catch (error) {
        sendError(res, mapConstraintError(error, ROLE_ERRORS));
    }
});

// Eliminar un rol (solo admin)
router.delete('/groups/:gid/roles/:gr_id', requireGroupAdmin('gid'), roleInGroup, async (req, res) => {
    try {
        await GroupRolesModel.deleteGroupRole(req.resourceId, req.groupId);
        res.status(200).json({ message: 'Role deleted successfully' });
    } catch (error) {
        sendError(res, error);
    }
});

module.exports = router;

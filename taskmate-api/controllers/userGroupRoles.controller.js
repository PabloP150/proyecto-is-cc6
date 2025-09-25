
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const UserGroupRolesModel = require('../models/userGroupRoles.model');

const router = express.Router();

// === CRUD PRINCIPAL ===
// Listar todos los roles asignados a usuarios de un grupo
router.get('/groups/:gid/userroles', async (req, res) => {
  const { gid } = req.params;
  try {
    const userRoles = await UserGroupRolesModel.getUserGroupRoles(gid);
    res.status(200).json({ userRoles });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Asignar un rol a un usuario en un grupo
router.post('/groups/:gid/userroles', async (req, res) => {
  const { gid } = req.params;
  const { uid, gr_id } = req.body;
  const ugr_id = uuidv4();
  try {
    await UserGroupRolesModel.assignRoleToUser({ ugr_id, uid, gr_id, gid });
    res.status(201).json({ message: 'Rol asignado correctamente', ugr_id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Quitar un rol a un usuario en un grupo
router.delete('/groups/:gid/userroles/:ugr_id', async (req, res) => {
  const { gid, ugr_id } = req.params;
  try {
    await UserGroupRolesModel.removeRoleFromUser({ ugr_id });
    res.status(200).json({ message: 'Rol removido correctamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Alternativamente, quitar por combinación de claves (uid, gr_id, gid)
router.delete('/groups/:gid/userroles', async (req, res) => {
  const { gid } = req.params;
  const { uid, gr_id } = req.body;
  try {
    await UserGroupRolesModel.removeRoleFromUser({ uid, gr_id, gid });
    res.status(200).json({ message: 'Rol removido correctamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// === CONSULTAS AVANZADAS ===
// Obtener los roles de un usuario en un grupo
router.get('/groups/:gid/users/:uid/roles', async (req, res) => {
  const { gid, uid } = req.params;
  try {
    const roles = await UserGroupRolesModel.getRolesOfUserInGroup(uid, gid);
    // Devolver solo los IDs de roles asignados
    res.status(200).json({ roleIds: Array.isArray(roles) ? roles.map(r => r.gr_id) : [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener los usuarios con un rol específico en un grupo
router.get('/groups/:gid/roles/:gr_id/users', async (req, res) => {
  const { gid, gr_id } = req.params;
  try {
    const users = await UserGroupRolesModel.getUsersWithRoleInGroup(gr_id, gid);
    res.status(200).json({ users });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verificar si un usuario tiene un rol específico en un grupo
router.get('/groups/:gid/users/:uid/roles/:gr_id', async (req, res) => {
  const { gid, uid, gr_id } = req.params;
  try {
    const assignment = await UserGroupRolesModel.getUserRoleAssignment(uid, gid, gr_id);
    res.status(200).json({ hasRole: !!assignment, assignment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Contar usuarios por rol en un grupo
router.get('/groups/:gid/roles/:gr_id/count', async (req, res) => {
  const { gid, gr_id } = req.params;
  try {
    const count = await UserGroupRolesModel.countUsersWithRoleInGroup(gr_id, gid);
    res.status(200).json({ count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Matriz completa de roles de todos los usuarios de un grupo
router.get('/groups/:gid/rolesmatrix', async (req, res) => {
  const { gid } = req.params;
  try {
    const matrix = await UserGroupRolesModel.getRolesMatrixForGroup(gid);
    res.status(200).json({ matrix });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

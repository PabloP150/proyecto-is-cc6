
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const UserGroupRolesModel = require('../models/userGroupRoles.model');
const AccessModel = require('../models/access.model');
const { AppError, sendError } = require('../helpers/errors');
const {
  requireGroupMember,
  requireGroupAdmin,
  requireResourceInGroup,
  requireUuids,
  readParam,
  assertUuid,
  sameId,
} = require('../middleware/groupAccess');
const { mapConstraintError } = require('../middleware/errorHandler');

const router = express.Router();

// UQ(uid, gr_id) and the composite FKs (uid,gid)→UserGroups / (gr_id,gid)→GroupRoles.
const ASSIGNMENT_ERRORS = {
  unique: { code: 'DUPLICATE_ROLE_ASSIGNMENT', message: 'The user already has this role' },
  foreignKey: 'The user must be a member of the group and the role must belong to it',
};

// `uid` in these routes is always a TARGET member; the caller is req.user.userId.

// === CRUD PRINCIPAL ===
// Listar todos los roles asignados a usuarios de un grupo
router.get('/groups/:gid/userroles', requireGroupMember('gid'), async (req, res) => {
  try {
    const userRoles = await UserGroupRolesModel.getUserGroupRoles(req.groupId);
    res.status(200).json({ userRoles });
  } catch (error) {
    sendError(res, error);
  }
});

// Asignar un rol a un usuario en un grupo (solo admin)
router.post('/groups/:gid/userroles', requireGroupAdmin('gid'), async (req, res) => {
  const gid = req.groupId;
  const ugr_id = uuidv4();
  try {
    const uid = assertUuid(readParam(req, 'uid'), 'uid');
    const gr_id = assertUuid(readParam(req, 'gr_id'), 'gr_id');
    const [roleGroup, isMember] = await Promise.all([
      AccessModel.resolveGroupId('groupRole', gr_id),
      AccessModel.isGroupMember(uid, gid),
    ]);
    if (!sameId(roleGroup, gid)) {
      throw new AppError('NOT_FOUND', 'Role not found', 404);
    }
    if (!isMember) {
      throw new AppError('VALIDATION_ERROR', 'The user is not a member of this group', 400);
    }
    await UserGroupRolesModel.assignRoleToUser({ ugr_id, uid, gr_id, gid });
    res.status(201).json({ message: 'Rol asignado correctamente', ugr_id });
  } catch (error) {
    sendError(res, mapConstraintError(error, ASSIGNMENT_ERRORS));
  }
});

// Quitar un rol a un usuario en un grupo (solo admin)
router.delete('/groups/:gid/userroles/:ugr_id', requireGroupAdmin('gid'), requireResourceInGroup('userGroupRole', 'ugr_id'), async (req, res) => {
  try {
    await UserGroupRolesModel.removeRoleFromUser({ ugr_id: req.resourceId });
    res.status(200).json({ message: 'Rol removido correctamente' });
  } catch (error) {
    sendError(res, error);
  }
});

// Alternativamente, quitar por combinación de claves (uid, gr_id, gid) (solo admin)
router.delete('/groups/:gid/userroles', requireGroupAdmin('gid'), requireUuids('uid', 'gr_id'), async (req, res) => {
  try {
    const uid = readParam(req, 'uid');
    const gr_id = readParam(req, 'gr_id');
    await UserGroupRolesModel.removeRoleFromUser({ uid, gr_id, gid: req.groupId });
    res.status(200).json({ message: 'Rol removido correctamente' });
  } catch (error) {
    sendError(res, error);
  }
});

// === CONSULTAS AVANZADAS ===
// Obtener los roles de un usuario en un grupo
router.get('/groups/:gid/users/:uid/roles', requireGroupMember('gid'), requireUuids('uid'), async (req, res) => {
  try {
    const roles = await UserGroupRolesModel.getRolesOfUserInGroup(req.params.uid, req.groupId);
    // Devolver solo los IDs de roles asignados
    res.status(200).json({ roleIds: Array.isArray(roles) ? roles.map(r => r.gr_id) : [] });
  } catch (error) {
    sendError(res, error);
  }
});

// Obtener los usuarios con un rol específico en un grupo
router.get('/groups/:gid/roles/:gr_id/users', requireGroupMember('gid'), requireUuids('gr_id'), async (req, res) => {
  try {
    const users = await UserGroupRolesModel.getUsersWithRoleInGroup(req.params.gr_id, req.groupId);
    res.status(200).json({ users });
  } catch (error) {
    sendError(res, error);
  }
});

// Verificar si un usuario tiene un rol específico en un grupo
router.get('/groups/:gid/users/:uid/roles/:gr_id', requireGroupMember('gid'), requireUuids('uid', 'gr_id'), async (req, res) => {
  try {
    const assignment = await UserGroupRolesModel.getUserRoleAssignment(req.params.uid, req.groupId, req.params.gr_id);
    res.status(200).json({ hasRole: !!assignment, assignment });
  } catch (error) {
    sendError(res, error);
  }
});

// Contar usuarios por rol en un grupo
router.get('/groups/:gid/roles/:gr_id/count', requireGroupMember('gid'), requireUuids('gr_id'), async (req, res) => {
  try {
    const count = await UserGroupRolesModel.countUsersWithRoleInGroup(req.params.gr_id, req.groupId);
    res.status(200).json({ count });
  } catch (error) {
    sendError(res, error);
  }
});

// Matriz completa de roles de todos los usuarios de un grupo
router.get('/groups/:gid/rolesmatrix', requireGroupMember('gid'), async (req, res) => {
  try {
    const matrix = await UserGroupRolesModel.getRolesMatrixForGroup(req.groupId);
    res.status(200).json({ matrix });
  } catch (error) {
    sendError(res, error);
  }
});

module.exports = router;

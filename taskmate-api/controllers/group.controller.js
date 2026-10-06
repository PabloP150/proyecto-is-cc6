const groupRoute = require('express').Router();
const GroupModel = require('./../models/group.model');
const UserGroupModel = require('./../models/userGroup.model');
const UserModel = require('./../models/user.model');
const { v4: uuidv4 } = require('uuid');
const { AppError, sendError } = require('../helpers/errors');
const { requireGroupMember, requireGroupAdmin, readParam, assertUuid } = require('../middleware/groupAccess');

const GROUP_NAME_MAX = 25;

// Crear un nuevo grupo: el admin es siempre quien hace la petición (se ignora adminId del body)
groupRoute.post('/group', async (req, res) => {
    const adminId = req.user.userId;
    const { name } = req.body || {};
    const gid = uuidv4();

    try {
        if (typeof name !== 'string' || !name.trim() || name.length > GROUP_NAME_MAX) {
            throw new AppError('VALIDATION_ERROR', `Group name is required (max ${GROUP_NAME_MAX} characters)`, 400);
        }

        // Grupo + membresía del admin en una sola transacción
        await GroupModel.createGroupWithAdmin({ gid, adminId, name });

        // Importante: devolver el gid creado (no un nuevo uuid)
        res.status(201).json({ message: 'Group created successfully', gid });
    } catch (error) {
        sendError(res, error);
    }
});

//obtener los nombres de usuarios que pertenecen a un grupo
groupRoute.get('/:gid/members', requireGroupMember('gid'), async (req, res) => {
    try {
        const members = await UserGroupModel.getMembersByGroupId(req.groupId);
        res.status(200).json({ members });
    } catch (error) {
        sendError(res, error);
    }
});

//obtener los grupos del usuario autenticado (el uid del query ya no decide nada)
groupRoute.get('/user-groups', async (req, res) => {
    try {
        const groups = await GroupModel.getGroupsByUserId(req.user.userId);
        res.status(200).json({ groups });
    } catch (error) {
        sendError(res, error);
    }
});

//obtener los roles disponibles para un grupo
groupRoute.get('/:gid/roles', requireGroupMember('gid'), async (req, res) => {
    try {
        const roles = await GroupModel.getRolesByGroupId(req.groupId);
        res.status(200).json(roles);
    } catch (error) {
        sendError(res, error);
    }
});

// Agregar a otro usuario (uid objetivo) al grupo: solo el admin
groupRoute.post('/join', requireGroupAdmin('gid'), async (req, res) => {
    try {
        const uid = assertUuid(readParam(req, 'uid'), 'uid');
        if (!(await UserModel.getidUser(uid))) {
            throw new AppError('NOT_FOUND', 'User not found', 404);
        }
        await UserGroupModel.addUserToGroup({ uid, gid: req.groupId });
        res.status(200).json({ message: 'Joined group successfully' });
    } catch (error) {
        sendError(res, error);
    }
});

//eliminar un miembro (uid objetivo) de un grupo: solo el admin
groupRoute.delete('/remove-member', requireGroupAdmin('gid'), async (req, res) => {
    try {
        const uid = assertUuid(readParam(req, 'uid'), 'uid');
        await UserGroupModel.removeMemberFromGroup(uid, req.groupId);
        res.status(200).json({ message: 'Member removed successfully' });
    } catch (error) {
        sendError(res, error);
    }
});

//abandonar un grupo (con transferencia de admin si aplica); siempre el usuario autenticado
groupRoute.delete('/leave', requireGroupMember('gid'), async (req, res) => {
    try {
        const outcome = await UserGroupModel.leaveGroup(req.user.userId, req.groupId);
        res.status(200).json({ message: 'Group left successfully', ...outcome });
    } catch (error) {
        sendError(res, error);
    }
});

//eliminar un grupo: solo el admin (se ignora adminId del body)
groupRoute.delete('/delete', requireGroupAdmin('gid'), async (req, res) => {
    try {
        await GroupModel.deleteGroup(req.groupId, req.user.userId);
        res.status(200).json({ message: 'Group deleted successfully' });
    } catch (error) {
        sendError(res, error);
    }
});

module.exports = groupRoute;

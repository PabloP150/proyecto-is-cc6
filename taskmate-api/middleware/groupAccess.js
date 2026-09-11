const AccessModel = require('../models/access.model');
const { AppError, sendError } = require('../helpers/errors');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RESOURCE_LABELS = {
    task: 'Task',
    node: 'Node',
    edge: 'Edge',
    completed: 'Task',
    deleted: 'Task',
    groupRole: 'Role',
    userGroupRole: 'Role assignment',
    userTask: 'Assignment',
};

const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);

// SQL Server returns GUIDs upper-cased while clients usually send them lower-cased.
const sameId = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

// A value may arrive in the path, the query string or the body. If it shows up in more than
// one place with different values the request is rejected, so a handler can never act on a
// different id than the one that was authorized.
const readParam = (req, name) => {
    const sources = [req.params, req.query, req.body && typeof req.body === 'object' ? req.body : null];
    let found;
    for (const source of sources) {
        if (!source || source[name] === undefined) continue;
        const value = source[name];
        if (found !== undefined && !(found === value || sameId(found, value))) {
            throw new AppError('VALIDATION_ERROR', `Conflicting values for ${name}`, 400);
        }
        if (found === undefined) found = value;
    }
    return found;
};

const assertUuid = (value, name) => {
    if (value === undefined || value === null || value === '') {
        throw new AppError('VALIDATION_ERROR', `${name} is required`, 400);
    }
    if (!isUuid(value)) {
        throw new AppError('VALIDATION_ERROR', `${name} must be a valid UUID`, 400);
    }
    return value;
};

const actingUserId = (req) => {
    if (!req.user || !req.user.userId) {
        throw new AppError('UNAUTHENTICATED', 'Authentication required.', 401);
    }
    return req.user.userId;
};

const guard = (check) => async (req, res, next) => {
    try {
        await check(req);
    } catch (error) {
        return sendError(res, error);
    }
    next();
};

const assertMember = async (uid, gid) => {
    if (!(await AccessModel.isGroupMember(uid, gid))) {
        throw new AppError('NOT_GROUP_MEMBER', 'You are not a member of this group', 403);
    }
};

const assertAdmin = async (uid, gid) => {
    if (!(await AccessModel.isGroupAdmin(uid, gid))) {
        throw new AppError('NOT_GROUP_ADMIN', 'Only the group admin can perform this action', 403);
    }
};

const requireGroupMember = (param = 'gid') => guard(async (req) => {
    const uid = actingUserId(req);
    const gid = assertUuid(readParam(req, param), param);
    await assertMember(uid, gid);
    req.groupId = gid;
});

const requireGroupAdmin = (param = 'gid') => guard(async (req) => {
    const uid = actingUserId(req);
    const gid = assertUuid(readParam(req, param), param);
    await assertAdmin(uid, gid);
    req.groupId = gid;
});

// `kind` may be a list: kinds are tried in order and the first one that exists decides the group.
const requireResourceMember = (kind, param, { notFoundCode = 'NOT_FOUND', admin = false } = {}) => {
    const kinds = Array.isArray(kind) ? kind : [kind];
    return guard(async (req) => {
        const uid = actingUserId(req);
        const id = assertUuid(readParam(req, param), param);
        let found = null;
        for (const k of kinds) {
            const gid = await AccessModel.resolveGroupId(k, id);
            if (gid) {
                found = { kind: k, gid };
                break;
            }
        }
        if (!found) {
            throw new AppError(notFoundCode, `${RESOURCE_LABELS[kinds[0]] || 'Resource'} not found`, 404);
        }
        if (admin) await assertAdmin(uid, found.gid);
        else await assertMember(uid, found.gid);
        req.groupId = found.gid;
        req.resourceId = id;
        req.resourceKind = found.kind;
    });
};

const requireResourceAdmin = (kind, param, options = {}) => requireResourceMember(kind, param, { ...options, admin: true });

// For routes that carry both :gid (already authorized) and a child id: the child must belong
// to that group, otherwise it is reported as not found.
const requireResourceInGroup = (kind, param, { notFoundCode = 'NOT_FOUND' } = {}) => guard(async (req) => {
    const id = assertUuid(readParam(req, param), param);
    const gid = await AccessModel.resolveGroupId(kind, id);
    if (!gid || !sameId(gid, req.groupId)) {
        throw new AppError(notFoundCode, `${RESOURCE_LABELS[kind] || 'Resource'} not found`, 404);
    }
    req.resourceId = id;
});

const requireUuids = (...names) => guard(async (req) => {
    names.forEach((name) => assertUuid(readParam(req, name), name));
});

module.exports = {
    requireGroupMember,
    requireGroupAdmin,
    requireResourceMember,
    requireResourceAdmin,
    requireResourceInGroup,
    requireUuids,
    readParam,
    assertUuid,
    isUuid,
    sameId,
};

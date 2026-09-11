const edgesRoute = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const EdgesModel = require('./../models/edges.model');
const AccessModel = require('./../models/access.model');
const { AppError, sendError } = require('../helpers/errors');
const { requireGroupMember, requireResourceMember, assertUuid, sameId } = require('../middleware/groupAccess');

const { mapConstraintError } = require('../middleware/errorHandler');

const edgeMember = requireResourceMember('edge', 'eid');
// UQ(sourceId, targetId) and the composite FKs (nid, gid) → Nodes.
const EDGE_ERRORS = {
    unique: { code: 'DUPLICATE_EDGE', message: 'These nodes are already connected' },
    foreignKey: 'sourceId and targetId must be nodes of the group',
};

edgesRoute.post('/', requireGroupMember('gid'), async (req, res) => {
    const eid = uuidv4();
    const gid = req.groupId;

    try {
        const sourceId = assertUuid(req.body.sourceId, 'sourceId');
        const targetId = assertUuid(req.body.targetId, 'targetId');
        const [sourceGroup, targetGroup] = await Promise.all([
            AccessModel.resolveGroupId('node', sourceId),
            AccessModel.resolveGroupId('node', targetId),
        ]);
        if (!sameId(sourceGroup, gid) || !sameId(targetGroup, gid)) {
            throw new AppError('VALIDATION_ERROR', 'sourceId and targetId must be nodes of the group', 400);
        }

        await EdgesModel.addEdge({
            eid,
            gid,
            sourceId,
            targetId
        });

        res.status(200).json({
            data: {
                eid,
                gid,
                sourceId,
                targetId
            }
        });
    } catch (error) {
        sendError(res, mapConstraintError(error, EDGE_ERRORS));
    }
});

// Nota: declarar primero rutas más específicas
edgesRoute.get('/group/:gid', requireGroupMember('gid'), async (req, res) => {
    try {
        const data = await EdgesModel.getEdgesByGroupId(req.groupId);
        res.status(200).json({ data });
    } catch (error) {
        sendError(res, error);
    }
});

edgesRoute.get('/:eid', edgeMember, async (req, res) => {
    try {
        const data = await EdgesModel.getEdgesById(req.resourceId);
        res.status(200).json({ data });
    } catch (error) {
        sendError(res, error);
    }
});

edgesRoute.put('/:eid', edgeMember, async (req, res) => {
    const { prerequisite } = req.body;
    try {
        await EdgesModel.updatePrerequisite({
            eid: req.resourceId,
            prerequisite
        });
        res.status(200).json({ message: 'Edge prerequisite updated successfully' });
    } catch (error) {
        sendError(res, error);
    }
});

edgesRoute.delete('/source/:id', requireResourceMember('node', 'id'), async (req, res) => {
    try {
        await EdgesModel.deleteEdgeBySource(req.resourceId);
        res.status(200).json({ message: 'Edge deleted successfully' });
    } catch (error) {
        sendError(res, error);
    }
});

edgesRoute.delete('/:eid', edgeMember, async (req, res) => {
    try {
        await EdgesModel.deleteEdge(req.resourceId);
        res.status(200).json({ message: 'Edge deleted successfully' });
    } catch (error) {
        sendError(res, error);
    }
});

module.exports = edgesRoute;

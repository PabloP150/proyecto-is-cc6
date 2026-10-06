const nodesRoute = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const NodesModel = require('./../models/nodes.model');
const AccessModel = require('./../models/access.model');
const { AppError, sendError } = require('../helpers/errors');
const { requireGroupMember, requireResourceMember, assertUuid, sameId } = require('../middleware/groupAccess');
const validate = require('../middleware/validate');

// Mirrors the Nodes columns (name NVARCHAR(25), description NVARCHAR(1000), date DATE).
const nodeTextFields = (body) => ({
    name: validate.text(body.name, 'name', { max: 25, required: true }),
    description: validate.text(body.description, 'description', { max: 1000 }) ?? '',
    date: validate.dateTime(body.date, 'date', { required: true }),
});

// GET / (every node of every group) was removed: the frontend never used it and it leaked other groups' data.

const nodeMember = requireResourceMember('node', 'id');

nodesRoute.get('/tasks/:gid', requireGroupMember('gid'), async (req, res) => {
    try {
        const data = await NodesModel.getNodesAndTasks(req.groupId);
        res.status(200).json({ data });
    } catch (error) {
        sendError(res, error);
    }
});

// Get a node by ID
nodesRoute.get('/:id', nodeMember, async (req, res) => {
    try {
        const data = await NodesModel.getNode(req.resourceId);
        if (!data || data.length === 0) {
            throw new AppError('NOT_FOUND', 'Node not found', 404);
        }
        res.status(200).json({ data: data[0] });
    } catch (error) {
        sendError(res, error);
    }
});

// Get nodes by group ID
nodesRoute.get('/group/:gid', requireGroupMember('gid'), async (req, res) => {
    try {
        const data = await NodesModel.getNodesByGroupId(req.groupId);
        res.status(200).json({ data });
    } catch (error) {
        sendError(res, error);
    }
});

// Create a new node. Importing a task reuses its tid as nid, so a client-supplied nid is
// only accepted if it is not a task of some other group.
nodesRoute.post('/', requireGroupMember('gid'), async (req, res) => {
    const gid = req.groupId;

    try {
        const { name, description, date } = nodeTextFields(req.body);
        const completed = validate.bit(req.body.completed, 'completed') ?? false;
        const percentage = validate.integer(req.body.percentage, 'percentage', { min: 0, max: 100 }) ?? 0;
        const x_pos = validate.number(req.body.x_pos, 'x_pos', { required: true });
        const y_pos = validate.number(req.body.y_pos, 'y_pos', { required: true });

        let nid;
        if (req.body.nid) {
            nid = assertUuid(req.body.nid, 'nid');
            const taskGroup = await AccessModel.resolveGroupId('task', nid);
            if (taskGroup && !sameId(taskGroup, gid)) {
                throw new AppError('VALIDATION_ERROR', 'nid belongs to a task of another group', 400);
            }
        } else {
            nid = uuidv4();
        }

        await NodesModel.addNode({
            nid,
            gid,
            name,
            description,
            date,
            completed,
            percentage,
            x_pos,
            y_pos,
        });

        res.status(200).json({
            data: {
                nid,
                gid,
                name,
                description,
                date,
                completed,
                percentage,
                x_pos,
                y_pos
            }
        });
    } catch (error) {
        sendError(res, error);
    }
});

//update a node
nodesRoute.put('/:id/', nodeMember, async (req, res) => {
    const nid = req.resourceId;
    try {
        const { name, description, date } = nodeTextFields(req.body);
        await NodesModel.updateNode({
            nid,
            name,
            description,
            date
        });

        res.status(200).json({
            message: 'Node coords updated successfully',
            nid
        });
    } catch (error) {
        sendError(res, error);
    }
});

//update a node's coordinates
nodesRoute.put('/:id/coords', nodeMember, async (req, res) => {
    const nid = req.resourceId;
    try {
        const x_pos = validate.number(req.body.x_pos, 'x_pos', { required: true });
        const y_pos = validate.number(req.body.y_pos, 'y_pos', { required: true });
        await NodesModel.updateNodeCoords({
            nid,
            x_pos,
            y_pos
        });

        res.status(200).json({
            message: 'Node coords updated successfully',
            nid
        });
    } catch (error) {
        sendError(res, error);
    }
});

//update a node's percentage
nodesRoute.put('/:id/percentage', nodeMember, async (req, res) => {
    const nid = req.resourceId;
    try {
        const percentage = validate.integer(req.body.percentage, 'percentage', { min: 0, max: 100, required: true });
        await NodesModel.updateNodePercentage({
            nid,
            percentage
        });

        res.status(200).json({
            message: 'Node percentage updated successfully',
            nid
        });
    } catch (error) {
        sendError(res, error);
    }
});

// Update a node's complete status
nodesRoute.put('/:id/toggleComplete', nodeMember, async (req, res) => {
    const nid = req.resourceId;
    try {
        const completed = validate.bit(req.body.completed, 'completed', { required: true });
        await NodesModel.updateNodeCompleted({
            nid,
            completed
        });

        res.status(200).json({
            message: 'Node set to complete',
            nid
        });
    } catch (error) {
        sendError(res, error);
    }
});

// Delete a node (edges are deleted inside deleteNode in a single batch)
nodesRoute.delete('/:id', nodeMember, async (req, res) => {
    try {
        await NodesModel.deleteNode(req.resourceId);
        res.status(200).json({ message: 'Node deleted successfully' });
    } catch (error) {
        sendError(res, error);
    }
});


module.exports = nodesRoute;

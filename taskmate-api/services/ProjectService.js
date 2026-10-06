const { v4: uuidv4 } = require('uuid');
const groupModel = require('../models/group.model');
const taskModel = require('../models/tasks.model');
const nodeModel = require('../models/nodes.model');
const userGroupModel = require('../models/userGroup.model');
const groupRolesModel = require('../models/groupRoles.model');
const { isGroupMember } = require('../models/access.model');
const { withTransaction, isFkViolation, isUniqueViolation } = require('../helpers/transaction');
const { AppError } = require('../helpers/errors');

// Fallback: map common emojis to Material Icons names
const EMOJI_TO_ICON = {
    '🔧': 'build', '👨‍💻': 'code', '🎨': 'palette', '🧪': 'bug_report',
    '📋': 'assignment', '👤': 'person', '📊': 'insights', '🛠️': 'settings',
    '💻': 'terminal', '🔒': 'lock', '🌐': 'public', '📝': 'edit',
    '⭐': 'star', '🔔': 'notifications', '💬': 'chat', '☁️': 'cloud',
    '📦': 'storage', '🚀': 'rocket_launch', '📅': 'event', '👥': 'group',
    '🧑‍💼': 'supervisor_account', '🎯': 'leaderboard', '🔍': 'visibility',
    '💡': 'lightbulb', '📱': 'phone_android', '🖥️': 'desktop_windows',
};
const VALID_ICONS = new Set([
    'dashboard','assignment','check_circle','pending_actions','event','group',
    'person','supervisor_account','admin_panel_settings','emoji_events','star',
    'leaderboard','insights','timeline','workspaces','code','terminal',
    'bug_report','build','cloud','storage','api','integration_instructions',
    'extension','chat','forum','comment','notifications','visibility','edit',
    'delete','settings','lock','public','favorite','help','palette',
    'rocket_launch','lightbulb','phone_android','desktop_windows',
]);
function normalizeIcon(icon) {
    if (!icon) return 'star';
    if (VALID_ICONS.has(icon)) return icon;
    if (EMOJI_TO_ICON[icon]) return EMOJI_TO_ICON[icon];
    // Strip non-ascii and check again
    const cleaned = icon.replace(/[^a-z_]/g, '');
    if (VALID_ICONS.has(cleaned)) return cleaned;
    return 'star';
}


// Column sizes of the text columns written here (NVARCHAR since migration 005; role colour is VARCHAR).
const LIMITS = { name: 25, list: 25, description: 1000, roleName: 40, roleColor: 20 };
const MAX_PLAN_TASKS = 100;
const MAX_PLAN_MILESTONES = 50;
const NODE_SPACING_X = 250;
// A milestone card (src/components/flow/CustomNode.jsx) is 11em wide and ~180px tall with a short
// description, so a row placed 300 below a card's top leaves a clear gap. The card shows the whole
// description, though, so a card taller than that pushes the next row down to its estimated bottom.
const NODE_SPACING_Y = 300;
const NODE_GAP_Y = 60;
// Upper bound of a card's height, from cards rendered in Chrome: at most 168px without a description,
// plus one 23px line (bold 0.9em, line-height 1.6) per 16-18 characters of it; 15 per line leaves margin.
const estimateNodeHeight = (descriptionLength) => 170 + 23 * Math.ceil((Number(descriptionLength) || 0) / 15);
// y of a new row of nodes: below every card the group already has, or 0 when it has none.
const nextNodeRowY = (layout) => (layout.length === 0 ? 0 : Math.max(...layout.map(node => (
    node.y_pos + Math.max(NODE_SPACING_Y, estimateNodeHeight(node.descriptionLength) + NODE_GAP_Y)
))));
// SMALLDATETIME range (Tasks.datetime).
const MIN_DATE = new Date(1900, 0, 1);
const MAX_DATE = new Date(2079, 5, 6);

// NVARCHAR lengths count UTF-16 code units: cut at `max` units without splitting a surrogate pair.
const fitUnits = (text, max) => {
    let out = '';
    for (const ch of text) {
        if (out.length + ch.length > max) break;
        out += ch;
    }
    return out;
};
const normalizeText = (value) => String(value ?? '').normalize('NFC').trim();
const clip = (value, max) => fitUnits(normalizeText(value), max);
const shorten = (value, max) => {
    const text = normalizeText(value);
    return text.length > max ? `${fitUnits(text, max - 3)}...` : text;
};

// 'YYYY-MM-DD' is a calendar date: build it in local time (the pool uses useUTC: false).
const parseLocalDate = (value) => {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value !== 'string') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    const date = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    if (m && date.getDate() !== Number(m[3])) return null; // e.g. 2026-02-31
    return date;
};

const inSmallDateTimeRange = (date) => date >= MIN_DATE && date <= MAX_DATE;

class ProjectService {
    /**
     * Calculates a future date based on a duration string.
     * @param {string} durationString - e.g., "2 days", "1 week", "3 months".
     * @returns {Date} - The calculated future date.
     */
    _calculateDueDate(durationString) {
        const now = new Date();
        if (typeof durationString !== 'string') {
            return now;
        }

        const parts = durationString.toLowerCase().split(' ');
        if (parts.length !== 2) {
            return now;
        }

        const amount = parseInt(parts[0], 10);
        const unit = parts[1].replace(/s$/, ''); // singular unit

        if (isNaN(amount)) {
            return now;
        }

        switch (unit) {
            case 'day':
                now.setDate(now.getDate() + amount);
                break;
            case 'week':
                now.setDate(now.getDate() + amount * 7);
                break;
            case 'month':
                now.setMonth(now.getMonth() + amount);
                break;
            default:
                // Return now if unit is unrecognized
                break;
        }
        return now;
    }

    // Due date of an LLM-generated task or milestone: ISO date, duration ("2 weeks") or today.
    _resolvePlanDate(value, fallbackDuration) {
        let date = null;
        if (typeof value === 'string' && value) {
            date = (value.includes('T') || value.includes('-'))
                ? parseLocalDate(value)
                : this._calculateDueDate(value);
        } else if (fallbackDuration) {
            date = this._calculateDueDate(fallbackDuration);
        }
        return date && inSmallDateTimeRange(date) ? date : new Date();
    }

    /**
     * Creates a group (with the user as admin and member), its roles, tasks and milestones from
     * an AI plan, all in ONE transaction: either the whole project exists or nothing does.
     * Returns {success: true, groupId, groupName} or {success: false, error}.
     */
    async createProjectFromPlan(recommendations, originalMessage, userId) {
        if (!recommendations) {
            return { success: false, error: 'Missing recommendations data' };
        }
        if (!userId) {
            return { success: false, error: 'Missing user ID' };
        }

        const projectData = recommendations.recommendations || recommendations;
        if (!projectData) {
            return { success: false, error: 'Invalid recommendations format: missing project data' };
        }
        if (!projectData.project_name && !originalMessage) {
            return { success: false, error: 'Missing project name and original message' };
        }
        if (!projectData.tasks || !Array.isArray(projectData.tasks)) {
            return { success: false, error: 'Invalid or missing tasks array' };
        }

        const groupId = uuidv4();
        const groupName = clip(projectData.project_name || `Project: ${originalMessage}`, LIMITS.name) || 'Project';

        // Role names are unique per group (UQ_GroupRoles_Gid_Name, case-insensitive).
        const seenRoles = new Set();
        const roles = (Array.isArray(projectData.roles) ? projectData.roles : [])
            .map(role => ({ ...role, cleanName: clip(role && role.name, LIMITS.roleName) }))
            .filter(role => {
                const key = role.cleanName.toLowerCase();
                if (!role.cleanName || seenRoles.has(key)) return false;
                seenRoles.add(key);
                return true;
            });

        const tasks = projectData.tasks.map((task, i) => ({
            tid: uuidv4(),
            gid: groupId,
            name: shorten(task && (task.name || task.task), LIMITS.name) || `Task ${i + 1}`,
            description: clip(task && task.description, LIMITS.description),
            list: shorten((task && (task.list || task.status)) || 'To Do', LIMITS.list) || 'To Do',
            datetime: this._resolvePlanDate(task && task.due_date, task && task.duration),
            percentage: 0,
        }));

        const milestones = (Array.isArray(projectData.milestones) ? projectData.milestones : []).map((milestone, i) => ({
            nid: uuidv4(),
            gid: groupId,
            name: shorten(milestone && milestone.name, LIMITS.name) || `Milestone ${i + 1}`,
            description: clip((milestone && milestone.description) || 'Project milestone', LIMITS.description),
            date: this._resolvePlanDate(milestone && milestone.date),
            completed: false,
            percentage: 0,
            x_pos: NODE_SPACING_X * i,
            y_pos: 0,
        }));

        try {
            await withTransaction(async (tx) => {
                await groupModel.addGroup({ gid: groupId, adminId: userId, name: groupName }, { tx });
                await userGroupModel.addUserToGroup({ uid: userId, gid: groupId }, { tx });
                // Queued FIFO on the transaction's single connection.
                await Promise.all([
                    ...roles.map(role => groupRolesModel.addGroupRole({
                        gr_id: uuidv4(),
                        gid: groupId,
                        gr_name: role.cleanName,
                        gr_color: clip(role.color || '#6b7280', LIMITS.roleColor),
                        gr_icon: normalizeIcon(role.icon),
                    }, { tx })),
                    ...tasks.map(task => taskModel.addTask(task, { tx })),
                    ...milestones.map(node => nodeModel.addNode(node, { tx })),
                ]);
            });
            return { success: true, groupId, groupName };
        } catch (error) {
            console.error('Error creating project from recommendations:', error);
            if (isFkViolation(error)) {
                return { success: false, error: 'Invalid user ID or database reference error' };
            }
            if (isUniqueViolation(error)) {
                return { success: false, error: 'Project with this name already exists for this user' };
            }
            return { success: false, error: 'Database error: the project could not be created' };
        }
    }

    /**
     * addPlanToGroup(gid, plan, uid) → {taskIds, nodeIds}
     * Saves a confirmed repository-analysis plan into an existing group in one transaction:
     * milestones become Nodes at x = 250*i in a new row below every node the group has (300 below
     * each card's top, more under a tall card; y = 0 when it has none), tasks become Tasks whose
     * list is their milestone's name (<= 25) or 'GitHub'. Text is truncated to the column sizes.
     * Throws AppError NOT_GROUP_MEMBER (403) or VALIDATION_ERROR (400).
     */
    async addPlanToGroup(gid, plan, uid) {
        if (!plan || typeof plan !== 'object') {
            throw new AppError('VALIDATION_ERROR', 'Plan is required', 400);
        }
        const planTasks = plan.tasks ?? [];
        const planMilestones = plan.milestones ?? [];
        if (!Array.isArray(planTasks) || !Array.isArray(planMilestones)) {
            throw new AppError('VALIDATION_ERROR', 'Plan tasks and milestones must be arrays', 400);
        }
        if (planTasks.length === 0 && planMilestones.length === 0) {
            throw new AppError('VALIDATION_ERROR', 'Plan has no tasks or milestones', 400);
        }
        if (planTasks.length > MAX_PLAN_TASKS || planMilestones.length > MAX_PLAN_MILESTONES) {
            throw new AppError('VALIDATION_ERROR', 'Plan is too large', 400);
        }

        const requireDate = (value, what) => {
            const date = parseLocalDate(value);
            if (!date || !inSmallDateTimeRange(date)) {
                throw new AppError('VALIDATION_ERROR', `Invalid date for ${what}`, 400);
            }
            return date;
        };

        const milestoneByKey = new Map();
        const nodes = planMilestones.map((milestone, i) => {
            if (!milestone || typeof milestone !== 'object') {
                throw new AppError('VALIDATION_ERROR', `Invalid milestone ${i + 1}`, 400);
            }
            const node = {
                nid: uuidv4(),
                gid,
                name: shorten(milestone.name, LIMITS.name) || `Milestone ${i + 1}`,
                description: clip(milestone.description, LIMITS.description),
                date: requireDate(milestone.target_date, `milestone ${i + 1}`),
                completed: false,
                percentage: 0,
                x_pos: NODE_SPACING_X * i,
            };
            if (milestone.key !== undefined && milestone.key !== null) milestoneByKey.set(String(milestone.key), node);
            return node;
        });

        const tasks = planTasks.map((task, i) => {
            if (!task || typeof task !== 'object') {
                throw new AppError('VALIDATION_ERROR', `Invalid task ${i + 1}`, 400);
            }
            const milestone = task.milestone_key === undefined || task.milestone_key === null
                ? null
                : milestoneByKey.get(String(task.milestone_key));
            return {
                tid: uuidv4(),
                gid,
                name: shorten(task.name, LIMITS.name) || `Task ${i + 1}`,
                description: clip(task.description, LIMITS.description),
                list: milestone ? milestone.name : 'GitHub',
                datetime: requireDate(task.due_date, `task ${i + 1}`),
                percentage: 0,
            };
        });

        await withTransaction(async (tx) => {
            if (!(await isGroupMember(uid, gid, { tx }))) {
                throw new AppError('NOT_GROUP_MEMBER', 'You are not a member of this group', 403);
            }
            const rowY = nodes.length > 0 ? nextNodeRowY(await nodeModel.getNodeLayout(gid, { tx })) : 0;
            await Promise.all([
                ...nodes.map(node => nodeModel.addNode({ ...node, y_pos: rowY }, { tx })),
                ...tasks.map(task => taskModel.addTask(task, { tx })),
            ]);
        });

        return { taskIds: tasks.map(t => t.tid), nodeIds: nodes.map(n => n.nid) };
    }
}

module.exports = new ProjectService();

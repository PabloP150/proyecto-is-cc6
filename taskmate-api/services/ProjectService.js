const { v4: uuidv4 } = require('uuid');
const groupModel = require('../models/group.model');
const taskModel = require('../models/tasks.model');
const nodeModel = require('../models/nodes.model');
const userGroupModel = require('../models/userGroup.model');
const groupRolesModel = require('../models/groupRoles.model');

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

    async createProjectFromPlan(recommendations, originalMessage, userId) {
        try {
            // Validate input parameters
            if (!recommendations) {
                return { success: false, error: 'Missing recommendations data' };
            }

            if (!userId) {
                return { success: false, error: 'Missing user ID' };
            }

            // Extract data from standardized recommendations format
            const projectData = recommendations.recommendations || recommendations;

            // Validate project data structure
            if (!projectData) {
                return { success: false, error: 'Invalid recommendations format: missing project data' };
            }

            if (!projectData.project_name && !originalMessage) {
                return { success: false, error: 'Missing project name and original message' };
            }

            if (!projectData.tasks || !Array.isArray(projectData.tasks)) {
                return { success: false, error: 'Invalid or missing tasks array' };
            }

            // 1. Create a project group
            const groupName = (projectData.project_name || `Project: ${originalMessage}`).substring(0, 25);
            const groupId = uuidv4();

            console.log(`Creating project group: ${groupName} (ID: ${groupId}) for user: ${userId}`);
            await groupModel.addGroup({
                gid: groupId,
                adminId: userId,
                name: groupName
            });

            // 2. Add the creator to the group
            await userGroupModel.addUserToGroup({ uid: userId, gid: groupId });

            // 3. Create group roles (in parallel)
            if (projectData.roles && Array.isArray(projectData.roles) && projectData.roles.length > 0) {
                console.log(`Creating ${projectData.roles.length} roles for project ${groupId}`);
                await Promise.all(projectData.roles.map(async (role) => {
                    if (!role.name) return;
                    try {
                        await groupRolesModel.addGroupRole({
                            gr_id: uuidv4(),
                            gid: groupId,
                            gr_name: role.name.substring(0, 30),
                            gr_color: role.color || '#6b7280',
                            gr_icon: normalizeIcon(role.icon),
                        });
                    } catch (roleError) {
                        console.error(`Failed to create role ${role.name}:`, roleError);
                    }
                }));
            }

            // 4. Create tasks from the recommendations (in parallel)
            console.log(`Creating ${projectData.tasks.length} tasks for project ${groupId}`);
            await Promise.all(projectData.tasks.map(async (task, i) => {
                const taskId = uuidv4();

                if (!task.name && !task.task) {
                    console.warn(`Task ${i + 1} missing name, using default`);
                }

                let dueDate;
                try {
                    if (task.due_date) {
                        if (task.due_date.includes('T') || task.due_date.includes('-')) {
                            dueDate = new Date(task.due_date);
                            if (isNaN(dueDate.getTime())) {
                                console.warn(`Invalid due_date format for task ${i + 1}: ${task.due_date}, using current date`);
                                dueDate = new Date();
                            }
                        } else {
                            dueDate = this._calculateDueDate(task.due_date);
                        }
                    } else if (task.duration) {
                        dueDate = this._calculateDueDate(task.duration);
                    } else {
                        dueDate = new Date();
                    }
                } catch (dateError) {
                    console.warn(`Error processing date for task ${i + 1}:`, dateError);
                    dueDate = new Date();
                }

                const taskName = task.name || task.task || `Task ${i + 1}`;
                const truncatedTaskName = taskName.length > 25 ? taskName.substring(0, 22) + '...' : taskName;

                const taskData = {
                    tid: taskId,
                    gid: groupId,
                    name: truncatedTaskName,
                    description: task.description || '',
                    list: task.list || task.status || 'To Do',
                    datetime: dueDate,
                    percentage: 0
                };

                try {
                    await taskModel.addTask(taskData);
                    console.log(`Created task: ${taskData.name}`);
                } catch (taskError) {
                    console.error(`Failed to create task ${i + 1}:`, taskError);
                    throw new Error(`Failed to create task: ${taskData.name}`);
                }
            }));

            // 5. Create milestones in Nodes table (in parallel, if provided)
            if (projectData.milestones && Array.isArray(projectData.milestones)) {
                console.log(`Creating ${projectData.milestones.length} milestones for project ${groupId}`);
                await Promise.all(projectData.milestones.map(async (milestone, i) => {
                    const nodeId = uuidv4();

                    if (!milestone.name) {
                        console.warn(`Milestone ${i + 1} missing name, using default`);
                    }

                    let milestoneDate;
                    try {
                        if (milestone.date) {
                            if (milestone.date.includes('T') || milestone.date.includes('-')) {
                                milestoneDate = new Date(milestone.date);
                                if (isNaN(milestoneDate.getTime())) {
                                    console.warn(`Invalid date format for milestone ${i + 1}: ${milestone.date}, using current date`);
                                    milestoneDate = new Date();
                                }
                            } else {
                                milestoneDate = this._calculateDueDate(milestone.date);
                            }
                        } else {
                            milestoneDate = new Date();
                        }
                    } catch (dateError) {
                        console.warn(`Error processing date for milestone ${i + 1}:`, dateError);
                        milestoneDate = new Date();
                    }

                    const milestoneName = milestone.name || `Milestone ${i + 1}`;
                    const truncatedMilestoneName = milestoneName.length > 25 ? milestoneName.substring(0, 22) + '...' : milestoneName;

                    const milestoneData = {
                        nid: nodeId,
                        gid: groupId,
                        name: truncatedMilestoneName,
                        description: milestone.description || 'Project milestone',
                        date: milestoneDate,
                        completed: false,
                        percentage: 0,
                        x_pos: 0,
                        y_pos: 0
                    };

                    try {
                        await nodeModel.addNode(milestoneData);
                        console.log(`Created milestone: ${milestoneData.name}`);
                    } catch (milestoneError) {
                        console.error(`Failed to create milestone ${i + 1}:`, milestoneError);
                        throw new Error(`Failed to create milestone: ${milestoneData.name}`);
                    }
                }));
            } else {
                console.log('No milestones provided, skipping milestone creation');
            }

            console.log(`Successfully created project ${groupName} with ${projectData.tasks.length} tasks and ${projectData.milestones?.length || 0} milestones`);
            return { success: true, groupId };
        } catch (error) {
            console.error('Error creating project from recommendations:', error);

            // Provide more specific error messages
            if (error.message.includes('Failed to create task')) {
                return { success: false, error: `Task creation failed: ${error.message}` };
            } else if (error.message.includes('Failed to create milestone')) {
                return { success: false, error: `Milestone creation failed: ${error.message}` };
            } else if (error.message.includes('duplicate') || error.message.includes('unique')) {
                return { success: false, error: 'Project with this name already exists for this user' };
            } else if (error.message.includes('foreign key') || error.message.includes('reference')) {
                return { success: false, error: 'Invalid user ID or database reference error' };
            } else {
                return { success: false, error: `Database error: ${error.message}` };
            }
        }
    }
}

module.exports = new ProjectService();

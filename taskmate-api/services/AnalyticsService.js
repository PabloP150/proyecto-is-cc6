const { execReadCommand, execWriteCommand } = require('../helpers/execQuery');
const { TYPES } = require('tedious');

const VALID_CATEGORIES = ['frontend', 'backend', 'database', 'testing', 'general'];

class AnalyticsService {
    /**
     * Execute multiple operations with error handling (simplified transaction-like behavior)
     * @param {Function} operations - Async function containing operations to execute
     * @returns {Promise} Operation result
     */
    async executeWithErrorHandling(operations) {
        // Errors propagate to the callers, which log them (a task with no analytics fact is a normal case).
        return operations();
    }
    /**
     * Record a new task assignment in analytics
     * @param {string} taskId - Task UUID
     * @param {string} userId - User UUID  
     * @param {string} groupId - Group UUID
     * @param {string} category - Task category (frontend, backend, database, testing, general)
     */
    async recordTaskAssignment(taskId, userId, groupId, category = 'general') {
        try {
            // Validate input parameters
            if (!taskId || !userId || !groupId) {
                throw new Error('Missing required parameters: taskId, userId, and groupId are required');
            }

            // Validate category
            if (!VALID_CATEGORIES.includes(category)) {
                console.warn(`Invalid category '${category}', defaulting to 'general'`);
                category = 'general';
            }

            // Insert only if no pending assignment already exists (single roundtrip). TaskAnalytics has
            // no FK to Tasks (it keeps history), so the task's existence is checked here.
            const insertQuery = `
                INSERT INTO dbo.TaskAnalytics (tid, uid, gid, task_category, assigned_at)
                SELECT @tid, @uid, @gid, @category, GETDATE()
                WHERE NOT EXISTS (
                    SELECT 1 FROM dbo.TaskAnalytics
                    WHERE tid = @tid AND uid = @uid AND success_status = 'pending'
                )
                AND EXISTS (SELECT 1 FROM dbo.Tasks WHERE tid = @tid)
            `;
            const insertParams = [
                { name: 'tid', type: TYPES.UniqueIdentifier, value: taskId },
                { name: 'uid', type: TYPES.UniqueIdentifier, value: userId },
                { name: 'gid', type: TYPES.UniqueIdentifier, value: groupId },
                { name: 'category', type: TYPES.VarChar, value: category }
            ];

            const rowsInserted = await execWriteCommand(insertQuery, insertParams);
            if (rowsInserted === 0) {
                return { success: true, message: 'Assignment already recorded' };
            }
            return {
                success: true, 
                task_id: taskId,
                user_id: userId,
                group_id: groupId,
                category: category
            };
        } catch (error) {
            console.error('Error recording task assignment:', error);
            
            // Handle specific database errors
            if (error.message.includes('FOREIGN KEY constraint')) {
                throw new Error('Invalid task, user, or group ID - referenced entity does not exist');
            } else if (error.message.includes('UNIQUE constraint')) {
                throw new Error('Task assignment already exists for this user');
            } else {
                throw new Error(`Failed to record task assignment: ${error.message}`);
            }
        }
    }

    /**
     * Record task completion and calculate completion time
     * @param {string} taskId - Task UUID
     * @param {boolean} success - Whether task was completed successfully
     */
    async recordTaskCompletion(taskId, success = true, statusOverride = null) {
        return this.executeWithErrorHandling(async () => {
            const status = statusOverride || (success ? 'completed' : 'failed');
            
            // First, verify the task exists and is pending
            const verifyQuery = `
                SELECT uid, gid, task_category, assigned_at 
                FROM dbo.TaskAnalytics 
                WHERE tid = @tid AND success_status = 'pending'
            `;
            const verifyParams = [
                { name: 'tid', type: TYPES.UniqueIdentifier, value: taskId }
            ];
            
            const taskData = await execReadCommand(verifyQuery, verifyParams);
            if (!taskData || taskData.length === 0) {
                // tasks.completeTask / trashTask close the facts inside their own transaction, so the
                // hook that runs after them only has to refresh the derived metrics (idempotent).
                const closed = await execReadCommand(
                    `SELECT TOP 1 success_status FROM dbo.TaskAnalytics
                     WHERE tid = @tid AND success_status <> 'pending'
                     ORDER BY completed_at DESC`,
                    verifyParams
                );
                if (!closed || closed.length === 0) {
                    throw new Error(`Task ${taskId} not found or already completed`);
                }
                await this._updateUserMetrics(taskId);
                return {
                    success: true,
                    task_id: taskId,
                    status: closed[0].success_status,
                    completion_time_calculated: true,
                    already_recorded: true
                };
            }

            // Close the pending facts; completed_at is clamped so it is never before assigned_at
            // (CK_TaskAnalytics_CompletedAt) and only completed tasks carry a duration.
            const updateQuery = `
                UPDATE ta
                SET completed_at = c.closed_at,
                    success_status = @status,
                    completion_time_hours = CASE WHEN @status = 'completed'
                        THEN CAST(DATEDIFF(SECOND, ta.assigned_at, c.closed_at) / 3600.0 AS DECIMAL(10,2))
                        ELSE NULL END
                FROM dbo.TaskAnalytics ta
                CROSS APPLY (SELECT CASE WHEN GETDATE() < ta.assigned_at THEN ta.assigned_at ELSE GETDATE() END AS closed_at) c
                WHERE ta.tid = @tid AND ta.success_status = 'pending'
            `;
            const updateParams = [
                { name: 'tid', type: TYPES.UniqueIdentifier, value: taskId },
                { name: 'status', type: TYPES.VarChar, value: status }
            ];
            
            const updateResult = await execWriteCommand(updateQuery, updateParams);
            if (updateResult === 0) {
                throw new Error(`No pending task found with ID ${taskId}`);
            }
            
            // Update user metrics after completion (non-blocking)
            try {
                await this._updateUserMetrics(taskId);
            } catch (metricsError) {
                console.warn(`Failed to update user metrics for task ${taskId}:`, metricsError.message);
                // Don't fail the main operation if metrics update fails
            }
            
            return {
                success: true, 
                task_id: taskId,
                status: status,
                completion_time_calculated: true
            };
        });
    }

    /**
     * Get current active task count for a user
     * @param {string} userId - User UUID
     * @returns {number} Number of active tasks
     */
    async getCurrentWorkload(userId) {
        try {
            const query = `
                SELECT COUNT(*) as active_count 
                FROM dbo.TaskAnalytics ta
                WHERE ta.uid = @uid AND ta.success_status = 'pending'
            `;
            const params = [
                { name: 'uid', type: TYPES.UniqueIdentifier, value: userId }
            ];
            
            const result = await execReadCommand(query, params);
            return result[0]?.active_count || 0;
        } catch (error) {
            console.error('Error getting current workload:', error);
            return 0; // Return 0 on error to avoid blocking recommendations
        }
    }

    /**
     * Get user expertise scores by category
     * @param {string} userId - User UUID
     * @returns {Object} Expertise data by category
     */
    async getUserExpertise(userId) {
        try {
            const query = `
                SELECT task_category, expertise_score, success_rate_percentage, 
                       tasks_completed, avg_completion_time_hours
                FROM dbo.UserExpertise 
                WHERE uid = @uid
            `;
            const params = [
                { name: 'uid', type: TYPES.UniqueIdentifier, value: userId }
            ];
            
            const results = await execReadCommand(query, params);
            
            // Convert array to object keyed by category
            const expertise = {};
            results.forEach(row => {
                expertise[row.task_category] = {
                    expertise_score: row.expertise_score || 0,
                    success_rate_percentage: row.success_rate_percentage || 50,
                    tasks_completed: row.tasks_completed || 0,
                    avg_completion_time_hours: row.avg_completion_time_hours || 0
                };
            });
            
            return expertise;
        } catch (error) {
            console.error('Error getting user expertise:', error);
            return {}; // Return empty object on error
        }
    }

    /**
     * Get historical capacity (max concurrent tasks) for a user
     * @param {string} userId - User UUID
     * @returns {number} Maximum concurrent tasks handled
     */
    async getHistoricalCapacity(userId) {
        try {
            const query = `
                SELECT MAX(max_concurrent_tasks) as max_capacity
                FROM dbo.UserMetrics 
                WHERE uid = @uid
            `;
            const params = [
                { name: 'uid', type: TYPES.UniqueIdentifier, value: userId }
            ];
            
            const result = await execReadCommand(query, params);
            return result[0]?.max_capacity || 3; // Default to 3 if no history
        } catch (error) {
            console.error('Error getting historical capacity:', error);
            return 3; // Default capacity on error
        }
    }

    /**
     * Get analytics summary for a user
     * @param {string} userId - User UUID
     * @returns {Object} Complete analytics summary
     */
    async getUserAnalyticsSummary(userId) {
        try {
            const [workload, expertise, capacity] = await Promise.all([
                this.getCurrentWorkload(userId),
                this.getUserExpertise(userId),
                this.getHistoricalCapacity(userId)
            ]);

            return {
                current_workload: workload,
                expertise_by_category: expertise,
                historical_capacity: capacity,
                updated_at: new Date().toISOString()
            };
        } catch (error) {
            console.error('Error getting user analytics summary:', error);
            throw new Error(`Failed to get analytics summary: ${error.message}`);
        }
    }

    /**
     * Refresh the derived metrics of every user that has a fact for this task (internal method).
     * @private
     */
    async _updateUserMetrics(taskId) {
        try {
            const rows = await execReadCommand(
                `SELECT DISTINCT uid, task_category FROM dbo.TaskAnalytics WHERE tid = @tid`,
                [{ name: 'tid', type: TYPES.UniqueIdentifier, value: taskId }]
            );
            if (!rows || rows.length === 0) return;

            const uids = [...new Set(rows.map(r => String(r.uid).toUpperCase()))];
            await Promise.all([
                ...rows.map(r => this._updateUserExpertise(r.uid, r.task_category)),
                ...uids.map(uid => this._updateDailyMetrics(uid))
            ]);
        } catch (error) {
            console.error('Error updating user metrics:', error);
            // Don't throw error to avoid blocking main task operations
        }
    }

    /**
     * Recompute a user's expertise in one category from the TaskAnalytics facts (completed vs
     * failed). Recomputing instead of incrementing makes the refresh idempotent: running it
     * twice for the same completion never double-counts.
     * score = min(100, success rate + time bonus), bonus = avg > 0 ? max(0, 20 - avg/2) : 10.
     * @private
     */
    async _updateUserExpertise(userId, category) {
        try {
            if (!VALID_CATEGORIES.includes(category)) return;
            const query = `
                MERGE dbo.UserExpertise WITH (HOLDLOCK) AS target
                USING (
                    SELECT s.uid, s.task_category, s.tasks_completed, s.avg_time, s.success_rate,
                           CASE WHEN s.tasks_completed = 0 THEN 0
                                WHEN s.success_rate + b.bonus > 100 THEN 100
                                ELSE s.success_rate + b.bonus END AS score
                    FROM (
                        SELECT @uid AS uid, @category AS task_category,
                               COUNT(*) AS tasks_completed,
                               CAST(ISNULL(AVG(CASE WHEN success_status = 'completed' THEN completion_time_hours END), 0) AS DECIMAL(10,2)) AS avg_time,
                               CAST(ISNULL(100.0 * SUM(CASE WHEN success_status = 'completed' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 0) AS DECIMAL(5,2)) AS success_rate
                        FROM dbo.TaskAnalytics
                        WHERE uid = @uid AND task_category = @category AND success_status IN ('completed', 'failed')
                    ) s
                    CROSS APPLY (SELECT CASE WHEN s.avg_time > 0
                                             THEN CASE WHEN 20 - s.avg_time / 2 > 0 THEN 20 - s.avg_time / 2 ELSE 0 END
                                             ELSE 10 END AS bonus) b
                ) AS source
                ON target.uid = source.uid AND target.task_category = source.task_category
                WHEN MATCHED THEN
                    UPDATE SET tasks_completed = source.tasks_completed,
                               avg_completion_time_hours = source.avg_time,
                               success_rate_percentage = source.success_rate,
                               expertise_score = source.score,
                               last_updated = GETDATE()
                WHEN NOT MATCHED AND source.tasks_completed > 0 THEN
                    INSERT (uid, task_category, expertise_score, tasks_completed, avg_completion_time_hours, success_rate_percentage)
                    VALUES (source.uid, source.task_category, source.score, source.tasks_completed, source.avg_time, source.success_rate);
            `;
            await execWriteCommand(query, [
                { name: 'uid', type: TYPES.UniqueIdentifier, value: userId },
                { name: 'category', type: TYPES.VarChar, value: category }
            ]);
        } catch (error) {
            console.error('Error updating user expertise:', error);
        }
    }

    /**
     * Update daily metrics for a user
     * @private
     */
    async _updateDailyMetrics(userId) {
        try {
            const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

            const maxConcurrentQuery = `
                SELECT COUNT(*) as concurrent_count
                FROM dbo.TaskAnalytics
                WHERE uid = @uid
                AND CAST(assigned_at AS DATE) = @today
                AND (completed_at IS NULL OR CAST(completed_at AS DATE) >= @today)
            `;
            const concurrentParams = [
                { name: 'uid', type: TYPES.UniqueIdentifier, value: userId },
                { name: 'today', type: TYPES.Date, value: today }
            ];

            // Both reads are independent — run in parallel
            const [activeCount, concurrentResult] = await Promise.all([
                this.getCurrentWorkload(userId),
                execReadCommand(maxConcurrentQuery, concurrentParams)
            ]);
            const maxConcurrent = concurrentResult[0]?.concurrent_count || activeCount;
            
            // Upsert daily metrics
            const upsertQuery = `
                MERGE dbo.UserMetrics WITH (HOLDLOCK) AS target
                USING (SELECT @uid as uid, @date as metric_date) AS source
                ON target.uid = source.uid AND target.metric_date = source.metric_date
                WHEN MATCHED THEN
                    UPDATE SET active_tasks_count = @activeCount,
                              max_concurrent_tasks = CASE WHEN @maxConcurrent > target.max_concurrent_tasks 
                                                         THEN @maxConcurrent 
                                                         ELSE target.max_concurrent_tasks END,
                              updated_at = GETDATE()
                WHEN NOT MATCHED THEN
                    INSERT (uid, metric_date, active_tasks_count, max_concurrent_tasks)
                    VALUES (@uid, @date, @activeCount, @maxConcurrent);
            `;
            const upsertParams = [
                { name: 'uid', type: TYPES.UniqueIdentifier, value: userId },
                { name: 'date', type: TYPES.Date, value: today },
                { name: 'activeCount', type: TYPES.Int, value: activeCount },
                { name: 'maxConcurrent', type: TYPES.Int, value: maxConcurrent }
            ];
            
            await execWriteCommand(upsertQuery, upsertParams);
        } catch (error) {
            console.error('Error updating daily metrics:', error);
        }
    }

    /**
     * Get team analytics summary for a group
     * @param {string} groupId - Group UUID
     * @returns {Object} Team analytics data
     */
    async getTeamAnalyticsSummary(groupId) {
        try {
            const query = `
                SELECT
                    u.uid,
                    u.username,
                    COUNT(CASE WHEN ta.success_status = 'pending' THEN 1 END) as active_tasks,
                    COUNT(CASE WHEN ta.success_status = 'completed' THEN 1 END) as completed_tasks,
                    COUNT(CASE WHEN ta.success_status = 'failed' THEN 1 END) as failed_tasks,
                    AVG(CASE WHEN ta.completion_time_hours IS NOT NULL THEN ta.completion_time_hours END) as avg_completion_time,
                    um_max.max_cap as historical_capacity
                FROM dbo.Users u
                JOIN dbo.UserGroups ug ON u.uid = ug.uid
                LEFT JOIN dbo.TaskAnalytics ta ON u.uid = ta.uid AND ta.gid = @gid
                LEFT JOIN (
                    SELECT uid, MAX(max_concurrent_tasks) as max_cap
                    FROM dbo.UserMetrics
                    GROUP BY uid
                ) um_max ON u.uid = um_max.uid
                WHERE ug.gid = @gid
                GROUP BY u.uid, u.username, um_max.max_cap
                ORDER BY u.username
            `;
            const params = [
                { name: 'gid', type: TYPES.UniqueIdentifier, value: groupId }
            ];
            
            const results = await execReadCommand(query, params);
            
            return {
                group_id: groupId,
                team_members: results.map(row => ({
                    user_id: row.uid,
                    username: row.username,
                    active_tasks: row.active_tasks || 0,
                    completed_tasks: row.completed_tasks || 0,
                    failed_tasks: row.failed_tasks || 0,
                    success_rate: row.completed_tasks > 0 ? 
                        ((row.completed_tasks / (row.completed_tasks + row.failed_tasks)) * 100).toFixed(2) : 0,
                    avg_completion_time_hours: row.avg_completion_time ? parseFloat(row.avg_completion_time.toFixed(2)) : 0,
                    historical_capacity: row.historical_capacity || 3
                })),
                updated_at: new Date().toISOString()
            };
        } catch (error) {
            console.error('Error getting team analytics summary:', error);
            throw new Error(`Failed to get team analytics: ${error.message}`);
        }
    }

    /**
     * Get task completion trends for a user over time
     * @param {string} userId - User UUID
     * @param {number} days - Number of days to look back (default: 30)
     * @returns {Object} Completion trends data
     */
    async getUserCompletionTrends(userId, days = 30) {
        try {
            const query = `
                SELECT 
                    CAST(completed_at AS DATE) as completion_date,
                    task_category,
                    COUNT(*) as tasks_completed,
                    AVG(completion_time_hours) as avg_completion_time,
                    COUNT(CASE WHEN success_status = 'completed' THEN 1 END) as successful_tasks
                FROM dbo.TaskAnalytics
                WHERE uid = @uid 
                AND completed_at IS NOT NULL
                AND completed_at >= DATEADD(day, -@days, GETDATE())
                GROUP BY CAST(completed_at AS DATE), task_category
                ORDER BY completion_date DESC, task_category
            `;
            const params = [
                { name: 'uid', type: TYPES.UniqueIdentifier, value: userId },
                { name: 'days', type: TYPES.Int, value: days }
            ];
            
            const results = await execReadCommand(query, params);
            
            return {
                user_id: userId,
                period_days: days,
                trends: results.map(row => ({
                    date: row.completion_date,
                    category: row.task_category,
                    tasks_completed: row.tasks_completed,
                    avg_completion_time_hours: row.avg_completion_time ? parseFloat(row.avg_completion_time.toFixed(2)) : 0,
                    success_rate: row.tasks_completed > 0 ? 
                        ((row.successful_tasks / row.tasks_completed) * 100).toFixed(2) : 0
                }))
            };
        } catch (error) {
            console.error('Error getting user completion trends:', error);
            throw new Error(`Failed to get completion trends: ${error.message}`);
        }
    }

    /**
     * Get workload distribution across team members
     * @param {string} groupId - Group UUID
     * @returns {Object} Workload distribution data
     */
    async getWorkloadDistribution(groupId) {
        try {
            const query = `
                SELECT
                    u.uid,
                    u.username,
                    MIN(gr.gr_name) as role_name,
                    ISNULL(wl.cnt, 0) as current_workload,
                    cap.max_cap as capacity
                FROM dbo.Users u
                INNER JOIN dbo.UserGroupRoles ugr ON u.uid = ugr.uid
                INNER JOIN dbo.GroupRoles gr ON gr.gr_id = ugr.gr_id
                LEFT JOIN (
                    -- Every assignment of an existing task: UserTask.completed is not a completion
                    -- flag (the UI sends true for "assigned") and completed tasks leave UserTask.
                    SELECT ut.uid, COUNT(*) as cnt
                    FROM dbo.UserTask ut
                    INNER JOIN dbo.Tasks t ON t.tid = ut.tid
                    GROUP BY ut.uid
                ) wl ON wl.uid = u.uid
                LEFT JOIN (
                    SELECT uid, MAX(max_concurrent_tasks) as max_cap
                    FROM dbo.UserMetrics
                    GROUP BY uid
                ) cap ON cap.uid = u.uid
                WHERE ugr.gid = @gid
                GROUP BY u.uid, u.username, wl.cnt, cap.max_cap
                ORDER BY u.username;
            `;
            const params = [
                { name: 'gid', type: TYPES.UniqueIdentifier, value: groupId }
            ];
            
            const results = await execReadCommand(query, params);
            
            return {
                group_id: groupId,
                workload_distribution: results.map(row => {
                    const capacity = row.capacity || 3; // Default capacity if null
                    const workload = row.current_workload || 0;
                    const workload_percentage = capacity > 0 ? (workload * 100.0) / capacity : 0;

                    return {
                        user_id: row.uid,
                        username: row.username,
                        current_workload: workload,
                        capacity: capacity,
                        utilization: parseFloat(workload_percentage.toFixed(2)),
                        status: this._getWorkloadStatus(workload_percentage),
                        role: row.role_name || 'N/A'
                    };
                }),
                updated_at: new Date().toISOString()
            };
        } catch (error) {
            console.error('Error getting workload distribution:', error);
            throw new Error(`Failed to get workload distribution: ${error.message}`);
        }
    }

    /**
     * Get category expertise rankings for a group
     * @param {string} groupId - Group UUID
     * @param {string} category - Task category (optional)
     * @returns {Object} Expertise rankings
     */
    async getCategoryExpertiseRankings(groupId, category = null) {
        try {
            let query = `
                SELECT 
                    u.uid,
                    u.username,
                    ue.task_category,
                    ue.expertise_score,
                    ue.tasks_completed,
                    ue.success_rate_percentage,
                    ue.avg_completion_time_hours
                FROM dbo.Users u
                JOIN dbo.UserGroups ug ON u.uid = ug.uid
                LEFT JOIN dbo.UserExpertise ue ON u.uid = ue.uid
                WHERE ug.gid = @gid
            `;
            
            const params = [
                { name: 'gid', type: TYPES.UniqueIdentifier, value: groupId }
            ];
            
            if (category) {
                query += ' AND ue.task_category = @category';
                params.push({ name: 'category', type: TYPES.VarChar, value: category });
            }
            
            query += ' ORDER BY ue.task_category, ue.expertise_score DESC';
            
            const results = await execReadCommand(query, params);
            
            // Group by category
            const expertiseByCategory = {};
            results.forEach(row => {
                const cat = row.task_category || 'no_expertise';
                if (!expertiseByCategory[cat]) {
                    expertiseByCategory[cat] = [];
                }
                
                expertiseByCategory[cat].push({
                    user_id: row.uid,
                    username: row.username,
                    expertise_score: row.expertise_score || 0,
                    tasks_completed: row.tasks_completed || 0,
                    success_rate_percentage: row.success_rate_percentage || 0,
                    avg_completion_time_hours: row.avg_completion_time_hours || 0
                });
            });
            
            return {
                group_id: groupId,
                category_filter: category,
                expertise_rankings: expertiseByCategory,
                updated_at: new Date().toISOString()
            };
        } catch (error) {
            console.error('Error getting category expertise rankings:', error);
            throw new Error(`Failed to get expertise rankings: ${error.message}`);
        }
    }

    /**
     * Batch update user metrics for all users (for scheduled jobs)
     * @returns {Object} Update results
     */
    async batchUpdateUserMetrics() {
        try {
            const results = {
                users_updated: 0,
                expertise_records_updated: 0,
                errors: []
            };

            // Get all users with recent task activity
            const activeUsersQuery = `
                SELECT DISTINCT uid 
                FROM dbo.TaskAnalytics 
                WHERE assigned_at >= DATEADD(day, -7, GETDATE())
                OR completed_at >= DATEADD(day, -7, GETDATE())
            `;
            
            const activeUsers = await execReadCommand(activeUsersQuery);

            // LEAST/GREATEST do not exist before SQL Server 2022, hence the CASEs.
            const expertiseUpdateQuery = `
                UPDATE ue SET
                    expertise_score = CASE
                        WHEN ue.tasks_completed = 0 THEN 0
                        WHEN ue.success_rate_percentage + b.bonus > 100 THEN 100
                        ELSE ue.success_rate_percentage + b.bonus
                    END,
                    last_updated = GETDATE()
                FROM dbo.UserExpertise ue
                CROSS APPLY (SELECT CASE WHEN ue.avg_completion_time_hours > 0
                                         THEN CASE WHEN 20 - ue.avg_completion_time_hours / 2 > 0
                                                   THEN 20 - ue.avg_completion_time_hours / 2 ELSE 0 END
                                         ELSE 10 END AS bonus) b
                WHERE ue.last_updated < DATEADD(hour, -1, GETDATE())
            `;

            // Daily metrics (UserMetrics table) and expertise scores (UserExpertise table) are independent — run in parallel
            const [, expertiseUpdateResult] = await Promise.all([
                Promise.all(activeUsers.map(async (user) => {
                    if (!user.uid) {
                        results.errors.push({ user_id: null, error: 'Invalid user ID' });
                        return;
                    }
                    try {
                        await this._updateDailyMetrics(user.uid);
                        results.users_updated++;
                    } catch (error) {
                        console.error(`Error updating metrics for user ${user.uid}:`, error);
                        results.errors.push({ user_id: user.uid, error: error.message });
                    }
                })),
                execWriteCommand(expertiseUpdateQuery).catch((error) => {
                    console.error('Error updating expertise scores:', error);
                    results.errors.push({ operation: 'expertise_update', error: error.message });
                    return 0;
                })
            ]);
            results.expertise_records_updated = expertiseUpdateResult ?? 0;

            return results;
        } catch (error) {
            console.error('Error in batch update user metrics:', error);
            throw new Error(`Batch update failed: ${error.message}`);
        }
    }

    /**
     * Get workload status based on percentage
     * @private
     */
    _getWorkloadStatus(workloadPercentage) {
        if (workloadPercentage >= 100) return 'overloaded';
        if (workloadPercentage >= 80) return 'high';
        if (workloadPercentage >= 50) return 'moderate';
        if (workloadPercentage > 0) return 'light';
        return 'available';
    }
}

module.exports = new AnalyticsService();
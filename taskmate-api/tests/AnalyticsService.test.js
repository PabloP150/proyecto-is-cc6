const AnalyticsService = require('../services/AnalyticsService');
const { GROUP_CAPACITY_SQL } = require('../services/analyticsContext');
const { execReadCommand, execWriteCommand } = require('../helpers/execQuery');

// Mock the database helpers
jest.mock('../helpers/execQuery');

describe('AnalyticsService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('recordTaskAssignment', () => {
        it('should record task assignment successfully', async () => {
            execWriteCommand.mockResolvedValue(1);

            const result = await AnalyticsService.recordTaskAssignment(
                'task-123',
                'user-456', 
                'group-789',
                'frontend'
            );

            expect(result.success).toBe(true);
            expect(result.task_id).toBe('task-123');
            expect(result.category).toBe('frontend');
        });

        it('should handle duplicate assignment gracefully', async () => {
            // The guarded INSERT affects 0 rows when a pending assignment already exists
            execWriteCommand.mockResolvedValueOnce(0);

            const result = await AnalyticsService.recordTaskAssignment(
                'task-123',
                'user-456', 
                'group-789',
                'frontend'
            );

            expect(result.success).toBe(true);
            expect(result.message).toBe('Assignment already recorded');
        });

        it('should validate required parameters', async () => {
            await expect(AnalyticsService.recordTaskAssignment(null, 'user-456', 'group-789'))
                .rejects.toThrow('Missing required parameters');
        });

        it('should handle invalid category gracefully', async () => {
            execWriteCommand.mockResolvedValue(1);

            const result = await AnalyticsService.recordTaskAssignment(
                'task-123',
                'user-456', 
                'group-789',
                'invalid-category'
            );

            expect(result.success).toBe(true);
            expect(result.category).toBe('general'); // Should default to general
        });

        it('should handle foreign key constraint errors', async () => {
            execWriteCommand.mockRejectedValue(new Error('FOREIGN KEY constraint failed'));

            await expect(AnalyticsService.recordTaskAssignment('task-123', 'user-456', 'group-789'))
                .rejects.toThrow('Invalid task, user, or group ID');
        });
    });

    describe('getCurrentWorkload', () => {
        it('should return current workload count', async () => {
            execReadCommand.mockResolvedValue([{ active_count: 5 }]);

            const workload = await AnalyticsService.getCurrentWorkload('user-456');

            expect(workload).toBe(5);
            expect(execReadCommand).toHaveBeenCalledWith(
                expect.stringContaining('SELECT COUNT(*) as active_count'),
                expect.arrayContaining([
                    expect.objectContaining({ name: 'uid', value: 'user-456' })
                ])
            );
        });

        it('should return 0 when no active tasks', async () => {
            execReadCommand.mockResolvedValue([{ active_count: 0 }]);

            const workload = await AnalyticsService.getCurrentWorkload('user-456');

            expect(workload).toBe(0);
        });

        it('should return 0 on database error', async () => {
            execReadCommand.mockRejectedValue(new Error('Database error'));

            const workload = await AnalyticsService.getCurrentWorkload('user-456');

            expect(workload).toBe(0);
        });
    });

    describe('getUserExpertise', () => {
        it('should return expertise data by category', async () => {
            const mockData = [
                {
                    task_category: 'frontend',
                    expertise_score: 85,
                    success_rate_percentage: 90,
                    tasks_completed: 10,
                    avg_completion_time_hours: 4.5
                },
                {
                    task_category: 'backend',
                    expertise_score: 70,
                    success_rate_percentage: 80,
                    tasks_completed: 5,
                    avg_completion_time_hours: 6.0
                }
            ];
            execReadCommand.mockResolvedValue(mockData);

            const expertise = await AnalyticsService.getUserExpertise('user-456');

            expect(expertise).toEqual({
                frontend: {
                    expertise_score: 85,
                    success_rate_percentage: 90,
                    tasks_completed: 10,
                    avg_completion_time_hours: 4.5
                },
                backend: {
                    expertise_score: 70,
                    success_rate_percentage: 80,
                    tasks_completed: 5,
                    avg_completion_time_hours: 6.0
                }
            });
        });

        it('should return empty object on database error', async () => {
            execReadCommand.mockRejectedValue(new Error('Database error'));

            const expertise = await AnalyticsService.getUserExpertise('user-456');

            expect(expertise).toEqual({});
        });
    });

    describe('getHistoricalCapacity', () => {
        it('should return maximum historical capacity', async () => {
            execReadCommand.mockResolvedValue([{ max_capacity: 8 }]);

            const capacity = await AnalyticsService.getHistoricalCapacity('user-456');

            expect(capacity).toBe(8);
        });

        it('should return default capacity when no history', async () => {
            execReadCommand.mockResolvedValue([{ max_capacity: null }]);

            const capacity = await AnalyticsService.getHistoricalCapacity('user-456');

            expect(capacity).toBe(3);
        });

        it('should return default capacity on database error', async () => {
            execReadCommand.mockRejectedValue(new Error('Database error'));

            const capacity = await AnalyticsService.getHistoricalCapacity('user-456');

            expect(capacity).toBe(3);
        });
    });

    describe('getUserAnalyticsSummary', () => {
        it('should return complete analytics summary', async () => {
            // Mock all the individual method calls
            execReadCommand
                .mockResolvedValueOnce([{ active_count: 3 }]) // getCurrentWorkload
                .mockResolvedValueOnce([{ // getUserExpertise
                    task_category: 'frontend',
                    expertise_score: 85,
                    success_rate_percentage: 90,
                    tasks_completed: 10,
                    avg_completion_time_hours: 4.5
                }])
                .mockResolvedValueOnce([{ max_capacity: 6 }]); // getHistoricalCapacity

            const summary = await AnalyticsService.getUserAnalyticsSummary('user-456');

            expect(summary).toEqual({
                current_workload: 3,
                expertise_by_category: {
                    frontend: {
                        expertise_score: 85,
                        success_rate_percentage: 90,
                        tasks_completed: 10,
                        avg_completion_time_hours: 4.5
                    }
                },
                historical_capacity: 6,
                updated_at: expect.any(String)
            });
        });
    });

    describe('recordTaskCompletion', () => {
        it('should record successful task completion', async () => {
            execReadCommand
                .mockResolvedValueOnce([{ // Verify pending facts exist
                    uid: 'user-456',
                    gid: 'group-789',
                    task_category: 'frontend',
                    assigned_at: new Date()
                }])
                .mockResolvedValueOnce([{ uid: 'user-456', task_category: 'frontend' }]) // Users of the task
                .mockResolvedValueOnce([{ active_count: 2 }]) // Current workload
                .mockResolvedValueOnce([{ concurrent_count: 3 }]); // Max concurrent

            execWriteCommand
                .mockResolvedValueOnce(1) // Main completion update
                .mockResolvedValueOnce(1) // Expertise recompute (MERGE)
                .mockResolvedValueOnce(1); // Daily metrics (MERGE)

            const result = await AnalyticsService.recordTaskCompletion('task-123', true);

            expect(result.success).toBe(true);
            expect(result.task_id).toBe('task-123');
            expect(result.status).toBe('completed');
        });

        it('should record failed task completion', async () => {
            execReadCommand
                .mockResolvedValueOnce([{ // Verify task exists
                    uid: 'user-456',
                    gid: 'group-789',
                    task_category: 'frontend',
                    assigned_at: new Date()
                }])
                .mockResolvedValueOnce([]) // No task data for metrics update
                .mockResolvedValueOnce([{ active_count: 2 }]); // Current workload

            execWriteCommand
                .mockResolvedValueOnce(1) // Main completion update
                .mockResolvedValueOnce(1); // Update daily metrics

            const result = await AnalyticsService.recordTaskCompletion('task-123', false);

            expect(result.success).toBe(true);
            expect(result.status).toBe('failed');
        });

        it('should throw error when task not found', async () => {
            execReadCommand
                .mockResolvedValueOnce([]) // No pending facts
                .mockResolvedValueOnce([]); // No closed facts either

            await expect(AnalyticsService.recordTaskCompletion('nonexistent-task'))
                .rejects.toThrow('Task nonexistent-task not found or already completed');
        });

        it('should only refresh metrics when completeTask already closed the facts', async () => {
            execReadCommand
                .mockResolvedValueOnce([]) // No pending facts
                .mockResolvedValueOnce([{ success_status: 'completed' }]) // Closed in the completeTask transaction
                .mockResolvedValueOnce([{ uid: 'user-456', task_category: 'frontend' }])
                .mockResolvedValue([{ active_count: 1, concurrent_count: 1 }]);
            execWriteCommand.mockResolvedValue(1);

            const result = await AnalyticsService.recordTaskCompletion('task-123', true);

            expect(result).toEqual(expect.objectContaining({
                success: true, task_id: 'task-123', status: 'completed', already_recorded: true
            }));
            // No UPDATE of the fact rows: only the two metric MERGEs ran
            const writes = execWriteCommand.mock.calls.map(([sql]) => sql);
            expect(writes.some(sql => /UPDATE ta\s+SET completed_at/.test(sql))).toBe(false);
            expect(writes.filter(sql => /MERGE dbo\.User(Expertise|Metrics)/.test(sql))).toHaveLength(2);
        });

        it('should handle update failure gracefully', async () => {
            execReadCommand.mockResolvedValueOnce([{ // Verify task exists
                uid: 'user-456',
                gid: 'group-789',
                task_category: 'frontend',
                assigned_at: new Date()
            }]);

            execWriteCommand.mockResolvedValueOnce(0); // No rows updated

            await expect(AnalyticsService.recordTaskCompletion('task-123'))
                .rejects.toThrow('No pending task found with ID task-123');
        });
    });
});

    describe('getTeamAnalyticsSummary', () => {
        it('should return team analytics summary', async () => {
            const mockTeamData = [
                {
                    uid: 'user-1',
                    username: 'john',
                    active_tasks: 2,
                    completed_tasks: 8,
                    failed_tasks: 1,
                    avg_completion_time: 4.5,
                    historical_capacity: 5
                },
                {
                    uid: 'user-2',
                    username: 'jane',
                    active_tasks: 1,
                    completed_tasks: 12,
                    failed_tasks: 0,
                    avg_completion_time: 3.2,
                    historical_capacity: 4
                }
            ];
            execReadCommand.mockResolvedValue(mockTeamData);

            const result = await AnalyticsService.getTeamAnalyticsSummary('group-123');

            expect(result.group_id).toBe('group-123');
            expect(result.team_members).toHaveLength(2);
            expect(result.team_members[0]).toEqual({
                user_id: 'user-1',
                username: 'john',
                active_tasks: 2,
                completed_tasks: 8,
                failed_tasks: 1,
                success_rate: '88.89',
                avg_completion_time_hours: 4.5,
                historical_capacity: 5
            });
        });

        it('should handle database errors', async () => {
            execReadCommand.mockRejectedValue(new Error('Database error'));

            await expect(AnalyticsService.getTeamAnalyticsSummary('group-123'))
                .rejects.toThrow('Failed to get team analytics');
        });

        it('takes historical_capacity from this group\'s facts (3 without history)', async () => {
            execReadCommand.mockResolvedValue([{ uid: 'user-1', username: 'john', active_tasks: 0, completed_tasks: 0, failed_tasks: 0, historical_capacity: null }]);

            const { team_members: [john] } = await AnalyticsService.getTeamAnalyticsSummary('group-123');

            expect(john.historical_capacity).toBe(3);
            const [sql] = execReadCommand.mock.calls[0];
            expect(sql).not.toMatch(/dbo\.UserMetrics/);
            expect(sql).toContain(GROUP_CAPACITY_SQL);
        });
    });

    describe('getUserCompletionTrends', () => {
        it('should return user completion trends', async () => {
            const mockTrendsData = [
                {
                    completion_date: '2025-01-15',
                    task_category: 'frontend',
                    tasks_completed: 3,
                    avg_completion_time: 4.2,
                    successful_tasks: 3
                },
                {
                    completion_date: '2025-01-14',
                    task_category: 'backend',
                    tasks_completed: 2,
                    avg_completion_time: 6.1,
                    successful_tasks: 1
                }
            ];
            execReadCommand.mockResolvedValue(mockTrendsData);

            const result = await AnalyticsService.getUserCompletionTrends('user-456', 7);

            expect(result.user_id).toBe('user-456');
            expect(result.period_days).toBe(7);
            expect(result.trends).toHaveLength(2);
            expect(result.trends[0]).toEqual({
                date: '2025-01-15',
                category: 'frontend',
                tasks_completed: 3,
                avg_completion_time_hours: 4.2,
                success_rate: '100.00'
            });
        });
    });

    describe('getWorkloadDistribution', () => {
        it('should return workload distribution', async () => {
            const mockWorkloadData = [
                {
                    uid: 'user-1',
                    username: 'john',
                    current_workload: 4,
                    capacity: 5,
                    workload_percentage: 80.0
                },
                {
                    uid: 'user-2',
                    username: 'jane',
                    current_workload: 1,
                    capacity: 4,
                    workload_percentage: 25.0
                }
            ];
            execReadCommand.mockResolvedValue(mockWorkloadData);

            const result = await AnalyticsService.getWorkloadDistribution('group-123');

            expect(result.group_id).toBe('group-123');
            expect(result.workload_distribution).toHaveLength(2);
            expect(result.workload_distribution[0]).toEqual({
                user_id: 'user-1',
                username: 'john',
                current_workload: 4,
                capacity: 5,
                utilization: 80,
                status: 'high',
                role: 'N/A',
                roles: []
            });
            expect(result.workload_distribution[1].status).toBe('light');
        });

        it('starts from the group\'s members, LEFT JOINs this group\'s roles and counts only its tasks', async () => {
            execReadCommand.mockResolvedValue([]);

            await AnalyticsService.getWorkloadDistribution('group-123');

            const [sql, params] = execReadCommand.mock.calls[0];
            expect(sql).toMatch(/FROM dbo\.UserGroups ug/);
            expect(sql).toMatch(/WHERE ug\.gid = @gid/);
            expect(sql).not.toMatch(/INNER JOIN dbo\.UserGroupRoles/);
            expect(sql).toMatch(/LEFT JOIN \(\s*SELECT ugr\.uid,[\s\S]*FROM dbo\.UserGroupRoles ugr[\s\S]*WHERE ugr\.gid = @gid/);
            expect(sql).toMatch(/gr\.gid = @gid/);
            expect(sql).toMatch(/STRING_AGG\([\s\S]*WITHIN GROUP \(ORDER BY gr\.gr_name\)/);
            expect(sql).toMatch(/INNER JOIN dbo\.Tasks t ON t\.tid = ut\.tid\s+WHERE t\.gid = @gid/);
            expect(sql).not.toMatch(/MIN\(gr\.gr_name\)/);
            expect(params).toEqual([expect.objectContaining({ name: 'gid', value: 'group-123' })]);
        });

        it('takes the capacity from this group\'s facts, not from the per-user UserMetrics', async () => {
            execReadCommand.mockResolvedValue([]);

            await AnalyticsService.getWorkloadDistribution('group-123');

            const [sql] = execReadCommand.mock.calls[0];
            expect(sql).not.toMatch(/dbo\.UserMetrics/);
            expect(sql).toContain(GROUP_CAPACITY_SQL);
            expect(sql).toMatch(/LEFT JOIN \(\s*SELECT f\.uid, MAX\(o\.open_count\) AS max_cap[\s\S]*\) cap ON cap\.uid = u\.uid/);
        });

        it('lists members without a role (roles []) and every role of the others', async () => {
            execReadCommand.mockResolvedValue([
                { uid: 'user-1', username: 'ana', roles_json: '["Backend","QA, \\"senior\\""]', current_workload: 1, capacity: 4 },
                { uid: 'user-2', username: 'beto', roles_json: null, current_workload: 0, capacity: null },
            ]);

            const { workload_distribution: [ana, beto] } = await AnalyticsService.getWorkloadDistribution('group-123');

            expect(ana).toEqual(expect.objectContaining({ roles: ['Backend', 'QA, "senior"'], role: 'Backend, QA, "senior"' }));
            expect(beto).toEqual(expect.objectContaining({
                user_id: 'user-2', roles: [], role: 'N/A', current_workload: 0, capacity: 3, status: 'available'
            }));
        });
    });

    describe('getCategoryExpertiseRankings', () => {
        it('should return expertise rankings by category', async () => {
            const mockExpertiseData = [
                {
                    uid: 'user-2',
                    username: 'jane',
                    task_category: 'frontend',
                    tasks_completed: 8,
                    success_rate_percentage: 50,
                    avg_completion_time_hours: 4
                },
                {
                    uid: 'user-1',
                    username: 'john',
                    task_category: 'frontend',
                    tasks_completed: 10,
                    success_rate_percentage: 90,
                    avg_completion_time_hours: 50
                }
            ];
            execReadCommand.mockResolvedValue(mockExpertiseData);

            const result = await AnalyticsService.getCategoryExpertiseRankings('group-123', 'frontend');

            expect(result.group_id).toBe('group-123');
            expect(result.category_filter).toBe('frontend');
            expect(result.expertise_rankings.frontend).toHaveLength(2);
            // Sorted by score: 90 + 0 (50 h leave no time bonus) beats 50 + (20 - 4/2)
            expect(result.expertise_rankings.frontend.map(e => [e.username, e.expertise_score])).toEqual([['john', 90], ['jane', 68]]);
            expect(result.expertise_rankings.frontend[0]).toEqual({
                user_id: 'user-1',
                username: 'john',
                expertise_score: 90,
                tasks_completed: 10,
                success_rate_percentage: 90,
                avg_completion_time_hours: 50
            });
            const [sql, params] = execReadCommand.mock.calls[0];
            expect(sql).toMatch(/AND s\.task_category = @category/);
            expect(params).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'category', value: 'frontend' })]));
        });

        it('reads this group\'s TaskAnalytics facts instead of the cross-group UserExpertise table', async () => {
            execReadCommand.mockResolvedValue([]);

            await AnalyticsService.getCategoryExpertiseRankings('group-123');

            const [sql, params] = execReadCommand.mock.calls[0];
            expect(sql).not.toMatch(/dbo\.UserExpertise/);
            expect(sql).toMatch(/FROM dbo\.UserGroups ug/);
            expect(sql).toMatch(/FROM dbo\.TaskAnalytics ta\s+WHERE ta\.gid = @gid/);
            expect(sql).toMatch(/success_status IN \('completed', 'failed'\)/);
            expect(sql).toMatch(/GROUP BY ta\.uid, ta\.task_category/);
            expect(sql).not.toMatch(/@category/);
            expect(params).toEqual([expect.objectContaining({ name: 'gid', value: 'group-123' })]);
        });

        it('scores like _updateUserExpertise and keeps members with no finished task in no_expertise', async () => {
            const { expertiseScore } = require('../services/analyticsContext');
            execReadCommand.mockResolvedValue([
                { uid: 'u1', username: 'a', task_category: 'backend', tasks_completed: 3, success_rate_percentage: 100, avg_completion_time_hours: 0 },
                { uid: 'u2', username: 'b', task_category: 'backend', tasks_completed: 1, success_rate_percentage: 0, avg_completion_time_hours: 0 },
                { uid: 'u3', username: 'c', task_category: 'testing', tasks_completed: 2, success_rate_percentage: 50, avg_completion_time_hours: 4 },
                { uid: 'u4', username: 'd', task_category: null, tasks_completed: null, success_rate_percentage: null, avg_completion_time_hours: null },
            ]);

            const { expertise_rankings: rankings } = await AnalyticsService.getCategoryExpertiseRankings('group-123');

            // score = min(100, success rate + bonus), bonus = avg > 0 ? max(0, 20 - avg/2) : 10
            expect(rankings.backend.map(e => e.expertise_score)).toEqual([100, 10]);
            expect(rankings.testing[0].expertise_score).toBe(68);
            expect(rankings.testing[0].expertise_score).toBe(expertiseScore({ finished: 2, successRate: 50, avgHours: 4 }));
            expect(rankings.no_expertise).toEqual([{
                user_id: 'u4', username: 'd', expertise_score: 0, tasks_completed: 0, success_rate_percentage: 0, avg_completion_time_hours: 0
            }]);
        });
    });

    describe('batchUpdateUserMetrics', () => {
        it('should update metrics for all active users', async () => {
            const mockActiveUsers = [
                { uid: 'user-1' },
                { uid: 'user-2' }
            ];
            
            execReadCommand
                .mockResolvedValueOnce(mockActiveUsers) // Active users query
                .mockResolvedValue([{ active_count: 2 }]); // Mock workload queries
            
            execWriteCommand
                .mockResolvedValue(1); // Mock all write operations

            const result = await AnalyticsService.batchUpdateUserMetrics();

            expect(result.users_updated).toBe(2);
            expect(result.expertise_records_updated).toBe(1);
            expect(result.errors).toHaveLength(0);
        });

        it('should handle individual user update errors gracefully', async () => {
            const mockActiveUsers = [
                { uid: 'user-1' },
                { uid: null } // Invalid user to trigger error
            ];
            
            execReadCommand
                .mockResolvedValueOnce(mockActiveUsers) // Active users query
                .mockResolvedValueOnce([{ active_count: 2 }]) // First user workload
                .mockResolvedValueOnce([{ concurrent_count: 2 }]); // First user concurrent
            
            execWriteCommand
                .mockResolvedValueOnce(1) // First user metrics update
                .mockResolvedValueOnce(1); // Expertise update

            const result = await AnalyticsService.batchUpdateUserMetrics();

            // First user succeeds, second fails due to invalid ID
            expect(result.users_updated).toBe(1);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0].user_id).toBe(null);
            expect(result.errors[0].error).toBe('Invalid user ID');
        });
    });

    describe('executeWithErrorHandling', () => {
        it('should execute operations successfully', async () => {
            const mockOperations = jest.fn().mockResolvedValue('success');

            const result = await AnalyticsService.executeWithErrorHandling(mockOperations);

            expect(result).toBe('success');
            expect(mockOperations).toHaveBeenCalled();
        });

        it('should handle operation errors', async () => {
            const mockOperations = jest.fn().mockRejectedValue(new Error('Operation failed'));

            await expect(AnalyticsService.executeWithErrorHandling(mockOperations))
                .rejects.toThrow('Operation failed');
        });
    });

// Test configuration
module.exports = {
    testEnvironment: 'node',
    collectCoverageFrom: [
        'services/AnalyticsService.js'
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html']
};
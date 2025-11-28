const AnalyticsService = require('../services/AnalyticsService');
const { execReadCommand, execWriteCommand } = require('../helpers/execQuery');

// Mock the database helpers
jest.mock('../helpers/execQuery');
jest.mock('../helpers/getConnection');

describe('AnalyticsService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('recordTaskAssignment', () => {
        it('should record task assignment successfully', async () => {
            execReadCommand.mockResolvedValueOnce([]); // No existing assignment
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
            execReadCommand.mockResolvedValueOnce([{ id: 'existing-id' }]); // Existing assignment

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
            execReadCommand.mockResolvedValueOnce([]); // No existing assignment
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
            execReadCommand.mockResolvedValueOnce([]); // No existing assignment
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
                .mockResolvedValueOnce([{ // Verify task exists
                    uid: 'user-456',
                    gid: 'group-789',
                    task_category: 'frontend',
                    assigned_at: new Date()
                }])
                .mockResolvedValueOnce([{ // Task data for _updateUserMetrics
                    uid: 'user-456',
                    gid: 'group-789',
                    task_category: 'frontend',
                    completion_time_hours: 4,
                    success_status: 'completed'
                }])
                .mockResolvedValueOnce([]) // No existing expertise record
                .mockResolvedValueOnce([{ active_count: 2 }]) // Current workload
                .mockResolvedValueOnce([{ concurrent_count: 3 }]); // Max concurrent

            execWriteCommand
                .mockResolvedValueOnce(1) // Main completion update
                .mockResolvedValueOnce(1) // Insert new expertise
                .mockResolvedValueOnce(1); // Update daily metrics

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
            execReadCommand.mockResolvedValueOnce([]); // No task found

            await expect(AnalyticsService.recordTaskCompletion('nonexistent-task'))
                .rejects.toThrow('Task nonexistent-task not found or already completed');
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
                workload_percentage: 80.0,
                status: 'high'
            });
            expect(result.workload_distribution[1].status).toBe('light');
        });
    });

    describe('getCategoryExpertiseRankings', () => {
        it('should return expertise rankings by category', async () => {
            const mockExpertiseData = [
                {
                    uid: 'user-1',
                    username: 'john',
                    task_category: 'frontend',
                    expertise_score: 85,
                    tasks_completed: 10,
                    success_rate_percentage: 90,
                    avg_completion_time_hours: 4.5
                },
                {
                    uid: 'user-2',
                    username: 'jane',
                    task_category: 'frontend',
                    expertise_score: 75,
                    tasks_completed: 8,
                    success_rate_percentage: 87.5,
                    avg_completion_time_hours: 5.2
                }
            ];
            execReadCommand.mockResolvedValue(mockExpertiseData);

            const result = await AnalyticsService.getCategoryExpertiseRankings('group-123', 'frontend');

            expect(result.group_id).toBe('group-123');
            expect(result.category_filter).toBe('frontend');
            expect(result.expertise_rankings.frontend).toHaveLength(2);
            expect(result.expertise_rankings.frontend[0].expertise_score).toBe(85);
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
/**
 * Integration test for AnalyticsService
 * This test requires a test database with the analytics tables created
 * Run this after setting up the analytics schema
 */

const AnalyticsService = require('../../services/AnalyticsService');
const { v4: uuidv4 } = require('uuid');

describe('AnalyticsService Integration Tests', () => {
    // Test data
    const testUserId = uuidv4();
    const testGroupId = uuidv4();
    const testTaskId = uuidv4();

    // Skip these tests if not in integration test environment
    const isIntegrationTest = process.env.NODE_ENV === 'integration-test';

    beforeAll(() => {
        if (!isIntegrationTest) {
            console.log('Skipping integration tests. Set NODE_ENV=integration-test to run.');
        }
    });

    describe('Task Assignment Recording', () => {
        it('should record and retrieve task assignment', async () => {
            if (!isIntegrationTest) return;

            // Record task assignment
            const assignmentResult = await AnalyticsService.recordTaskAssignment(
                testTaskId,
                testUserId,
                testGroupId,
                'frontend'
            );

            expect(assignmentResult.success).toBe(true);

            // Verify workload increased
            const workload = await AnalyticsService.getCurrentWorkload(testUserId);
            expect(workload).toBeGreaterThan(0);
        });

        it('should handle task completion flow', async () => {
            if (!isIntegrationTest) return;

            // Complete the task
            const completionResult = await AnalyticsService.recordTaskCompletion(testTaskId, true);
            expect(completionResult.success).toBe(true);

            // Check that expertise was updated
            const expertise = await AnalyticsService.getUserExpertise(testUserId);
            expect(expertise.frontend).toBeDefined();
            expect(expertise.frontend.tasks_completed).toBeGreaterThan(0);
        });

        it('should provide complete analytics summary', async () => {
            if (!isIntegrationTest) return;

            const summary = await AnalyticsService.getUserAnalyticsSummary(testUserId);

            expect(summary).toHaveProperty('current_workload');
            expect(summary).toHaveProperty('expertise_by_category');
            expect(summary).toHaveProperty('historical_capacity');
            expect(summary).toHaveProperty('updated_at');
        });
    });

    describe('Error Handling', () => {
        it('should handle invalid UUIDs gracefully', async () => {
            if (!isIntegrationTest) return;

            await expect(
                AnalyticsService.recordTaskAssignment('invalid-uuid', testUserId, testGroupId)
            ).rejects.toThrow();
        });

        it('should return defaults for non-existent users', async () => {
            if (!isIntegrationTest) return;

            const nonExistentUserId = uuidv4();
            
            const workload = await AnalyticsService.getCurrentWorkload(nonExistentUserId);
            expect(workload).toBe(0);

            const expertise = await AnalyticsService.getUserExpertise(nonExistentUserId);
            expect(expertise).toEqual({});

            const capacity = await AnalyticsService.getHistoricalCapacity(nonExistentUserId);
            expect(capacity).toBe(3); // Default capacity
        });
    });
});

// Instructions for running integration tests:
/*
To run integration tests:

1. Set up test database with analytics tables
2. Configure test database connection
3. Run: NODE_ENV=integration-test npm test -- --testPathPattern=integration

Example test database setup:
- Create test database
- Run analytics migration script
- Insert test users, groups, and tasks
- Set connection string in test environment
*/
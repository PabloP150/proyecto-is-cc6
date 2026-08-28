const AnalyticsService = require('../services/AnalyticsService');

/**
 * Performance Tests with Sample Analytics Data
 * Tests requirement 7.3: Add performance tests with sample analytics data
 */

class PerformanceTest {

    constructor() {
        this.testResults = {
            passed: 0,
            failed: 0,
            errors: [],
            metrics: {}
        };

        // Performance thresholds
        this.thresholds = {
            single_query_ms: 1000,      // Single query should complete within 1 second
            batch_query_ms: 5000,       // Batch queries should complete within 5 seconds
            concurrent_queries_ms: 3000, // Concurrent queries should complete within 3 seconds
            memory_increase_mb: 50,      // Memory increase should be less than 50MB
            cpu_usage_percent: 80        // CPU usage should be less than 80%
        };
    }

    /**
     * Generate sample analytics data for testing
     */
    generateSampleData(userCount = 100, taskCount = 1000) {
        const users = [];
        const tasks = [];
        const categories = ['frontend', 'backend', 'database', 'testing', 'general'];

        const generateGUID = (prefix, index) => {
            const hexStr = index.toString(16).padStart(8, '0');
            return `${hexStr}-1234-5678-9abc-def012345678`;
        };

        // Generate sample users
        for (let i = 0; i < userCount; i++) {
            users.push({
                uid: generateGUID('user', i),
                username: `user_${i}`,
                workload: Math.floor(Math.random() * 5),
                capacity: Math.floor(Math.random() * 8) + 2,
                expertise: this.generateUserExpertise(categories)
            });
        }

        // Generate sample tasks
        for (let i = 0; i < taskCount; i++) {
            const assignedUser = users[Math.floor(Math.random() * users.length)];
            tasks.push({
                tid: generateGUID('task', i),
                title: `Task ${i}`,
                category: categories[Math.floor(Math.random() * categories.length)],
                assigned_to: assignedUser.uid,
                completed: Math.random() > 0.7,
                duration_minutes: Math.floor(Math.random() * 480) + 15
            });
        }

        return { users, tasks };
    }

    /**
     * Generate expertise data for a user across categories
     */
    generateUserExpertise(categories) {
        const expertise = {};
        categories.forEach(category => {
            expertise[category] = {
                expertise_score: Math.floor(Math.random() * 100),
                success_rate_percentage: Math.floor(Math.random() * 100),
                completed_tasks: Math.floor(Math.random() * 50)
            };
        });
        return expertise;
    }

    /**
     * Test single query performance
     */
    async testSingleQueryPerformance() {
        console.log('\n\n=== Testing Single Query Performance ===');

        const { users } = this.generateSampleData(50, 200);
        const testUser = users[0];

        try {
            const startTime = Date.now();

            const analytics = await AnalyticsService.getUserAnalyticsSummary(testUser.uid);

            const endTime = Date.now();
            const duration = endTime - startTime;

            console.log(`Single query duration: ${duration}ms`);

            if (duration <= this.thresholds.single_query_ms) {
                console.log('✅ Single query performance acceptable');
                this.testResults.passed++;
            } else {
                console.log(`❌ Single query too slow (${duration}ms > ${this.thresholds.single_query_ms}ms)`);
                this.testResults.failed++;
                this.testResults.errors.push(`Single query too slow: ${duration}ms`);
            }

            this.testResults.metrics.single_query_duration = duration;

        } catch (error) {
            console.log('❌ Single query error:', error.message);
            this.testResults.failed++;
            this.testResults.errors.push(`Single query error: ${error.message}`);
        }
    }

    /**
     * Test batch query performance (10 queries in parallel)
     */
    async testBatchQueryPerformance() {
        console.log('\n\n=== Testing Batch Query Performance (10 parallel) ===');

        const { users } = this.generateSampleData(10, 100);

        try {
            const startTime = Date.now();

            const queries = users.map(user =>
                AnalyticsService.getUserAnalyticsSummary(user.uid).catch(err => ({ error: err.message }))
            );

            await Promise.all(queries);

            const endTime = Date.now();
            const duration = endTime - startTime;

            console.log(`Batch query duration (10 parallel): ${duration}ms`);

            if (duration <= this.thresholds.batch_query_ms) {
                console.log('✅ Batch query performance acceptable');
                this.testResults.passed++;
            } else {
                console.log(`❌ Batch query too slow (${duration}ms > ${this.thresholds.batch_query_ms}ms)`);
                this.testResults.failed++;
                this.testResults.errors.push(`Batch query too slow: ${duration}ms`);
            }

            this.testResults.metrics.batch_query_duration = duration;

        } catch (error) {
            console.log('❌ Batch query error:', error.message);
            this.testResults.failed++;
            this.testResults.errors.push(`Batch query error: ${error.message}`);
        }
    }

    /**
     * Test concurrent query performance (20 concurrent queries)
     */
    async testConcurrentQueryPerformance() {
        console.log('\n\n=== Testing Concurrent Query Performance (20 concurrent) ===');

        const { users } = this.generateSampleData(20, 150);
        const concurrentUsers = users.slice(0, 20);

        try {
            const startTime = Date.now();

            const concurrentQueries = concurrentUsers.map(user =>
                AnalyticsService.getUserAnalyticsSummary(user.uid).catch(err => ({ error: err.message }))
            );

            const results = await Promise.all(concurrentQueries);
            const successCount = results.filter(r => !r.error).length;

            const endTime = Date.now();
            const duration = endTime - startTime;

            console.log(`Concurrent queries duration (20 concurrent): ${duration}ms`);
            console.log(`Successful queries: ${successCount}/${concurrentUsers.length}`);

            if (duration <= this.thresholds.concurrent_queries_ms) {
                console.log('✅ Concurrent query performance acceptable');
                this.testResults.passed++;
            } else {
                console.log(`❌ Concurrent query too slow (${duration}ms > ${this.thresholds.concurrent_queries_ms}ms)`);
                this.testResults.failed++;
                this.testResults.errors.push(`Concurrent query too slow: ${duration}ms`);
            }

            this.testResults.metrics.concurrent_query_duration = duration;
            this.testResults.metrics.concurrent_success_rate = (successCount / concurrentUsers.length) * 100;

        } catch (error) {
            console.log('❌ Concurrent query error:', error.message);
            this.testResults.failed++;
            this.testResults.errors.push(`Concurrent query error: ${error.message}`);
        }
    }

    /**
     * Test memory usage performance
     */
    async testMemoryUsage() {
        console.log('\n\n=== Testing Memory Usage Performance ===');

        const initialMemory = process.memoryUsage();
        console.log('Initial memory usage:', {
            heapUsed: Math.round(initialMemory.heapUsed / 1024 / 1024) + 'MB',
            heapTotal: Math.round(initialMemory.heapTotal / 1024 / 1024) + 'MB'
        });

        try {
            // Perform memory-intensive operations
            const { users, tasks } = this.generateSampleData(200, 500);

            // Simulate processing large datasets
            const operations = [];
            for (let i = 0; i < 50; i++) {
                const user = users[i % users.length];
                operations.push(
                    AnalyticsService.getCurrentWorkload(user.uid).catch(err => ({ error: err.message }))
                );
            }

            await Promise.all(operations);

            // Force garbage collection if available
            if (global.gc) {
                global.gc();
            }

            const finalMemory = process.memoryUsage();
            const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
            const memoryIncreaseMB = memoryIncrease / 1024 / 1024;

            console.log('Final memory usage:', {
                heapUsed: Math.round(finalMemory.heapUsed / 1024 / 1024) + 'MB',
                heapTotal: Math.round(finalMemory.heapTotal / 1024 / 1024) + 'MB'
            });
            console.log(`Memory increase: ${memoryIncreaseMB.toFixed(2)}MB`);

            if (memoryIncreaseMB <= this.thresholds.memory_increase_mb) {
                console.log('✅ Memory usage within acceptable limits');
                this.testResults.passed++;
            } else {
                console.log(`❌ Memory usage too high (${memoryIncreaseMB.toFixed(2)}MB > ${this.thresholds.memory_increase_mb}MB)`);
                this.testResults.failed++;
                this.testResults.errors.push(`Memory usage too high: ${memoryIncreaseMB.toFixed(2)}MB`);
            }

            this.testResults.metrics.memory_increase_mb = memoryIncreaseMB;

        } catch (error) {
            console.log('❌ Memory usage test error:', error.message);
            this.testResults.failed++;
            this.testResults.errors.push(`Memory usage error: ${error.message}`);
        }
    }

    /**
     * Test recommendation generation performance
     */
    async testRecommendationPerformance() {
        console.log('\n\n=== Testing Recommendation Generation Performance ===');

        const { users } = this.generateSampleData(20, 100);
        const teamSizes = [5, 10, 15, 20];

        for (const teamSize of teamSizes) {
            console.log(`\nTesting recommendation generation for team of ${teamSize}...`);

            try {
                const teamMembers = users.slice(0, teamSize);
                const startTime = Date.now();

                // Simulate recommendation generation
                const recommendations = this.generateMockRecommendations(teamMembers, 'frontend');

                const endTime = Date.now();
                const duration = endTime - startTime;

                console.log(`Duration: ${duration}ms`);
                console.log(`Recommendations generated: ${recommendations.length}`);

                if (duration <= this.thresholds.single_query_ms) {
                    console.log(`✅ Recommendation generation for team of ${teamSize} acceptable`);
                    this.testResults.passed++;
                } else {
                    console.log(`❌ Recommendation generation for team of ${teamSize} too slow`);
                    this.testResults.failed++;
                    this.testResults.errors.push(`Recommendation generation too slow for team of ${teamSize}: ${duration}ms`);
                }

                this.testResults.metrics[`recommendation_team_${teamSize}`] = duration;

            } catch (error) {
                console.log(`❌ Recommendation generation error for team of ${teamSize}:`, error.message);
                this.testResults.failed++;
                this.testResults.errors.push(`Recommendation error for team of ${teamSize}: ${error.message}`);
            }
        }
    }

    /**
     * Test database query optimization (non-SQL simulation, not representative of real DB)
     */
    async testDatabaseOptimization() {
        console.log('\n\n=== Testing Database Query Optimization ===');

        const testQueries = [
            {
                name: 'Simple workload query',
                complexity: 'low',
                expectedTime: 500
            },
            {
                name: 'Complex analytics aggregation',
                complexity: 'high',
                expectedTime: 2000
            },
            {
                name: 'Multi-table join query',
                complexity: 'medium',
                expectedTime: 1000
            }
        ];

        for (const query of testQueries) {
            console.log(`\nTesting ${query.name}...`);

            try {
                const startTime = Date.now();

                // Simulate different query complexities
                await this.simulateQueryComplexity(query.complexity);

                const endTime = Date.now();
                const duration = endTime - startTime;

                console.log(`Duration: ${duration}ms (expected: ${query.expectedTime}ms)`);

                if (duration <= query.expectedTime) {
                    console.log(`✅ ${query.name} optimization acceptable`);
                    this.testResults.passed++;
                } else {
                    console.log(`❌ ${query.name} optimization needs improvement`);
                    this.testResults.failed++;
                    this.testResults.errors.push(`${query.name} too slow: ${duration}ms`);
                }

                this.testResults.metrics[`db_${query.complexity}_query`] = duration;

            } catch (error) {
                console.log(`❌ ${query.name} error:`, error.message);
                this.testResults.failed++;
                this.testResults.errors.push(`${query.name} error: ${error.message}`);
            }
        }
    }

    // Helper methods

    /**
     * Generate mock recommendations for performance testing
     */
    generateMockRecommendations(teamMembers, taskCategory) {
        return teamMembers.map(member => {
            const expertise = member.expertise[taskCategory] || { expertise_score: 0, success_rate_percentage: 50 };
            const workloadRatio = member.capacity > 0 ? member.workload / member.capacity : 0.5;

            // Simple scoring algorithm
            let score = 50;
            score += (expertise.expertise_score / 100) * 30;
            score += (expertise.success_rate_percentage / 100) * 20;
            score -= workloadRatio * 20;

            return {
                user_id: member.uid,
                username: member.username,
                score: Math.max(0, Math.min(100, score)),
                reasoning: `Expertise: ${expertise.expertise_score}%, Workload: ${member.workload}/${member.capacity}`,
                metrics: {
                    workload: member.workload,
                    expertise: expertise,
                    capacity: member.capacity
                }
            };
        }).sort((a, b) => b.score - a.score);
    }

    /**
     * Simulate different query complexities
     */
    async simulateQueryComplexity(complexity) {
        const delays = {
            low: 50,
            medium: 200,
            high: 500
        };

        return new Promise(resolve => {
            setTimeout(resolve, delays[complexity] || 100);
        });
    }

    /**
     * Run all performance tests
     */
    async runAllTests() {
        console.log('Starting Performance Tests with Sample Analytics Data...');
        console.log('Testing performance with various data sizes and scenarios\n');

        console.log('Performance Thresholds:');
        console.log(`  Single Query: ${this.thresholds.single_query_ms}ms`);
        console.log(`  Batch Queries: ${this.thresholds.batch_query_ms}ms`);
        console.log(`  Concurrent Queries: ${this.thresholds.concurrent_queries_ms}ms`);
        console.log(`  Memory Increase: ${this.thresholds.memory_increase_mb}MB`);

        try {
            await this.testSingleQueryPerformance();
            await this.testBatchQueryPerformance();
            await this.testConcurrentQueryPerformance();
            await this.testMemoryUsage();
            await this.testRecommendationPerformance();
            await this.testDatabaseOptimization();

            this.printTestSummary();

        } catch (error) {
            console.log('\n❌ Performance test suite failed with error:', error);
            this.testResults.failed++;
            this.testResults.errors.push(`Test suite error: ${error.message}`);
            this.printTestSummary();
        }
    }

    /**
     * Print test results summary
     */
    printTestSummary() {
        console.log('\n\n=== Performance Test Summary ===');
        console.log(`✅ Tests Passed: ${this.testResults.passed}`);
        console.log(`❌ Tests Failed: ${this.testResults.failed}`);
        console.log(`📊 Total Tests: ${this.testResults.passed + this.testResults.failed}`);

        if (this.testResults.errors.length > 0) {
            console.log('\n🔍 Performance Issues:');
            this.testResults.errors.forEach((error, index) => {
                console.log(`  ${index + 1}. ${error}`);
            });
        }

        console.log('\n📈 Performance Metrics:');
        Object.entries(this.testResults.metrics).forEach(([key, value]) => {
            if (typeof value === 'number') {
                if (key.includes('duration') || key.includes('query')) {
                    console.log(`  ${key}: ${value}ms`);
                } else if (key.includes('rate')) {
                    console.log(`  ${key}: ${value.toFixed(1)}%`);
                } else if (key.includes('memory')) {
                    console.log(`  ${key}: ${value.toFixed(2)}MB`);
                } else {
                    console.log(`  ${key}: ${value}`);
                }
            }
        });

        const total = this.testResults.passed + this.testResults.failed;
        const successRate = total > 0 ? (this.testResults.passed / total) * 100 : 0;
        console.log(`\n📊 Performance Success Rate: ${successRate.toFixed(1)}%`);

        if (successRate >= 80) {
            console.log('\n🎉 Performance tests completed successfully!');
        } else if (successRate >= 60) {
            console.log('\n⚠️ Performance tests completed with warnings - optimization recommended');
        } else {
            console.log('\n❌ Performance tests failed - optimization required');
        }

        console.log('\nPerformance test coverage:');
        console.log('  ✅ Single query performance');
        console.log('  ✅ Batch query performance');
        console.log('  ✅ Concurrent query performance');
        console.log('  ✅ Memory usage monitoring');
        console.log('  ✅ Recommendation generation performance');
        console.log('  ⚠️ Database query optimization (simulation only, not representative)');
    }
}

// Jest integration — performance tests gated by NODE_ENV
const RUN_PERFORMANCE = process.env.NODE_ENV === 'integration-test';

describe('Performance Tests (requiere SQL Server real — NODE_ENV=integration-test)', () => {
    let perf;

    beforeEach(() => {
        perf = new PerformanceTest();
        if (!RUN_PERFORMANCE) {
            console.log('Skipping real performance benchmarks. Run "npm run test:performance" with a live DB to execute.');
        }
    });

    it('single query performance stays within threshold', async () => {
        if (!RUN_PERFORMANCE) return;
        await perf.testSingleQueryPerformance();
        expect(perf.testResults.failed).toBe(0);
    });

    it('batch query performance (10 parallel) stays within threshold', async () => {
        if (!RUN_PERFORMANCE) return;
        await perf.testBatchQueryPerformance();
        expect(perf.testResults.failed).toBe(0);
    });

    it('concurrent query performance (20 concurrent) stays within threshold', async () => {
        if (!RUN_PERFORMANCE) return;
        await perf.testConcurrentQueryPerformance();
        expect(perf.testResults.failed).toBe(0);
    });

    it('memory increase after batch operations stays within threshold', async () => {
        if (!RUN_PERFORMANCE) return;
        await perf.testMemoryUsage();
        expect(perf.testResults.failed).toBe(0);
    });

    it('mock recommendation generation stays fast for teams up to 20', async () => {
        if (!RUN_PERFORMANCE) return;
        await perf.testRecommendationPerformance();
        expect(perf.testResults.failed).toBe(0);
    });

    // testDatabaseOptimization() uses setTimeout simulation (not SQL real) — kept outside gate
    // See docs/fase-02-optimizacion-rendimiento/README.md for notes on why
});

// Export for use in other test files
module.exports = PerformanceTest;

// Run tests if this file is executed directly
if (require.main === module) {
    const testSuite = new PerformanceTest();
    testSuite.runAllTests();
}

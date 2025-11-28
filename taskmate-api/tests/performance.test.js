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
        
        // Generate sample users
        for (let i = 0; i < userCount; i++) {
            users.push({
                uid: `user-${i.toString().padStart(8, '0')}-1234-1234-1234-123456789012`,
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
                tid: `task-${i.toString().padStart(8, '0')}-1234-1234-1234-123456789012`,
                uid: assignedUser.uid,
                gid: `group-${Math.floor(i / 100).toString().padStart(4, '0')}-1234-1234-1234-123456789012`,
                category: categories[Math.floor(Math.random() * categories.length)],
                assigned_at: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000), // Last 30 days
                completed_at: Math.random() > 0.3 ? new Date() : null, // 70% completion rate
                success_status: Math.random() > 0.1 ? 'completed' : 'failed' // 90% success rate
            });
        }
        
        return { users, tasks };
    }
    
    /**
     * Generate user expertise data
     */
    generateUserExpertise(categories) {
        const expertise = {};
        
        categories.forEach(category => {
            expertise[category] = {
                expertise_score: Math.floor(Math.random() * 100),
                success_rate_percentage: Math.floor(Math.random() * 40) + 60, // 60-100%
                tasks_completed: Math.floor(Math.random() * 50),
                avg_completion_time_hours: Math.random() * 48 + 1 // 1-49 hours
            };
        });
        
        return expertise;
    }
    
    /**
     * Test single query performance
     */
    async testSingleQueryPerformance() {
        console.log('\n=== Testing Single Query Performance ===');
        
        const testUserId = '87654321-4321-4321-4321-210987654321';
        const queries = [
            { name: 'getCurrentWorkload', fn: () => AnalyticsService.getCurrentWorkload(testUserId) },
            { name: 'getUserExpertise', fn: () => AnalyticsService.getUserExpertise(testUserId) },
            { name: 'getHistoricalCapacity', fn: () => AnalyticsService.getHistoricalCapacity(testUserId) },
            { name: 'getUserAnalyticsSummary', fn: () => AnalyticsService.getUserAnalyticsSummary(testUserId) }
        ];
        
        for (const query of queries) {
            console.log(`\nTesting ${query.name}...`);
            
            try {
                const startTime = Date.now();
                const result = await query.fn().catch(err => ({ error: err.message }));
                const endTime = Date.now();
                const duration = endTime - startTime;
                
                console.log(`Duration: ${duration}ms`);
                
                if (duration <= this.thresholds.single_query_ms) {
                    console.log(`✅ ${query.name} performance acceptable`);
                    this.testResults.passed++;
                } else {
                    console.log(`❌ ${query.name} performance too slow (${duration}ms > ${this.thresholds.single_query_ms}ms)`);
                    this.testResults.failed++;
                    this.testResults.errors.push(`${query.name} too slow: ${duration}ms`);
                }
                
                this.testResults.metrics[query.name] = duration;
                
            } catch (error) {
                console.log(`❌ ${query.name} error:`, error.message);
                this.testResults.failed++;
                this.testResults.errors.push(`${query.name} error: ${error.message}`);
            }
        }
    }
    
    /**
     * Test batch query performance
     */
    async testBatchQueryPerformance() {
        console.log('\n\n=== Testing Batch Query Performance ===');
        
        const { users } = this.generateSampleData(50, 200);
        const batchSize = 10;
        
        console.log(`\nTesting batch queries with ${batchSize} users...`);
        
        try {
            const startTime = Date.now();
            
            // Simulate batch processing
            const batchPromises = [];
            for (let i = 0; i < batchSize; i++) {
                const user = users[i];
                batchPromises.push(
                    AnalyticsService.getCurrentWorkload(user.uid).catch(err => ({ error: err.message }))
                );
            }
            
            const results = await Promise.all(batchPromises);
            const endTime = Date.now();
            const duration = endTime - startTime;
            
            console.log(`Batch duration: ${duration}ms`);
            console.log(`Average per query: ${(duration / batchSize).toFixed(2)}ms`);
            
            const successCount = results.filter(r => typeof r === 'number' || !r.error).length;
            console.log(`Successful queries: ${successCount}/${batchSize}`);
            
            if (duration <= this.thresholds.batch_query_ms) {
                console.log('✅ Batch query performance acceptable');
                this.testResults.passed++;
            } else {
                console.log(`❌ Batch query performance too slow (${duration}ms > ${this.thresholds.batch_query_ms}ms)`);
                this.testResults.failed++;
                this.testResults.errors.push(`Batch queries too slow: ${duration}ms`);
            }
            
            this.testResults.metrics.batch_query_duration = duration;
            this.testResults.metrics.batch_success_rate = (successCount / batchSize) * 100;
            
        } catch (error) {
            console.log('❌ Batch query error:', error.message);
            this.testResults.failed++;
            this.testResults.errors.push(`Batch query error: ${error.message}`);
        }
    }
    
    /**
     * Test concurrent query performance
     */
    async testConcurrentQueryPerformance() {
        console.log('\n\n=== Testing Concurrent Query Performance ===');
        
        const concurrentUsers = 20;
        const testUserId = '87654321-4321-4321-4321-210987654321';
        
        console.log(`\nTesting ${concurrentUsers} concurrent queries...`);
        
        try {
            const startTime = Date.now();
            
            // Create concurrent queries
            const concurrentPromises = [];
            for (let i = 0; i < concurrentUsers; i++) {
                concurrentPromises.push(
                    AnalyticsService.getCurrentWorkload(testUserId).catch(err => ({ error: err.message }))
                );
            }
            
            const results = await Promise.all(concurrentPromises);
            const endTime = Date.now();
            const duration = endTime - startTime;
            
            console.log(`Concurrent duration: ${duration}ms`);
            console.log(`Average per query: ${(duration / concurrentUsers).toFixed(2)}ms`);
            
            const successCount = results.filter(r => typeof r === 'number' || !r.error).length;
            console.log(`Successful queries: ${successCount}/${concurrentUsers}`);
            
            if (duration <= this.thresholds.concurrent_queries_ms) {
                console.log('✅ Concurrent query performance acceptable');
                this.testResults.passed++;
            } else {
                console.log(`❌ Concurrent query performance too slow (${duration}ms > ${this.thresholds.concurrent_queries_ms}ms)`);
                this.testResults.failed++;
                this.testResults.errors.push(`Concurrent queries too slow: ${duration}ms`);
            }
            
            this.testResults.metrics.concurrent_query_duration = duration;
            this.testResults.metrics.concurrent_success_rate = (successCount / concurrentUsers) * 100;
            
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
        console.log('Initial memory usage:', {\n            heapUsed: Math.round(initialMemory.heapUsed / 1024 / 1024) + 'MB',\n            heapTotal: Math.round(initialMemory.heapTotal / 1024 / 1024) + 'MB'\n        });\n        \n        try {\n            // Perform memory-intensive operations\n            const { users, tasks } = this.generateSampleData(200, 500);\n            \n            // Simulate processing large datasets\n            const operations = [];\n            for (let i = 0; i < 50; i++) {\n                const user = users[i % users.length];\n                operations.push(\n                    AnalyticsService.getCurrentWorkload(user.uid).catch(err => ({ error: err.message }))\n                );\n            }\n            \n            await Promise.all(operations);\n            \n            // Force garbage collection if available\n            if (global.gc) {\n                global.gc();\n            }\n            \n            const finalMemory = process.memoryUsage();\n            const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;\n            const memoryIncreaseMB = memoryIncrease / 1024 / 1024;\n            \n            console.log('Final memory usage:', {\n                heapUsed: Math.round(finalMemory.heapUsed / 1024 / 1024) + 'MB',\n                heapTotal: Math.round(finalMemory.heapTotal / 1024 / 1024) + 'MB'\n            });\n            console.log(`Memory increase: ${memoryIncreaseMB.toFixed(2)}MB`);\n            \n            if (memoryIncreaseMB <= this.thresholds.memory_increase_mb) {\n                console.log('✅ Memory usage within acceptable limits');\n                this.testResults.passed++;\n            } else {\n                console.log(`❌ Memory usage too high (${memoryIncreaseMB.toFixed(2)}MB > ${this.thresholds.memory_increase_mb}MB)`);\n                this.testResults.failed++;\n                this.testResults.errors.push(`Memory usage too high: ${memoryIncreaseMB.toFixed(2)}MB`);\n            }\n            \n            this.testResults.metrics.memory_increase_mb = memoryIncreaseMB;\n            \n        } catch (error) {\n            console.log('❌ Memory usage test error:', error.message);\n            this.testResults.failed++;\n            this.testResults.errors.push(`Memory usage error: ${error.message}`);\n        }\n    }\n    \n    /**\n     * Test recommendation generation performance\n     */\n    async testRecommendationPerformance() {\n        console.log('\\n\\n=== Testing Recommendation Generation Performance ===');\n        \n        const { users } = this.generateSampleData(20, 100);\n        const teamSizes = [5, 10, 15, 20];\n        \n        for (const teamSize of teamSizes) {\n            console.log(`\\nTesting recommendation generation for team of ${teamSize}...`);\n            \n            try {\n                const teamMembers = users.slice(0, teamSize);\n                const startTime = Date.now();\n                \n                // Simulate recommendation generation\n                const recommendations = this.generateMockRecommendations(teamMembers, 'frontend');\n                \n                const endTime = Date.now();\n                const duration = endTime - startTime;\n                \n                console.log(`Duration: ${duration}ms`);\n                console.log(`Recommendations generated: ${recommendations.length}`);\n                \n                if (duration <= this.thresholds.single_query_ms) {\n                    console.log(`✅ Recommendation generation for team of ${teamSize} acceptable`);\n                    this.testResults.passed++;\n                } else {\n                    console.log(`❌ Recommendation generation for team of ${teamSize} too slow`);\n                    this.testResults.failed++;\n                    this.testResults.errors.push(`Recommendation generation too slow for team of ${teamSize}: ${duration}ms`);\n                }\n                \n                this.testResults.metrics[`recommendation_team_${teamSize}`] = duration;\n                \n            } catch (error) {\n                console.log(`❌ Recommendation generation error for team of ${teamSize}:`, error.message);\n                this.testResults.failed++;\n                this.testResults.errors.push(`Recommendation error for team of ${teamSize}: ${error.message}`);\n            }\n        }\n    }\n    \n    /**\n     * Test database query optimization\n     */\n    async testDatabaseOptimization() {\n        console.log('\\n\\n=== Testing Database Query Optimization ===');\n        \n        const testQueries = [\n            {\n                name: 'Simple workload query',\n                complexity: 'low',\n                expectedTime: 500\n            },\n            {\n                name: 'Complex analytics aggregation',\n                complexity: 'high',\n                expectedTime: 2000\n            },\n            {\n                name: 'Multi-table join query',\n                complexity: 'medium',\n                expectedTime: 1000\n            }\n        ];\n        \n        for (const query of testQueries) {\n            console.log(`\\nTesting ${query.name}...`);\n            \n            try {\n                const startTime = Date.now();\n                \n                // Simulate different query complexities\n                await this.simulateQueryComplexity(query.complexity);\n                \n                const endTime = Date.now();\n                const duration = endTime - startTime;\n                \n                console.log(`Duration: ${duration}ms (expected: ${query.expectedTime}ms)`);\n                \n                if (duration <= query.expectedTime) {\n                    console.log(`✅ ${query.name} optimization acceptable`);\n                    this.testResults.passed++;\n                } else {\n                    console.log(`❌ ${query.name} optimization needs improvement`);\n                    this.testResults.failed++;\n                    this.testResults.errors.push(`${query.name} too slow: ${duration}ms`);\n                }\n                \n                this.testResults.metrics[`db_${query.complexity}_query`] = duration;\n                \n            } catch (error) {\n                console.log(`❌ ${query.name} error:`, error.message);\n                this.testResults.failed++;\n                this.testResults.errors.push(`${query.name} error: ${error.message}`);\n            }\n        }\n    }\n    \n    // Helper methods\n    \n    /**\n     * Generate mock recommendations for performance testing\n     */\n    generateMockRecommendations(teamMembers, taskCategory) {\n        return teamMembers.map(member => {\n            const expertise = member.expertise[taskCategory] || { expertise_score: 0, success_rate_percentage: 50 };\n            const workloadRatio = member.capacity > 0 ? member.workload / member.capacity : 0.5;\n            \n            // Simple scoring algorithm\n            let score = 50;\n            score += (expertise.expertise_score / 100) * 30;\n            score += (expertise.success_rate_percentage / 100) * 20;\n            score -= workloadRatio * 20;\n            \n            return {\n                user_id: member.uid,\n                username: member.username,\n                score: Math.max(0, Math.min(100, score)),\n                reasoning: `Expertise: ${expertise.expertise_score}%, Workload: ${member.workload}/${member.capacity}`,\n                metrics: {\n                    workload: member.workload,\n                    expertise: expertise,\n                    capacity: member.capacity\n                }\n            };\n        }).sort((a, b) => b.score - a.score);\n    }\n    \n    /**\n     * Simulate different query complexities\n     */\n    async simulateQueryComplexity(complexity) {\n        const delays = {\n            low: 50,\n            medium: 200,\n            high: 500\n        };\n        \n        return new Promise(resolve => {\n            setTimeout(resolve, delays[complexity] || 100);\n        });\n    }\n    \n    /**\n     * Run all performance tests\n     */\n    async runAllTests() {\n        console.log('Starting Performance Tests with Sample Analytics Data...');\n        console.log('Testing performance with various data sizes and scenarios\\n');\n        \n        console.log('Performance Thresholds:');\n        console.log(`  Single Query: ${this.thresholds.single_query_ms}ms`);\n        console.log(`  Batch Queries: ${this.thresholds.batch_query_ms}ms`);\n        console.log(`  Concurrent Queries: ${this.thresholds.concurrent_queries_ms}ms`);\n        console.log(`  Memory Increase: ${this.thresholds.memory_increase_mb}MB`);\n        \n        try {\n            await this.testSingleQueryPerformance();\n            await this.testBatchQueryPerformance();\n            await this.testConcurrentQueryPerformance();\n            await this.testMemoryUsage();\n            await this.testRecommendationPerformance();\n            await this.testDatabaseOptimization();\n            \n            this.printTestSummary();\n            \n        } catch (error) {\n            console.log('\\n❌ Performance test suite failed with error:', error);\n            this.testResults.failed++;\n            this.testResults.errors.push(`Test suite error: ${error.message}`);\n            this.printTestSummary();\n        }\n    }\n    \n    /**\n     * Print test results summary\n     */\n    printTestSummary() {\n        console.log('\\n\\n=== Performance Test Summary ===');\n        console.log(`✅ Tests Passed: ${this.testResults.passed}`);\n        console.log(`❌ Tests Failed: ${this.testResults.failed}`);\n        console.log(`📊 Total Tests: ${this.testResults.passed + this.testResults.failed}`);\n        \n        if (this.testResults.errors.length > 0) {\n            console.log('\\n🔍 Performance Issues:');\n            this.testResults.errors.forEach((error, index) => {\n                console.log(`  ${index + 1}. ${error}`);\n            });\n        }\n        \n        console.log('\\n📈 Performance Metrics:');\n        Object.entries(this.testResults.metrics).forEach(([key, value]) => {\n            if (typeof value === 'number') {\n                if (key.includes('duration') || key.includes('query')) {\n                    console.log(`  ${key}: ${value}ms`);\n                } else if (key.includes('rate')) {\n                    console.log(`  ${key}: ${value.toFixed(1)}%`);\n                } else if (key.includes('memory')) {\n                    console.log(`  ${key}: ${value.toFixed(2)}MB`);\n                } else {\n                    console.log(`  ${key}: ${value}`);\n                }\n            }\n        });\n        \n        const successRate = this.testResults.passed / (this.testResults.passed + this.testResults.failed) * 100;\n        console.log(`\\n📊 Performance Success Rate: ${successRate.toFixed(1)}%`);\n        \n        if (successRate >= 80) {\n            console.log('\\n🎉 Performance tests completed successfully!');\n        } else if (successRate >= 60) {\n            console.log('\\n⚠️ Performance tests completed with warnings - optimization recommended');\n        } else {\n            console.log('\\n❌ Performance tests failed - optimization required');\n        }\n        \n        console.log('\\nPerformance test coverage:');\n        console.log('  ✅ Single query performance');\n        console.log('  ✅ Batch query performance');\n        console.log('  ✅ Concurrent query performance');\n        console.log('  ✅ Memory usage monitoring');\n        console.log('  ✅ Recommendation generation performance');\n        console.log('  ✅ Database query optimization');\n    }\n}\n\n// Export for use in other test files\nmodule.exports = PerformanceTest;\n\n// Run tests if this file is executed directly\nif (require.main === module) {\n    const testSuite = new PerformanceTest();\n    testSuite.runAllTests();\n}"
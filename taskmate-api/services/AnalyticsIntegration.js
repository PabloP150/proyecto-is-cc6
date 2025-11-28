const AnalyticsService = require('./AnalyticsService');

/**
 * Analytics Integration Service
 * Provides hooks for integrating analytics tracking with existing task operations
 */
class AnalyticsIntegration {
    constructor() {
        this.analyticsService = AnalyticsService;
        this.enabled = process.env.ANALYTICS_ENABLED !== 'false'; // Default to enabled
    }

    /**
     * Hook for task assignment - called when a user is assigned to a task
     * @param {string} taskId - Task UUID
     * @param {string} userId - User UUID
     * @param {string} groupId - Group UUID
     * @param {Object} taskData - Additional task data for category detection
     */
    async onTaskAssignment(taskId, userId, groupId, taskData = {}) {
        if (!this.enabled) {
            console.log('Analytics disabled, skipping task assignment recording');
            return { success: true, skipped: true };
        }

        try {
            // Detect task category from task data
            const category = this.detectTaskCategory(taskData);
            
            console.log(`Analytics Integration: Recording task assignment - Task: ${taskId}, User: ${userId}, Category: ${category}`);
            
            // Record the assignment in analytics
            const result = await this.analyticsService.recordTaskAssignment(
                taskId,
                userId,
                groupId,
                category
            );
            
            return { ...result, category };
        } catch (error) {
            console.error('Analytics Integration: Failed to record task assignment:', error);
            // Don't throw error to avoid breaking main task flow
            return { success: false, error: error.message, skipped: false };
        }
    }

    /**
     * Hook for task completion - called when a task is completed
     * @param {string} taskId - Task UUID
     * @param {boolean} success - Whether the task was completed successfully
     * @param {Object} completionData - Additional completion data
     */
    async onTaskCompletion(taskId, success = true, completionData = {}) {
        if (!this.enabled) {
            console.log('Analytics disabled, skipping task completion recording');
            return { success: true, skipped: true };
        }

        try {
            console.log(`Analytics Integration: Recording task completion - Task: ${taskId}, Success: ${success}`);
            
            // Record the completion in analytics
            const result = await this.analyticsService.recordTaskCompletion(taskId, success);
            
            return result;
        } catch (error) {
            console.error('Analytics Integration: Failed to record task completion:', error);
            // Don't throw error to avoid breaking main task flow
            return { success: false, error: error.message, skipped: false };
        }
    }

    /**
     * Hook for task deletion - called when a task is deleted
     * @param {string} taskId - Task UUID
     */
    async onTaskDeletion(taskId) {
        if (!this.enabled) {
            console.log('Analytics disabled, skipping task deletion handling');
            return { success: true, skipped: true };
        }

        try {
            console.log(`Analytics Integration: Handling task deletion - Task: ${taskId}`);
            
            // Mark any pending analytics records as 'reassigned' or handle appropriately
            // This could involve updating the success_status to 'reassigned' for pending tasks
            const result = await this.analyticsService.recordTaskCompletion(taskId, false);
            
            return result;
        } catch (error) {
            console.error('Analytics Integration: Failed to handle task deletion:', error);
            return { success: false, error: error.message, skipped: false };
        }
    }

    /**
     * Detect task category based on task data
     * @param {Object} taskData - Task data including name, description, list
     * @returns {string} Detected category
     */
    detectTaskCategory(taskData) {
        const { name = '', description = '', list = '' } = taskData;
        
        // Combine all text for analysis
        const text = `${name} ${description} ${list}`.toLowerCase();
        
        // Define category keywords
        const categoryKeywords = {
            frontend: [
                'ui', 'ux', 'interface', 'frontend', 'front-end', 'react', 'vue', 'angular',
                'css', 'html', 'javascript', 'responsive', 'design', 'component', 'layout',
                'styling', 'theme', 'visual', 'user interface', 'dashboard', 'form', 'modal',
                'button', 'navigation', 'menu', 'page', 'screen', 'view'
            ],
            backend: [
                'api', 'backend', 'back-end', 'server', 'endpoint', 'service', 'microservice',
                'database', 'sql', 'query', 'authentication', 'authorization', 'auth',
                'middleware', 'controller', 'model', 'route', 'rest', 'graphql',
                'integration', 'webhook', 'cron', 'job', 'worker', 'queue'
            ],
            database: [
                'database', 'db', 'sql', 'query', 'table', 'schema', 'migration', 'index',
                'optimization', 'performance', 'backup', 'restore', 'data', 'storage',
                'mongodb', 'postgresql', 'mysql', 'redis', 'elasticsearch', 'aggregate',
                'join', 'transaction', 'constraint', 'foreign key', 'primary key'
            ],
            testing: [
                'test', 'testing', 'unit test', 'integration test', 'e2e', 'qa', 'quality',
                'bug', 'fix', 'debug', 'validation', 'verification', 'coverage', 'mock',
                'stub', 'jest', 'cypress', 'selenium', 'automation', 'regression',
                'performance test', 'load test', 'stress test'
            ]
        };
        
        // Score each category
        const scores = {};
        for (const [category, keywords] of Object.entries(categoryKeywords)) {
            scores[category] = 0;
            for (const keyword of keywords) {
                if (text.includes(keyword)) {
                    scores[category]++;
                }
            }
        }
        
        // Find the category with the highest score
        const maxScore = Math.max(...Object.values(scores));
        if (maxScore === 0) {
            return 'general'; // Default category if no keywords match
        }
        
        const detectedCategory = Object.keys(scores).find(category => scores[category] === maxScore);
        
        console.log(`Analytics Integration: Detected category '${detectedCategory}' for task with text: "${text.substring(0, 100)}..."`);
        
        return detectedCategory;
    }

    /**
     * Get analytics recommendations for task assignment
     * @param {string} groupId - Group UUID
     * @param {Object} taskData - Task data for category detection and context
     * @returns {Object} Recommendations from analytics agent
     */
    async getTaskAssignmentRecommendations(groupId, taskData = {}) {
        if (!this.enabled) {
            console.log('Analytics disabled, skipping recommendations');
            return { success: false, error: 'Analytics disabled' };
        }

        try {
            const category = this.detectTaskCategory(taskData);
            
            // This would typically call the Analytics Agent via the bridge
            // For now, we'll return a placeholder that indicates the integration point
            console.log(`Analytics Integration: Would get recommendations for group ${groupId}, category ${category}`);
            
            return {
                success: true,
                category,
                message: 'Analytics integration ready - connect to Analytics Agent for recommendations'
            };
        } catch (error) {
            console.error('Analytics Integration: Failed to get recommendations:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Run batch update for user metrics and expertise
     * This should be called periodically (e.g., daily via cron job)
     */
    async runBatchUpdate() {
        if (!this.enabled) {
            console.log('Analytics disabled, skipping batch update');
            return { success: true, skipped: true };
        }

        try {
            console.log('Analytics Integration: Running batch update for user metrics and expertise');
            
            const result = await this.analyticsService.batchUpdateUserMetrics();
            
            console.log(`Analytics Integration: Batch update completed - Updated ${result.users_updated} users, ${result.expertise_records_updated} expertise records`);
            
            return result;
        } catch (error) {
            console.error('Analytics Integration: Batch update failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Enable or disable analytics tracking
     * @param {boolean} enabled - Whether to enable analytics
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        console.log(`Analytics Integration: ${enabled ? 'Enabled' : 'Disabled'}`);
    }

    /**
     * Get analytics status
     * @returns {Object} Status information
     */
    getStatus() {
        return {
            enabled: this.enabled,
            service: 'AnalyticsIntegration',
            version: '1.0.0'
        };
    }
}

module.exports = new AnalyticsIntegration();
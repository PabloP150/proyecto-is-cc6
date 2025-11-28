const cron = require('node-cron');
const AnalyticsIntegration = require('./AnalyticsIntegration');

/**
 * Analytics Batch Job Service
 * Handles scheduled updates for user metrics and expertise
 */
class AnalyticsBatchJob {
    constructor() {
        this.isRunning = false;
        this.lastRun = null;
        this.schedule = process.env.ANALYTICS_BATCH_SCHEDULE || '0 2 * * *'; // Default: 2 AM daily
        this.enabled = process.env.ANALYTICS_BATCH_ENABLED !== 'false'; // Default: enabled
        this.job = null;
    }

    /**
     * Start the batch job scheduler
     */
    start() {
        if (!this.enabled) {
            console.log('Analytics Batch Job: Disabled via configuration');
            return;
        }

        if (this.job) {
            console.log('Analytics Batch Job: Already running');
            return;
        }

        console.log(`Analytics Batch Job: Starting with schedule: ${this.schedule}`);
        
        this.job = cron.schedule(this.schedule, async () => {
            await this.runBatchUpdate();
        }, {
            scheduled: true,
            timezone: process.env.TZ || 'UTC'
        });

        console.log('Analytics Batch Job: Scheduler started');
    }

    /**
     * Stop the batch job scheduler
     */
    stop() {
        if (this.job) {
            this.job.stop();
            this.job = null;
            console.log('Analytics Batch Job: Scheduler stopped');
        }
    }

    /**
     * Run the batch update manually
     */
    async runBatchUpdate() {
        if (this.isRunning) {
            console.log('Analytics Batch Job: Already running, skipping this execution');
            return;
        }

        this.isRunning = true;
        const startTime = new Date();
        
        try {
            console.log('Analytics Batch Job: Starting batch update...');
            
            const result = await AnalyticsIntegration.runBatchUpdate();
            
            const endTime = new Date();
            const duration = endTime - startTime;
            
            this.lastRun = {
                startTime,
                endTime,
                duration,
                result,
                success: result.success
            };

            if (result.success) {
                console.log(`Analytics Batch Job: Completed successfully in ${duration}ms`);
                console.log(`  - Users updated: ${result.users_updated}`);
                console.log(`  - Expertise records updated: ${result.expertise_records_updated}`);
                if (result.errors && result.errors.length > 0) {
                    console.log(`  - Errors encountered: ${result.errors.length}`);
                }
            } else {
                console.error(`Analytics Batch Job: Failed - ${result.error}`);
            }
            
        } catch (error) {
            const endTime = new Date();
            const duration = endTime - startTime;
            
            this.lastRun = {
                startTime,
                endTime,
                duration,
                result: null,
                success: false,
                error: error.message
            };

            console.error(`Analytics Batch Job: Exception occurred - ${error.message}`);
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Get batch job status
     */
    getStatus() {
        return {
            enabled: this.enabled,
            running: this.isRunning,
            schedule: this.schedule,
            lastRun: this.lastRun,
            nextRun: this.job ? this.job.nextDate() : null
        };
    }

    /**
     * Update the schedule
     * @param {string} newSchedule - New cron schedule
     */
    updateSchedule(newSchedule) {
        if (this.job) {
            this.stop();
        }
        
        this.schedule = newSchedule;
        
        if (this.enabled) {
            this.start();
        }
        
        console.log(`Analytics Batch Job: Schedule updated to ${newSchedule}`);
    }

    /**
     * Enable or disable the batch job
     * @param {boolean} enabled - Whether to enable the batch job
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        
        if (enabled) {
            this.start();
        } else {
            this.stop();
        }
        
        console.log(`Analytics Batch Job: ${enabled ? 'Enabled' : 'Disabled'}`);
    }
}

module.exports = new AnalyticsBatchJob();
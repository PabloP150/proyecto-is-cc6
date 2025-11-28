/**
 * Production Analytics Metrics Tracking
 * Measures the effectiveness of AI task assignment recommendations
 */

class ProductionMetrics {
    
    /**
     * Track when a recommendation is given
     */
    static async trackRecommendationGiven(recommendationId, taskId, recommendations) {
        const metrics = {
            recommendation_id: recommendationId,
            task_id: taskId,
            timestamp: new Date().toISOString(),
            recommendations_count: recommendations.length,
            top_recommendation: recommendations[0],
            all_recommendations: recommendations
        };
        
        // Store in database for analysis
        await this.storeMetric('recommendation_given', metrics);
    }
    
    /**
     * Track when a user follows or ignores a recommendation
     */
    static async trackRecommendationDecision(recommendationId, taskId, assignedUserId, wasRecommended) {
        const metrics = {
            recommendation_id: recommendationId,
            task_id: taskId,
            assigned_user_id: assignedUserId,
            followed_recommendation: wasRecommended,
            timestamp: new Date().toISOString()
        };
        
        await this.storeMetric('recommendation_decision', metrics);
    }
    
    /**
     * Track task completion outcome
     */
    static async trackTaskOutcome(taskId, success, completionTime, assignedUserId) {
        const metrics = {
            task_id: taskId,
            assigned_user_id: assignedUserId,
            success,
            completion_time_hours: completionTime,
            timestamp: new Date().toISOString()
        };
        
        await this.storeMetric('task_outcome', metrics);
    }
    
    /**
     * Calculate recommendation effectiveness
     */
    static async calculateRecommendationEffectiveness(timeframe = '30 days') {
        const query = `
            WITH recommendation_outcomes AS (
                SELECT 
                    rg.recommendation_id,
                    rg.task_id,
                    rd.followed_recommendation,
                    to.success as task_success,
                    to.completion_time_hours,
                    rg.top_recommendation->>'username' as recommended_user,
                    rd.assigned_user_id
                FROM recommendation_given rg
                LEFT JOIN recommendation_decision rd ON rg.recommendation_id = rd.recommendation_id
                LEFT JOIN task_outcome to ON rg.task_id = to.task_id
                WHERE rg.timestamp >= NOW() - INTERVAL '${timeframe}'
            )
            SELECT 
                COUNT(*) as total_recommendations,
                COUNT(CASE WHEN followed_recommendation = true THEN 1 END) as followed_count,
                COUNT(CASE WHEN followed_recommendation = false THEN 1 END) as ignored_count,
                
                -- Success rates
                AVG(CASE WHEN followed_recommendation = true THEN task_success::int END) as followed_success_rate,
                AVG(CASE WHEN followed_recommendation = false THEN task_success::int END) as ignored_success_rate,
                
                -- Completion times
                AVG(CASE WHEN followed_recommendation = true THEN completion_time_hours END) as followed_avg_time,
                AVG(CASE WHEN followed_recommendation = false THEN completion_time_hours END) as ignored_avg_time,
                
                -- Overall metrics
                (COUNT(CASE WHEN followed_recommendation = true THEN 1 END)::float / COUNT(*)) * 100 as adoption_rate
            FROM recommendation_outcomes
        `;
        
        const results = await this.executeQuery(query);
        return results[0];
    }
    
    /**
     * A/B Test Framework for recommendation algorithms
     */
    static async runABTest(taskId, groupId, taskCategory) {
        // Randomly assign to control or test group
        const isTestGroup = Math.random() > 0.5;
        
        let recommendations;
        if (isTestGroup) {
            // Use new AI algorithm
            recommendations = await this.getAIRecommendations(taskId, groupId, taskCategory);
            await this.trackABTestAssignment(taskId, 'ai_algorithm', 'test');
        } else {
            // Use baseline algorithm (simple workload balancing)
            recommendations = await this.getBaselineRecommendations(taskId, groupId, taskCategory);
            await this.trackABTestAssignment(taskId, 'baseline_algorithm', 'control');
        }
        
        return recommendations;
    }
    
    /**
     * Generate weekly effectiveness report
     */
    static async generateWeeklyReport() {
        const effectiveness = await this.calculateRecommendationEffectiveness('7 days');
        const previousWeek = await this.calculateRecommendationEffectiveness('14 days', '7 days');
        
        const report = {
            period: 'Last 7 days',
            metrics: {
                total_recommendations: effectiveness.total_recommendations,
                adoption_rate: `${effectiveness.adoption_rate.toFixed(1)}%`,
                
                success_rates: {
                    when_followed: `${(effectiveness.followed_success_rate * 100).toFixed(1)}%`,
                    when_ignored: `${(effectiveness.ignored_success_rate * 100).toFixed(1)}%`,
                    improvement: `${((effectiveness.followed_success_rate - effectiveness.ignored_success_rate) * 100).toFixed(1)}%`
                },
                
                completion_times: {
                    when_followed: `${effectiveness.followed_avg_time.toFixed(1)}h`,
                    when_ignored: `${effectiveness.ignored_avg_time.toFixed(1)}h`,
                    time_saved: `${(effectiveness.ignored_avg_time - effectiveness.followed_avg_time).toFixed(1)}h`
                }
            },
            
            trends: {
                adoption_rate_change: effectiveness.adoption_rate - previousWeek.adoption_rate,
                success_rate_change: (effectiveness.followed_success_rate - previousWeek.followed_success_rate) * 100
            }
        };
        
        return report;
    }
    
    /**
     * Real-time dashboard metrics
     */
    static async getDashboardMetrics() {
        const [today, thisWeek, thisMonth] = await Promise.all([
            this.calculateRecommendationEffectiveness('1 day'),
            this.calculateRecommendationEffectiveness('7 days'),
            this.calculateRecommendationEffectiveness('30 days')
        ]);
        
        return {
            today: {
                recommendations: today.total_recommendations,
                adoption_rate: today.adoption_rate,
                success_rate: today.followed_success_rate * 100
            },
            this_week: {
                recommendations: thisWeek.total_recommendations,
                adoption_rate: thisWeek.adoption_rate,
                success_rate: thisWeek.followed_success_rate * 100,
                time_saved_hours: (thisWeek.ignored_avg_time - thisWeek.followed_avg_time) * thisWeek.followed_count
            },
            this_month: {
                recommendations: thisMonth.total_recommendations,
                adoption_rate: thisMonth.adoption_rate,
                success_rate: thisMonth.followed_success_rate * 100,
                total_time_saved: (thisMonth.ignored_avg_time - thisMonth.followed_avg_time) * thisMonth.followed_count
            }
        };
    }
    
    // Helper methods
    static async storeMetric(type, data) {
        // Store in analytics database
        console.log(`Storing ${type} metric:`, data);
        // Implementation would store in database
    }
    
    static async executeQuery(query) {
        // Execute database query
        console.log('Executing query:', query);
        // Return mock data for now
        return [{ 
            total_recommendations: 100,
            followed_count: 75,
            ignored_count: 25,
            followed_success_rate: 0.907,
            ignored_success_rate: 0.65,
            followed_avg_time: 4.2,
            ignored_avg_time: 6.1,
            adoption_rate: 75
        }];
    }
}

module.exports = ProductionMetrics;
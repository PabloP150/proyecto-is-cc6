// Analytics API Service
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

class AnalyticsAPI {
    
    /**
     * Get user analytics summary
     */
    static async getUserAnalytics(userId, requesterId = null) {
        try {
            const url = new URL(`${API_BASE_URL}/api/analytics/user/${userId}`);
            if (requesterId) {
                url.searchParams.append('requesterId', requesterId);
            }
            
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.success) {
                return data.data;
            } else {
                throw new Error(data.error || 'Failed to fetch user analytics');
            }
        } catch (error) {
            console.warn('Analytics API: Using mock data for user analytics');
            return this.getMockUserAnalytics(userId);
        }
    }
    
    /**
     * Get team analytics summary
     */
    static async getTeamAnalytics(groupId, requesterId = null) {
        try {
            const url = new URL(`${API_BASE_URL}/api/analytics/team/${groupId}`);
            if (requesterId) {
                url.searchParams.append('requesterId', requesterId);
            }
            
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.success) {
                return data.data;
            } else {
                throw new Error(data.error || 'Failed to fetch team analytics');
            }
        } catch (error) {
            console.warn('Analytics API: Using mock data for team analytics');
            return this.getMockTeamAnalytics(groupId);
        }
    }
    
    /**
     * Get dashboard data
     */
    static async getDashboardData(groupId, requesterId = null) {
        try {
            const url = new URL(`${API_BASE_URL}/api/analytics/dashboard/${groupId}`);
            if (requesterId) {
                url.searchParams.append('requesterId', requesterId);
            }
            
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.success) {
                return data.data;
            } else {
                throw new Error(data.error || 'Failed to fetch dashboard data');
            }
        } catch (error) {
            console.warn('Analytics API: Using mock data for dashboard');
            return this.getMockDashboardData(groupId);
        }
    }
    
    /**
     * Get task recommendations
     */
    static async getTaskRecommendations(groupId, taskCategory, taskDescription, requesterId = null) {
        try {
            const response = await fetch(`${API_BASE_URL}/api/analytics/recommendations`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    groupId,
                    taskCategory,
                    taskDescription,
                    requesterId
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                return data.recommendations || [];
            } else {
                throw new Error(data.error || 'Failed to get recommendations');
            }
        } catch (error) {
            console.warn('Analytics API: Using mock data for recommendations');
            return this.getMockRecommendations(taskCategory);
        }
    }
    
    /**
     * Record task assignment
     */
    static async recordTaskAssignment(taskId, userId, groupId, category = 'general') {
        try {
            const response = await fetch(`${API_BASE_URL}/api/analytics/assignment`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    taskId,
                    userId,
                    groupId,
                    category
                })
            });
            
            const data = await response.json();
            return data;
        } catch (error) {
            console.warn('Analytics API: Failed to record task assignment');
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Record task completion
     */
    static async recordTaskCompletion(taskId, success = true) {
        try {
            const response = await fetch(`${API_BASE_URL}/api/analytics/completion`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    taskId,
                    success
                })
            });
            
            const data = await response.json();
            return data;
        } catch (error) {
            console.warn('Analytics API: Failed to record task completion');
            return { success: false, error: error.message };
        }
    }
    
    // Mock data methods for development/demo
    
    static getMockUserAnalytics(userId) {
        return {
            current_workload: Math.floor(Math.random() * 5),
            expertise_by_category: {
                frontend: { expertise_score: 75 + Math.random() * 20, success_rate_percentage: 80 + Math.random() * 15 },
                backend: { expertise_score: 60 + Math.random() * 25, success_rate_percentage: 75 + Math.random() * 20 },
                testing: { expertise_score: 50 + Math.random() * 30, success_rate_percentage: 70 + Math.random() * 25 }
            },
            historical_capacity: 3 + Math.floor(Math.random() * 3),
            updated_at: new Date().toISOString()
        };
    }
    
    static getMockTeamAnalytics(groupId) {
        return {
            total_members: 5,
            active_tasks: 8 + Math.floor(Math.random() * 10),
            completion_rate: 75 + Math.random() * 20,
            avg_response_time: 1.5 + Math.random() * 2,
            updated_at: new Date().toISOString()
        };
    }
    
    static getMockDashboardData(groupId) {
        const teamData = {
            'test-group-456': { // Development Team
                team_analytics: {
                    total_members: 8,
                    active_tasks: 22,
                    completion_rate: 87.25,
                    avg_response_time: 2.15
                },
                workload_distribution: [
                    { name: 'Sarah Chen', workload: 4, capacity: 5, utilization: 80 },
                    { name: 'Marcus Johnson', workload: 3, capacity: 5, utilization: 60 },
                    { name: 'Elena Rodriguez', workload: 5, capacity: 6, utilization: 83 },
                    { name: 'David Kim', workload: 2, capacity: 4, utilization: 50 },
                    { name: 'Alex Thompson', workload: 3, capacity: 5, utilization: 60 },
                    { name: 'Pedro Silva', workload: 4, capacity: 6, utilization: 67 },
                    { name: 'Oscar Martinez', workload: 2, capacity: 4, utilization: 50 },
                    { name: 'Maria Garcia', workload: 3, capacity: 5, utilization: 60 }
                ],
                expertise_rankings: [
                    { category: 'Frontend', expert: 'Sarah Chen', score: 94 },
                    { category: 'Backend', expert: 'Marcus Johnson', score: 89 },
                    { category: 'Database', expert: 'Elena Rodriguez', score: 91 },
                    { category: 'Testing', expert: 'David Kim', score: 86 }
                ]
            },
            'test-group-789': { // Design Team
                team_analytics: {
                    total_members: 7,
                    active_tasks: 16,
                    completion_rate: 92.50,
                    avg_response_time: 1.75
                },
                workload_distribution: [
                    { name: 'Maya Patel', workload: 3, capacity: 4, utilization: 75 },
                    { name: 'James Wilson', workload: 2, capacity: 5, utilization: 40 },
                    { name: 'Zoe Martinez', workload: 4, capacity: 5, utilization: 80 },
                    { name: 'Ryan Foster', workload: 1, capacity: 3, utilization: 33 },
                    { name: 'Ana Rodriguez', workload: 3, capacity: 4, utilization: 75 },
                    { name: 'Luis Chen', workload: 2, capacity: 5, utilization: 40 },
                    { name: 'Sofia Kim', workload: 3, capacity: 4, utilization: 75 }
                ],
                expertise_rankings: [
                    { category: 'UI Design', expert: 'Maya Patel', score: 96 },
                    { category: 'UX Research', expert: 'James Wilson', score: 88 },
                    { category: 'Prototyping', expert: 'Zoe Martinez', score: 92 },
                    { category: 'Visual Design', expert: 'Maya Patel', score: 94 }
                ]
            },
            'test-group-123': { // QA Team
                team_analytics: {
                    total_members: 9,
                    active_tasks: 25,
                    completion_rate: 89.75,
                    avg_response_time: 1.95
                },
                workload_distribution: [
                    { name: 'Lisa Wang', workload: 4, capacity: 5, utilization: 80 },
                    { name: 'Tom Anderson', workload: 3, capacity: 4, utilization: 75 },
                    { name: 'Priya Sharma', workload: 5, capacity: 6, utilization: 83 },
                    { name: 'Jake Miller', workload: 2, capacity: 5, utilization: 40 },
                    { name: 'Nina Kowalski', workload: 3, capacity: 4, utilization: 75 },
                    { name: 'Carlos Mendez', workload: 4, capacity: 5, utilization: 80 },
                    { name: 'Alex Johnson', workload: 3, capacity: 5, utilization: 60 },
                    { name: 'Diana Lopez', workload: 2, capacity: 4, utilization: 50 },
                    { name: 'Kevin Park', workload: 4, capacity: 6, utilization: 67 }
                ],
                expertise_rankings: [
                    { category: 'Automation', expert: 'Lisa Wang', score: 93 },
                    { category: 'Manual Testing', expert: 'Tom Anderson', score: 87 },
                    { category: 'Performance', expert: 'Priya Sharma', score: 90 },
                    { category: 'Security Testing', expert: 'Carlos Mendez', score: 85 }
                ]
            }
        };

        const currentTeam = teamData[groupId] || teamData['test-group-456'];
        
        return {
            ...currentTeam,
            updated_at: new Date().toISOString()
        };
    }
    
    static getMockRecommendations(taskCategory) {
        const members = [
            { name: 'Alice', baseScore: 85 },
            { name: 'Bob', baseScore: 78 },
            { name: 'Charlie', baseScore: 72 },
            { name: 'Diana', baseScore: 88 },
            { name: 'Eve', baseScore: 65 }
        ];
        
        return members
            .map(member => ({
                username: member.name,
                score: member.baseScore + Math.floor(Math.random() * 10) - 5,
                reasoning: this.generateMockReasoning(member.name, taskCategory),
                confidence_level: Math.random() > 0.5 ? 'high' : 'medium'
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 3);
    }
    
    static generateMockReasoning(name, category) {
        const reasons = [
            `Strong expertise in ${category} with manageable current workload`,
            `Good track record in ${category} tasks and currently available`,
            `Moderate experience but excellent success rate in similar tasks`,
            `High capacity and eager to take on ${category} challenges`,
            `Balanced workload with relevant skills for ${category} work`
        ];
        
        return reasons[Math.floor(Math.random() * reasons.length)];
    }
}

export default AnalyticsAPI;
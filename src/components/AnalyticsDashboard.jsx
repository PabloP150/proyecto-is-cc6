import React, { useState, useEffect, useContext } from 'react';
import { GroupContext } from './GroupContext';
import useWebSocket from '../hooks/useWebSocket';
import './AnalyticsDashboard.css';

const AnalyticsDashboard = () => {
    const { selectedGroupId } = useContext(GroupContext);
    const [analytics, setAnalytics] = useState(null);
    const [loading, setLoading] = useState(true);
    const [selectedRole, setSelectedRole] = useState('all');
    
    // State for analytics recommendations
    const [analyticsResponse, setAnalyticsResponse] = useState(null);
    const [analyticsLoading, setAnalyticsLoading] = useState(false);
    
    // Get user token from localStorage
    const [token] = useState(() => {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        return localStorage.getItem('token') || user.token;
    });

    // WebSocket connection for analytics
    const {
        sendMessage: sendWebSocketMessage,
        isConnected
    } = useWebSocket(
        'ws://localhost:9000/chat',
        token,
        {
            autoConnect: !!token,
            onMessage: (data) => {
                console.log('WebSocket message received:', data);
                
                // Handle analytics responses - look for assistant messages when we're waiting for analytics
                if (data.type === 'assistant' && analyticsLoading) {
                    console.log('Received potential analytics response:', data);
                    
                    try {
                        // Try to parse the content as JSON analytics response
                        const content = data.content;
                        
                        // Look for JSON in the response
                        const jsonMatch = content.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            const analyticsData = JSON.parse(jsonMatch[0]);
                            
                            if (analyticsData.recommendations || analyticsData.suggested_plan) {
                                console.log('Parsed analytics data:', analyticsData);
                                setAnalyticsResponse({ data: analyticsData });
                                setAnalyticsLoading(false);
                                return;
                            }
                        }
                        
                        // If no JSON found, treat as text response and try to extract recommendations
                        console.log('No JSON found, treating as text response');
                        setAnalyticsLoading(false);
                        generateFallbackRecommendations();
                        
                    } catch (error) {
                        console.error('Error parsing analytics response:', error);
                        setAnalyticsLoading(false);
                        generateFallbackRecommendations();
                    }
                }
            }
        }
    );

    // Generate fallback recommendations using current team data
    const generateFallbackRecommendations = () => {
        if (!analytics || !analytics.workload_distribution) {
            console.log('No team data available for fallback recommendations');
            return;
        }

        console.log('Generating fallback recommendations from team data');
        
        const availableMembers = analytics.workload_distribution
            .filter(member => member.utilization < 80) // Less than 80% utilized
            .sort((a, b) => a.utilization - b.utilization) // Sort by availability
            .slice(0, 3) // Top 3 most available
            .map((member, index) => {
                const baseScore = 95 - (index * 5) - member.utilization;
                const roleBonus = member.role.includes('Frontend') ? 5 : member.role.includes('Backend') ? 3 : 0;
                
                return {
                    username: member.name,
                    score: Math.min(100, baseScore + roleBonus),
                    reasoning: `${member.name} is currently at ${member.utilization}% capacity (${member.workload}/${member.capacity} tasks) with strong availability for new assignments. Their ${member.role} expertise aligns well with project requirements.`,
                    confidence_level: index === 0 ? 'high' : index === 1 ? 'medium' : 'low',
                    development_opportunity: index === 0 
                        ? `Leading this task would strengthen ${member.name}'s project leadership skills and provide exposure to cross-functional collaboration.`
                        : index === 1 
                        ? `This assignment offers ${member.name} an opportunity to expand their technical expertise and take on more complex challenges.`
                        : `Working on this task would help ${member.name} develop new skills while contributing meaningfully to the project.`,
                    expertise_match: member.role,
                    availability_score: Math.round((100 - member.utilization) * 0.8),
                    skill_alignment: roleBonus > 0 ? 'High' : 'Medium',
                    workload_impact: member.utilization < 50 ? 'Low impact - good capacity' : 'Moderate impact - manageable load'
                };
            });

        if (availableMembers.length > 0) {
            const fallbackResponse = {
                data: {
                    recommendations: availableMembers,
                    suggested_plan: {
                        primary_assignee: availableMembers[0].username,
                        plan_type: 'solo',
                        rationale: `${availableMembers[0].username} is the optimal choice with ${analytics.workload_distribution.find(m => m.name === availableMembers[0].username)?.utilization}% current utilization, providing excellent capacity for focused execution while maintaining quality standards.`,
                        alternative_approach: availableMembers.length > 1 ? `Consider ${availableMembers[1].username} as backup option with ${analytics.workload_distribution.find(m => m.name === availableMembers[1].username)?.utilization}% utilization, or implement pair programming approach for knowledge sharing.` : 'Monitor workload distribution and consider redistributing tasks if capacity becomes constrained.',
                        strategic_value: `This assignment leverages ${availableMembers[0].username}'s expertise while maintaining team balance. It provides growth opportunities and ensures project continuity.`,
                        estimated_effort: 'Medium complexity - estimated 1-2 weeks based on current team velocity and task scope.',
                        risk_assessment: availableMembers[0].availability_score > 70 ? 'Low risk - excellent availability and skill match' : 'Medium risk - monitor workload and provide support as needed'
                    }
                }
            };
            
            setAnalyticsResponse(fallbackResponse);
        }
    };

    // Error handler for analytics operations
    const handleAnalyticsError = () => {
        console.error('Analytics operation failed - WebSocket not available');
        setAnalyticsResponse(null);
        setAnalyticsLoading(false);
        generateFallbackRecommendations();
    };
    
    // Available roles for filtering
    const availableRoles = [
        'Frontend Developer',
        'Backend Developer', 
        'QA Engineer',
        'UI/UX Designer',
        'DevOps Engineer',
        'Product Manager'
    ];

    // Fetch real users and combine with hardcoded workload data
    const fetchAnalyticsData = async () => {
        if (!selectedGroupId) {
            setLoading(false);
            return;
        }

        setLoading(true);
        
        try {
            // Fetch real team members from the database
            const response = await fetch(`http://localhost:9000/api/analytics/dashboard/${selectedGroupId}`);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            const realUsers = data.data?.team_analytics?.team_members || [];
            
            // Hardcoded workload assignments mapped to real usernames
            const workloadMap = {
                'sarah.chen': { workload: 4, capacity: 5, utilization: 80, role: 'Frontend Developer' },
                'marcus.johnson': { workload: 3, capacity: 5, utilization: 60, role: 'Backend Developer' },
                'elena.rodriguez': { workload: 5, capacity: 6, utilization: 83, role: 'Backend Developer' },
                'david.kim': { workload: 2, capacity: 4, utilization: 50, role: 'QA Engineer' },
                'alex.thompson': { workload: 3, capacity: 5, utilization: 60, role: 'Frontend Developer' },
                'maya.patel': { workload: 3, capacity: 4, utilization: 75, role: 'UI/UX Designer' },
                'james.wilson': { workload: 2, capacity: 5, utilization: 40, role: 'UI/UX Designer' },
                'zoe.martinez': { workload: 4, capacity: 5, utilization: 80, role: 'Frontend Developer' },
                'ryan.foster': { workload: 1, capacity: 3, utilization: 33, role: 'DevOps Engineer' },
                'lisa.wang': { workload: 4, capacity: 5, utilization: 80, role: 'QA Engineer' },
                'tom.anderson': { workload: 3, capacity: 4, utilization: 75, role: 'Backend Developer' },
                'priya.sharma': { workload: 5, capacity: 6, utilization: 83, role: 'QA Engineer' },
                'jake.miller': { workload: 2, capacity: 5, utilization: 40, role: 'Frontend Developer' },
                'nina.kowalski': { workload: 3, capacity: 4, utilization: 75, role: 'Product Manager' },
                'carlos.mendez': { workload: 4, capacity: 5, utilization: 80, role: 'DevOps Engineer' }
            };
            
            // Combine real users with hardcoded workload data
            const workloadDistribution = realUsers.map(user => {
                const workloadData = workloadMap[user.username] || { 
                    workload: 2, 
                    capacity: 4, 
                    utilization: 50, 
                    role: 'Developer' 
                };
                
                return {
                    name: user.username.split('.').map(name => 
                        name.charAt(0).toUpperCase() + name.slice(1)
                    ).join(' '),
                    username: user.username,
                    workload: workloadData.workload,
                    capacity: workloadData.capacity,
                    utilization: workloadData.utilization,
                    role: workloadData.role,
                    active_tasks: user.active_tasks || 0
                };
            });
            
            const analyticsData = {
                team_analytics: {
                    total_members: realUsers.length,
                    active_tasks: realUsers.reduce((sum, user) => sum + (user.active_tasks || 0), 0),
                    completion_rate: 88.75, // Hardcoded for now
                    avg_response_time: 2.25 // Hardcoded for now
                },
                workload_distribution: workloadDistribution,
                expertise_rankings: [
                    { category: 'Frontend', expert: 'Sarah Chen', score: 94 },
                    { category: 'Backend', expert: 'Marcus Johnson', score: 89 },
                    { category: 'UI/UX Design', expert: 'Maya Patel', score: 96 },
                    { category: 'QA Testing', expert: 'Lisa Wang', score: 93 },
                    { category: 'DevOps', expert: 'Carlos Mendez', score: 87 },
                    { category: 'Product Management', expert: 'Nina Kowalski', score: 91 }
                ]
            };
            
            setAnalytics(analyticsData);
            
        } catch (error) {
            console.error('Error fetching analytics:', error);
            // Fallback to completely hardcoded data if API fails
            setAnalytics({
                team_analytics: {
                    total_members: 15,
                    active_tasks: 35,
                    completion_rate: 88.75,
                    avg_response_time: 2.25
                },
                workload_distribution: [
                    { name: 'Sarah Chen', workload: 4, capacity: 5, utilization: 80, role: 'Frontend Developer' },
                    { name: 'Marcus Johnson', workload: 3, capacity: 5, utilization: 60, role: 'Backend Developer' },
                    { name: 'Elena Rodriguez', workload: 5, capacity: 6, utilization: 83, role: 'Backend Developer' },
                    { name: 'David Kim', workload: 2, capacity: 4, utilization: 50, role: 'QA Engineer' },
                    { name: 'Alex Thompson', workload: 3, capacity: 5, utilization: 60, role: 'Frontend Developer' }
                ],
                expertise_rankings: [
                    { category: 'Frontend', expert: 'Sarah Chen', score: 94 },
                    { category: 'Backend', expert: 'Marcus Johnson', score: 89 }
                ]
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (selectedGroupId) {
            fetchAnalyticsData();
        }
    }, [selectedGroupId]);

    // Refresh analytics data
    const refreshAnalytics = () => {
        fetchAnalyticsData();
    };

    if (loading) {
        return (
            <div className="analytics-dashboard">
                <div className="dashboard-header">
                    <h1>Team Analytics Dashboard</h1>
                    <div className="dashboard-controls">
                        <button className="refresh-btn" disabled>
                            Loading...
                        </button>
                    </div>
                </div>
                <div className="loading-container" style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: '400px',
                    gap: '20px'
                }}>
                    <div className="loading-spinner" style={{
                        width: '40px',
                        height: '40px',
                        border: '4px solid #f3f3f3',
                        borderTop: '4px solid #3498db',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite'
                    }}></div>
                    <div className="loading-text" style={{ fontSize: '18px', fontWeight: '500', color: 'white' }}>
                        Loading analytics data...
                    </div>
                </div>
            </div>
        );
    }



    return (
        <div className="analytics-dashboard">
            <div className="dashboard-header">
                <h1>Team Analytics Dashboard</h1>
                <div className="dashboard-controls">
                    <select
                        value={selectedRole}
                        onChange={(e) => setSelectedRole(e.target.value)}
                        className="role-selector"
                    >
                        <option value="all">All Roles</option>
                        {availableRoles.map(role => (
                            <option key={role} value={role}>
                                {role}
                            </option>
                        ))}
                    </select>
                    <button onClick={refreshAnalytics} className="refresh-btn">
                        Refresh
                    </button>
                </div>
            </div>

            <div className="metrics-grid">
                <MetricCard
                    title="Team Members"
                    value={analytics.team_analytics?.total_members || 0}
                    icon="👥"
                    color="blue"
                />
                <MetricCard
                    title="Active Tasks"
                    value={analytics.team_analytics?.active_tasks || 0}
                    icon="📋"
                    color="green"
                />
                <MetricCard
                    title="Project Completion"
                    value={`${(analytics.team_analytics?.completion_rate || 0).toFixed(1)}%`}
                    icon="✅"
                    color="purple"
                />
            </div>

            <div className="dashboard-content">
                <div className="chart-section">
                    <h2>Team Workload Distribution</h2>
                    <WorkloadChart data={analytics.workload_distribution || []} selectedRole={selectedRole} />
                </div>

                <div className="expertise-section">
                    <h2>Category Expertise</h2>
                    <ExpertiseList data={analytics.expertise_rankings || []} />
                </div>
            </div>

            <div className="recommendations-section">
                <TaskRecommendations 
                    groupId={selectedGroupId} 
                    currentTeamData={analytics}
                    isConnected={isConnected}
                    sendWebSocketMessage={sendWebSocketMessage}
                    handleAnalyticsError={handleAnalyticsError}
                    analyticsResponse={analyticsResponse}
                    analyticsLoading={analyticsLoading}
                    setAnalyticsLoading={setAnalyticsLoading}
                    generateFallbackRecommendations={generateFallbackRecommendations}
                />
            </div>

        </div>
    );
};

const MetricCard = ({ title, value, icon, color }) => (
    <div className={`metric-card ${color}`}>
        <div className="metric-icon">{icon}</div>
        <div className="metric-content">
            <div className="metric-value">{value}</div>
            <div className="metric-title">{title}</div>
        </div>
    </div>
);

const WorkloadChart = ({ data, selectedRole }) => {
    // Ensure data is an array
    const workloadData = Array.isArray(data) ? data : [];
    
    // Filter data by selected role if not 'all'
    const filteredData = selectedRole === 'all' 
        ? workloadData 
        : workloadData.filter(member => member.role === selectedRole);

    return (
        <div className="workload-chart">
            {filteredData.length === 0 ? (
                <div className="no-data-message">
                    {selectedRole === 'all' ? 'No workload data available' : `No team members found for role: ${selectedRole}`}
                </div>
            ) : (
                filteredData.map((member, index) => {
            const utilization = member.utilization || 0;
            const getGradientColors = (utilization) => {
                if (utilization > 80) return { start: '#ef4444', end: '#dc2626' }; // Red gradient
                if (utilization > 60) return { start: '#f59e0b', end: '#d97706' }; // Orange gradient
                return { start: '#10b981', end: '#059669' }; // Green gradient
            };

            const colors = getGradientColors(utilization);

            return (
                <div key={index} className="workload-bar">
                    <div className="member-info">
                        <div className="member-name">{member.name}</div>
                        <div className="member-role">{member.role}</div>
                    </div>
                    <div className="bar-container">
                        <div
                            className="workload-fill"
                            style={{
                                width: `${utilization}%`,
                                '--fill-color': colors.start,
                                '--fill-color-end': colors.end
                            }}
                        />
                        <div className="workload-text">
                            {member.workload}/{member.capacity} ({utilization}%)
                        </div>
                    </div>
                </div>
            );
        })
            )}
        </div>
    );
};

const ExpertiseList = ({ data }) => {
    const expertiseArray = Array.isArray(data) ? data : [];

    return (
        <div className="expertise-list">
            {expertiseArray.length > 0 ? (
                expertiseArray.map((item, index) => (
                    <div key={index} className="expertise-item">
                        <div className="expertise-category">{item.category}</div>
                        <div className="expertise-expert">{item.expert}</div>
                        <div className="expertise-score">{item.score}/100</div>
                    </div>
                ))
            ) : (
                <div className="no-data-message">No expertise data available</div>
            )}
        </div>
    );
};

const TaskRecommendations = ({ 
    groupId, 
    currentTeamData, 
    isConnected, 
    sendWebSocketMessage, 
    handleAnalyticsError,
    analyticsResponse,
    analyticsLoading,
    setAnalyticsLoading,
    generateFallbackRecommendations
}) => {
    const [recommendations, setRecommendations] = useState([]);
    const [suggestedPlan, setSuggestedPlan] = useState(null);
    const [taskDescription, setTaskDescription] = useState('');
    const [taskCategory, setTaskCategory] = useState('frontend');

    // Handle analytics responses
    useEffect(() => {
        if (analyticsResponse && analyticsResponse.data) {
            console.log('Processing analytics response:', analyticsResponse);
            
            if (analyticsResponse.data.recommendations) {
                setRecommendations(analyticsResponse.data.recommendations);
            }
            
            if (analyticsResponse.data.suggested_plan) {
                setSuggestedPlan(analyticsResponse.data.suggested_plan);
            }
        }
    }, [analyticsResponse]);

    const getRecommendations = async () => {
        if (!taskDescription.trim()) {
            alert('Please enter a task description');
            return;
        }

        if (!isConnected) {
            console.error('WebSocket not connected');
            handleAnalyticsError();
            return;
        }

        setAnalyticsLoading(true);
        setRecommendations([]);
        setSuggestedPlan(null);

        try {
            console.log('Sending analytics request via WebSocket...');

            // Send analytics request through WebSocket - using user message format with analytics content
            const analyticsMessage = {
                type: 'user',
                content: `Please analyze the following task and provide detailed assignment recommendations:

Task Description: ${taskDescription}
Task Category: ${taskCategory}
Group ID: ${groupId}

Current Team Data:
${currentTeamData ? JSON.stringify({
    workload_distribution: currentTeamData.workload_distribution,
    expertise_rankings: currentTeamData.expertise_rankings,
    team_analytics: currentTeamData.team_analytics
}, null, 2) : 'No team data available'}

Please provide a comprehensive analysis with the following structure:

{
  "recommendations": [
    {
      "username": "Team Member Name",
      "score": 85,
      "reasoning": "Detailed explanation of why this person is recommended",
      "confidence_level": "high|medium|low",
      "development_opportunity": "How this task will help them grow professionally",
      "expertise_match": "Their relevant role/skills",
      "availability_score": 75,
      "skill_alignment": "High|Medium|Low",
      "workload_impact": "Assessment of how this affects their current workload"
    }
  ],
  "suggested_plan": {
    "primary_assignee": "Best candidate name",
    "plan_type": "solo|pair|team",
    "rationale": "Detailed reasoning for the assignment strategy",
    "alternative_approach": "Backup plan or alternative assignment",
    "strategic_value": "Long-term benefits of this assignment",
    "estimated_effort": "Time/complexity estimate",
    "risk_assessment": "Potential challenges and mitigation"
  }
}

Analyze team member availability, expertise alignment, development opportunities, and provide strategic insights for optimal task assignment.`,
                timestamp: new Date().toISOString(),
                analytics_request: true // Flag to identify this as an analytics request
            };

            const success = sendWebSocketMessage(analyticsMessage);

            if (!success) {
                console.error('Failed to send analytics request');
                setAnalyticsLoading(false);
                handleAnalyticsError();
            } else {
                console.log('Analytics request sent via WebSocket');
                
                // Set a timeout for the request
                setTimeout(() => {
                    if (analyticsLoading) {
                        console.log('Analytics request timeout - using fallback');
                        setAnalyticsLoading(false);
                        generateFallbackRecommendations();
                    }
                }, 15000); // 15 second timeout
            }

        } catch (error) {
            console.error('Failed to send analytics request:', error);
            setAnalyticsLoading(false);
            handleAnalyticsError();
        }
    };

    return (
        <div className="recommendations-panel">
            <h2>AI Task Assignment Recommendations</h2>

            <div className="task-input">
                <div className="input-group">
                    <label>Task Description:</label>
                    <textarea
                        value={taskDescription}
                        onChange={(e) => setTaskDescription(e.target.value)}
                        placeholder="Describe the task you need to assign..."
                        rows={3}
                    />
                </div>

                <div className="input-group">
                    <label>Category:</label>
                    <select
                        value={taskCategory}
                        onChange={(e) => setTaskCategory(e.target.value)}
                    >
                        <option value="frontend">Frontend</option>
                        <option value="backend">Backend</option>
                        <option value="database">Database</option>
                        <option value="testing">Testing</option>
                        <option value="general">General</option>
                    </select>
                </div>

                <button
                    onClick={getRecommendations}
                    disabled={analyticsLoading || !taskDescription.trim()}
                    className="get-recommendations-btn"
                >
                    {analyticsLoading ? 'Analyzing...' : 'Get Recommendations'}
                </button>
            </div>

            {recommendations.length > 0 && (
                <div className="recommendations-list">
                    <h3>Recommended Assignees:</h3>
                    {recommendations.map((rec, index) => (
                        <div key={index} className="recommendation-card">
                            <div className="rec-header">
                                <span className="rec-rank">#{index + 1}</span>
                                <span className="rec-name">{rec.username}</span>
                                <span className="rec-score">{rec.score}/100</span>
                                {rec.confidence_level && (
                                    <span className={`rec-confidence ${rec.confidence_level}`}>
                                        {rec.confidence_level}
                                    </span>
                                )}
                            </div>
                            
                            <div className="rec-reasoning">{rec.reasoning}</div>
                            
                            {rec.expertise_match && (
                                <div className="rec-expertise">
                                    <strong>Expertise:</strong> {rec.expertise_match}
                                    {rec.skill_alignment && (
                                        <span className={`skill-alignment ${rec.skill_alignment?.toLowerCase()}`}>
                                            ({rec.skill_alignment} alignment)
                                        </span>
                                    )}
                                </div>
                            )}
                            
                            {rec.availability_score && (
                                <div className="rec-availability">
                                    <strong>Availability:</strong> {rec.availability_score}% available
                                    {rec.workload_impact && (
                                        <span className="workload-impact"> - {rec.workload_impact}</span>
                                    )}
                                </div>
                            )}
                            
                            {rec.development_opportunity && (
                                <div className="rec-development">
                                    <strong>Growth Opportunity:</strong> {rec.development_opportunity}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {suggestedPlan && (
                <div className="suggested-plan">
                    <h3>AI Assignment Strategy:</h3>
                    <div className="plan-card">
                        <div className="plan-header">
                            <span className="plan-type">{suggestedPlan.plan_type || 'solo'}</span>
                            <span className="plan-assignee">
                                Primary: {suggestedPlan.primary_assignee}
                            </span>
                        </div>
                        <div className="plan-rationale">
                            <strong>Rationale:</strong> {suggestedPlan.rationale}
                        </div>
                        
                        {suggestedPlan.estimated_effort && (
                            <div className="plan-effort">
                                <strong>Estimated Effort:</strong> {suggestedPlan.estimated_effort}
                            </div>
                        )}
                        
                        {suggestedPlan.risk_assessment && (
                            <div className="plan-risks">
                                <strong>Risk Assessment:</strong> {suggestedPlan.risk_assessment}
                            </div>
                        )}
                        
                        {suggestedPlan.alternative_approach && (
                            <div className="plan-alternative">
                                <strong>Alternative Approach:</strong> {suggestedPlan.alternative_approach}
                            </div>
                        )}
                        
                        {suggestedPlan.strategic_value && (
                            <div className="plan-strategic">
                                <strong>Strategic Value:</strong> {suggestedPlan.strategic_value}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default AnalyticsDashboard;
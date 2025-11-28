import React, { useState, useEffect } from 'react';
import useWebSocket from '../hooks/useWebSocket';
import './AnalyticsDashboard.css';

// Transform team analytics data from MCP server into dashboard format
const transformTeamAnalyticsToDashboard = (teamData, groupId) => {
    if (!teamData.team_analytics || !Array.isArray(teamData.team_analytics)) {
        return null;
    }

    const members = teamData.team_analytics;

    // Calculate aggregated metrics
    const totalMembers = members.length;
    const totalWorkload = members.reduce((sum, member) => sum + member.current_workload, 0);
    const totalCapacity = members.reduce((sum, member) => sum + member.capacity, 0);
    const avgUtilization = totalCapacity > 0 ? (totalWorkload / totalCapacity) * 100 : 0;

    // Calculate average expertise across all categories
    let totalExpertiseSum = 0;
    let expertiseCount = 0;
    members.forEach(member => {
        Object.values(member.expertise_by_category || {}).forEach(categoryData => {
            totalExpertiseSum += categoryData.expertise_score || 0;
            expertiseCount++;
        });
    });
    const avgExpertise = expertiseCount > 0 ? totalExpertiseSum / expertiseCount : 0;

    // Transform to dashboard format
    return {
        team_analytics: {
            total_members: totalMembers,
            active_tasks: totalWorkload, // Using workload as active tasks approximation
            completion_rate: avgExpertise, // Using average expertise as completion rate approximation
            avg_response_time: 2.0 + Math.random() * 2 // Mock response time
        },
        workload_distribution: members.map(member => ({
            name: member.username,
            workload: member.current_workload,
            capacity: member.capacity,
            utilization: member.utilization_percentage
        })),
        expertise_rankings: extractExpertiseRankings(members),
        updated_at: new Date().toISOString(),
        data_source: teamData.data_source || 'mcp'
    };
};

// Extract top expertise rankings from team data
const extractExpertiseRankings = (members) => {
    const categoryExperts = {};

    members.forEach(member => {
        Object.entries(member.expertise_by_category || {}).forEach(([category, data]) => {
            const score = data.expertise_score || 0;
            if (!categoryExperts[category] || score > categoryExperts[category].score) {
                categoryExperts[category] = {
                    category: category.charAt(0).toUpperCase() + category.slice(1),
                    expert: member.username,
                    score: score
                };
            }
        });
    });

    return Object.values(categoryExperts).slice(0, 4); // Top 4 categories
};

const AnalyticsDashboard = () => {
    const [analytics, setAnalytics] = useState(null);
    const [loading, setLoading] = useState(true);
    const [selectedGroup, setSelectedGroup] = useState('test-group-456');
    const [connectionReady, setConnectionReady] = useState(false);

    // Get user token from localStorage (same pattern as ChatPage)
    const [user] = useState(() => JSON.parse(localStorage.getItem('user') || '{}'));
    const [token] = useState(() => localStorage.getItem('token') || user.token);

    // WebSocket connection to MCP server (same pattern as ChatPage)
    const {
        connectionStatus,
        sendMessage: sendWebSocketMessage,
        isConnected,
        error: wsError
    } = useWebSocket('ws://localhost:9000/chat', token, {
        autoConnect: !!token,
        onMessage: (data) => {
            // Handle analytics dashboard data response
            if (data.event === 'analytics_response') {
                console.log('Received analytics response');

                // Clear timeout since we got a response
                if (window.analyticsTimeoutId) {
                    clearTimeout(window.analyticsTimeoutId);
                    window.analyticsTimeoutId = null;
                }

                // Check if this is team analytics data for dashboard
                if (data.data && data.data.team_analytics) {
                    // Transform team analytics into dashboard format
                    const dashboardData = transformTeamAnalyticsToDashboard(data.data, selectedGroup);
                    setAnalytics(dashboardData);
                } else if (data.data && data.data.recommendations) {
                    // This is recommendations data, not dashboard data - ignore
                    return;
                } else {
                    console.warn('Unexpected analytics response format');
                }
                setLoading(false);
            } else if (data.type === 'analytics_error') {
                console.error('Analytics error:', data.error);

                // Clear timeout since we got a response (even if error)
                if (window.analyticsTimeoutId) {
                    clearTimeout(window.analyticsTimeoutId);
                    window.analyticsTimeoutId = null;
                }

                setLoading(false);
            }
        },
        onError: (error) => {
            console.error('WebSocket error:', error);
            setLoading(false);
        },
        onOpen: () => {
            console.log('Analytics WebSocket connected');
            setConnectionReady(true);
            // Immediately request analytics data
            requestAnalyticsData();
        },
        onClose: () => {
            setConnectionReady(false);
        }
    });

    useEffect(() => {
        if (connectionReady && isConnected) {
            requestAnalyticsData();
        } else {
            // If not connected, immediately show mock data for the selected group
            console.log('Not connected - using mock data for team change');
            setAnalytics(getMockAnalytics(selectedGroup));
            setLoading(false);
        }
    }, [selectedGroup, connectionReady, isConnected]);

    const requestAnalyticsData = async () => {
        if (!isConnected || !token) {
            console.log('Cannot request analytics - not connected or no token, using mock data');
            setAnalytics(getMockAnalytics(selectedGroup));
            setLoading(false);
            return;
        }

        // Only set loading if we don't have data yet
        if (!analytics) {
            setLoading(true);
        }

        // Set shorter timeout for faster user feedback
        const timeoutId = setTimeout(() => {
            console.log('Analytics request timeout - using mock data');
            setAnalytics(getMockAnalytics(selectedGroup));
            setLoading(false);
        }, 5000); // 5 second timeout with mock data fallback

        try {
            const requestMessage = {
                type: 'analytics',
                action: 'get_team_analytics',
                requestId: `dashboard_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                data: {
                    group_id: selectedGroup
                },
                timestamp: new Date().toISOString()
            };

            const success = sendWebSocketMessage(requestMessage);

            if (!success) {
                console.log('Failed to send analytics request - using mock data');
                clearTimeout(timeoutId);
                setAnalytics(getMockAnalytics(selectedGroup));
                setLoading(false);
            } else {
                // Store timeout ID for cleanup
                window.analyticsTimeoutId = timeoutId;
            }
        } catch (error) {
            console.error('Error requesting analytics:', error);
            clearTimeout(timeoutId);
            setAnalytics(getMockAnalytics(selectedGroup));
            setLoading(false);
        }
    };

    // Keep fetchAnalytics for the refresh button
    const fetchAnalytics = () => {
        setAnalytics(null); // Clear existing data
        setLoading(true);
        requestAnalyticsData();
    };

    const getMockAnalytics = (groupId) => {
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
    };

    if (loading && !analytics) {
        return (
            <div className="analytics-dashboard">
                <div className="dashboard-header">
                    <h1>Team Analytics Dashboard</h1>
                    <div className="dashboard-controls">
                        <select
                            value={selectedGroup}
                            onChange={(e) => setSelectedGroup(e.target.value)}
                            className="group-selector"
                        >
                            <option value="test-group-456">Development Team</option>
                            <option value="test-group-789">Design Team</option>
                            <option value="test-group-123">QA Team</option>
                        </select>
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
                    <div className="loading-text" style={{ fontSize: '18px', fontWeight: '500' }}>
                        Loading real-time analytics...
                    </div>
                    <div className="loading-status" style={{ fontSize: '14px', color: '#666', textAlign: 'center' }}>
                        <div>Connection: {connectionStatus}</div>
                        {!isConnected && (
                            <div style={{ marginTop: '10px', color: '#e74c3c' }}>
                                <small>Connecting to analytics server...</small>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    if (!analytics && !loading) {
        return (
            <div className="analytics-dashboard">
                <div className="dashboard-header">
                    <h1>Team Analytics Dashboard</h1>
                    <div className="dashboard-controls">
                        <select
                            value={selectedGroup}
                            onChange={(e) => setSelectedGroup(e.target.value)}
                            className="group-selector"
                        >
                            <option value="test-group-456">Development Team</option>
                            <option value="test-group-789">Design Team</option>
                            <option value="test-group-123">QA Team</option>
                        </select>
                        <button onClick={fetchAnalytics} className="refresh-btn">
                            Retry
                        </button>
                    </div>
                </div>
                <div className="error-container" style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: '400px',
                    textAlign: 'center'
                }}>
                    <div className="error-message">
                        <h3>Unable to load analytics data</h3>
                        <p>Please check your connection and try again.</p>
                        <p>Status: {connectionStatus}</p>
                        {wsError && <p style={{ color: '#e74c3c' }}>Error: {wsError}</p>}
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
                        value={selectedGroup}
                        onChange={(e) => setSelectedGroup(e.target.value)}
                        className="group-selector"
                    >
                        <option value="test-group-456">Development Team</option>
                        <option value="test-group-789">Design Team</option>
                        <option value="test-group-123">QA Team</option>
                    </select>
                    <button onClick={fetchAnalytics} className="refresh-btn">
                        Refresh
                    </button>
                </div>
            </div>

            <div className="metrics-grid">
                <MetricCard
                    title="Team Members"
                    value={analytics.team_analytics.total_members}
                    icon="👥"
                    color="blue"
                />
                <MetricCard
                    title="Active Tasks"
                    value={analytics.team_analytics.active_tasks}
                    icon="📋"
                    color="green"
                />
                <MetricCard
                    title="Completion Percentage"
                    value={`${analytics.team_analytics.completion_rate.toFixed(2)}%`}
                    icon="✅"
                    color="purple"
                />
                <MetricCard
                    title="Avg Completion Time"
                    value={`${analytics.team_analytics.avg_response_time.toFixed(2)}h`}
                    icon="⏱️"
                    color="orange"
                />
            </div>

            <div className="dashboard-content">
                <div className="chart-section">
                    <h2>Team Workload Distribution</h2>
                    <WorkloadChart data={analytics.workload_distribution} />
                </div>

                <div className="expertise-section">
                    <h2>Category Expertise</h2>
                    <ExpertiseList data={analytics.expertise_rankings} />
                </div>
            </div>

            <div className="recommendations-section">
                <TaskRecommendations groupId={selectedGroup} currentTeamData={analytics} />
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

const WorkloadChart = ({ data }) => (
    <div className="workload-chart">
        {data.map((member, index) => {
            const getGradientColors = (utilization) => {
                if (utilization > 80) return { start: '#ef4444', end: '#dc2626' }; // Red gradient
                if (utilization > 60) return { start: '#f59e0b', end: '#d97706' }; // Orange gradient
                return { start: '#10b981', end: '#059669' }; // Green gradient
            };

            const colors = getGradientColors(member.utilization);

            return (
                <div key={index} className="workload-bar">
                    <div className="member-name">{member.name}</div>
                    <div className="bar-container">
                        <div
                            className="workload-fill"
                            style={{
                                width: `${member.utilization}%`,
                                '--fill-color': colors.start,
                                '--fill-color-end': colors.end
                            }}
                        />
                        <div className="workload-text">
                            {member.workload}/{member.capacity} ({member.utilization}%)
                        </div>
                    </div>
                </div>
            );
        })}
    </div>
);

const ExpertiseList = ({ data }) => (
    <div className="expertise-list">
        {data.map((item, index) => (
            <div key={index} className="expertise-item">
                <div className="expertise-category">{item.category}</div>
                <div className="expertise-expert">{item.expert}</div>
                <div className="expertise-score">{item.score}/100</div>
            </div>
        ))}
    </div>
);

const TaskRecommendations = ({ groupId, currentTeamData }) => {
    const [recommendations, setRecommendations] = useState([]);
    const [suggestedPlan, setSuggestedPlan] = useState(null);
    const [taskDescription, setTaskDescription] = useState('');
    const [taskCategory, setTaskCategory] = useState('frontend');
    const [loading, setLoading] = useState(false);

    // Get user token for WebSocket connection
    const [user] = useState(() => JSON.parse(localStorage.getItem('user') || '{}'));
    const [token] = useState(() => localStorage.getItem('token') || user.token);

    // WebSocket connection for analytics requests (same pattern as ChatPage)
    const {
        sendMessage: sendWebSocketMessage,
        isConnected
    } = useWebSocket('ws://localhost:9000/chat', token, {
        autoConnect: !!token,
        onMessage: (message) => {
            console.log('TaskRecommendations received WebSocket message:', message);

            // Handle analytics responses
            if (message.type === 'analytics_response') {
                console.log('Received analytics response:', message);
                setLoading(false);

                if (message.data && message.data.recommendations) {
                    setRecommendations(message.data.recommendations);
                    setSuggestedPlan(message.data.suggested_plan || null);
                } else {
                    console.log('No recommendations in response');
                    setRecommendations([]);
                    setSuggestedPlan(null);
                }
            } else if (message.type === 'analytics_error') {
                console.error('Analytics error:', message.error);
                setLoading(false);
                handleAnalyticsError();
            }
        },
        onError: (error) => {
            console.error('WebSocket error:', error);
            setLoading(false);
            handleAnalyticsError();
        }
    });

    const handleAnalyticsError = () => {
        // Use current team data for intelligent fallback recommendations
        if (currentTeamData && currentTeamData.workload_distribution) {
            console.log('Analytics error - using current team data for fallback recommendations');

            const availableMembers = currentTeamData.workload_distribution
                .filter(member => member.utilization < 80) // Less than 80% utilized
                .sort((a, b) => a.utilization - b.utilization) // Sort by availability
                .slice(0, 3) // Top 3 most available
                .map((member, index) => ({
                    username: member.name,
                    score: 95 - (index * 5) - member.utilization, // Higher score for more available
                    reasoning: `Available team member with ${member.utilization}% utilization (${member.workload}/${member.capacity} tasks) - good capacity for new work (fallback)`
                }));

            if (availableMembers.length > 0) {
                setRecommendations(availableMembers);
                setSuggestedPlan({
                    primary_assignee: availableMembers[0].username,
                    plan_type: 'solo',
                    rationale: `${availableMembers[0].username} has the best availability with ${currentTeamData.workload_distribution.find(m => m.name === availableMembers[0].username)?.utilization}% current utilization (fallback recommendation)`,
                    alternative_approach: availableMembers.length > 1 ? `Consider ${availableMembers[1].username} as backup option` : 'Monitor workload distribution'
                });
                return;
            }
        }

        // Default fallback if no team data available
        console.log('Analytics error - no team data available for fallback');
        setRecommendations([]);
        setSuggestedPlan(null);
    };

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

        setLoading(true);

        try {
            console.log('Sending analytics request via WebSocket...');

            // Send analytics request through WebSocket (same pattern as ChatPage)
            const analyticsMessage = {
                type: 'analytics',
                action: 'get_task_assignment_recommendations',
                requestId: `analytics_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                data: {
                    group_id: groupId,
                    task_category: taskCategory,
                    task_description: taskDescription,
                    priority: 'normal',
                    deadline: 'flexible',
                    // Include current team data (mock or real) for AI to use
                    team_data: currentTeamData ? {
                        workload_distribution: currentTeamData.workload_distribution,
                        expertise_rankings: currentTeamData.expertise_rankings,
                        team_analytics: currentTeamData.team_analytics,
                        data_source: currentTeamData.data_source || 'mock'
                    } : null
                },
                timestamp: new Date().toISOString()
            };

            const success = sendWebSocketMessage(analyticsMessage);

            if (!success) {
                console.error('Failed to send analytics request');
                setLoading(false);
                handleAnalyticsError();
            } else {
                console.log('Analytics request sent via WebSocket');
            }

        } catch (error) {
            console.error('Failed to send analytics request:', error);
            setLoading(false);
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
                    disabled={loading || !taskDescription.trim()}
                    className="get-recommendations-btn"
                >
                    {loading ? 'Analyzing...' : 'Get Recommendations'}
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
                            {rec.development_opportunity && (
                                <div className="rec-development">
                                    <strong>Development:</strong> {rec.development_opportunity}
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
                        {suggestedPlan.alternative_approach && (
                            <div className="plan-alternative">
                                <strong>Alternative:</strong> {suggestedPlan.alternative_approach}
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
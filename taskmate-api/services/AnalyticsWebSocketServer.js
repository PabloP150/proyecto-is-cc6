const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

class AnalyticsWebSocketServer {
    constructor(server) {
        // Create WebSocket server for analytics
        this.wss = new WebSocket.Server({
            server,
            path: '/analytics',
            verifyClient: this.verifyClient.bind(this)
        });

        this.activeConnections = new Map(); // userId -> ws connection
        this.setupEventHandlers();
        this.setupHeartbeat();
        console.log('Analytics WebSocket server initialized on /analytics path');
    }

    verifyClient(info) {
        try {
            // Extract token from query parameters or headers
            const url = new URL(info.req.url, `http://${info.req.headers.host}`);
            const token = url.searchParams.get('token') || 
                         info.req.headers.authorization?.replace('Bearer ', '');

            if (!token) {
                console.log('Analytics WebSocket connection rejected: No token provided');
                return false;
            }

            // Verify JWT token
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
            
            // Store user info in request for later use
            info.req.userId = decoded.userId || decoded.id;
            
            console.log(`Analytics WebSocket connection verified for user: ${info.req.userId}`);
            return true;

        } catch (error) {
            console.log('Analytics WebSocket connection rejected: Invalid token', error.message);
            return false;
        }
    }

    setupEventHandlers() {
        this.wss.on('connection', (ws, req) => {
            try {
                const userId = req.userId;
                // Store connection
                this.activeConnections.set(userId, ws);

                // Send connection confirmation
                this.sendMessage(ws, {
                    type: 'analytics_connected',
                    message: 'Analytics WebSocket connected successfully',
                    timestamp: new Date().toISOString()
                });

                // Handle incoming analytics requests
                ws.on('message', async (data) => {
                    try {
                        const message = JSON.parse(data.toString());
                        await this.handleAnalyticsRequest(ws, userId, message);
                    } catch (error) {
                        console.error('Error parsing analytics message:', error);
                        this.sendMessage(ws, {
                            type: 'analytics_error',
                            error: 'Invalid message format',
                            timestamp: new Date().toISOString()
                        });
                    }
                });

                // Handle connection close
                ws.on('close', () => {
                    this.activeConnections.delete(userId);
                });

                // Handle connection errors
                ws.on('error', (error) => {
                    console.error(`Analytics WebSocket error for user ${userId}:`, error);
                    this.activeConnections.delete(userId);
                });

            } catch (error) {
                console.error('Error handling Analytics WebSocket connection:', error);
                ws.close(1011, 'Server error during connection setup');
            }
        });

        this.wss.on('error', (error) => {
            console.error('Analytics WebSocket server error:', error);
        });
    }

    async handleAnalyticsRequest(ws, userId, message) {
        // Only log important requests, not every single one
        if (message.action !== 'get_team_analytics') {
            console.log(`Analytics request from user ${userId}:`, message.type, message.action);
        }

        try {
            switch (message.action) {
                case 'get_team_analytics':
                    await this.handleTeamAnalyticsRequest(ws, message);
                    break;
                
                case 'get_task_assignment_recommendations':
                    await this.handleTaskRecommendationsRequest(ws, message);
                    break;
                
                default:
                    this.sendMessage(ws, {
                        type: 'analytics_error',
                        error: `Unknown analytics action: ${message.action}`,
                        requestId: message.requestId,
                        timestamp: new Date().toISOString()
                    });
            }
        } catch (error) {
            console.error('Error handling analytics request:', error);
            this.sendMessage(ws, {
                type: 'analytics_error',
                error: 'Internal server error processing analytics request',
                requestId: message.requestId,
                timestamp: new Date().toISOString()
            });
        }
    }

    async handleTeamAnalyticsRequest(ws, message) {
        // Simulate analytics processing delay
        setTimeout(() => {
            const mockTeamAnalytics = this.generateMockTeamAnalytics(message.data.group_id);
            
            this.sendMessage(ws, {
                type: 'analytics_response',
                event: 'analytics_response',
                data: mockTeamAnalytics,
                requestId: message.requestId,
                timestamp: new Date().toISOString()
            });
        }, 1000); // 1 second delay to simulate processing
    }

    async handleTaskRecommendationsRequest(ws, message) {
        // Simulate AI processing delay
        setTimeout(() => {
            const recommendations = this.generateMockRecommendations(message.data);
            
            this.sendMessage(ws, {
                type: 'analytics_response',
                event: 'analytics_response',
                data: {
                    recommendations: recommendations.recommendations,
                    suggested_plan: recommendations.suggested_plan
                },
                requestId: message.requestId,
                timestamp: new Date().toISOString()
            });
        }, 2000); // 2 second delay to simulate AI processing
    }

    generateMockTeamAnalytics(groupId) {
        const teamData = {
            'test-group-456': {
                team_analytics: [
                    {
                        username: 'Sarah Chen',
                        current_workload: 4,
                        capacity: 5,
                        utilization_percentage: 80,
                        expertise_by_category: {
                            frontend: { expertise_score: 94 },
                            backend: { expertise_score: 75 }
                        }
                    },
                    {
                        username: 'Marcus Johnson',
                        current_workload: 3,
                        capacity: 5,
                        utilization_percentage: 60,
                        expertise_by_category: {
                            backend: { expertise_score: 89 },
                            database: { expertise_score: 82 }
                        }
                    },
                    {
                        username: 'Elena Rodriguez',
                        current_workload: 5,
                        capacity: 6,
                        utilization_percentage: 83,
                        expertise_by_category: {
                            database: { expertise_score: 91 },
                            backend: { expertise_score: 78 }
                        }
                    },
                    {
                        username: 'David Kim',
                        current_workload: 2,
                        capacity: 4,
                        utilization_percentage: 50,
                        expertise_by_category: {
                            testing: { expertise_score: 86 },
                            frontend: { expertise_score: 70 }
                        }
                    }
                ],
                data_source: 'analytics_websocket'
            }
        };

        return teamData[groupId] || teamData['test-group-456'];
    }

    generateMockRecommendations(requestData) {
        const { task_category, task_description, team_data } = requestData;
        
        // Generate intelligent recommendations based on team data
        const recommendations = [];
        const availableMembers = team_data?.workload_distribution || [];
        
        // Sort by availability and expertise
        const sortedMembers = availableMembers
            .filter(member => member.utilization < 90) // Not overloaded
            .sort((a, b) => {
                // Prioritize by lower utilization and higher capacity
                const aScore = (100 - a.utilization) + (a.capacity * 10);
                const bScore = (100 - b.utilization) + (b.capacity * 10);
                return bScore - aScore;
            })
            .slice(0, 3); // Top 3 candidates

        sortedMembers.forEach((member, index) => {
            const baseScore = 85 - (index * 5) - (member.utilization * 0.3);
            const confidence = index === 0 ? 'high' : index === 1 ? 'medium' : 'low';
            
            recommendations.push({
                username: member.name,
                score: Math.round(baseScore),
                confidence_level: confidence,
                reasoning: `${member.name} has ${member.utilization}% utilization (${member.workload}/${member.capacity} tasks) and good availability for ${task_category} work. ${index === 0 ? 'Best match based on current workload.' : `Alternative option with ${confidence} confidence.`}`,
                development_opportunity: index > 0 ? `Could be a good learning opportunity for ${task_category} skills` : null
            });
        });

        const suggested_plan = recommendations.length > 0 ? {
            primary_assignee: recommendations[0].username,
            plan_type: 'solo',
            rationale: `${recommendations[0].username} is the best choice with ${recommendations[0].score}/100 match score and ${recommendations[0].confidence_level} confidence for this ${task_category} task.`,
            alternative_approach: recommendations.length > 1 ? 
                `Consider ${recommendations[1].username} as backup or for pair programming` : 
                'Monitor workload and reassess if needed'
        } : null;

        return { recommendations, suggested_plan };
    }

    sendMessage(ws, message) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
            return true;
        }
        return false;
    }

    broadcast(message) {
        this.activeConnections.forEach((ws, userId) => {
            this.sendMessage(ws, message);
        });
    }

    sendToUser(userId, message) {
        const ws = this.activeConnections.get(userId);
        if (ws) {
            return this.sendMessage(ws, message);
        }
        return false;
    }

    setupHeartbeat() {
        // Send ping to all connected clients every 30 seconds
        this.heartbeatInterval = setInterval(() => {
            this.activeConnections.forEach((ws, userId) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.ping();
                } else {
                    this.activeConnections.delete(userId);
                }
            });
        }, 30000); // 30 seconds
    }

    getActiveConnections() {
        return this.activeConnections.size;
    }

    disconnectUser(userId) {
        const ws = this.activeConnections.get(userId);
        if (ws) {
            ws.close();
            this.activeConnections.delete(userId);
            return true;
        }
        return false;
    }

    getConnectionInfo() {
        const connections = [];
        this.activeConnections.forEach((ws, userId) => {
            connections.push({
                userId,
                readyState: ws.readyState,
                connectedAt: new Date().toISOString() // Could store actual connection time
            });
        });

        return {
            activeConnections: this.activeConnections.size,
            connections
        };
    }

    close() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        this.activeConnections.clear();
        this.wss.close();
    }
}

module.exports = AnalyticsWebSocketServer;
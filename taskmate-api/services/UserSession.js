const fetch = require('node-fetch');

const PYTHON_LLM_SERVICE_BASE_URL = 'http://localhost:8001';

class UserSession {
    constructor(userId, websocket) {
        this.userId = userId;
        this.websocket = websocket;
        this.context = null;
        this.createdAt = new Date();
        this.lastActivity = new Date();
        this.state = { pending_action: null, data: null };
    }

    async initialize() {
        try {
            // Initialize user context (will be implemented in later tasks)
            this.context = {
                userId: this.userId,
                tasks: [],
                groups: [],
                preferences: {},
                lastUpdated: new Date()
            };

            // Send welcome message
            this.sendMessage({
                type: 'system',
                content: 'Connected to TaskMate AI Assistant',
                timestamp: new Date()
            });

        } catch (error) {
            console.error('Error initializing user session:', error);
            throw error;
        }
    }

    async handleMessage(message) {
        try {
            this.lastActivity = new Date();
            
            console.log(`Message from user ${this.userId}:`, message);
            
            if (message.type !== 'user' || !message.content) {
                console.log(`Received non-user message type: ${message.type}`);
                return;
            }

            const userContent = message.content;

            console.log(`UserSession State: ${JSON.stringify(this.state)}`);

            if (this.state.pending_action) {
                console.log(`Pending action detected: ${this.state.pending_action}`);
                const response = await fetch(`${PYTHON_LLM_SERVICE_BASE_URL}/is_affirmative`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: userContent }),
                });
                const data = await response.json();
                const isAffirmative = data.is_affirmative;
                console.log(`User response is affirmative: ${isAffirmative}`);

                if (isAffirmative) {
                    await this.handleAffirmativeResponse();
                } else {
                    this.resetState();
                    this.sendMessage({
                        type: 'assistant',
                        content: 'Okay, what would you like to do instead?',
                        timestamp: new Date(),
                    });
                }
            } else {
                const response = await fetch(`${PYTHON_LLM_SERVICE_BASE_URL}/classify_intent`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: userContent }),
                });
                const data = await response.json();
                const intent = data.intent;
                console.log(`Classified Intent: ${intent}`);

                if (intent === 'create_new_project') {
                    this.state.pending_action = 'confirm_new_project';
                    this.state.data = { original_message: userContent };
                    console.log(`Updated UserSession State: ${JSON.stringify(this.state)}`);
                    this.sendMessage({
                        type: 'assistant',
                        content: 'It seems you want to start a new project. Shall I help you plan it?',
                        timestamp: new Date(),
                    });
                } else {
                    const response = await fetch(`${PYTHON_LLM_SERVICE_BASE_URL}/generate_response`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ message: userContent, context: this.context }),
                    });
                    const data = await response.json();
                    const llmResponse = data.response;
                    this.sendMessage({
                        type: 'assistant',
                        content: llmResponse,
                        timestamp: new Date(),
                    });
                }
            }
        } catch (error) {
            console.error('Error handling message:', error);
            this.sendMessage({
                type: 'system',
                content: 'Sorry, there was an error processing your message. Please try again.',
                timestamp: new Date(),
            });
        }
    }

    async handleAffirmativeResponse() {
        if (this.state.pending_action === 'confirm_new_project') {
            console.log(`Handling affirmative response for 'confirm_new_project'. Fetching recommendations...`);
            this.state.pending_action = 'confirm_save_tasks';
            const response = await fetch('http://localhost:9000/api/mcp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'request',
                    sender: 'OrchestratorAgent',
                    receiver: 'RecommendationsAgent',
                    payload: { idea: this.state.data.original_message },
                }),
            });
            const data = await response.json();
            const recommendations = data.payload.recommendations;
            this.state.data.project_name = recommendations.project_name;
            this.state.data.project_description = recommendations.project_description;
            this.state.data.tasks = recommendations.tasks;
            this.state.data.milestones = recommendations.milestones;
            console.log(`Received recommendations: ${JSON.stringify(this.state.data)}`);

            let planDetails = `Here is a plan for your project: ${recommendations.project_name}\n\n`;
            if (recommendations.project_description) {
                planDetails += `Description: ${recommendations.project_description}\n\n`;
            }
            planDetails += 'Tasks:\n';
            recommendations.tasks.forEach(t => {
                planDetails += `- ${t.name}: ${t.description} (Due: ${t.due_date}, Status: ${t.status})\n`;
            });
            if (recommendations.milestones && recommendations.milestones.length > 0) {
                planDetails += '\nMilestones:\n';
                recommendations.milestones.forEach(m => {
                    planDetails += `- ${m.name}: ${m.description} (Date: ${m.date})\n`;
                });
            }
            planDetails += '\nDo you want to save this plan?';

            this.sendMessage({
                type: 'assistant',
                content: planDetails,
                timestamp: new Date(),
            });
        } else if (this.state.pending_action === 'confirm_save_tasks') {
            console.log(`Handling affirmative response for 'confirm_save_tasks'. Saving project, tasks, and milestones...`);
            console.log(`Saving data: ${JSON.stringify(this.state.data)}`);
            await fetch('http://localhost:9000/api/mcp/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: this.userId,
                    project_name: this.state.data.project_name,
                    project_description: this.state.data.project_description,
                    tasks: this.state.data.tasks,
                    milestones: this.state.data.milestones,
                }),
            });
            this.sendMessage({
                type: 'assistant',
                content: 'I have saved the project, tasks, and milestones for you.',
                timestamp: new Date(),
            });
            this.resetState();
        }
    }

    resetState() {
        this.state.pending_action = null;
        this.state.data = null;
    }

    sendMessage(message) {
        try {
            if (this.websocket && this.websocket.readyState === 1) { // WebSocket.OPEN
                this.websocket.send(JSON.stringify(message));
            }
        } catch (error) {
            console.error('Error sending message:', error);
        }
    }

    cleanup() {
        // Clean up any resources
        this.context = null;
        
        // Close WebSocket if still open
        if (this.websocket && this.websocket.readyState === 1) {
            this.websocket.close();
        }
    }

    isActive() {
        return this.websocket && this.websocket.readyState === 1;
    }

    updateActivity() {
        this.lastActivity = new Date();
    }
}

module.exports = UserSession;
const LLMService = require('./LLMService');

class UserSession {
    constructor(userId, websocket) {
        this.userId = userId;
        this.websocket = websocket;
        this.context = null;
        this.createdAt = new Date();
        this.lastActivity = new Date();
        this.llmService = new LLMService();
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
            
            // Only process user messages for LLM
            if (message.type === 'user' && message.content) {
                // Generate LLM response with user context
                const llmResponse = await this.llmService.generateResponse(
                    message.content,
                    this.context
                );
                
                this.sendMessage({
                    type: 'assistant',
                    content: llmResponse,
                    timestamp: new Date()
                });
            } else {
                // Handle other message types (system, etc.)
                console.log(`Received non-user message type: ${message.type}`);
            }

        } catch (error) {
            console.error('Error handling message:', error);
            this.sendMessage({
                type: 'system',
                content: 'Sorry, there was an error processing your message. Please try again.',
                timestamp: new Date()
            });
        }
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
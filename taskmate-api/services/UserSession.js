const { v4: uuidv4 } = require('uuid');
const llmService = require('./LLMService');

const projectService = require('./ProjectService');

class UserSession {
    constructor(userId, websocket) {
        this.userId = userId;
        this.websocket = websocket;
        this.sessionId = uuidv4(); // Unique ID for this user's session with the backend
        this.llmService = llmService;
        this.connected = true;
        this.createdAt = new Date();
        this.lastActivity = new Date();
        this.chatHistory = []; // Store chat messages
        this.maxHistorySize = 100; // Limit history to prevent memory issues

        this.initialize();
    }

    initialize() {
        // Remove any existing listeners for this session to avoid duplicates
        this.llmService.removeAllListeners(this.sessionId);

        // Listen for messages from the Python service intended for this session
        this.llmService.on(this.sessionId, (response) => {
            this.forwardResponseToClient(response);
        });

        console.log(`Initialized session ${this.sessionId} for user ${this.userId}`);
    }

    handleMessage(message) {
        this.lastActivity = new Date();

        // Handle heartbeat
        if (message.type === 'ping') {
            this.sendMessage({ type: 'pong' });
            return;
        }

        // Handle analytics requests
        if (message.type === 'analytics') {
            this.handleAnalyticsMessage(message);
            return;
        }

        // Handle regular chat messages
        if (message.type !== 'user' || !message.content) {
            return;
        }

        // Store user message in history
        this.addToHistory({
            type: 'user',
            content: message.content,
            timestamp: new Date()
        });

        const request = {
            requestId: uuidv4(),
            sessionId: this.sessionId,
            method: 'handle_user_message', // All user messages from the client go to this single method
            params: {
                message: message.content,
                context: { userId: this.userId }
            }
        };

        this.llmService.send(request);
    }

    handleAnalyticsMessage(message) {
        console.log(`[UserSession] Handling analytics request for user ${this.userId}:`, message.action);

        const request = {
            requestId: message.requestId || uuidv4(),
            sessionId: this.sessionId,
            type: 'analytics',
            action: message.action,
            data: message.data || {}
        };

        // Send analytics request to MCP server via LLMService
        this.llmService.send(request);
    }

    async forwardResponseToClient(response) {
        const { event, data } = response;
        let messageType = 'assistant'; // Default type

        if (event === 'response') {
            messageType = 'assistant';
            this.sendMessage({ type: messageType, content: data.content, timestamp: new Date() });
        } else if (event === 'response_chunk') {
            messageType = 'assistant_chunk';
            this.sendMessage({ type: messageType, content: data, timestamp: new Date() });
        } else if (event === 'response_stream_end') {
            // The stream end event can be used to signify the end of a stream on the client.
        } else if (event === 'save_plan') {
            console.log('Received save_plan event:', JSON.stringify(data, null, 2));
            const result = await projectService.createProjectFromPlan(data.plan, data.original_message, this.userId);
            if (result.success) {
                this.sendMessage({ type: 'system', content: `Project "${result.groupId}" created successfully!`, timestamp: new Date() });
            } else {
                console.error('Failed to create project:', result.error);
                this.sendMessage({ type: 'system', content: `Failed to create the project: ${result.error}`, timestamp: new Date() });
            }
        } else if (event === 'analytics_response') {
            // Forward analytics responses to the client
            console.log(`[UserSession] Forwarding analytics response to user ${this.userId}`);
            this.sendMessage({ 
                type: 'analytics_response', 
                data: data,
                requestId: response.requestId,
                timestamp: new Date() 
            });
        } else if (event === 'analytics_error') {
            // Forward analytics errors to the client
            console.log(`[UserSession] Forwarding analytics error to user ${this.userId}:`, response.error);
            this.sendMessage({ 
                type: 'analytics_error', 
                error: response.error,
                requestId: response.requestId,
                timestamp: new Date() 
            });
        } else if (response.error) {
            messageType = 'system';
            this.sendMessage({ type: messageType, content: response.error, timestamp: new Date() });
        }
    }

    sendMessage(message) {
        try {
            this.lastActivity = new Date();

            // Store non-system messages in history (except welcome messages)
            if (message.type !== 'system' || !message.content.includes('Connected to TaskMate')) {
                this.addToHistory(message);
            }

            if (this.websocket && this.websocket.readyState === 1) { // WebSocket.OPEN
                this.websocket.send(JSON.stringify(message));
            } else if (this.connected) {
                console.warn(`Cannot send message to user ${this.userId}: WebSocket not open`);
            }
        } catch (error) {
            console.error(`Error sending message to user ${this.userId}:`, error);
        }
    }

    reconnect() {
        console.log(`Reconnecting session ${this.sessionId} for user ${this.userId}`);
        this.connected = true;
        this.lastActivity = new Date();

        // Send chat history first
        this.sendChatHistory();
    }

    markDisconnected() {
        console.log(`Marking session ${this.sessionId} as disconnected for user ${this.userId}`);
        this.connected = false;
        this.websocket = null;
    }

    isDisconnected() {
        return !this.connected;
    }

    isActive() {
        return this.connected && this.websocket && this.websocket.readyState === 1;
    }

    addToHistory(message) {
        // Add timestamp if not present
        if (!message.timestamp) {
            message.timestamp = new Date();
        }

        this.chatHistory.push(message);

        // Limit history size to prevent memory issues
        if (this.chatHistory.length > this.maxHistorySize) {
            this.chatHistory = this.chatHistory.slice(-this.maxHistorySize);
        }
    }

    sendChatHistory() {
        if (this.chatHistory.length > 0) {
            console.log(`Sending ${this.chatHistory.length} messages from chat history to user ${this.userId}`);

            // Send a special message type to indicate history restoration
            this.websocket.send(JSON.stringify({
                type: 'history_restore',
                messages: this.chatHistory,
                timestamp: new Date()
            }));
        }
    }

    getChatHistory() {
        return this.chatHistory;
    }

    clearHistory() {
        this.chatHistory = [];
    }

    getSessionInfo() {
        return {
            userId: this.userId,
            sessionId: this.sessionId,
            connected: this.connected,
            createdAt: this.createdAt,
            lastActivity: this.lastActivity,
            isActive: this.isActive(),
            messageCount: this.chatHistory.length
        };
    }

    cleanup() {
        console.log(`Cleaning up session ${this.sessionId} for user ${this.userId}`);
        this.connected = false;
        this.llmService.removeAllListeners(this.sessionId);

        if (this.websocket && this.websocket.readyState === 1) {
            this.websocket.close(1000, 'Session cleanup');
        }
        this.websocket = null;
    }
}

module.exports = UserSession;

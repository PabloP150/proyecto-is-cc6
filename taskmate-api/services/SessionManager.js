const UserSession = require('./UserSession');

class SessionManager {
    constructor() {
        this.activeSessions = new Map();
    }

    async connect(ws, userId) {
        try {
            // Create new user session
            const session = new UserSession(userId, ws);
            
            // Store session with WebSocket as key
            this.activeSessions.set(ws, session);
            
            console.log(`User ${userId} connected. Active sessions: ${this.activeSessions.size}`);
            
            // Initialize session context
            await session.initialize();
            
            return session;
        } catch (error) {
            console.error('Error connecting user session:', error);
            throw error;
        }
    }

    disconnect(ws) {
        try {
            const session = this.activeSessions.get(ws);
            if (session) {
                console.log(`User ${session.userId} disconnected`);
                
                // Remove from active sessions first
                this.activeSessions.delete(ws);
                
                // Clean up session resources
                try {
                    session.cleanup();
                } catch (cleanupError) {
                    console.error('Error during session cleanup:', cleanupError);
                }
                
                console.log(`Active sessions: ${this.activeSessions.size}`);
            }
        } catch (error) {
            console.error('Error disconnecting user session:', error);
        }
    }

    getSession(ws) {
        return this.activeSessions.get(ws);
    }

    getUserSession(userId) {
        for (const [ws, session] of this.activeSessions) {
            if (session.userId === userId) {
                return session;
            }
        }
        return null;
    }

    getActiveSessionCount() {
        return this.activeSessions.size;
    }

    cleanup() {
        // Clean up all sessions
        for (const [ws, session] of this.activeSessions) {
            try {
                session.cleanup();
            } catch (cleanupError) {
                console.error('Error during session cleanup:', cleanupError);
            }
        }
        this.activeSessions.clear();
    }
}

module.exports = SessionManager;
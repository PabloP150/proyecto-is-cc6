const UserSession = require('./UserSession');

class SessionManager {
    constructor() {
        this.activeSessions = new Map(); // WebSocket -> Session mapping
        this.userSessions = new Map();   // UserId -> Session mapping for persistence
        this.cleanupTimers = new Map();  // UserId -> cleanup timeout ID
    }

    async connect(ws, userId) {
        try {
            // Cancel any pending cleanup for this user
            const existingTimer = this.cleanupTimers.get(userId);
            if (existingTimer) {
                clearTimeout(existingTimer);
                this.cleanupTimers.delete(userId);
            }

            // Check if a session for this user already exists
            let session = this.userSessions.get(userId);

            if (session) {
                console.log(`User ${userId} reconnected. Reusing existing session.`);

                // Remove old WebSocket mapping if it exists
                if (session.websocket) {
                    this.activeSessions.delete(session.websocket);
                }

                // Update the websocket for the existing session
                session.websocket = ws;
                session.reconnect();
            } else {
                // Create a new user session
                session = new UserSession(userId, ws);
                console.log(`User ${userId} connected. Creating new session.`);
            }
            
            // Store session with both mappings
            this.activeSessions.set(ws, session);
            this.userSessions.set(userId, session);
            
            console.log(`Active sessions: ${this.activeSessions.size}, User sessions: ${this.userSessions.size}`);
            
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
                console.log(`WebSocket disconnected for user ${session.userId} (session preserved)`);
                
                // Remove from active WebSocket sessions
                this.activeSessions.delete(ws);
                
                // Mark session as disconnected but don't clean up yet
                session.markDisconnected();
                
                // Set a timeout to clean up the session if user doesn't reconnect
                const timer = setTimeout(() => {
                    // Only clean up if the session is still disconnected and hasn't been replaced
                    if (session.isDisconnected() && this.userSessions.get(session.userId) === session) {
                        console.log(`Cleaning up session for user ${session.userId} after timeout`);
                        this.userSessions.delete(session.userId);
                        this.cleanupTimers.delete(session.userId);
                        session.cleanup();
                    }
                }, 60 * 60 * 1000); // 1 hour timeout
                this.cleanupTimers.set(session.userId, timer);
                
                console.log(`Active WebSocket sessions: ${this.activeSessions.size}, Preserved user sessions: ${this.userSessions.size}`);
            }
        } catch (error) {
            console.error('Error disconnecting user session:', error);
        }
    }

    getSession(ws) {
        return this.activeSessions.get(ws);
    }

    getUserSession(userId) {
        return this.userSessions.get(userId) || null;
    }

    getActiveSessionCount() {
        return this.activeSessions.size;
    }

    cleanup() {
        // Clean up all sessions
        for (const [userId, session] of this.userSessions) {
            try {
                session.cleanup();
            } catch (cleanupError) {
                console.error('Error during session cleanup:', cleanupError);
            }
        }
        this.activeSessions.clear();
        this.userSessions.clear();
    }

    // Method to manually disconnect a user (for logout)
    disconnectUser(userId) {
        const session = this.userSessions.get(userId);
        if (session) {
            console.log(`Manually disconnecting user ${userId}`);

            // Cancel any pending cleanup timer
            const timer = this.cleanupTimers.get(userId);
            if (timer) {
                clearTimeout(timer);
                this.cleanupTimers.delete(userId);
            }

            if (session.websocket && session.websocket.readyState === 1) {
                session.websocket.close(1000, 'User logged out');
            }
            if (session.websocket) {
                this.activeSessions.delete(session.websocket);
            }
            this.userSessions.delete(userId);
            session.cleanup();
            return true;
        }
        return false;
    }
}

module.exports = SessionManager;
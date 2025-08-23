const SessionManager = require('../services/SessionManager');
const UserSession = require('../services/UserSession');

// Mock WebSocket
const mockWebSocket = (readyState = 1) => ({
    readyState,
    send: jest.fn(),
    close: jest.fn()
});

// Mock UserSession
jest.mock('../services/UserSession');

describe('SessionManager', () => {
    let sessionManager;
    let mockWs;
    let mockSession;

    beforeEach(() => {
        sessionManager = new SessionManager();
        mockWs = mockWebSocket();
        mockSession = {
            userId: 'test-user-123',
            initialize: jest.fn().mockResolvedValue(),
            cleanup: jest.fn(),
            websocket: mockWs
        };
        
        // Reset mocks
        UserSession.mockClear();
        UserSession.mockImplementation(() => mockSession);
    });

    describe('constructor', () => {
        test('should initialize with empty activeSessions Map', () => {
            expect(sessionManager.activeSessions).toBeInstanceOf(Map);
            expect(sessionManager.activeSessions.size).toBe(0);
        });
    });

    describe('connect', () => {
        test('should create new user session and store it', async () => {
            const userId = 'test-user-123';
            
            const session = await sessionManager.connect(mockWs, userId);
            
            expect(UserSession).toHaveBeenCalledWith(userId, mockWs);
            expect(mockSession.initialize).toHaveBeenCalled();
            expect(sessionManager.activeSessions.get(mockWs)).toBe(mockSession);
            expect(sessionManager.activeSessions.size).toBe(1);
            expect(session).toBe(mockSession);
        });

        test('should handle initialization errors', async () => {
            const userId = 'test-user-123';
            const error = new Error('Initialization failed');
            mockSession.initialize.mockRejectedValue(error);
            
            await expect(sessionManager.connect(mockWs, userId)).rejects.toThrow('Initialization failed');
        });

        test('should track multiple sessions', async () => {
            const mockWs2 = mockWebSocket();
            const mockSession2 = {
                userId: 'test-user-456',
                initialize: jest.fn().mockResolvedValue(),
                cleanup: jest.fn(),
                websocket: mockWs2
            };
            
            UserSession.mockImplementationOnce(() => mockSession);
            UserSession.mockImplementationOnce(() => mockSession2);
            
            await sessionManager.connect(mockWs, 'test-user-123');
            await sessionManager.connect(mockWs2, 'test-user-456');
            
            expect(sessionManager.activeSessions.size).toBe(2);
            expect(sessionManager.activeSessions.get(mockWs)).toBe(mockSession);
            expect(sessionManager.activeSessions.get(mockWs2)).toBe(mockSession2);
        });
    });

    describe('disconnect', () => {
        beforeEach(async () => {
            await sessionManager.connect(mockWs, 'test-user-123');
        });

        test('should clean up session and remove from activeSessions', () => {
            sessionManager.disconnect(mockWs);
            
            expect(mockSession.cleanup).toHaveBeenCalled();
            expect(sessionManager.activeSessions.has(mockWs)).toBe(false);
            expect(sessionManager.activeSessions.size).toBe(0);
        });

        test('should handle disconnect for non-existent session gracefully', () => {
            const nonExistentWs = mockWebSocket();
            
            expect(() => sessionManager.disconnect(nonExistentWs)).not.toThrow();
            expect(sessionManager.activeSessions.size).toBe(1); // Original session still there
        });

        test('should handle cleanup errors gracefully', () => {
            mockSession.cleanup.mockImplementation(() => {
                throw new Error('Cleanup failed');
            });
            
            expect(() => sessionManager.disconnect(mockWs)).not.toThrow();
            expect(sessionManager.activeSessions.has(mockWs)).toBe(false);
        });
    });

    describe('getSession', () => {
        test('should return session for existing WebSocket', async () => {
            await sessionManager.connect(mockWs, 'test-user-123');
            
            const session = sessionManager.getSession(mockWs);
            
            expect(session).toBe(mockSession);
        });

        test('should return undefined for non-existent WebSocket', () => {
            const nonExistentWs = mockWebSocket();
            
            const session = sessionManager.getSession(nonExistentWs);
            
            expect(session).toBeUndefined();
        });
    });

    describe('getUserSession', () => {
        test('should return session for existing userId', async () => {
            await sessionManager.connect(mockWs, 'test-user-123');
            
            const session = sessionManager.getUserSession('test-user-123');
            
            expect(session).toBe(mockSession);
        });

        test('should return null for non-existent userId', () => {
            const session = sessionManager.getUserSession('non-existent-user');
            
            expect(session).toBeNull();
        });

        test('should find correct session among multiple sessions', async () => {
            const mockWs2 = mockWebSocket();
            const mockSession2 = {
                userId: 'test-user-456',
                initialize: jest.fn().mockResolvedValue(),
                cleanup: jest.fn(),
                websocket: mockWs2
            };
            
            UserSession.mockImplementationOnce(() => mockSession);
            UserSession.mockImplementationOnce(() => mockSession2);
            
            await sessionManager.connect(mockWs, 'test-user-123');
            await sessionManager.connect(mockWs2, 'test-user-456');
            
            const session1 = sessionManager.getUserSession('test-user-123');
            const session2 = sessionManager.getUserSession('test-user-456');
            
            expect(session1).toBe(mockSession);
            expect(session2).toBe(mockSession2);
        });
    });

    describe('getActiveSessionCount', () => {
        test('should return 0 for no active sessions', () => {
            expect(sessionManager.getActiveSessionCount()).toBe(0);
        });

        test('should return correct count for active sessions', async () => {
            const mockWs2 = mockWebSocket();
            const mockSession2 = {
                userId: 'test-user-456',
                initialize: jest.fn().mockResolvedValue(),
                cleanup: jest.fn(),
                websocket: mockWs2
            };
            
            UserSession.mockImplementationOnce(() => mockSession);
            UserSession.mockImplementationOnce(() => mockSession2);
            
            await sessionManager.connect(mockWs, 'test-user-123');
            expect(sessionManager.getActiveSessionCount()).toBe(1);
            
            await sessionManager.connect(mockWs2, 'test-user-456');
            expect(sessionManager.getActiveSessionCount()).toBe(2);
            
            sessionManager.disconnect(mockWs);
            expect(sessionManager.getActiveSessionCount()).toBe(1);
        });
    });

    describe('cleanup', () => {
        test('should clean up all sessions and clear activeSessions', async () => {
            const mockWs2 = mockWebSocket();
            const mockSession2 = {
                userId: 'test-user-456',
                initialize: jest.fn().mockResolvedValue(),
                cleanup: jest.fn(),
                websocket: mockWs2
            };
            
            UserSession.mockImplementationOnce(() => mockSession);
            UserSession.mockImplementationOnce(() => mockSession2);
            
            await sessionManager.connect(mockWs, 'test-user-123');
            await sessionManager.connect(mockWs2, 'test-user-456');
            
            sessionManager.cleanup();
            
            expect(mockSession.cleanup).toHaveBeenCalled();
            expect(mockSession2.cleanup).toHaveBeenCalled();
            expect(sessionManager.activeSessions.size).toBe(0);
        });

        test('should handle cleanup errors gracefully', async () => {
            mockSession.cleanup.mockImplementation(() => {
                throw new Error('Cleanup failed');
            });
            
            await sessionManager.connect(mockWs, 'test-user-123');
            
            expect(() => sessionManager.cleanup()).not.toThrow();
            expect(sessionManager.activeSessions.size).toBe(0);
        });
    });

    describe('session isolation', () => {
        test('should maintain separate sessions for different users', async () => {
            const mockWs2 = mockWebSocket();
            const mockSession2 = {
                userId: 'test-user-456',
                initialize: jest.fn().mockResolvedValue(),
                cleanup: jest.fn(),
                websocket: mockWs2
            };
            
            UserSession.mockImplementationOnce(() => mockSession);
            UserSession.mockImplementationOnce(() => mockSession2);
            
            await sessionManager.connect(mockWs, 'test-user-123');
            await sessionManager.connect(mockWs2, 'test-user-456');
            
            const session1 = sessionManager.getSession(mockWs);
            const session2 = sessionManager.getSession(mockWs2);
            
            expect(session1).not.toBe(session2);
            expect(session1.userId).toBe('test-user-123');
            expect(session2.userId).toBe('test-user-456');
        });
    });
});
const UserSession = require('../services/UserSession');

// Mock WebSocket
const mockWebSocket = (readyState = 1) => ({
    readyState,
    send: jest.fn(),
    close: jest.fn()
});

describe('UserSession', () => {
    let userSession;
    let mockWs;
    const userId = 'test-user-123';

    beforeEach(() => {
        mockWs = mockWebSocket();
        userSession = new UserSession(userId, mockWs);
        
        // Mock console methods to avoid noise in tests
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('constructor', () => {
        test('should initialize with correct properties', () => {
            expect(userSession.userId).toBe(userId);
            expect(userSession.websocket).toBe(mockWs);
            expect(userSession.context).toBeNull();
            expect(userSession.createdAt).toBeInstanceOf(Date);
            expect(userSession.lastActivity).toBeInstanceOf(Date);
        });

        test('should set creation time and last activity to current time', () => {
            const now = Date.now();
            const session = new UserSession(userId, mockWs);
            
            expect(session.createdAt.getTime()).toBeCloseTo(now, -2); // Within 100ms
            expect(session.lastActivity.getTime()).toBeCloseTo(now, -2);
        });
    });

    describe('initialize', () => {
        test('should initialize context and send welcome message', async () => {
            await userSession.initialize();
            
            expect(userSession.context).toEqual({
                userId: userId,
                tasks: [],
                groups: [],
                preferences: {},
                lastUpdated: expect.any(Date)
            });
            
            expect(mockWs.send).toHaveBeenCalledWith(
                expect.stringContaining('"type":"system"')
            );
            expect(mockWs.send).toHaveBeenCalledWith(
                expect.stringContaining('"content":"Connected to TaskMate AI Assistant"')
            );
        });

        test('should handle initialization errors', async () => {
            // Mock an error in the context initialization part
            const originalDate = Date;
            global.Date = jest.fn(() => {
                throw new Error('Date initialization failed');
            });
            
            await expect(userSession.initialize()).rejects.toThrow('Date initialization failed');
            
            global.Date = originalDate;
        });
    });

    describe('handleMessage', () => {
        beforeEach(async () => {
            await userSession.initialize();
            mockWs.send.mockClear(); // Clear the welcome message call
        });

        test('should update last activity and echo message', async () => {
            const message = { content: 'Hello, AI!' };
            const beforeTime = userSession.lastActivity.getTime();
            
            // Add small delay to ensure time difference
            await new Promise(resolve => setTimeout(resolve, 1));
            await userSession.handleMessage(message);
            
            expect(userSession.lastActivity.getTime()).toBeGreaterThan(beforeTime);
            expect(mockWs.send).toHaveBeenCalledWith(
                expect.stringContaining('"type":"assistant"')
            );
            expect(mockWs.send).toHaveBeenCalledWith(
                expect.stringContaining('I received your message: \\"Hello, AI!\\". LLM integration coming soon!')
            );
        });

        test('should handle message processing errors', async () => {
            const message = { content: 'Test message' };
            
            // Mock console.log to throw an error during message processing
            const originalConsoleLog = console.log;
            console.log = jest.fn(() => {
                throw new Error('Logging failed');
            });
            
            await userSession.handleMessage(message);
            
            // Should send error message
            expect(mockWs.send).toHaveBeenCalledWith(
                expect.stringContaining('"type":"system"')
            );
            expect(mockWs.send).toHaveBeenCalledWith(
                expect.stringContaining('Sorry, there was an error processing your message.')
            );
            
            console.log = originalConsoleLog;
        });

        test('should log received message', async () => {
            const message = { content: 'Test message' };
            
            await userSession.handleMessage(message);
            
            expect(console.log).toHaveBeenCalledWith(
                `Message from user ${userId}:`,
                message
            );
        });
    });

    describe('sendMessage', () => {
        test('should send message when WebSocket is open', () => {
            const message = {
                type: 'assistant',
                content: 'Test message',
                timestamp: new Date()
            };
            
            userSession.sendMessage(message);
            
            expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify(message));
        });

        test('should not send message when WebSocket is closed', () => {
            mockWs.readyState = 3; // WebSocket.CLOSED
            const message = {
                type: 'assistant',
                content: 'Test message',
                timestamp: new Date()
            };
            
            userSession.sendMessage(message);
            
            expect(mockWs.send).not.toHaveBeenCalled();
        });

        test('should handle send errors gracefully', () => {
            mockWs.send.mockImplementation(() => {
                throw new Error('Send failed');
            });
            const message = {
                type: 'assistant',
                content: 'Test message',
                timestamp: new Date()
            };
            
            expect(() => userSession.sendMessage(message)).not.toThrow();
            expect(console.error).toHaveBeenCalledWith('Error sending message:', expect.any(Error));
        });

        test('should not send when websocket is null', () => {
            userSession.websocket = null;
            const message = {
                type: 'assistant',
                content: 'Test message',
                timestamp: new Date()
            };
            
            expect(() => userSession.sendMessage(message)).not.toThrow();
        });
    });

    describe('cleanup', () => {
        beforeEach(async () => {
            await userSession.initialize();
        });

        test('should clear context and close WebSocket', () => {
            userSession.cleanup();
            
            expect(userSession.context).toBeNull();
            expect(mockWs.close).toHaveBeenCalled();
        });

        test('should not close WebSocket if already closed', () => {
            mockWs.readyState = 3; // WebSocket.CLOSED
            
            userSession.cleanup();
            
            expect(userSession.context).toBeNull();
            expect(mockWs.close).not.toHaveBeenCalled();
        });

        test('should handle null websocket gracefully', () => {
            userSession.websocket = null;
            
            expect(() => userSession.cleanup()).not.toThrow();
            expect(userSession.context).toBeNull();
        });
    });

    describe('isActive', () => {
        test('should return true when WebSocket is open', () => {
            mockWs.readyState = 1; // WebSocket.OPEN
            
            expect(userSession.isActive()).toBe(true);
        });

        test('should return false when WebSocket is closed', () => {
            mockWs.readyState = 3; // WebSocket.CLOSED
            
            expect(userSession.isActive()).toBe(false);
        });

        test('should return false when WebSocket is connecting', () => {
            mockWs.readyState = 0; // WebSocket.CONNECTING
            
            expect(userSession.isActive()).toBe(false);
        });

        test('should return false when WebSocket is closing', () => {
            mockWs.readyState = 2; // WebSocket.CLOSING
            
            expect(userSession.isActive()).toBe(false);
        });

        test('should return false when websocket is null', () => {
            userSession.websocket = null;
            
            expect(userSession.isActive()).toBeFalsy();
        });
    });

    describe('updateActivity', () => {
        test('should update lastActivity timestamp', () => {
            const beforeTime = userSession.lastActivity.getTime();
            
            // Wait a small amount to ensure time difference
            setTimeout(() => {
                userSession.updateActivity();
                expect(userSession.lastActivity.getTime()).toBeGreaterThan(beforeTime);
            }, 1);
        });
    });

    describe('session isolation', () => {
        test('should maintain separate contexts for different sessions', async () => {
            const mockWs2 = mockWebSocket();
            const userSession2 = new UserSession('user-456', mockWs2);
            
            await userSession.initialize();
            await userSession2.initialize();
            
            // Modify one session's context
            userSession.context.tasks = [{ id: 1, title: 'Task 1' }];
            
            expect(userSession.context.tasks).toHaveLength(1);
            expect(userSession2.context.tasks).toHaveLength(0);
            expect(userSession.context).not.toBe(userSession2.context);
        });

        test('should maintain separate WebSocket connections', () => {
            const mockWs2 = mockWebSocket();
            const userSession2 = new UserSession('user-456', mockWs2);
            
            expect(userSession.websocket).toBe(mockWs);
            expect(userSession2.websocket).toBe(mockWs2);
            expect(userSession.websocket).not.toBe(userSession2.websocket);
        });
    });

    describe('resource management', () => {
        test('should properly manage memory by clearing references', () => {
            userSession.context = { large: 'data' };
            
            userSession.cleanup();
            
            expect(userSession.context).toBeNull();
        });

        test('should handle multiple cleanup calls safely', () => {
            userSession.cleanup();
            
            expect(() => userSession.cleanup()).not.toThrow();
            expect(userSession.context).toBeNull();
        });
    });
});
import React, { useState, useEffect, useRef } from 'react';
import {
    Box,
    Container,
    TextField,
    Typography,
    Paper,
    List,
    ListItem,
    Avatar,
    CssBaseline,
    IconButton,
    CircularProgress
} from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import SendIcon from '@mui/icons-material/Send';
import PersonIcon from '@mui/icons-material/Person';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import useWebSocket from '../hooks/useWebSocket';
import './ChatPage.css';

const theme = createTheme({
    palette: {
        mode: 'dark',
        primary: {
            main: '#4a90e2',
        },
        background: {
            default: 'transparent',
            paper: 'rgba(0, 0, 0, 0.6)',
        },
    },
});

function ChatPage() {
    const [messages, setMessages] = useState([]);
    const [inputMessage, setInputMessage] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);

    // Get user token from localStorage (reactive to changes)
    const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('user') || '{}'));
    const [token, setToken] = useState(() => localStorage.getItem('token') || user.token);

    // Update user and token when localStorage changes
    useEffect(() => {
        const handleStorageChange = () => {
            const newUser = JSON.parse(localStorage.getItem('user') || '{}');
            const newToken = localStorage.getItem('token') || newUser.token;
            setUser(newUser);
            setToken(newToken);
        };

        // Listen for storage changes
        window.addEventListener('storage', handleStorageChange);
        
        // Also check on component mount/focus
        window.addEventListener('focus', handleStorageChange);

        return () => {
            window.removeEventListener('storage', handleStorageChange);
            window.removeEventListener('focus', handleStorageChange);
        };
    }, []);

    // Debug logging (run only once)
    useEffect(() => {
        console.log('ChatPage Debug Info:');
        console.log('User from localStorage:', user);
        console.log('Token from localStorage:', token);
        console.log('Token exists:', !!token);
        console.log('All localStorage keys:', Object.keys(localStorage));
        console.log('localStorage.token:', localStorage.getItem('token'));
        console.log('localStorage.user:', localStorage.getItem('user'));
    }, []); // Empty dependency array to run only once

    // WebSocket connection
    const {
        connectionStatus,
        sendMessage: sendWebSocketMessage,
        isConnected,
        error: wsError,
        connect: connectWebSocket
    } = useWebSocket(
        'ws://localhost:9000/chat',
        token,
        {
            autoConnect: !!token, // Only auto-connect if we have a token
            onMessage: (data) => {
                // Handle incoming messages from WebSocket
                if (data.type === 'assistant' || data.type === 'system') {
                    setMessages(prev => [...prev, {
                        id: Date.now().toString(),
                        type: data.type,
                        content: data.content,
                        timestamp: new Date(data.timestamp)
                    }]);
                    setIsTyping(false);
                }
            },
            onError: (error) => {
                console.error('WebSocket error:', error);
                setIsTyping(false);
            },
            onOpen: () => {
                console.log('WebSocket connected successfully');
            },
            onClose: () => {
                console.log('WebSocket connection closed');
                setIsTyping(false);
            }
        }
    );

    // Auto-scroll to bottom when new messages arrive
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // Initialize with a welcome message
    useEffect(() => {
        if (token) {
            setMessages([
                {
                    id: '1',
                    type: 'assistant',
                    content: 'Hello! I\'m your AI assistant. I can help you with task management, planning, and productivity advice. How can I assist you today?',
                    timestamp: new Date()
                }
            ]);
        } else {
            setMessages([
                {
                    id: '1',
                    type: 'system',
                    content: 'Please log in to start chatting with the AI assistant.',
                    timestamp: new Date()
                }
            ]);
        }
    }, [token]);

    const handleSendMessage = async (e) => {
        e.preventDefault();

        if (!inputMessage.trim() || !isConnected) return;

        const userMessage = {
            id: Date.now().toString(),
            type: 'user',
            content: inputMessage.trim(),
            timestamp: new Date()
        };

        // Add user message immediately to UI
        setMessages(prev => [...prev, userMessage]);
        setInputMessage('');
        setIsTyping(true);

        // Send message through WebSocket
        const success = sendWebSocketMessage({
            type: 'user',
            content: userMessage.content,
            timestamp: userMessage.timestamp
        });

        if (!success) {
            setIsTyping(false);
            // Add error message if send failed
            setMessages(prev => [...prev, {
                id: (Date.now() + 1).toString(),
                type: 'system',
                content: 'Failed to send message. Please check your connection.',
                timestamp: new Date()
            }]);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage(e);
        }
    };

    const formatTime = (timestamp) => {
        return new Date(timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <Box
                sx={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    backgroundImage: 'url(/1.jpeg)',
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat',
                    zIndex: -1,
                }}
            >
                <Container
                    component="main"
                    maxWidth="md"
                    className="chat-container"
                    sx={{
                        height: '100vh',
                        display: 'flex',
                        flexDirection: 'column',
                        pt: { xs: 10, sm: 10, md: 10 }, // Account for navbar
                        pb: 2,
                        px: { xs: 1, sm: 2, md: 3 }
                    }}
                >
                    <Paper
                        elevation={6}
                        className="chat-paper"
                        sx={{
                            backgroundColor: 'background.paper',
                            borderRadius: { xs: 1, sm: 2 },
                            display: 'flex',
                            flexDirection: 'column',
                            height: '100%',
                            overflow: 'hidden'
                        }}
                    >
                        {/* Chat Header */}
                        <Box sx={{ p: 2, borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
                            <Typography variant="h5" component="h1" sx={{ mb: 1 }}>
                                AI Assistant
                            </Typography>
                            <Typography
                                variant="body2"
                                color={isConnected ? 'success.main' : 'error.main'}
                            >
                                Status: {connectionStatus}
                                {wsError && ` - ${wsError}`}
                            </Typography>
                            {!token && (
                                <Typography variant="body2" color="warning.main">
                                    No authentication token found. Please log in again.
                                </Typography>
                            )}
                            {token && !isConnected && (
                                <Box sx={{ mt: 1 }}>
                                    <IconButton 
                                        onClick={connectWebSocket}
                                        size="small"
                                        sx={{ bgcolor: 'primary.main', color: 'white' }}
                                    >
                                        🔌 Connect
                                    </IconButton>
                                </Box>
                            )}
                            <Typography variant="caption" sx={{ mt: 1, opacity: 0.7 }}>
                                Debug: Token exists: {!!token ? 'Yes' : 'No'}
                                {token && ` (${token.substring(0, 20)}...)`}
                            </Typography>
                        </Box>

                        {/* Messages Container */}
                        <Box
                            className="chat-messages-container"
                            sx={{
                                flexGrow: 1,
                                overflow: 'auto',
                                p: { xs: 0.5, sm: 1 },
                                display: 'flex',
                                flexDirection: 'column'
                            }}
                        >
                            <List sx={{ flexGrow: 1, py: 0 }}>
                                {messages.map((message) => (
                                    <ListItem
                                        key={message.id}
                                        sx={{
                                            display: 'flex',
                                            justifyContent: message.type === 'user' ? 'flex-end' : 'flex-start',
                                            alignItems: 'flex-start',
                                            py: 1,
                                            px: 2
                                        }}
                                    >
                                        <Box
                                            className="chat-message-container"
                                            sx={{
                                                display: 'flex',
                                                flexDirection: message.type === 'user' ? 'row-reverse' : 'row',
                                                alignItems: 'flex-start',
                                                maxWidth: { xs: '90%', sm: '85%', md: '80%' },
                                                gap: { xs: 0.5, sm: 1 }
                                            }}
                                        >
                                            <Avatar
                                                className="chat-avatar"
                                                sx={{
                                                    bgcolor: message.type === 'user' ? 'primary.main' : 'grey.600',
                                                    width: { xs: 28, sm: 32 },
                                                    height: { xs: 28, sm: 32 }
                                                }}
                                            >
                                                {message.type === 'user' ? <PersonIcon /> : <SmartToyIcon />}
                                            </Avatar>

                                            <Box
                                                className="chat-message-bubble"
                                                sx={{
                                                    backgroundColor: message.type === 'user'
                                                        ? 'primary.main'
                                                        : 'rgba(255, 255, 255, 0.1)',
                                                    color: 'white',
                                                    borderRadius: { xs: 1.5, sm: 2 },
                                                    p: { xs: 1.5, sm: 2 },
                                                    maxWidth: '100%',
                                                    wordWrap: 'break-word',
                                                    wordBreak: 'break-word'
                                                }}
                                            >
                                                <Typography variant="body1" sx={{ mb: 0.5 }}>
                                                    {message.content}
                                                </Typography>
                                                <Typography
                                                    variant="caption"
                                                    sx={{
                                                        opacity: 0.7,
                                                        fontSize: '0.75rem'
                                                    }}
                                                >
                                                    {formatTime(message.timestamp)}
                                                </Typography>
                                            </Box>
                                        </Box>
                                    </ListItem>
                                ))}

                                {/* Typing Indicator */}
                                {isTyping && (
                                    <ListItem
                                        sx={{
                                            display: 'flex',
                                            justifyContent: 'flex-start',
                                            alignItems: 'flex-start',
                                            py: 1,
                                            px: 2
                                        }}
                                    >
                                        <Box
                                            sx={{
                                                display: 'flex',
                                                alignItems: 'flex-start',
                                                gap: 1
                                            }}
                                        >
                                            <Avatar
                                                sx={{
                                                    bgcolor: 'grey.600',
                                                    width: 32,
                                                    height: 32
                                                }}
                                            >
                                                <SmartToyIcon />
                                            </Avatar>

                                            <Box
                                                sx={{
                                                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                                    borderRadius: 2,
                                                    p: 2,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 1
                                                }}
                                            >
                                                <CircularProgress size={16} />
                                                <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
                                                    AI is typing...
                                                </Typography>
                                            </Box>
                                        </Box>
                                    </ListItem>
                                )}
                            </List>

                            {/* Auto-scroll anchor */}
                            <div ref={messagesEndRef} />
                        </Box>

                        {/* Message Input */}
                        <Box
                            component="form"
                            onSubmit={handleSendMessage}
                            className="chat-input-container"
                            sx={{
                                p: { xs: 1.5, sm: 2 },
                                borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                                display: 'flex',
                                gap: { xs: 0.5, sm: 1 }
                            }}
                        >
                            <TextField
                                ref={inputRef}
                                fullWidth
                                multiline
                                maxRows={4}
                                value={inputMessage}
                                onChange={(e) => setInputMessage(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Type your message here..."
                                variant="outlined"
                                className="chat-input"
                                sx={{
                                    '& .MuiOutlinedInput-root': {
                                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                        fontSize: { xs: '0.9rem', sm: '1rem' }
                                    }
                                }}
                            />
                            <IconButton
                                type="submit"
                                disabled={!inputMessage.trim() || isTyping}
                                sx={{
                                    bgcolor: 'primary.main',
                                    color: 'white',
                                    '&:hover': {
                                        bgcolor: 'primary.dark',
                                    },
                                    '&:disabled': {
                                        bgcolor: 'grey.600',
                                        color: 'grey.400'
                                    }
                                }}
                            >
                                <SendIcon />
                            </IconButton>
                        </Box>
                    </Paper>
                </Container>
            </Box>
        </ThemeProvider>
    );
}

export default ChatPage;
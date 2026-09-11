import {
    Alert,
    Avatar,
    Box,
    CircularProgress,
    Container,
    CssBaseline,
    IconButton,
    List,
    ListItem,
    Paper,
    Snackbar,
    TextField,
    Typography
} from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import PersonIcon from '@mui/icons-material/Person';
import SendIcon from '@mui/icons-material/Send';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import { useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { errorMessage, getAuthToken } from '../api/client';
import useWebSocket from '../hooks/useWebSocket';
import ThemeProvider from '../theme/ThemeProvider';
import { WS_BASE } from '../config';
import { GroupContext } from './GroupContext';
import ChatProjectSelector from './github/ChatProjectSelector';
import RepoPlanCard from './github/RepoPlanCard';
import { TASKS_CHANGED_EVENT, isAbortError, sameId } from './github/githubUtils';
import './ChatPage.css';

// rehype-sanitize must run after rehype-raw: raw HTML from the model is parsed first and then
// stripped of scripts, event handlers and javascript: URLs (default GitHub-like schema).
export const REMARK_PLUGINS = [remarkGfm];
export const REHYPE_PLUGINS = [rehypeRaw, rehypeSanitize];

const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime())
        ? ''
        : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const readStoredUser = () => {
    try {
        return JSON.parse(localStorage.getItem('user') || '{}') || {};
    } catch {
        return {};
    }
};

const userIdOf = (u) => u?.uid || u?.userId || u?.id || null;

let messageSeq = 0;
const nextMessageId = (prefix = 'msg') => `${prefix}-${Date.now()}-${++messageSeq}`;

// Normalizes live and restored server messages. Other fields (event, groupId, plan...) are kept so
// richer renderers can use them; `error` messages carry their text in `message`.
const toChatMessage = (raw, id = nextMessageId()) => {
    const content = typeof raw.content === 'string'
        ? raw.content
        : (typeof raw.message === 'string' ? raw.message : '');
    return { ...raw, id, content, timestamp: raw.timestamp ? new Date(raw.timestamp) : new Date() };
};

const MAX_INSTRUCTIONS = 500;
const ANALYSIS_STAGE_TEXT = {
    fetching_repo: 'Leyendo el repositorio en GitHub…',
    analyzing: 'La IA está analizando el repositorio (puede tardar hasta un minuto y medio)…',
};
const PLAN_EVENT_STATUS = { repo_plan_saved: 'saved', repo_plan_discarded: 'discarded' };
// Errors that mean a plan can no longer be confirmed.
const PLAN_ERROR_STATUS = { REPO_PLAN_EXPIRED: 'expired', REPO_PLAN_NOT_FOUND: 'expired' };

const newRequestId = () => (
    typeof window.crypto?.randomUUID === 'function'
        ? window.crypto.randomUUID()
        : `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
);

const updatePlan = (list, planId, patch) => list.map(m => (
    m.type === 'repo_plan' && m.planId === planId ? { ...m, ...patch } : m
));

// Restored history keeps repo_plan entries plus the later saved/discarded/expired events:
// fold those events into the plan cards so they come back read-only.
const foldPlanEvents = (list) => {
    const updates = new Map();
    list.forEach(m => {
        if (PLAN_EVENT_STATUS[m.type] && m.planId) {
            updates.set(m.planId, { status: PLAN_EVENT_STATUS[m.type], created: m.created });
        } else if (m.type === 'error' && m.planId && PLAN_ERROR_STATUS[m.code]) {
            updates.set(m.planId, { status: PLAN_ERROR_STATUS[m.code] });
        }
    });
    return list
        .filter(m => !PLAN_EVENT_STATUS[m.type])
        .map(m => (m.type === 'repo_plan' && updates.has(m.planId) ? { ...m, ...updates.get(m.planId) } : m));
};

// System notices (project created, connection hints) and errors are not chat turns: centered,
// no avatar, and visually distinct from assistant replies.
function NoticeMessage({ message }) {
    const isError = message.type === 'error';
    const Icon = isError ? ErrorOutlineIcon : InfoOutlinedIcon;
    return (
        <Box
            className={isError ? 'chat-error-message' : 'chat-system-message'}
            role={isError ? 'alert' : 'status'}
            sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 1,
                maxWidth: { xs: '95%', sm: '85%' },
                px: 2,
                py: 1,
                borderRadius: 2,
                border: '1px solid',
                borderColor: isError ? 'rgba(239, 68, 68, 0.45)' : 'rgba(245, 158, 11, 0.4)',
                backgroundColor: isError ? 'rgba(239, 68, 68, 0.12)' : 'rgba(245, 158, 11, 0.08)',
                color: isError ? '#fca5a5' : '#fcd34d',
                fontSize: '0.9rem',
            }}
        >
            <Icon fontSize="small" sx={{ mt: '2px' }} />
            <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" sx={{ color: 'inherit', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {message.content}
                </Typography>
                {isError && message.code && (
                    <Typography variant="caption" sx={{ opacity: 0.75, display: 'block' }}>
                        Code: {message.code}
                    </Typography>
                )}
            </Box>
        </Box>
    );
}

function ChatPage() {
    const [messages, setMessages] = useState([]);
    const [inputMessage, setInputMessage] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [hasReceivedHistory, setHasReceivedHistory] = useState(false);
    const [initialMessageShown, setInitialMessageShown] = useState(false);
    const [notice, setNotice] = useState('');
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);
    const { refreshGroups, groups } = useContext(GroupContext) || {};
    const location = useLocation();
    const navigate = useNavigate();
    const analyzeGroupId = location.state?.analyzeGroupId || null;
    // Chat project context: null = "Nuevo proyecto (sin contexto)". repo undefined = not known yet.
    const [projectId, setProjectId] = useState(analyzeGroupId);
    const [projectRepo, setProjectRepo] = useState(undefined);
    const [analysis, setAnalysis] = useState(null);
    const [busyPlanId, setBusyPlanId] = useState(null);
    const projectIdRef = useRef(projectId);
    const pendingAnalyzeRef = useRef(analyzeGroupId);
    useEffect(() => { projectIdRef.current = projectId; }, [projectId]);

    // Get user token from localStorage (reactive to changes)
    const [user, setUser] = useState(readStoredUser);
    const [token, setToken] = useState(getAuthToken);
    const userRef = useRef(user);
    useEffect(() => { userRef.current = user; }, [user]);

    // Update user and token when localStorage changes (the stored user is {uid, name, token})
    const handleStorageChange = useCallback(() => {
        const newUser = readStoredUser();
        const newToken = getAuthToken();
        const currentUserId = userIdOf(userRef.current);
        const newUserId = userIdOf(newUser);
        setUser(newUser);
        setToken(newToken);
        if (currentUserId && newUserId && currentUserId !== newUserId) {
            setHasReceivedHistory(false);
            setInitialMessageShown(false);
            setMessages([]);
        }
    }, []);

    useEffect(() => {
        window.addEventListener('storage', handleStorageChange);
        window.addEventListener('focus', handleStorageChange);
        return () => {
            window.removeEventListener('storage', handleStorageChange);
            window.removeEventListener('focus', handleStorageChange);
        };
    }, [handleStorageChange]);

    // WebSocket connection
    const {
        sendMessage: sendWebSocketMessage,
        isConnected,
        error: wsError,
        connect: connectWebSocket
    } = useWebSocket(
        `${WS_BASE}/chat`,
        token,
        {
            autoConnect: !!token, // Only auto-connect if we have a token
            onMessage: (data) => {
                if (data.type === 'analytics_response' || data.type === 'analytics_error') {
                    return;
                }

                if (data.type === 'context') {
                    const current = projectIdRef.current;
                    if ((!data.groupId && !current) || sameId(data.groupId, current)) {
                        setProjectRepo(data.repo || null);
                    }
                    return;
                }

                if (data.type === 'repo_analysis_status') {
                    setAnalysis(prev => (prev && (!data.requestId || prev.requestId === data.requestId)
                        ? { ...prev, stage: data.stage }
                        : prev));
                    return;
                }

                if (data.type === 'repo_plan') {
                    setAnalysis(null);
                    setIsTyping(false);
                    setMessages(prev => [...prev, toChatMessage(data)]);
                    return;
                }

                if (PLAN_EVENT_STATUS[data.type]) {
                    const status = PLAN_EVENT_STATUS[data.type];
                    setMessages(prev => updatePlan(prev, data.planId, { status, created: data.created }));
                    setBusyPlanId(prev => (prev === data.planId ? null : prev));
                    if (status === 'saved') {
                        window.dispatchEvent(new CustomEvent(TASKS_CHANGED_EVENT, { detail: { groupId: data.groupId } }));
                    }
                    return;
                }

                if (data.type === 'history_restore') {
                    const restoredMessages = foldPlanEvents((Array.isArray(data.messages) ? data.messages : [])
                        .map((msg, index) => toChatMessage(msg, nextMessageId(`restored-${index}`))))
                        .filter(msg => msg.content.trim()); // Filter empty content from history

                    setMessages(restoredMessages);
                    setHasReceivedHistory(true);
                    setIsTyping(false);
                    return;
                }

                if (data.type === 'error') {
                    if (data.planId) {
                        setBusyPlanId(prev => (prev === data.planId ? null : prev));
                        if (PLAN_ERROR_STATUS[data.code]) {
                            setMessages(prev => updatePlan(prev, data.planId, { status: PLAN_ERROR_STATUS[data.code] }));
                        }
                    }
                    if (data.requestId) {
                        setAnalysis(prev => (prev && prev.requestId === data.requestId ? null : prev));
                    }
                    const errorMsg = toChatMessage(data);
                    if (!errorMsg.content.trim()) errorMsg.content = 'Something went wrong while processing your request.';
                    setMessages(prev => [...prev, errorMsg]);
                    setIsTyping(false);
                    return;
                }

                // Handle regular assistant or system messages
                if (data.type === 'assistant' || data.type === 'system') {
                    if (data.type === 'system' && data.event === 'project_created') {
                        refreshGroups().catch(err => setNotice(errorMessage(err, 'Could not refresh your groups')));
                    }
                    const msg = toChatMessage(data);
                    if (!msg.content.trim()) return;
                    setMessages(prev => [...prev, msg]);
                    setIsTyping(false);
                    return;
                }

            },
            onError: () => {
                setIsTyping(false);
            },
            onOpen: () => {
                // debug ws: conectado
            },
            onClose: () => {
                // A reply that arrives while disconnected comes back through history_restore.
                setIsTyping(false);
                setAnalysis(null);
                setBusyPlanId(null);
            }
        }
    );

    // After a reload the context has no groups yet; the selector needs them.
    useEffect(() => {
        if (!refreshGroups || (Array.isArray(groups) && groups.length > 0)) return undefined;
        const controller = new AbortController();
        refreshGroups({ signal: controller.signal }).catch(err => {
            if (!isAbortError(err)) setNotice(errorMessage(err, 'No se pudieron cargar tus proyectos'));
        });
        return () => controller.abort();
        // Only on mount: an empty list after that is a real "no groups" answer.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const pushError = useCallback((content) => {
        setMessages(prev => [...prev, { id: nextMessageId('error'), type: 'error', content, timestamp: new Date() }]);
    }, []);

    const startAnalysis = useCallback((groupId, instructions) => {
        const requestId = newRequestId();
        const sent = sendWebSocketMessage({ type: 'repo_analysis', requestId, groupId, instructions });
        if (!sent) {
            pushError('No se pudo enviar la solicitud de análisis. Revisa tu conexión.');
            return false;
        }
        setAnalysis({ requestId, stage: null });
        return true;
    }, [sendWebSocketMessage, pushError]);

    // On (re)connect the server session needs the selected project again; a navigation from
    // /github with `analyzeGroupId` also starts the analysis once and then clears that state.
    useEffect(() => {
        if (!isConnected) return;
        const pendingGroupId = pendingAnalyzeRef.current;
        if (pendingGroupId) {
            pendingAnalyzeRef.current = null;
            sendWebSocketMessage({ type: 'set_context', groupId: pendingGroupId });
            startAnalysis(pendingGroupId, '');
            navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
            return;
        }
        if (projectIdRef.current) {
            sendWebSocketMessage({ type: 'set_context', groupId: projectIdRef.current });
        }
        // Runs per connection; the rest is read through refs on purpose.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isConnected]);

    const handleProjectChange = useCallback((groupId) => {
        setProjectId(groupId);
        setProjectRepo(groupId ? undefined : null);
        sendWebSocketMessage({ type: 'set_context', groupId: groupId || null });
    }, [sendWebSocketMessage]);

    const sendPlanAction = useCallback((type, planId) => {
        if (!planId) return false;
        if (!sendWebSocketMessage({ type, planId })) {
            setNotice('No se pudo enviar la acción del plan. Revisa tu conexión.');
            return false;
        }
        setBusyPlanId(planId);
        return undefined;
    }, [sendWebSocketMessage]);
    const confirmPlan = useCallback((planId) => sendPlanAction('repo_plan_confirm', planId), [sendPlanAction]);
    const discardPlan = useCallback((planId) => sendPlanAction('repo_plan_discard', planId), [sendPlanAction]);

    // Auto-scroll to bottom when new messages arrive
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // Initialize with a welcome message (only if no history is restored)

    useEffect(() => {
        // Only show initial message if we have a token but no existing messages and no history received
        if (token && !hasReceivedHistory && !initialMessageShown && messages.length === 0) {
            // Wait a bit to see if we receive history restoration
            const timer = setTimeout(() => {
                // Double-check conditions before showing initial message
                if (!hasReceivedHistory && messages.length === 0) {
                    setMessages([
                        {
                            id: '1',
                            type: 'assistant',
                            content: 'Hello! I\'m your AI assistant. I can help you with task management, planning, and productivity advice. How can I assist you today?',
                            timestamp: new Date()
                        }
                    ]);
                    setInitialMessageShown(true);
                }
            }, 1500); // Wait 1.5 seconds for potential history restoration

            return () => clearTimeout(timer);
        } else if (!token && messages.length === 0) {
            // Show login message if no token
            setMessages([
                {
                    id: '1',
                    type: 'system',
                    content: 'Please log in to start chatting with the AI assistant.',
                    timestamp: new Date()
                }
            ]);
        }
    }, [token, hasReceivedHistory, initialMessageShown, messages.length]);

    const handleSendMessage = async (e) => {
        e.preventDefault();

        // With a project selected the input carries optional instructions for a repo analysis.
        if (projectId) {
            if (!isConnected || analysis || projectRepo === null) return;
            const instructions = inputMessage.trim().slice(0, MAX_INSTRUCTIONS);
            const group = (groups || []).find(g => sameId(g.gid, projectId));
            setMessages(prev => [...prev, {
                id: nextMessageId('user'),
                type: 'user',
                content: instructions || `Analiza el repositorio de «${group?.name || 'este proyecto'}» y propón las siguientes tareas.`,
                timestamp: new Date(),
            }]);
            setInputMessage('');
            startAnalysis(projectId, instructions);
            return;
        }

        if (!inputMessage.trim() || !isConnected) return;

        const userMessage = {
            id: nextMessageId('user'),
            type: 'user',
            content: inputMessage.trim(),
            timestamp: new Date()
        };

        // Add user message immediately to UI
        setMessages(prev => [...prev, userMessage]);
        setInputMessage('');
        setIsTyping(true);
        setTimeout(() => inputRef.current?.focus(), 0);

        const success = sendWebSocketMessage({
            type: 'user',
            content: userMessage.content,
            timestamp: userMessage.timestamp
        });

        if (!success) {
            setIsTyping(false);
            // Add error message if send failed
            setMessages(prev => [...prev, {
                id: nextMessageId('error'),
                type: 'error',
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

    return (
        <ThemeProvider>
            <CssBaseline />
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
                    px: { xs: 1, sm: 2, md: 3 },
                    zIndex: 1, // Ensure chat content is above background
                    position: 'relative', // Needed for z-index to work
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

                        <ChatProjectSelector
                            groups={groups || []}
                            value={projectId}
                            onChange={handleProjectChange}
                            repo={projectId ? projectRepo : null}
                            disabled={Boolean(analysis)}
                        />
                        {projectId && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                                {projectRepo === null
                                    ? 'Este proyecto no tiene un repositorio conectado. Conéctalo desde la página GitHub o elige «Nuevo proyecto».'
                                    : 'El mensaje se usará como instrucciones para analizar el repositorio. Se envía a Groq solo la estructura, el README, las dependencias, los commits y los issues; nunca el código fuente.'}
                            </Typography>
                        )}
                        {!token && (
                            <Typography variant="body2" color="warning.main">
                                No authentication token found. Please log in again.
                            </Typography>
                        )}
                        {token && !isConnected && wsError && (
                            <Typography variant="body2" color="error.light" role="status">
                                Connection problem: {wsError}
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
                                message.type === 'repo_plan' ? (
                                    <ListItem key={message.id} sx={{ py: 1, px: 2 }}>
                                        <Box sx={{ width: '100%', maxWidth: { xs: '100%', sm: '90%' } }}>
                                            <RepoPlanCard
                                                message={message}
                                                busy={busyPlanId === message.planId}
                                                onConfirm={confirmPlan}
                                                onDiscard={discardPlan}
                                            />
                                        </Box>
                                    </ListItem>
                                ) : message.type === 'system' || message.type === 'error' ? (
                                    <ListItem
                                        key={message.id}
                                        sx={{ display: 'flex', justifyContent: 'center', py: 1, px: 2 }}
                                    >
                                        <NoticeMessage message={message} />
                                    </ListItem>
                                ) : (
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
                                                    wordBreak: 'break-word',
                                                    // Add styles for markdown content
                                                    '& .markdown-content': {
                                                        '& p': { margin: '0 0 8px 0' },
                                                        '& p:last-child': { margin: 0 },
                                                        '& a': { color: 'secondary.main' },
                                                        '& h1,& h2,& h3,& h4': { margin: '12px 0 6px 0', fontWeight: 600, lineHeight: 1.3 },
                                                        '& h1': { fontSize: '1.2em' },
                                                        '& h2': { fontSize: '1.1em' },
                                                        '& h3': { fontSize: '1em' },
                                                        '& ul,& ol': { margin: '4px 0', paddingLeft: '20px' },
                                                        '& li': { margin: '2px 0' },
                                                        '& table': { borderCollapse: 'collapse', width: '100%', margin: '8px 0', fontSize: '0.85em' },
                                                        '& th': { backgroundColor: 'rgba(255,255,255,0.1)', padding: '6px 10px', border: '1px solid rgba(255,255,255,0.2)', textAlign: 'left', fontWeight: 600 },
                                                        '& td': { padding: '5px 10px', border: '1px solid rgba(255,255,255,0.15)' },
                                                        '& tr:nth-of-type(even)': { backgroundColor: 'rgba(255,255,255,0.04)' },
                                                        '& code': { backgroundColor: 'rgba(0,0,0,0.3)', padding: '1px 5px', borderRadius: '3px', fontSize: '0.88em', fontFamily: 'monospace' },
                                                        '& pre': { backgroundColor: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '6px', overflowX: 'auto', margin: '8px 0' },
                                                        '& pre code': { backgroundColor: 'transparent', padding: 0 },
                                                        '& blockquote': { borderLeft: '3px solid rgba(255,255,255,0.3)', margin: '6px 0', paddingLeft: '12px', opacity: 0.85 },
                                                        '& hr': { border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', margin: '10px 0' },
                                                        '& strong': { fontWeight: 700 },
                                                        '& em': { fontStyle: 'italic' },
                                                    }
                                                }}
                                            >
                                                <Box className="markdown-content">
                                                    {message.type === 'user' ? (
                                                        <Typography variant="body1" sx={{ mb: 0.5 }}>
                                                            {message.content}
                                                        </Typography>
                                                    ) : (
                                                        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>
                                                            {message.content}
                                                        </ReactMarkdown>
                                                    )}
                                                </Box>
                                                <Typography
                                                    variant="caption"
                                                    sx={{
                                                        opacity: 0.7,
                                                        fontSize: '0.75rem',
                                                        mt: 1, // Add margin top for spacing
                                                        display: 'block' // Ensure it's on a new line
                                                    }}
                                                >
                                                    {formatTime(message.timestamp)}
                                                </Typography>
                                            </Box>
                                        </Box>
                                    </ListItem>
                                )
                            ))}

                            {/* Typing Indicator */}
                            {(isTyping || analysis) && (
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
                                            <Typography variant="body2" sx={{ fontStyle: 'italic' }} aria-live="polite">
                                                {analysis
                                                    ? (ANALYSIS_STAGE_TEXT[analysis.stage] || 'Preparando el análisis del repositorio…')
                                                    : 'AI is typing...'}
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
                            placeholder={projectId
                                ? 'Instrucciones opcionales para el análisis (p. ej. «prioriza las pruebas»)…'
                                : 'Type your message here...'}
                            inputProps={projectId ? { maxLength: MAX_INSTRUCTIONS, 'aria-label': 'Instrucciones para el análisis' } : { 'aria-label': 'Mensaje' }}
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
                            aria-label={projectId ? 'Analizar repositorio' : 'Enviar mensaje'}
                            disabled={projectId
                                ? Boolean(analysis) || projectRepo === null || !isConnected
                                : !inputMessage.trim() || isTyping}
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
            <Snackbar
                open={Boolean(notice)}
                autoHideDuration={4000}
                onClose={(event, reason) => { if (reason !== 'clickaway') setNotice(''); }}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert onClose={() => setNotice('')} severity="error" sx={{ width: '100%' }}>
                    {notice}
                </Alert>
            </Snackbar>
        </ThemeProvider>
    );
}

export default ChatPage;

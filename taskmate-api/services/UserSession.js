const { v4: uuidv4 } = require('uuid');
const llmService = require('./LLMService');
const projectService = require('./ProjectService');
const { buildTeamContext } = require('./analyticsContext');
const accessModel = require('../models/access.model');
const groupModel = require('../models/group.model');
const githubModel = require('../models/github.model');
const tasksModel = require('../models/tasks.model');
const nodesModel = require('../models/nodes.model');
const userGroupModel = require('../models/userGroup.model');
const usertaskModel = require('../models/usertask.model');
const { AppError, isAppError } = require('../helpers/errors');
const { buildRepoSnapshot, buildExisting } = require('./github/repoSnapshot');
const { sanitizePlan, planToText, localToday, PLAN_LIMITS } = require('./github/repoPlan');

const REQUEST_TIMEOUT_MS = 90 * 1000;
const ANALYSIS_TIMEOUT_MS = REQUEST_TIMEOUT_MS;
const ANALYSIS_COOLDOWN_MS = 60 * 1000;
const PLAN_TTL_MS = 30 * 60 * 1000;
const MAX_PENDING_PLANS = 5;
const MAX_INSTRUCTIONS = 500;
const MAX_CHAT_MESSAGE = 4000;
const CHAT_WINDOW_MS = 60 * 1000;
const CHAT_MESSAGES_PER_WINDOW = 20;
// Each analytics request is an LLM call, so it gets the same budget as the REST recommendations route.
const ANALYTICS_REQUESTS_PER_WINDOW = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT_ID_RE = /^[A-Za-z0-9_.:-]{1,100}$/;
const DEMO_GROUP_RE = /^test-group-[A-Za-z0-9_-]+$/;
// Not stored in chatHistory (history_restore would replay them).
// assistant_chunk is the streamed text of a reply that is about to arrive whole as 'assistant': storing
// the chunks too would make history_restore replay every fragment after a reconnect.
const TRANSIENT_TYPES = new Set(['pong', 'context', 'repo_analysis_status', 'assistant_chunk']);

// Same rule as the REST analytics endpoints: team-level data only for group leaders.
const TEAM_ANALYTICS_ACTIONS = new Set([
    'get_task_assignment_recommendations', 'get_team_analytics', 'get_workload_distribution',
    'get_expertise_rankings', 'record_task_assignment', 'record_task_completion',
]);
const USER_ANALYTICS_ACTIONS = new Set(['get_user_analytics']);

const ERROR_MESSAGES = {
    VALIDATION_ERROR: 'Invalid request.',
    NOT_GROUP_MEMBER: 'You are not a member of that project.',
    NOT_GROUP_ADMIN: 'Only team leaders can see that data.',
    REPO_NOT_CONNECTED: 'The project has no GitHub repository connected.',
    AI_ANALYSIS_DISABLED: 'AI analysis is turned off for this project; an admin can turn it on.',
    INSTALLATION_SUSPENDED: 'The GitHub App installation is suspended.',
    REPO_NOT_ACCESSIBLE: 'The GitHub App no longer has access to the repository.',
    APP_PERMISSIONS_MISSING: 'The GitHub App installation is missing permissions; ask the repository owner to accept them on GitHub.',
    REPO_EMPTY: 'The repository is empty.',
    GITHUB_RATE_LIMITED: 'GitHub rate-limited the requests; try again later.',
    GITHUB_ERROR: 'Could not read the repository on GitHub.',
    GITHUB_NOT_CONFIGURED: 'The GitHub integration is not configured.',
    ANALYSIS_IN_PROGRESS: 'An analysis is already running.',
    RATE_LIMITED: 'You can only ask for one analysis per minute.',
    MESSAGE_TOO_LONG: `The message is too long (limit ${MAX_CHAT_MESSAGE} characters).`,
    LLM_TIMEOUT: 'The AI took too long to answer. Please try again.',
    LLM_RATE_LIMIT: 'The AI service is busy. Try again in a few seconds.',
    LLM_INVALID_OUTPUT: 'The AI returned an invalid plan. Please try again.',
    LLM_ERROR: 'The AI service is not available right now.',
    ANALYSIS_FAILED: 'Could not complete the analysis.',
    REPO_PLAN_NOT_FOUND: 'The plan is no longer available.',
    REPO_PLAN_EXPIRED: 'The plan expired; analyze the repository again.',
    SAVE_FAILED: 'Could not save the plan.',
    INTERNAL_ERROR: 'An unexpected error occurred.',
};
const CHAT_RATE_LIMITED_MESSAGE = 'You are sending messages too fast; wait a moment.';
const PASSTHROUGH_ANALYSIS_CODES = new Set(['LLM_TIMEOUT', 'LLM_RATE_LIMIT', 'LLM_INVALID_OUTPUT', 'LLM_ERROR', 'MESSAGE_TOO_LONG']);

// Per user (not per session): a reconnect or a second tab does not reset these limits.
const lastAnalysisByUser = new Map();
const chatWindowByUser = new Map();
const analyticsWindowByUser = new Map();

const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);
const sameId = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameGroup = (a, b) => (a && b ? String(a).toLowerCase() === String(b).toLowerCase() : a === b);
// Each project (and "no project") keeps its own chat: history and plan gate, by this key.
const historyKeyOf = (groupId) => (groupId ? String(groupId).toLowerCase() : '');
const MAX_STASHED_CHATS = 20;
const clientRequestIdOf = (value) => (typeof value === 'string' && CLIENT_ID_RE.test(value) ? value : null);

const cooldownRemainingSec = (userId, now = Date.now()) => {
    if (lastAnalysisByUser.size > 1000) {
        for (const [uid, at] of lastAnalysisByUser) if (now - at >= ANALYSIS_COOLDOWN_MS) lastAnalysisByUser.delete(uid);
    }
    const last = lastAnalysisByUser.get(userId);
    return last && now - last < ANALYSIS_COOLDOWN_MS ? Math.ceil((ANALYSIS_COOLDOWN_MS - (now - last)) / 1000) : 0;
};

// Fixed window per user; returns seconds to wait, or 0 when the request may go through.
const takeSlot = (windows, limit, userId, now = Date.now()) => {
    if (windows.size > 1000) {
        for (const [uid, w] of windows) if (now - w.start >= CHAT_WINDOW_MS) windows.delete(uid);
    }
    let window = windows.get(userId);
    if (!window || now - window.start >= CHAT_WINDOW_MS) {
        window = { start: now, count: 0 };
        windows.set(userId, window);
    }
    if (window.count >= limit) return Math.ceil((CHAT_WINDOW_MS - (now - window.start)) / 1000);
    window.count += 1;
    return 0;
};

const takeChatSlot = (userId, now) => takeSlot(chatWindowByUser, CHAT_MESSAGES_PER_WINDOW, userId, now);
const takeAnalyticsSlot = (userId, now) => takeSlot(analyticsWindowByUser, ANALYTICS_REQUESTS_PER_WINDOW, userId, now);

const deriveProjectName = (plan, originalMessage) => {
    const data = (plan && (plan.recommendations || plan)) || {};
    return String(data.project_name || `Project: ${originalMessage || ''}`).slice(0, 25);
};

const requireLeader = async (userId, groupId) => {
    if (!(await accessModel.isGroupLeader(userId, groupId))) {
        throw new AppError('NOT_GROUP_ADMIN', 'Only team leaders can view team analytics', 403);
    }
};

// Client-sent team_context is never trusted; the real one is only built for group leaders.
// Without `action` (legacy callers) the strictest rule applies: any real group needs a leader.
const prepareAnalyticsData = async (userId, rawData, action) => {
    const retryAfterSec = takeAnalyticsSlot(userId);
    if (retryAfterSec > 0) {
        throw new AppError('RATE_LIMITED', 'Too many analytics requests, please wait', 429, { retryAfterSec });
    }
    const data = isPlainObject(rawData) ? { ...rawData } : {};
    delete data.team_context;
    const groupId = data.group_id || data.groupId;

    if (action !== undefined && !TEAM_ANALYTICS_ACTIONS.has(action) && !USER_ANALYTICS_ACTIONS.has(action)) {
        throw new AppError('VALIDATION_ERROR', 'Unknown analytics action', 400);
    }
    if (USER_ANALYTICS_ACTIONS.has(action)) {
        const target = data.user_id || data.userId;
        if (target === undefined || target === null || sameId(String(target), String(userId))) return data;
        if (!isUuid(String(target)) || !isUuid(groupId)) throw new AppError('VALIDATION_ERROR', 'user_id and group_id must be valid UUIDs', 400);
        await requireLeader(userId, groupId);
        if (!(await accessModel.isGroupMember(String(target), groupId))) {
            throw new AppError('NOT_GROUP_MEMBER', 'The user is not a member of this group', 403);
        }
        return data;
    }
    if (!isUuid(groupId)) {
        // Demo groups (`test-group-*`) keep using the Python mock data.
        if (groupId === undefined || groupId === null || DEMO_GROUP_RE.test(String(groupId))) return data;
        throw new AppError('VALIDATION_ERROR', 'group_id must be a valid UUID', 400);
    }
    await requireLeader(userId, groupId);
    data.team_context = await buildTeamContext(groupId);
    return data;
};

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
        this.analysis = null;
        // Project selected in the chat; its context is built on the first message and reused.
        this.chatContext = { groupId: null, cache: null, building: null };
        this.pendingPlans = new Map();
        // requestId sent to Python -> { kind: 'chat' | 'analytics', clientRequestId, timer }
        this.pendingRequests = new Map();
        // Set only while Python is waiting for the user to confirm a project plan (save_plan gate).
        this.awaitingPlanConfirmation = false;
        // chatHistory and awaitingPlanConfirmation belong to the project shown (historyKey); the other
        // projects' are kept here, so switching back brings its conversation back.
        this.historyKey = '';
        this.stashedChats = new Map();
        // Each set_context bumps it; a slower, older one must not undo a newer project switch.
        this.contextSeq = 0;
        // Set while sending on behalf of a project (forProject): messages for a project not shown go
        // to that project's chat instead of the screen.
        this.redirectKey = undefined;
        // Chat requests that timed out (Python requestId -> { historyKey, clientRequestId }): a late
        // reply still belongs to the project it was asked in.
        this.expiredRequests = new Map();

        this.initialize();
    }

    initialize() {
        // Remove any existing listeners for this session to avoid duplicates
        this.llmService.removeAllListeners(this.sessionId);

        // Listen for messages from the Python service intended for this session
        this.llmService.on(this.sessionId, (response) => {
            this.forwardResponseToClient(response).catch((error) => {
                console.error(`Error forwarding AI response to user ${this.userId}:`, error.message);
            });
        });
    }

    // The new message types are routed before the `user` early return below.
    handleMessage(message) {
        this.lastActivity = new Date();
        if (!isPlainObject(message)) return undefined;

        switch (message.type) {
            case 'ping':
                this.sendMessage({ type: 'pong' });
                return undefined;
            case 'analytics':
                return this.run(this.handleAnalyticsMessage(message));
            case 'set_context':
                // Not a chat turn (and re-sent on every reconnect): a refusal is shown live only.
                return this.run(this.handleSetContext(message), { persist: false });
            case 'repo_analysis':
                return this.run(this.handleRepoAnalysis(message));
            case 'repo_plan_confirm':
                return this.run(this.handleRepoPlanConfirm(message));
            case 'repo_plan_discard':
                return this.run(this.handleRepoPlanDiscard(message));
            default:
                break;
        }

        // Handle regular chat messages
        if (message.type !== 'user' || typeof message.content !== 'string' || !message.content.trim()) {
            return undefined;
        }
        return this.run(this.handleUserMessage(message));
    }

    run(promise, options) {
        return promise.catch((error) => this.sendErrorFrom(error, {}, options));
    }

    // A refused request (bad input, rate limit, analysis already running) is answered live only:
    // the request itself never enters chatHistory, so a restored refusal would have no context,
    // and its "retry in N s" would be stale by then.
    refuse(code, extra) {
        return this.sendError(code, extra, { persist: false });
    }

    async handleUserMessage(message) {
        const requestId = uuidv4();
        const clientRequestId = clientRequestIdOf(message.requestId) || requestId;
        if (message.content.length > MAX_CHAT_MESSAGE) {
            return this.refuse('MESSAGE_TOO_LONG', { requestId: clientRequestId });
        }
        const retryAfterSec = takeChatSlot(this.userId);
        if (retryAfterSec > 0) {
            return this.refuse('RATE_LIMITED', { requestId: clientRequestId, retryAfterSec, message: CHAT_RATE_LIMITED_MESSAGE, content: CHAT_RATE_LIMITED_MESSAGE });
        }

        // Store user message in history
        this.addToHistory({
            type: 'user',
            content: message.content,
            timestamp: new Date()
        });

        this.trackRequest(requestId, 'chat', clientRequestId);
        let project = null;
        try {
            project = await this.ensureProjectContext();
        } catch (error) {
            // Lost membership or a DB hiccup: answer without project data rather than not at all.
            console.warn('Chat project context unavailable:', error && (error.code || error.message));
        }
        const sent = await this.llmService.send({
            requestId,
            sessionId: this.sessionId,
            method: 'handle_user_message', // All user messages from the client go to this single method
            params: {
                message: message.content,
                context: { userId: this.userId },
                project,
            }
        });
        if (!sent) this.failRequest(requestId, 'LLM_ERROR');
        return undefined;
    }

    // Every request to Python gets an answer for the client: Python's, an error, or LLM_TIMEOUT.
    trackRequest(requestId, kind, clientRequestId) {
        this.clearRequest(requestId);
        const timer = setTimeout(() => this.failRequest(requestId, 'LLM_TIMEOUT'), REQUEST_TIMEOUT_MS);
        if (timer.unref) timer.unref();
        this.pendingRequests.set(requestId, { kind, clientRequestId, timer, historyKey: this.historyKey });
    }

    takeExpired(requestId) {
        const entry = requestId ? this.expiredRequests.get(requestId) : null;
        if (entry) this.expiredRequests.delete(requestId);
        return entry || null;
    }

    clearRequest(requestId) {
        const pending = requestId ? this.pendingRequests.get(requestId) : null;
        if (!pending) return null;
        clearTimeout(pending.timer);
        this.pendingRequests.delete(requestId);
        return pending;
    }

    failRequest(requestId, code) {
        const pending = this.clearRequest(requestId);
        if (!pending) return;
        if (pending.kind === 'chat') {
            this.expiredRequests.set(requestId, { historyKey: pending.historyKey, clientRequestId: pending.clientRequestId, expired: true });
            while (this.expiredRequests.size > 50) this.expiredRequests.delete(this.expiredRequests.keys().next().value);
        }
        if (pending.kind !== 'analytics' && pending.historyKey !== this.historyKey) {
            const message = ERROR_MESSAGES[code] || ERROR_MESSAGES.INTERNAL_ERROR;
            this.keepForItsProject(pending, { type: 'error', code, message, content: message, requestId: pending.clientRequestId });
            return;
        }
        if (pending.kind === 'analytics') {
            this.sendMessage({ type: 'analytics_error', error: code, requestId: pending.clientRequestId, timestamp: new Date() });
        } else {
            this.sendError(code, { requestId: pending.clientRequestId });
        }
    }

    async handleAnalyticsMessage(message) {
        const requestId = clientRequestIdOf(message.requestId) || uuidv4();
        let data;
        try {
            data = await prepareAnalyticsData(this.userId, message.data, message.action);
        } catch (error) {
            if (!isAppError(error)) console.error('Failed to prepare the analytics request:', error.message);
            this.sendMessage({ type: 'analytics_error', error: isAppError(error) ? error.code : 'ANALYTICS_ERROR', requestId, timestamp: new Date() });
            return;
        }

        this.trackRequest(requestId, 'analytics', requestId);
        const sent = await this.llmService.send({
            requestId,
            sessionId: this.sessionId,
            type: 'analytics',
            action: message.action,
            data
        });
        if (!sent) this.failRequest(requestId, 'LLM_ERROR');
    }

    async loadMemberGroup(groupId) {
        if (!isUuid(groupId)) throw new AppError('VALIDATION_ERROR', 'groupId must be a valid UUID', 400);
        if (!(await accessModel.isGroupMember(this.userId, groupId))) {
            throw new AppError('NOT_GROUP_MEMBER', 'You are not a member of this group', 403);
        }
        const group = await groupModel.getGroupById(groupId);
        if (!group) throw new AppError('NOT_GROUP_MEMBER', 'You are not a member of this group', 403);
        return { groupId, groupName: group.name, adminId: group.adminId };
    }

    async handleSetContext(message) {
        const seq = ++this.contextSeq;
        const groupId = message.groupId === undefined || message.groupId === '' ? null : message.groupId;
        // Switched right away, before any database work, so whatever the client sends next (a message,
        // an analysis, another switch) already belongs to this project. Membership is checked on every
        // use of chatContext (buildProjectContext, revalidatedContext, the analysis), not only here.
        if (!sameGroup(this.chatContext.groupId, groupId)) this.chatContext = { groupId, cache: null, building: null };
        this.showChatOf(groupId, { always: true });
        if (groupId === null) {
            this.sendMessage({ type: 'context', groupId: null, groupName: null, repo: null });
            return;
        }
        const group = await this.loadMemberGroup(groupId);
        const [repo, unused] = await Promise.all([
            githubModel.getGroupRepository(groupId),
            groupModel.isGroupUnused(groupId),
        ]);
        // A newer set_context arrived meanwhile (quick switches): its context message wins.
        if (seq !== this.contextSeq) return;
        // Never used (no tasks at all, milestones or repository): the chat shapes a new project for it.
        if (unused) this.chatContext.cache = null;
        this.sendMessage({
            type: 'context',
            groupId,
            groupName: group.groupName,
            repo: repo ? { fullName: repo.fullName, defaultBranch: repo.defaultBranch, aiAnalysisEnabled: repo.aiAnalysisEnabled === true } : null,
            empty: unused,
            // Only its admin can have the plan saved in the group; anyone else gets a new group.
            fillable: unused && sameGroup(group.adminId, this.userId),
        });
    }

    // Shows the chat of another project: the current one is kept and the other's is restored (an
    // empty restore clears the screen). Nothing happens when that project is already shown.
    showChatOf(groupId, { always = false } = {}) {
        const key = historyKeyOf(groupId);
        if (key === this.historyKey) {
            // Asked by the client (set_context): it may have cleared its screen, so it gets the chat again.
            if (always) this.sendChatHistory({ evenIfEmpty: true });
            return;
        }
        this.stashedChats.delete(this.historyKey);
        this.stashedChats.set(this.historyKey, { chatHistory: this.chatHistory, awaitingPlanConfirmation: this.awaitingPlanConfirmation });
        while (this.stashedChats.size > MAX_STASHED_CHATS) {
            this.stashedChats.delete(this.stashedChats.keys().next().value);
        }
        const next = this.stashedChats.get(key);
        this.stashedChats.delete(key);
        this.chatHistory = next ? next.chatHistory : [];
        this.awaitingPlanConfirmation = next ? next.awaitingPlanConfirmation : false;
        this.historyKey = key;
        this.sendChatHistory({ evenIfEmpty: true });
    }

    // Adds a message to the chat of project `key` (shown or not).
    addToProjectHistory(key, message) {
        if (key === this.historyKey) return this.addToHistory(message);
        const chat = this.stashedChats.get(key) || { chatHistory: [], awaitingPlanConfirmation: false };
        if (!message.timestamp) message.timestamp = new Date();
        chat.chatHistory.push(message);
        if (chat.chatHistory.length > this.maxHistorySize) chat.chatHistory = chat.chatHistory.slice(-this.maxHistorySize);
        this.stashedChats.set(key, chat);
        return undefined;
    }

    // A reply to a request made in another project than the one now shown: it goes to that project's
    // chat (seen when the user goes back to it) instead of appearing in this one. Returns true if so.
    keepForItsProject(pending, message, awaitingConfirmation) {
        if (!pending || pending.historyKey === undefined || pending.historyKey === this.historyKey) return false;
        this.addToProjectHistory(pending.historyKey, message);
        if (awaitingConfirmation !== undefined) this.stashedChats.get(pending.historyKey).awaitingPlanConfirmation = awaitingConfirmation;
        return true;
    }

    // Runs `send` (synchronous sendMessage/sendError calls) on behalf of project `key`: shown live when
    // it is the project on screen, otherwise kept in that project's chat (live-only messages dropped).
    forProject(key, send) {
        const previous = this.redirectKey;
        this.redirectKey = key;
        try {
            return send();
        } finally {
            this.redirectKey = previous;
        }
    }

    // The selected project's context for the chat: built once (GitHub snapshot + tasks + milestones +
    // team) on the first message after a selection, then reused until the project changes.
    async ensureProjectContext() {
        const ctx = this.chatContext;
        if (!ctx.groupId) return null;
        if (ctx.cache) return this.revalidatedContext(ctx);
        if (!ctx.building) {
            ctx.building = this.buildProjectContext(ctx.groupId).finally(() => { ctx.building = null; });
        }
        const built = await ctx.building;
        // Only cached for the project still selected, and only when the repository could be read.
        if (this.chatContext === ctx && built.cacheable) ctx.cache = built.context;
        return built.context;
    }

    // The cache is reused only while the user is still a member and the repository data is still
    // allowed (consent on, installation not suspended): both re-checked on every message.
    async revalidatedContext(ctx) {
        const { cache } = ctx;
        const [member, repo] = await Promise.all([
            accessModel.isGroupMember(this.userId, ctx.groupId),
            cache.snapshot ? githubModel.getGroupRepository(ctx.groupId) : null,
        ]);
        if (!member) {
            this.chatContext = { groupId: null, cache: null, building: null };
            return null;
        }
        if (cache.snapshot && (!repo || repo.suspendedAt || repo.aiAnalysisEnabled !== true)) {
            ctx.cache = { ...cache, snapshot: null, repoNote: 'Repository data is no longer available to the AI for this project.' };
        }
        return ctx.cache;
    }

    async buildProjectContext(groupId) {
        const group = await this.loadMemberGroup(groupId);
        const [repo, tasks, nodes, members, assignees, unused] = await Promise.all([
            githubModel.getGroupRepository(groupId),
            tasksModel.getTasksByGroupId(groupId),
            nodesModel.getNodesByGroupId(groupId),
            userGroupModel.getMembersByGroupId(groupId),
            usertaskModel.getAssigneesByGroup(groupId),
            groupModel.isGroupUnused(groupId),
        ]);
        const assignments = {};
        for (const { taskName, username } of assignees || []) {
            if (taskName && username) (assignments[taskName] = assignments[taskName] || []).push(username);
        }
        let snapshot = null;
        let repoNote = '';
        let cacheable = true;
        if (!repo) repoNote = 'No GitHub repository is connected to this project.';
        else if (repo.suspendedAt) repoNote = 'The GitHub App installation is suspended.';
        else if (repo.aiAnalysisEnabled !== true) repoNote = 'The group has not allowed AI analysis of its repository.';
        else {
            try {
                snapshot = await buildRepoSnapshot(repo);
            } catch (error) {
                repoNote = 'The repository could not be read right now.';
                cacheable = false; // retried on the next message
            }
        }
        // An unused group is not cached: once it gets tasks, milestones or a repository, the next message
        // must see them (the chat treats an unused group as a new project).
        if (unused) cacheable = false;
        console.log(`[chat] project context built for ${groupId} (repo: ${snapshot ? 'yes' : repoNote || 'no'})`);
        return {
            cacheable,
            context: {
                groupId,
                groupName: group.groupName,
                repoNote,
                hasRepository: Boolean(repo),
                // Never used (no active, completed or deleted tasks, milestones or repository).
                isEmpty: unused === true,
                members: (members || []).map((m) => m.username).filter(Boolean),
                assignments,
                snapshot,
                existing: buildExisting(tasks || [], nodes || []),
            },
        };
    }

    async handleRepoAnalysis(message) {
        const clientRequestId = clientRequestIdOf(message.requestId) || uuidv4();
        // kind lets the client tell an analysis error (e.g. its cooldown) from a chat one with the same code.
        const refuse = (code, extra = {}) => this.refuse(code, { requestId: clientRequestId, kind: 'analysis', ...extra });

        const { groupId, fromChat = false } = message;
        const instructions = message.instructions === undefined || message.instructions === null ? '' : message.instructions;
        if (!isUuid(groupId) || typeof instructions !== 'string') return refuse('VALIDATION_ERROR');
        if (this.analysis) return refuse('ANALYSIS_IN_PROGRESS');
        const retryAfterSec = cooldownRemainingSec(this.userId);
        if (retryAfterSec > 0) return refuse('RATE_LIMITED', { retryAfterSec });

        // Claimed synchronously so a second request in flight sees ANALYSIS_IN_PROGRESS.
        // The client asks for an analysis of the project it shows (after its set_context): that chat is
        // the one shown from now on. Done before any await so a later switch is never undone.
        if (!fromChat) this.showChatOf(groupId);
        const analysis = { requestId: uuidv4(), clientRequestId, groupId, groupName: null, existingTaskNames: [], timer: null, inHistory: false,
            // The analysed group's chat: its request, status, plan or error go there even if the user
            // switches project meanwhile (or the /github shortcut's set_context is still in flight).
            historyKey: historyKeyOf(groupId) };
        this.analysis = analysis;
        const cleanInstructions = instructions.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ').trim().slice(0, MAX_INSTRUCTIONS);
        let releaseCooldown = null;
        try {
            const group = await this.loadMemberGroup(groupId);
            analysis.groupName = group.groupName;
            // From here the analysis is part of the conversation: history_restore shows the request
            // (same text ChatPage shows) before its plan or error. The requestId lets ChatPage tell
            // whether a restore already holds the request it is showing.
            // A plan asked for in the chat already has its message in history.
            if (!fromChat) {
                this.addToProjectHistory(analysis.historyKey, {
                    type: 'user',
                    content: cleanInstructions || `Analyze the repository of “${group.groupName}” and propose the next tasks.`,
                    requestId: clientRequestId,
                    timestamp: new Date(),
                });
            }
            analysis.inHistory = true;
            const repo = await githubModel.getGroupRepository(groupId);
            if (!repo) throw new AppError('REPO_NOT_CONNECTED', 'This group has no connected repository', 409);
            if (repo.suspendedAt) throw new AppError('INSTALLATION_SUSPENDED', 'The GitHub App installation is suspended', 409);
            if (repo.aiAnalysisEnabled !== true) throw new AppError('AI_ANALYSIS_DISABLED', 'AI analysis is disabled for this group', 409);

            // The cooldown is claimed now and given back if nothing reaches the AI provider.
            const previous = lastAnalysisByUser.get(this.userId);
            lastAnalysisByUser.set(this.userId, Date.now());
            releaseCooldown = () => {
                if (previous === undefined) lastAnalysisByUser.delete(this.userId);
                else lastAnalysisByUser.set(this.userId, previous);
            };

            this.forProject(analysis.historyKey, () => this.sendMessage({ type: 'repo_analysis_status', requestId: clientRequestId, stage: 'fetching_repo' }));
            const cached = this.chatContext.cache;
            const [snapshot, tasks, nodes] = await Promise.all([
                cached && sameGroup(cached.groupId, groupId) && cached.snapshot ? cached.snapshot : buildRepoSnapshot(repo),
                tasksModel.getTasksByGroupId(groupId),
                nodesModel.getNodesByGroupId(groupId),
            ]);
            if (this.analysis !== analysis) return undefined;
            analysis.existingTaskNames = (tasks || []).map((t) => t.name);

            this.forProject(analysis.historyKey, () => this.sendMessage({ type: 'repo_analysis_status', requestId: clientRequestId, stage: 'analyzing' }));
            analysis.timer = setTimeout(() => this.finishAnalysis(analysis, { code: 'LLM_TIMEOUT' }), ANALYSIS_TIMEOUT_MS);
            if (analysis.timer.unref) analysis.timer.unref();

            const sent = await this.llmService.send({
                requestId: analysis.requestId,
                sessionId: this.sessionId,
                method: 'analyze_repository',
                params: {
                    groupId,
                    instructions: cleanInstructions,
                    today: localToday(),
                    limits: { ...PLAN_LIMITS },
                    snapshot,
                    existing: buildExisting(tasks || [], nodes || []),
                },
            });
            if (!sent) {
                releaseCooldown();
                this.finishAnalysis(analysis, { code: 'LLM_ERROR' });
            }
        } catch (error) {
            if (releaseCooldown) releaseCooldown();
            this.finishAnalysis(analysis, { error });
        }
        return undefined;
    }

    // Ends an analysis once (reply, error, timeout or failure); later calls are no-ops.
    finishAnalysis(analysis, { code, error, retryAfterSec } = {}) {
        if (this.analysis !== analysis) return;
        clearTimeout(analysis.timer);
        this.analysis = null;
        const extra = { requestId: analysis.clientRequestId, kind: 'analysis' };
        if (Number.isFinite(retryAfterSec)) extra.retryAfterSec = retryAfterSec;
        // Kept only next to the request it answers (a refused request is not in history; see refuse).
        const options = { persist: analysis.inHistory };
        const send = () => {
            if (error) this.sendErrorFrom(error, extra, options);
            else this.sendError(code, extra, options);
        };
        // A refusal before the request entered the conversation is answered live, as any refusal;
        // later errors belong to the analysed project's chat.
        if (analysis.inHistory) this.forProject(analysis.historyKey, send);
        else send();
    }

    handleAnalysisReply(response) {
        const analysis = this.analysis;
        // Replies are correlated by requestId only (Python answers analyses out of order).
        if (!analysis || response.requestId !== analysis.requestId) return;

        if (response.event === 'repo_analysis_error') {
            const error = isPlainObject(response.error) ? response.error : {};
            const code = PASSTHROUGH_ANALYSIS_CODES.has(error.code) ? error.code : 'ANALYSIS_FAILED';
            this.finishAnalysis(analysis, { code, retryAfterSec: Number(error.retryAfterSec) });
            return;
        }

        let plan;
        try {
            plan = sanitizePlan(response.data && response.data.plan, { today: localToday(), existingTaskNames: analysis.existingTaskNames });
        } catch {
            this.finishAnalysis(analysis, { code: 'LLM_INVALID_OUTPUT' });
            return;
        }
        clearTimeout(analysis.timer);
        this.analysis = null;

        const planId = uuidv4();
        const expiresAt = Date.now() + PLAN_TTL_MS;
        this.storePendingPlan(planId, { plan, groupId: analysis.groupId, groupName: analysis.groupName, expiresAt });
        this.forProject(analysis.historyKey, () => this.sendMessage({
            type: 'repo_plan',
            requestId: analysis.clientRequestId,
            planId,
            groupId: analysis.groupId,
            groupName: analysis.groupName,
            expiresAt: new Date(expiresAt).toISOString(),
            content: planToText(plan, analysis.groupName),
            plan,
        }));
    }

    storePendingPlan(planId, entry) {
        const now = Date.now();
        for (const [id, pending] of this.pendingPlans) if (pending.expiresAt <= now) this.pendingPlans.delete(id);
        while (this.pendingPlans.size >= MAX_PENDING_PLANS) {
            this.pendingPlans.delete(this.pendingPlans.keys().next().value);
        }
        this.pendingPlans.set(planId, entry);
    }

    async handleRepoPlanConfirm(message) {
        const { planId } = message;
        const pending = typeof planId === 'string' ? this.pendingPlans.get(planId) : null;
        if (!pending) return this.sendError('REPO_PLAN_NOT_FOUND', { planId });
        // Single use: removed before saving so a double click cannot save twice.
        this.pendingPlans.delete(planId);
        if (pending.expiresAt <= Date.now()) return this.sendError('REPO_PLAN_EXPIRED', { planId });

        // The outcome belongs next to the plan card, in that group's chat, even if the user switched meanwhile.
        const inPlanChat = (send) => this.forProject(historyKeyOf(pending.groupId), send);
        try {
            if (!(await accessModel.isGroupMember(this.userId, pending.groupId))) {
                throw new AppError('NOT_GROUP_MEMBER', 'You are not a member of this group', 403);
            }
            const result = await projectService.addPlanToGroup(pending.groupId, pending.plan, this.userId);
            const created = { tasks: result.taskIds.length, milestones: result.nodeIds.length };
            inPlanChat(() => this.sendMessage({
                type: 'repo_plan_saved',
                planId,
                groupId: pending.groupId,
                created,
                content: `Plan guardado: ${created.tasks} tareas y ${created.milestones} hitos.`,
            }));
        } catch (error) {
            if (isAppError(error) && error.code === 'NOT_GROUP_MEMBER') return inPlanChat(() => this.sendError('NOT_GROUP_MEMBER', { planId }));
            if (!isAppError(error)) console.error('Failed to save the repository plan:', error.message);
            if (pending.expiresAt > Date.now()) this.pendingPlans.set(planId, pending);
            inPlanChat(() => this.sendError('SAVE_FAILED', { planId }));
        }
        return undefined;
    }

    async handleRepoPlanDiscard(message) {
        const { planId } = message;
        if (typeof planId !== 'string' || !this.pendingPlans.has(planId)) return this.sendError('REPO_PLAN_NOT_FOUND', { planId });
        const { groupId } = this.pendingPlans.get(planId);
        this.pendingPlans.delete(planId);
        this.forProject(historyKeyOf(groupId), () => this.sendMessage({ type: 'repo_plan_discarded', planId, content: 'Plan descartado.' }));
        return undefined;
    }

    async forwardResponseToClient(response) {
        if (!isPlainObject(response)) return;
        const { event } = response;
        const data = isPlainObject(response.data) ? response.data : {};

        if (event === 'repo_analysis_plan' || event === 'repo_analysis_error') {
            this.handleAnalysisReply(response);
        } else if (event === 'response') {
            // LLM failures in the chat arrive here as friendly text (data.error carries the code).
            const pending = this.clearRequest(response.requestId) || this.takeExpired(response.requestId);
            const message = { type: 'assistant', content: data.content, timestamp: new Date() };
            // A late reply (after LLM_TIMEOUT) is shown without the request id, as before.
            if (pending && !pending.expired) message.requestId = pending.clientRequestId;
            if (this.keepForItsProject(pending, message, data.awaiting_confirmation === true)) return;
            this.awaitingPlanConfirmation = data.awaiting_confirmation === true;
            this.sendMessage(message);
        } else if (event === 'response_chunk') {
            // Streamed text of a chat reply. Only for a request still in flight: once it has
            // timed out or been answered, a late chunk would paint a bubble under that outcome.
            const pending = response.requestId ? this.pendingRequests.get(response.requestId) : null;
            const content = typeof response.data === 'string' ? response.data : data.content;
            if (pending && pending.historyKey === this.historyKey && typeof content === 'string' && content) {
                // The client groups chunks into one bubble by its own request id; the final
                // 'assistant' message carries the same id and replaces the streamed text.
                this.sendMessage({ type: 'assistant_chunk', content, requestId: pending.clientRequestId, timestamp: new Date() });
            }
        } else if (event === 'response_stream_end') {
            // Nothing to do: the final 'response' event closes the stream on the client.
        } else if (event === 'plan_request') {
            // The user asked for a plan in the chat: run the repository analysis for that message.
            const pending = this.clearRequest(response.requestId);
            if (!pending) return;
            // Asked in another project than the one now shown: that project is not analyzed for it.
            if (this.keepForItsProject(pending, { type: 'error', code: 'PROJECT_CHANGED',
                content: 'The plan was not started because the chat switched to another project.', requestId: pending.clientRequestId })) return;
            if (!this.chatContext.groupId) return;
            await this.run(this.handleRepoAnalysis({
                groupId: this.chatContext.groupId,
                instructions: typeof data.instructions === 'string' ? data.instructions.slice(0, MAX_INSTRUCTIONS) : '',
                requestId: pending.clientRequestId,
                fromChat: true,
            }));
        } else if (event === 'save_plan') {
            const pending = this.clearRequest(response.requestId) || this.takeExpired(response.requestId);
            if (pending && pending.historyKey !== this.historyKey) {
                // Confirmed in a project the user has left meanwhile: not saved; Python is told so.
                this.keepForItsProject(pending, { type: 'error', code: 'SAVE_FAILED', content: 'Could not create the project.', requestId: pending.clientRequestId }, true);
                await this.notifySaveResult(response.requestId || uuidv4(), { success: false, errorCode: 'PROJECT_CHANGED' });
                return;
            }
            await this.saveProjectPlan(response.requestId, data, pending);
        } else if (event === 'analytics_response') {
            this.clearRequest(response.requestId);
            this.sendMessage({
                type: 'analytics_response',
                data: response.data,
                requestId: response.requestId,
                timestamp: new Date()
            });
        } else if (event === 'analytics_error') {
            this.clearRequest(response.requestId);
            const code = typeof response.code === 'string' ? response.code : 'ANALYTICS_ERROR';
            this.sendMessage({ type: 'analytics_error', error: code, code, requestId: response.requestId, timestamp: new Date() });
        } else if (event === 'error' || response.error) {
            this.handlePythonError(response);
        }
    }

    // Python's error text never reaches the client, only a known code (default LLM_ERROR).
    handlePythonError(response) {
        const code = typeof response.code === 'string' ? response.code
            : (isPlainObject(response.error) && typeof response.error.code === 'string' ? response.error.code : null);
        const knownCode = code && PASSTHROUGH_ANALYSIS_CODES.has(code) ? code : null;
        if (this.analysis && response.requestId && response.requestId === this.analysis.requestId) {
            this.finishAnalysis(this.analysis, { code: knownCode || 'ANALYSIS_FAILED' });
        } else if (response.requestId && this.pendingRequests.has(response.requestId)) {
            this.failRequest(response.requestId, knownCode || 'LLM_ERROR');
        } else {
            this.sendError(knownCode || 'LLM_ERROR');
        }
    }

    // Python only asks to save after it showed a plan awaiting confirmation; any other save_plan
    // is refused. Python always gets the outcome back (it keeps the plan until then).
    async saveProjectPlan(pythonRequestId, data, pending = null) {
        const requestId = pythonRequestId || uuidv4();
        // The project the plan was confirmed in: its outcome goes to that chat even if the user
        // switches project while the database work runs.
        const key = pending && pending.historyKey !== undefined ? pending.historyKey : this.historyKey;
        if (!this.awaitingPlanConfirmation) {
            console.warn(`Ignored save_plan for user ${this.userId}: no project plan was awaiting confirmation`);
            await this.notifySaveResult(requestId, { success: false, errorCode: 'PLAN_NOT_EXPECTED' });
            return;
        }
        this.awaitingPlanConfirmation = false;

        let result;
        let notFilledReason = null;
        try {
            // Made in an unused group (a new account's personal one): saved in it when the user is its
            // admin and it is still unused; otherwise as a new project, as before.
            if (data.target_group_id) {
                result = await projectService.fillEmptyGroupFromPlan(data.target_group_id, data.plan, data.original_message, this.userId);
                if (result && result.notEligible) notFilledReason = result.reason || 'NOT_EMPTY';
            }
            if (!result || notFilledReason) {
                result = await projectService.createProjectFromPlan(data.plan, data.original_message, this.userId);
            }
        } catch (error) {
            console.error('Failed to create project:', error.message);
            result = null;
        }
        if (result && result.success) {
            const groupName = result.groupName || deriveProjectName(data.plan, data.original_message);
            const why = notFilledReason === 'NOT_ADMIN'
                ? 'solo el admin del grupo puede guardarlo en él'
                : 'el grupo ya no estaba vacío';
            this.forProject(key, () => this.sendMessage({
                type: 'system',
                event: 'project_created',
                content: result.filled
                    ? `Proyecto "${groupName}" creado en este grupo`
                    : notFilledReason
                        ? `Proyecto "${groupName}" creado como un grupo nuevo (${why})`
                        : `Proyecto "${groupName}" creado`,
                groupId: result.groupId,
                groupName,
                filled: result.filled === true,
                timestamp: new Date()
            }));
            // The filled group now has data: its chat context is rebuilt on the next message.
            if (result.filled && sameGroup(this.chatContext.groupId, result.groupId)) {
                this.chatContext = { groupId: this.chatContext.groupId, cache: null, building: null };
            }
            await this.notifySaveResult(requestId, { success: true, groupId: result.groupId, groupName });
        } else {
            this.forProject(key, () => this.sendError('SAVE_FAILED', { content: 'Could not create the project.' }));
            await this.notifySaveResult(requestId, { success: false, errorCode: 'SAVE_FAILED' });
        }
    }

    notifySaveResult(requestId, params) {
        return this.llmService.send({ requestId, sessionId: this.sessionId, method: 'save_plan_result', params }, { expectReply: false });
    }

    sendError(code, extra = {}, options) {
        const message = ERROR_MESSAGES[code] || ERROR_MESSAGES.INTERNAL_ERROR;
        const payload = { type: 'error', code: code || 'INTERNAL_ERROR', message, content: message, timestamp: new Date(), ...extra };
        Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);
        this.sendMessage(payload, options);
    }

    sendErrorFrom(error, extra = {}, options) {
        if (isAppError(error) && ERROR_MESSAGES[error.code]) {
            const withRetry = error.details && Number.isFinite(error.details.retryAfterSec)
                ? { retryAfterSec: error.details.retryAfterSec, ...extra }
                : extra;
            return this.sendError(error.code, withRetry, options);
        }
        console.error(`Unexpected error in session of user ${this.userId}:`, error && error.message);
        return this.sendError('INTERNAL_ERROR', extra, options);
    }

    sendMessage(message, { persist = true } = {}) {
        try {
            this.lastActivity = new Date();
            if (!message.timestamp) message.timestamp = new Date();

            const isWelcome = message.type === 'system' && typeof message.content === 'string'
                && message.content.includes('Connected to TaskMate');
            const keep = persist && !isWelcome && !TRANSIENT_TYPES.has(message.type);
            if (this.redirectKey !== undefined && this.redirectKey !== this.historyKey) {
                if (keep) this.addToProjectHistory(this.redirectKey, message);
                return;
            }
            if (keep) {
                this.addToHistory(message);
            }

            if (this.websocket && this.websocket.readyState === 1) { // WebSocket.OPEN
                this.websocket.send(JSON.stringify(message));
            }
        } catch (error) {
            console.error(`Error sending message to user ${this.userId}:`, error);
        }
    }

    reconnect() {
        this.connected = true;
        this.lastActivity = new Date();

        // Send chat history first
        this.sendChatHistory();
    }

    markDisconnected() {
        this.connected = false;
        this.websocket = null;
    }

    isDisconnected() {
        return !this.connected;
    }

    isActive() {
        return Boolean(this.connected && this.websocket && this.websocket.readyState === 1);
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

    sendChatHistory({ evenIfEmpty = false } = {}) {
        if ((evenIfEmpty || this.chatHistory.length > 0) && this.websocket && this.websocket.readyState === 1) {
            // chatOf: whose chat this is (group id in lowercase, '' = no project), so the client shows it
            // only under that project (after a reconnect the server may still be on another one).
            this.websocket.send(JSON.stringify({
                type: 'history_restore',
                messages: this.chatHistory,
                chatOf: this.historyKey,
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
        this.connected = false;
        this.llmService.removeAllListeners(this.sessionId);
        if (this.analysis) clearTimeout(this.analysis.timer);
        this.analysis = null;
        this.pendingPlans.clear();
        for (const pending of this.pendingRequests.values()) clearTimeout(pending.timer);
        this.pendingRequests.clear();

        if (this.websocket && this.websocket.readyState === 1) {
            this.websocket.close(1000, 'Session cleanup');
        }
        this.websocket = null;
    }
}

UserSession.prepareAnalyticsData = prepareAnalyticsData;
UserSession.lastAnalysisByUser = lastAnalysisByUser;
UserSession.chatWindowByUser = chatWindowByUser;
UserSession.analyticsWindowByUser = analyticsWindowByUser;
UserSession.REQUEST_TIMEOUT_MS = REQUEST_TIMEOUT_MS;
UserSession.ANALYSIS_TIMEOUT_MS = ANALYSIS_TIMEOUT_MS;
UserSession.PLAN_TTL_MS = PLAN_TTL_MS;

module.exports = UserSession;

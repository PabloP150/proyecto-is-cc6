const { v4: uuidv4 } = require('uuid');
const llmService = require('./LLMService');
const projectService = require('./ProjectService');
const { buildTeamContext } = require('./analyticsContext');
const accessModel = require('../models/access.model');
const groupModel = require('../models/group.model');
const githubModel = require('../models/github.model');
const tasksModel = require('../models/tasks.model');
const nodesModel = require('../models/nodes.model');
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
const TRANSIENT_TYPES = new Set(['pong', 'context', 'repo_analysis_status']);

// Same rule as the REST analytics endpoints: team-level data only for group leaders.
const TEAM_ANALYTICS_ACTIONS = new Set([
    'get_task_assignment_recommendations', 'get_team_analytics', 'get_workload_distribution',
    'get_expertise_rankings', 'record_task_assignment', 'record_task_completion',
]);
const USER_ANALYTICS_ACTIONS = new Set(['get_user_analytics']);

const ERROR_MESSAGES = {
    VALIDATION_ERROR: 'Solicitud inválida.',
    NOT_GROUP_MEMBER: 'No eres miembro de ese proyecto.',
    NOT_GROUP_ADMIN: 'Solo los líderes del equipo pueden ver esos datos.',
    REPO_NOT_CONNECTED: 'El proyecto no tiene un repositorio de GitHub conectado.',
    AI_ANALYSIS_DISABLED: 'El análisis con IA está desactivado para este proyecto; un administrador puede activarlo.',
    INSTALLATION_SUSPENDED: 'La instalación de la GitHub App está suspendida.',
    REPO_NOT_ACCESSIBLE: 'La GitHub App ya no tiene acceso al repositorio.',
    REPO_EMPTY: 'El repositorio está vacío.',
    GITHUB_RATE_LIMITED: 'GitHub limitó las solicitudes; intenta más tarde.',
    GITHUB_ERROR: 'No se pudo leer el repositorio en GitHub.',
    GITHUB_NOT_CONFIGURED: 'La integración con GitHub no está configurada.',
    ANALYSIS_IN_PROGRESS: 'Ya hay un análisis en curso.',
    RATE_LIMITED: 'Solo se puede pedir un análisis por minuto.',
    MESSAGE_TOO_LONG: `El mensaje es demasiado largo (máximo ${MAX_CHAT_MESSAGE} caracteres).`,
    LLM_TIMEOUT: 'La IA tardó demasiado en responder. Intenta de nuevo.',
    LLM_RATE_LIMIT: 'El servicio de IA está ocupado. Intenta de nuevo en unos segundos.',
    LLM_INVALID_OUTPUT: 'La IA devolvió un plan inválido. Intenta de nuevo.',
    LLM_ERROR: 'El servicio de IA no está disponible en este momento.',
    ANALYSIS_FAILED: 'No se pudo completar el análisis.',
    REPO_PLAN_NOT_FOUND: 'El plan ya no está disponible.',
    REPO_PLAN_EXPIRED: 'El plan expiró; vuelve a analizar el repositorio.',
    SAVE_FAILED: 'No se pudo guardar el plan.',
    INTERNAL_ERROR: 'Ocurrió un error inesperado.',
};
const CHAT_RATE_LIMITED_MESSAGE = 'Estás enviando mensajes muy rápido; espera un momento.';
const PASSTHROUGH_ANALYSIS_CODES = new Set(['LLM_TIMEOUT', 'LLM_RATE_LIMIT', 'LLM_INVALID_OUTPUT', 'LLM_ERROR', 'MESSAGE_TOO_LONG']);

// Per user (not per session): a reconnect or a second tab does not reset these limits.
const lastAnalysisByUser = new Map();
const chatWindowByUser = new Map();
const analyticsWindowByUser = new Map();

const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);
const sameId = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
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
        this.pendingPlans = new Map();
        // requestId sent to Python -> { kind: 'chat' | 'analytics', clientRequestId, timer }
        this.pendingRequests = new Map();
        // Set only while Python is waiting for the user to confirm a project plan (save_plan gate).
        this.awaitingPlanConfirmation = false;

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
        const sent = await this.llmService.send({
            requestId,
            sessionId: this.sessionId,
            method: 'handle_user_message', // All user messages from the client go to this single method
            params: {
                message: message.content,
                context: { userId: this.userId }
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
        this.pendingRequests.set(requestId, { kind, clientRequestId, timer });
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
        return { groupId, groupName: group.name };
    }

    async handleSetContext(message) {
        const groupId = message.groupId === undefined || message.groupId === '' ? null : message.groupId;
        if (groupId === null) {
            this.sendMessage({ type: 'context', groupId: null, groupName: null, repo: null });
            return;
        }
        const group = await this.loadMemberGroup(groupId);
        const repo = await githubModel.getGroupRepository(groupId);
        this.sendMessage({
            type: 'context',
            groupId,
            groupName: group.groupName,
            repo: repo ? { fullName: repo.fullName, defaultBranch: repo.defaultBranch, aiAnalysisEnabled: repo.aiAnalysisEnabled === true } : null,
        });
    }

    async handleRepoAnalysis(message) {
        const clientRequestId = clientRequestIdOf(message.requestId) || uuidv4();
        const refuse = (code, extra = {}) => this.refuse(code, { requestId: clientRequestId, ...extra });

        const { groupId } = message;
        const instructions = message.instructions === undefined || message.instructions === null ? '' : message.instructions;
        if (!isUuid(groupId) || typeof instructions !== 'string') return refuse('VALIDATION_ERROR');
        if (this.analysis) return refuse('ANALYSIS_IN_PROGRESS');
        const retryAfterSec = cooldownRemainingSec(this.userId);
        if (retryAfterSec > 0) return refuse('RATE_LIMITED', { retryAfterSec });

        // Claimed synchronously so a second request in flight sees ANALYSIS_IN_PROGRESS.
        const analysis = { requestId: uuidv4(), clientRequestId, groupId, groupName: null, existingTaskNames: [], timer: null, inHistory: false };
        this.analysis = analysis;
        const cleanInstructions = instructions.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ').trim().slice(0, MAX_INSTRUCTIONS);
        let releaseCooldown = null;
        try {
            const group = await this.loadMemberGroup(groupId);
            analysis.groupName = group.groupName;
            // From here the analysis is part of the conversation: history_restore shows the request
            // (same text ChatPage shows) before its plan or error. The requestId lets ChatPage tell
            // whether a restore already holds the request it is showing.
            this.addToHistory({
                type: 'user',
                content: cleanInstructions || `Analiza el repositorio de «${group.groupName}» y propón las siguientes tareas.`,
                requestId: clientRequestId,
                timestamp: new Date(),
            });
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

            this.sendMessage({ type: 'repo_analysis_status', requestId: clientRequestId, stage: 'fetching_repo' });
            const [snapshot, tasks, nodes] = await Promise.all([
                buildRepoSnapshot(repo),
                tasksModel.getTasksByGroupId(groupId),
                nodesModel.getNodesByGroupId(groupId),
            ]);
            if (this.analysis !== analysis) return undefined;
            analysis.existingTaskNames = (tasks || []).map((t) => t.name);

            this.sendMessage({ type: 'repo_analysis_status', requestId: clientRequestId, stage: 'analyzing' });
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
        const extra = { requestId: analysis.clientRequestId };
        if (Number.isFinite(retryAfterSec)) extra.retryAfterSec = retryAfterSec;
        // Kept only next to the request it answers (a refused request is not in history; see refuse).
        const options = { persist: analysis.inHistory };
        if (error) this.sendErrorFrom(error, extra, options);
        else this.sendError(code, extra, options);
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
        this.sendMessage({
            type: 'repo_plan',
            requestId: analysis.clientRequestId,
            planId,
            groupId: analysis.groupId,
            groupName: analysis.groupName,
            expiresAt: new Date(expiresAt).toISOString(),
            content: planToText(plan, analysis.groupName),
            plan,
        });
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

        try {
            if (!(await accessModel.isGroupMember(this.userId, pending.groupId))) {
                throw new AppError('NOT_GROUP_MEMBER', 'You are not a member of this group', 403);
            }
            const result = await projectService.addPlanToGroup(pending.groupId, pending.plan, this.userId);
            const created = { tasks: result.taskIds.length, milestones: result.nodeIds.length };
            this.sendMessage({
                type: 'repo_plan_saved',
                planId,
                groupId: pending.groupId,
                created,
                content: `Plan guardado: ${created.tasks} tareas y ${created.milestones} hitos.`,
            });
        } catch (error) {
            if (isAppError(error) && error.code === 'NOT_GROUP_MEMBER') return this.sendError('NOT_GROUP_MEMBER', { planId });
            if (!isAppError(error)) console.error('Failed to save the repository plan:', error.message);
            if (pending.expiresAt > Date.now()) this.pendingPlans.set(planId, pending);
            this.sendError('SAVE_FAILED', { planId });
        }
        return undefined;
    }

    async handleRepoPlanDiscard(message) {
        const { planId } = message;
        if (typeof planId !== 'string' || !this.pendingPlans.has(planId)) return this.sendError('REPO_PLAN_NOT_FOUND', { planId });
        this.pendingPlans.delete(planId);
        this.sendMessage({ type: 'repo_plan_discarded', planId, content: 'Plan descartado.' });
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
            const pending = this.clearRequest(response.requestId);
            this.awaitingPlanConfirmation = data.awaiting_confirmation === true;
            const message = { type: 'assistant', content: data.content, timestamp: new Date() };
            if (pending) message.requestId = pending.clientRequestId;
            this.sendMessage(message);
        } else if (event === 'response_chunk') {
            const content = typeof response.data === 'string' ? response.data : data.content;
            if (typeof content === 'string' && content) {
                this.sendMessage({ type: 'assistant_chunk', content, timestamp: new Date() });
            }
        } else if (event === 'response_stream_end') {
            // The stream end event can be used to signify the end of a stream on the client.
        } else if (event === 'save_plan') {
            this.clearRequest(response.requestId);
            await this.saveProjectPlan(response.requestId, data);
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
    async saveProjectPlan(pythonRequestId, data) {
        const requestId = pythonRequestId || uuidv4();
        if (!this.awaitingPlanConfirmation) {
            console.warn(`Ignored save_plan for user ${this.userId}: no project plan was awaiting confirmation`);
            await this.notifySaveResult(requestId, { success: false, errorCode: 'PLAN_NOT_EXPECTED' });
            return;
        }
        this.awaitingPlanConfirmation = false;

        let result;
        try {
            result = await projectService.createProjectFromPlan(data.plan, data.original_message, this.userId);
        } catch (error) {
            console.error('Failed to create project:', error.message);
            result = null;
        }
        if (result && result.success) {
            const groupName = result.groupName || deriveProjectName(data.plan, data.original_message);
            this.sendMessage({
                type: 'system',
                event: 'project_created',
                content: `Proyecto "${groupName}" creado`,
                groupId: result.groupId,
                groupName,
                timestamp: new Date()
            });
            await this.notifySaveResult(requestId, { success: true, groupId: result.groupId, groupName });
        } else {
            this.sendError('SAVE_FAILED', { content: 'No se pudo crear el proyecto.' });
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
            if (persist && !isWelcome && !TRANSIENT_TYPES.has(message.type)) {
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

    sendChatHistory() {
        if (this.chatHistory.length > 0 && this.websocket && this.websocket.readyState === 1) {
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

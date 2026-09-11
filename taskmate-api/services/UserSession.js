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

const ANALYSIS_TIMEOUT_MS = 90 * 1000;
const ANALYSIS_COOLDOWN_MS = 60 * 1000;
const PLAN_TTL_MS = 30 * 60 * 1000;
const MAX_PENDING_PLANS = 5;
const MAX_INSTRUCTIONS = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT_ID_RE = /^[A-Za-z0-9_.:-]{1,100}$/;
// Not stored in chatHistory (history_restore would replay them).
const TRANSIENT_TYPES = new Set(['pong', 'context', 'repo_analysis_status']);

const ERROR_MESSAGES = {
    VALIDATION_ERROR: 'Solicitud inválida.',
    NOT_GROUP_MEMBER: 'No eres miembro de ese proyecto.',
    REPO_NOT_CONNECTED: 'El proyecto no tiene un repositorio de GitHub conectado.',
    INSTALLATION_SUSPENDED: 'La instalación de la GitHub App está suspendida.',
    REPO_NOT_ACCESSIBLE: 'La GitHub App ya no tiene acceso al repositorio.',
    REPO_EMPTY: 'El repositorio está vacío.',
    GITHUB_RATE_LIMITED: 'GitHub limitó las solicitudes; intenta más tarde.',
    GITHUB_ERROR: 'No se pudo leer el repositorio en GitHub.',
    GITHUB_NOT_CONFIGURED: 'La integración con GitHub no está configurada.',
    ANALYSIS_IN_PROGRESS: 'Ya hay un análisis en curso.',
    RATE_LIMITED: 'Espera un minuto antes de pedir otro análisis.',
    LLM_TIMEOUT: 'El análisis tardó demasiado. Intenta de nuevo.',
    LLM_RATE_LIMIT: 'El servicio de IA está ocupado. Intenta de nuevo en unos segundos.',
    LLM_INVALID_OUTPUT: 'La IA devolvió un plan inválido. Intenta de nuevo.',
    LLM_ERROR: 'El servicio de IA no está disponible en este momento.',
    ANALYSIS_FAILED: 'No se pudo completar el análisis.',
    REPO_PLAN_NOT_FOUND: 'El plan ya no está disponible.',
    REPO_PLAN_EXPIRED: 'El plan expiró; vuelve a analizar el repositorio.',
    SAVE_FAILED: 'No se pudo guardar el plan.',
    INTERNAL_ERROR: 'Ocurrió un error inesperado.',
};
const PASSTHROUGH_ANALYSIS_CODES = new Set(['LLM_TIMEOUT', 'LLM_RATE_LIMIT', 'LLM_INVALID_OUTPUT', 'LLM_ERROR']);

// Per user (not per session): a reconnect or a second tab does not reset the cooldown.
const lastAnalysisByUser = new Map();

const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);
const sameId = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const clientRequestIdOf = (value) => (typeof value === 'string' && CLIENT_ID_RE.test(value) ? value : uuidv4());

const cooldownRemainingSec = (userId, now = Date.now()) => {
    if (lastAnalysisByUser.size > 1000) {
        for (const [uid, at] of lastAnalysisByUser) if (now - at >= ANALYSIS_COOLDOWN_MS) lastAnalysisByUser.delete(uid);
    }
    const last = lastAnalysisByUser.get(userId);
    return last && now - last < ANALYSIS_COOLDOWN_MS ? Math.ceil((ANALYSIS_COOLDOWN_MS - (now - last)) / 1000) : 0;
};

const deriveProjectName = (plan, originalMessage) => {
    const data = (plan && (plan.recommendations || plan)) || {};
    return String(data.project_name || `Project: ${originalMessage || ''}`).slice(0, 25);
};

// Client-sent team_context is never trusted; the real one is only built for members.
const prepareAnalyticsData = async (userId, rawData) => {
    const data = rawData && typeof rawData === 'object' && !Array.isArray(rawData) ? { ...rawData } : {};
    delete data.team_context;
    const groupId = data.group_id || data.groupId;
    if (isUuid(groupId)) {
        if (!(await accessModel.isGroupMember(userId, groupId))) {
            throw new AppError('NOT_GROUP_MEMBER', 'You are not a member of this group', 403);
        }
        data.team_context = await buildTeamContext(groupId);
    }
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
        this.context = null;
        this.analysis = null;
        this.pendingPlans = new Map();

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
        if (!message || typeof message !== 'object') return undefined;

        switch (message.type) {
            case 'ping':
                this.sendMessage({ type: 'pong' });
                return undefined;
            case 'analytics':
                return this.run(this.handleAnalyticsMessage(message));
            case 'set_context':
                return this.run(this.handleSetContext(message));
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
        if (message.type !== 'user' || !message.content) {
            return undefined;
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

        return this.run(this.llmService.send(request).then((sent) => {
            if (!sent) this.sendError('LLM_ERROR');
        }));
    }

    run(promise) {
        return promise.catch((error) => this.sendErrorFrom(error));
    }

    async handleAnalyticsMessage(message) {
        const requestId = typeof message.requestId === 'string' ? message.requestId.slice(0, 100) : uuidv4();
        let data;
        try {
            data = await prepareAnalyticsData(this.userId, message.data);
        } catch (error) {
            if (!isAppError(error)) console.error('Failed to build the analytics team context:', error.message);
            this.sendMessage({ type: 'analytics_error', error: isAppError(error) ? error.code : 'ANALYTICS_ERROR', requestId, timestamp: new Date() });
            return;
        }

        const sent = await this.llmService.send({
            requestId,
            sessionId: this.sessionId,
            type: 'analytics',
            action: message.action,
            data
        });
        if (!sent) {
            this.sendMessage({ type: 'analytics_error', error: 'LLM_ERROR', requestId, timestamp: new Date() });
        }
    }

    async loadMemberGroup(groupId) {
        if (!isUuid(groupId)) throw new AppError('VALIDATION_ERROR', 'groupId must be a valid UUID', 400);
        if (!(await accessModel.isGroupMember(this.userId, groupId))) {
            throw new AppError('NOT_GROUP_MEMBER', 'You are not a member of this group', 403);
        }
        const groups = await groupModel.getGroupsByUserId(this.userId);
        const group = (groups || []).find((g) => sameId(String(g.gid), groupId));
        return { groupId, groupName: group ? group.name : null };
    }

    async handleSetContext(message) {
        const groupId = message.groupId === undefined || message.groupId === '' ? null : message.groupId;
        if (groupId === null) {
            this.context = null;
            this.sendMessage({ type: 'context', groupId: null, groupName: null, repo: null });
            return;
        }
        const group = await this.loadMemberGroup(groupId);
        const repo = await githubModel.getGroupRepository(groupId);
        this.context = {
            groupId,
            groupName: group.groupName,
            repo: repo ? { fullName: repo.fullName, defaultBranch: repo.defaultBranch } : null,
        };
        this.sendMessage({ type: 'context', ...this.context });
    }

    async handleRepoAnalysis(message) {
        const clientRequestId = clientRequestIdOf(message.requestId);
        const fail = (code, extra = {}) => this.sendError(code, { requestId: clientRequestId, ...extra });

        const { groupId } = message;
        const instructions = message.instructions === undefined || message.instructions === null ? '' : message.instructions;
        if (!isUuid(groupId) || typeof instructions !== 'string') return fail('VALIDATION_ERROR');
        if (this.analysis) return fail('ANALYSIS_IN_PROGRESS');
        const retryAfterSec = cooldownRemainingSec(this.userId);
        if (retryAfterSec > 0) return fail('RATE_LIMITED', { retryAfterSec });

        // Claimed synchronously so a second request in flight sees ANALYSIS_IN_PROGRESS.
        const analysis = { requestId: uuidv4(), clientRequestId, groupId, groupName: null, existingTaskNames: [], timer: null };
        this.analysis = analysis;
        try {
            const group = await this.loadMemberGroup(groupId);
            analysis.groupName = group.groupName;
            const repo = await githubModel.getGroupRepository(groupId);
            if (!repo) throw new AppError('REPO_NOT_CONNECTED', 'This group has no connected repository', 409);
            if (repo.suspendedAt) throw new AppError('INSTALLATION_SUSPENDED', 'The GitHub App installation is suspended', 409);

            lastAnalysisByUser.set(this.userId, Date.now());
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
                    instructions: instructions.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ').trim().slice(0, MAX_INSTRUCTIONS),
                    today: localToday(),
                    limits: { ...PLAN_LIMITS },
                    snapshot,
                    existing: buildExisting(tasks || [], nodes || []),
                },
            });
            if (!sent) this.finishAnalysis(analysis, { code: 'LLM_ERROR' });
        } catch (error) {
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
        if (error) this.sendErrorFrom(error, extra);
        else this.sendError(code, extra);
    }

    handleAnalysisReply(response) {
        const analysis = this.analysis;
        // Replies are correlated by requestId only (Python answers analyses out of order).
        if (!analysis || response.requestId !== analysis.requestId) return;

        if (response.event === 'repo_analysis_error') {
            const error = response.error && typeof response.error === 'object' ? response.error : {};
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
        if (!response || typeof response !== 'object') return;
        const { event } = response;
        const data = response.data || {};

        if (event === 'repo_analysis_plan' || event === 'repo_analysis_error') {
            this.handleAnalysisReply(response);
        } else if (event === 'response') {
            // LLM failures in the chat arrive here as friendly text (data.error carries the code).
            this.sendMessage({ type: 'assistant', content: data.content, timestamp: new Date() });
        } else if (event === 'response_chunk') {
            this.sendMessage({ type: 'assistant_chunk', content: response.data, timestamp: new Date() });
        } else if (event === 'response_stream_end') {
            // The stream end event can be used to signify the end of a stream on the client.
        } else if (event === 'save_plan') {
            await this.saveProjectPlan(data);
        } else if (event === 'analytics_response') {
            this.sendMessage({
                type: 'analytics_response',
                data: response.data,
                requestId: response.requestId,
                timestamp: new Date()
            });
        } else if (event === 'analytics_error') {
            this.sendMessage({
                type: 'analytics_error',
                error: response.error,
                requestId: response.requestId,
                timestamp: new Date()
            });
        } else if (event === 'error' || response.error) {
            if (this.analysis && response.requestId && response.requestId === this.analysis.requestId) {
                this.finishAnalysis(this.analysis, { code: 'ANALYSIS_FAILED' });
            } else {
                this.sendError('LLM_ERROR');
            }
        }
    }

    async saveProjectPlan(data) {
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
        } else {
            this.sendError('SAVE_FAILED', { content: 'No se pudo crear el proyecto.' });
        }
    }

    sendError(code, extra = {}) {
        const message = ERROR_MESSAGES[code] || ERROR_MESSAGES.INTERNAL_ERROR;
        const payload = { type: 'error', code: code || 'INTERNAL_ERROR', message, content: message, timestamp: new Date(), ...extra };
        Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);
        this.sendMessage(payload);
    }

    sendErrorFrom(error, extra = {}) {
        if (isAppError(error) && ERROR_MESSAGES[error.code]) {
            const withRetry = error.details && Number.isFinite(error.details.retryAfterSec)
                ? { retryAfterSec: error.details.retryAfterSec, ...extra }
                : extra;
            return this.sendError(error.code, withRetry);
        }
        console.error(`Unexpected error in session of user ${this.userId}:`, error && error.message);
        return this.sendError('INTERNAL_ERROR', extra);
    }

    sendMessage(message) {
        try {
            this.lastActivity = new Date();
            if (!message.timestamp) message.timestamp = new Date();

            const isWelcome = message.type === 'system' && typeof message.content === 'string'
                && message.content.includes('Connected to TaskMate');
            if (!isWelcome && !TRANSIENT_TYPES.has(message.type)) {
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

        if (this.websocket && this.websocket.readyState === 1) {
            this.websocket.close(1000, 'Session cleanup');
        }
        this.websocket = null;
    }
}

UserSession.prepareAnalyticsData = prepareAnalyticsData;
UserSession.lastAnalysisByUser = lastAnalysisByUser;
UserSession.ANALYSIS_TIMEOUT_MS = ANALYSIS_TIMEOUT_MS;
UserSession.PLAN_TTL_MS = PLAN_TTL_MS;

module.exports = UserSession;

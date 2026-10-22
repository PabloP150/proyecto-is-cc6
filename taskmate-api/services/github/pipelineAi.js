// Phase 4: the AI proposes the CI/CD pipeline. Sends the repository facts (projects and their
// package.json scripts, never source code) to the Python AI server and waits for its proposal.
// The spec that comes back is not trusted: pipelineService validates it against the facts like
// any other spec (pipelineSpec.validateSpec) before showing it.
const { v4: uuidv4 } = require('uuid');
const { AppError } = require('../../helpers/errors');
const { redactSecrets } = require('./repoSnapshot');

const DEFAULT_TIMEOUT_MS = 60 * 1000;
const MAX_PROJECTS = 6;
const MAX_SCRIPTS = 40;
const MAX_SCRIPT_COMMAND = 200;
const MAX_EXPLANATION = 600;

const ERRORS = Object.freeze({
    LLM_TIMEOUT: ['The AI took too long to propose the pipeline', 504],
    LLM_RATE_LIMIT: ['The AI provider is rate limiting requests', 503],
    LLM_INVALID_OUTPUT: ['The AI returned an invalid pipeline proposal', 502],
    LLM_ERROR: ['The AI service is not available', 503],
});

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value, max) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string').slice(0, max) : []);

const aiError = (code, details) => {
    const [message, status] = ERRORS[code] || ERRORS.LLM_ERROR;
    return new AppError(ERRORS[code] ? code : 'LLM_ERROR', message, status, details);
};

// Script commands are the only free text sent: secrets redacted, then cut.
const cleanScripts = (scripts) => {
    const out = {};
    for (const [name, command] of Object.entries(isPlainObject(scripts) ? scripts : {})) {
        if (Object.keys(out).length >= MAX_SCRIPTS) break;
        if (typeof command === 'string') out[name] = redactSecrets(command).slice(0, MAX_SCRIPT_COMMAND);
    }
    return out;
};

// Every project has every field (neutral values when it does not apply to its stack).
const projectParams = (project) => ({
    dir: project.dir,
    stack: project.stack,
    scripts: cleanScripts(project.scripts),
    longRunning: strings(project.longRunning, MAX_SCRIPTS),
    lockfile: project.lockfile || null,
    runtime: project.runtime || null,
    framework: project.framework || null,
    siteDirs: strings(project.siteDirs, 10),
    requirementFiles: strings(project.requirementFiles, 10),
    pyproject: project.pyproject === true,
    usesPytest: project.usesPytest === true,
});

// At most MAX_PROJECTS, always including the project of the detected spec.
const pickProjects = (projects, detected) => {
    const all = Array.isArray(projects) ? projects : [];
    const kept = all.slice(0, MAX_PROJECTS);
    const wanted = detected && detected.project;
    const target = wanted ? all.find((p) => p.dir === wanted.dir && p.stack === wanted.stack) : null;
    if (target && !kept.includes(target)) kept[kept.length - 1] = target;
    return kept;
};

const buildParams = ({ repo, facts, detected, options }) => ({
    repo: { fullName: repo.fullName, defaultBranch: repo.defaultBranch },
    projects: pickProjects(facts && facts.projects, detected).map(projectParams),
    detected,
    options: { nodeVersions: [...options.nodeVersions], pythonVersions: [...options.pythonVersions] },
});

const cleanExplanation = (value) => (typeof value === 'string'
    ? value.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ').trim().slice(0, MAX_EXPLANATION)
    : '');

// {proposal: {...spec fields, explanation}} → {spec, explanation}; the spec is validated by the caller.
const toResult = (data) => {
    const proposal = isPlainObject(data) ? data.proposal : null;
    if (!isPlainObject(proposal)) throw aiError('LLM_INVALID_OUTPUT');
    const { explanation, ...fields } = proposal;
    return { spec: { version: 1, ...fields }, explanation: cleanExplanation(explanation) };
};

// Python's error codes (and its message) never reach the client as such, only these AppErrors.
const fromReply = (response) => {
    const error = isPlainObject(response.error) ? response.error : {};
    const code = typeof error.code === 'string' ? error.code : response.code;
    if (code === 'LLM_RATE_LIMIT') {
        const retryAfterSec = Number(error.retryAfterSec);
        return aiError(code, Number.isFinite(retryAfterSec) && retryAfterSec >= 0 ? { retryAfterSec: Math.ceil(retryAfterSec) } : undefined);
    }
    if (code === 'LLM_TIMEOUT' || code === 'LLM_INVALID_OUTPUT') return aiError(code);
    return aiError('LLM_ERROR');
};

/**
 * Asks the AI for a pipeline. → {spec, explanation} (spec NOT validated), or throws AppError
 * LLM_TIMEOUT (504), LLM_RATE_LIMIT (503, details.retryAfterSec), LLM_INVALID_OUTPUT (502) or
 * LLM_ERROR (503: not sent, connection lost, or any other failure on the Python side).
 */
const proposeWithAi = ({ repo, facts, detected, options, llm, timeoutMs = DEFAULT_TIMEOUT_MS }) => {
    // Loaded on first use: requiring the singleton opens the WebSocket to the AI server.
    const client = llm || require('../LLMService');
    const requestId = uuidv4();
    const sessionId = `pipeline:${requestId}`;
    const message = { requestId, sessionId, method: 'propose_pipeline', params: buildParams({ repo, facts, detected, options }) };

    return new Promise((resolve, reject) => {
        let done = false;
        let timer = null;
        let onReply = null;
        const finish = (error, result) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            client.removeListener(sessionId, onReply);
            if (error) reject(error);
            else resolve(result);
        };
        onReply = (response) => {
            if (!isPlainObject(response) || response.requestId !== requestId) return;
            if (response.event === 'pipeline_proposal') {
                try {
                    finish(null, toResult(response.data));
                } catch (err) {
                    finish(err);
                }
            } else if (response.event === 'pipeline_proposal_error' || response.event === 'error' || response.error) {
                // 'error' also covers the connection to Python dropping (LLMService.failInflight).
                finish(fromReply(response));
            }
        };

        client.on(sessionId, onReply);
        timer = setTimeout(() => finish(aiError('LLM_TIMEOUT')), timeoutMs);
        if (timer.unref) timer.unref();
        let sending;
        try {
            sending = Promise.resolve(client.send(message));
        } catch {
            sending = Promise.resolve(false);
        }
        sending.then((sent) => {
            if (!sent) finish(aiError('LLM_ERROR'));
        }, () => finish(aiError('LLM_ERROR')));
    });
};

module.exports = { proposeWithAi, buildParams, DEFAULT_TIMEOUT_MS };

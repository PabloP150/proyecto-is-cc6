// Client for the TaskMate local AI server (separate repo: taskmate-ai-server). Runs its project
// commands (audit, generate-tests, review-pr) over HTTP with the shared secret.
const { AppError } = require('../../helpers/errors');

const DEFAULT_TIMEOUT_MS = 180 * 1000; // an audit of 15 files takes ~20 s; leave room for a cold model

const settings = (env = process.env) => ({
    url: String(env.AI_SERVER_URL || '').replace(/\/+$/, ''),
    secret: env.AI_SERVER_SECRET || '',
    project: env.AI_SERVER_PROJECT || 'TaskMate',
    timeoutMs: Number(env.AI_SERVER_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
});

const createAiServerClient = ({ fetchImpl = (...a) => fetch(...a), env = process.env } = {}) => {
    const enabled = () => Boolean(settings(env).url);

    const runCommand = async (name, args, { project } = {}) => {
        const cfg = settings(env);
        if (!cfg.url) throw new AppError('AI_SERVER_DISABLED', 'The AI server is not configured (AI_SERVER_URL).', 503);

        let res;
        try {
            res = await fetchImpl(`${cfg.url}/commands/${encodeURIComponent(name)}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-ai-server-secret': cfg.secret },
                body: JSON.stringify({ project: project || cfg.project, args }),
                signal: AbortSignal.timeout(cfg.timeoutMs),
            });
        } catch (err) {
            if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
                throw new AppError('AI_SERVER_TIMEOUT', 'The AI server took too long to answer.', 504);
            }
            throw new AppError('AI_SERVER_UNAVAILABLE', 'Could not reach the AI server.', 502);
        }

        const body = await res.json().catch(() => ({}));
        if (res.ok) return body;
        if (res.status === 401) throw new AppError('AI_SERVER_AUTH', 'The AI server rejected the shared secret (AI_SERVER_SECRET).', 502);
        if (res.status === 400 || res.status === 422) {
            const detail = typeof body.detail === 'string' ? body.detail : 'The AI server rejected the request.';
            throw new AppError('AI_SERVER_BAD_REQUEST', detail.slice(0, 300), 400);
        }
        if (res.status === 501) throw new AppError('AI_SERVER_NOT_IMPLEMENTED', `The AI server has no ${name} command yet.`, 501);
        throw new AppError('AI_SERVER_ERROR', `The AI server failed running ${name}.`, 502);
    };

    return { enabled, runCommand };
};

module.exports = { createAiServerClient, aiServer: createAiServerClient() };

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { AppError, isAppError } = require('../../helpers/errors');

const API_BASE = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const USER_AGENT = 'TaskMate-GitHub-App';
const REQUEST_TIMEOUT_MS = 10 * 1000;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const APP_JWT_TTL_S = 9 * 60;
const APP_JWT_BACKDATE_S = 60;
// Installation tokens allow 5000 requests/h; TaskMate keeps headroom below that.
const DEFAULT_HOURLY_BUDGET = 4000;
const HOUR_MS = 60 * 60 * 1000;

// Minimal permission sets requested for installation tokens (the App must have at least these).
const PERMISSIONS = Object.freeze({
    read: Object.freeze({ contents: 'read' }),
    snapshot: Object.freeze({ contents: 'read', issues: 'read' }),
    pulls: Object.freeze({ pull_requests: 'read' }),
    writeRefs: Object.freeze({ contents: 'write' }),
});

const notConfigured = () => new AppError('GITHUB_NOT_CONFIGURED', 'GitHub integration is not configured', 503);

// GITHUB_APP_PRIVATE_KEY is a base64-encoded PEM; a raw PEM (with literal "\n") is tolerated.
const decodePrivateKey = (value) => {
    if (!value || typeof value !== 'string') throw notConfigured();
    const pem = value.includes('-----BEGIN')
        ? value.replace(/\\n/g, '\n')
        : Buffer.from(value.trim(), 'base64').toString('utf8');
    try {
        return crypto.createPrivateKey(pem);
    } catch {
        throw notConfigured();
    }
};

const parseNextLink = (linkHeader) => {
    if (!linkHeader) return null;
    for (const part of linkHeader.split(',')) {
        const match = part.match(/<([^>]+)>\s*;\s*rel="?next"?/);
        if (match) return match[1];
    }
    return null;
};

const retryAfterSeconds = (headers, nowMs) => {
    const retryAfter = Number.parseInt(headers.get('retry-after'), 10);
    if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter, 3600);
    const reset = Number.parseInt(headers.get('x-ratelimit-reset'), 10);
    if (Number.isFinite(reset)) return Math.min(Math.max(Math.ceil(reset - nowMs / 1000), 1), 3600);
    return 60;
};

const withStatus = (err, status) => {
    err.githubStatus = status;
    return err;
};

const mapGitHubError = (status, headers, data, { nowMs, tokenMint = false, notFoundCode } = {}) => {
    const message = data && typeof data.message === 'string' ? data.message : '';
    const rateLimited = status === 429
        || (status === 403 && (headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(message)));
    if (rateLimited) {
        const retryAfterSec = retryAfterSeconds(headers, nowMs);
        return withStatus(new AppError('GITHUB_RATE_LIMITED', 'GitHub rate limit reached, try again later', 503, { retryAfterSec }), status);
    }
    if (tokenMint) {
        if (status === 403 && /suspend/i.test(message)) {
            return withStatus(new AppError('INSTALLATION_SUSPENDED', 'The GitHub App installation is suspended', 409), status);
        }
        if (status === 403 || status === 404 || status === 422) {
            return withStatus(new AppError('REPO_NOT_ACCESSIBLE', 'The repository is not accessible to the GitHub App', 403), status);
        }
        return withStatus(new AppError('GITHUB_ERROR', 'GitHub request failed', 502), status);
    }
    if (status === 409) {
        return withStatus(new AppError('REPO_EMPTY', 'The repository is empty', 409), status);
    }
    if (status === 404 && notFoundCode) {
        return withStatus(new AppError(notFoundCode, 'Not found', 404), status);
    }
    if (status === 403 || status === 404) {
        return withStatus(new AppError('REPO_NOT_ACCESSIBLE', 'The repository is not accessible to the GitHub App', 403), status);
    }
    return withStatus(new AppError('GITHUB_ERROR', 'GitHub request failed', 502), status);
};

const normalizePermissions = (permissions) => {
    const entries = Object.entries(permissions || PERMISSIONS.read).sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries);
};

const normalizeRepoIds = (repoIds) => {
    if (!repoIds || !repoIds.length) return null;
    const ids = [...new Set(repoIds.map(Number))].filter((id) => Number.isSafeInteger(id) && id > 0);
    return ids.length ? ids.sort((a, b) => a - b) : null;
};

class GitHubApp {
    constructor({ appId, privateKey, fetchImpl, now, apiBase = API_BASE, timeoutMs = REQUEST_TIMEOUT_MS, hourlyBudget } = {}) {
        this.options = { appId, privateKey, hourlyBudget };
        this.budgets = new Map();
        this.fetchImpl = fetchImpl || null;
        this.now = now || (() => Date.now());
        this.apiBase = apiBase;
        this.timeoutMs = timeoutMs;
        this.tokenCache = new Map();
        this.inflight = new Map();
        this.appJwt = null;
        this.keyObject = null;
        this.keySource = null;
    }

    get fetch() {
        const impl = this.fetchImpl || globalThis.fetch;
        if (typeof impl !== 'function') throw new AppError('GITHUB_ERROR', 'HTTP client unavailable', 502);
        return impl;
    }

    _appId() {
        const appId = this.options.appId || process.env.GITHUB_APP_ID;
        if (!appId) throw notConfigured();
        return String(appId);
    }

    _privateKey() {
        const source = this.options.privateKey || process.env.GITHUB_APP_PRIVATE_KEY;
        if (!this.keyObject || this.keySource !== source) {
            this.keyObject = decodePrivateKey(source);
            this.keySource = source;
        }
        return this.keyObject;
    }

    // RS256, backdated 60 s against clock drift; GitHub rejects exp more than 10 min after iat.
    createAppJwt() {
        const nowS = Math.floor(this.now() / 1000);
        if (this.appJwt && this.appJwt.refreshAt > nowS) return this.appJwt.token;
        const iat = nowS - APP_JWT_BACKDATE_S;
        const exp = nowS + APP_JWT_TTL_S;
        const token = jwt.sign({ iat, exp, iss: this._appId() }, this._privateKey(), { algorithm: 'RS256' });
        this.appJwt = { token, refreshAt: exp - 60 };
        return token;
    }

    _cacheKey(installationId, repoIds, permissions) {
        return `${installationId}|${repoIds ? repoIds.join(',') : '*'}|${JSON.stringify(permissions)}`;
    }

    // Tokens stay in memory only, scoped to the repo ids and permissions asked for.
    async getInstallationToken(installationId, { repoIds, permissions } = {}) {
        const id = Number(installationId);
        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new AppError('VALIDATION_ERROR', 'Invalid installation id', 400);
        }
        const ids = normalizeRepoIds(repoIds);
        const perms = normalizePermissions(permissions);
        const key = this._cacheKey(id, ids, perms);

        const cached = this.tokenCache.get(key);
        if (cached && cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > this.now()) return cached.token;
        if (this.inflight.has(key)) return this.inflight.get(key);

        const mint = (async () => {
            const body = { permissions: perms };
            if (ids) body.repository_ids = ids;
            const { data } = await this.request({ app: true }, 'POST', `/app/installations/${id}/access_tokens`, {
                body,
                tokenMint: true,
            });
            if (!data || typeof data.token !== 'string') {
                throw new AppError('GITHUB_ERROR', 'GitHub returned no installation token', 502);
            }
            const expiresAt = Date.parse(data.expires_at) || this.now() + 60 * 60 * 1000;
            this._pruneCache();
            this.tokenCache.set(key, { token: data.token, expiresAt, installationId: id });
            return data.token;
        })();

        this.inflight.set(key, mint);
        try {
            return await mint;
        } finally {
            this.inflight.delete(key);
        }
    }

    _pruneCache() {
        const now = this.now();
        for (const [key, entry] of this.tokenCache) {
            if (entry.expiresAt - TOKEN_REFRESH_MARGIN_MS <= now) this.tokenCache.delete(key);
        }
    }

    _hourlyBudget() {
        return Number(this.options.hourlyBudget) || Number(process.env.GITHUB_INSTALLATION_HOURLY_BUDGET) || DEFAULT_HOURLY_BUDGET;
    }

    _refill(installationId) {
        const capacity = this._hourlyBudget();
        const now = this.now();
        const bucket = this.budgets.get(installationId) || { tokens: capacity, updatedAt: now };
        bucket.tokens = Math.min(capacity, bucket.tokens + ((now - bucket.updatedAt) * capacity) / HOUR_MS);
        bucket.updatedAt = now;
        this.budgets.set(installationId, bucket);
        return bucket;
    }

    // Requests TaskMate may still make with this installation right now (token bucket).
    availableBudget(installationId) {
        return Math.floor(this._refill(Number(installationId)).tokens);
    }

    _takeBudget(installationId) {
        const bucket = this._refill(Number(installationId));
        if (bucket.tokens < 1) {
            const retryAfterSec = Math.max(1, Math.ceil(((1 - bucket.tokens) * HOUR_MS) / this._hourlyBudget() / 1000));
            throw new AppError('GITHUB_RATE_LIMITED', 'GitHub request budget exhausted, try again later', 503, { retryAfterSec });
        }
        bucket.tokens -= 1;
    }

    invalidateInstallation(installationId) {
        const id = Number(installationId);
        for (const [key, entry] of this.tokenCache) {
            if (entry.installationId === id) this.tokenCache.delete(key);
        }
    }

    async _authorization(auth, scope) {
        if (!auth || typeof auth !== 'object') throw new AppError('GITHUB_ERROR', 'Missing GitHub credentials', 502);
        if (auth.app) return `Bearer ${this.createAppJwt()}`;
        if (auth.token) return `Bearer ${auth.token}`;
        if (auth.installationId !== undefined) {
            return `Bearer ${await this.getInstallationToken(auth.installationId, scope)}`;
        }
        throw new AppError('GITHUB_ERROR', 'Missing GitHub credentials', 502);
    }

    _url(path, query) {
        const url = new URL(path.startsWith('http') ? path : `${this.apiBase}${path}`);
        if (url.origin !== new URL(this.apiBase).origin) {
            throw new AppError('GITHUB_ERROR', 'Refusing to call a non-GitHub host', 502);
        }
        if (query) {
            for (const [key, value] of Object.entries(query)) {
                if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
            }
        }
        return url.toString();
    }

    async _send(url, method, headers, body) {
        try {
            return await this.fetch(url, {
                method,
                headers,
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(this.timeoutMs),
            });
        } catch {
            throw new AppError('GITHUB_ERROR', 'GitHub is unreachable', 502);
        }
    }

    // auth: {installationId} | {token} (user token) | {app: true}. Returns {status, data, headers}.
    async request(auth, method, path, options = {}) {
        const { query, body, repoIds, permissions, allowStatus = [], notFoundCode, tokenMint = false, retried = false } = options;
        if (auth && auth.installationId !== undefined) this._takeBudget(auth.installationId);
        const headers = {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': API_VERSION,
            'User-Agent': USER_AGENT,
            Authorization: await this._authorization(auth, { repoIds, permissions }),
        };
        if (body !== undefined) headers['Content-Type'] = 'application/json';

        const res = await this._send(this._url(path, query), method, headers, body);
        let data = null;
        if (res.status !== 204) {
            const text = await res.text().catch(() => '');
            if (text) {
                try {
                    data = JSON.parse(text);
                } catch {
                    data = null;
                }
            }
        }

        if (res.ok || allowStatus.includes(res.status)) {
            return { status: res.status, data, headers: res.headers };
        }
        // A cached installation token can be revoked early (uninstall, permission change): mint once more.
        if (res.status === 401 && auth.installationId !== undefined && !retried) {
            this.invalidateInstallation(auth.installationId);
            return this.request(auth, method, path, { ...options, retried: true });
        }
        throw mapGitHubError(res.status, res.headers, data, { nowMs: this.now(), tokenMint, notFoundCode });
    }

    // Follows Link rel="next" (same origin only). `itemsKey` picks the array out of wrapped responses.
    async paginate(auth, path, { query, repoIds, permissions, itemsKey, maxItems = 1000, maxPages = 10 } = {}) {
        const items = [];
        let next = this._url(path, { per_page: 100, ...query });
        let pages = 0;
        while (next && pages < maxPages && items.length < maxItems) {
            const { data, headers } = await this.request(auth, 'GET', next, { repoIds, permissions });
            const pageItems = itemsKey ? (data && data[itemsKey]) || [] : Array.isArray(data) ? data : [];
            items.push(...pageItems);
            pages += 1;
            next = parseNextLink(headers.get('link'));
            if (next) {
                try {
                    next = this._url(next);
                } catch {
                    next = null;
                }
            }
        }
        return items.slice(0, maxItems);
    }
}

const defaultApp = new GitHubApp();

module.exports = {
    GitHubApp,
    githubApp: defaultApp,
    PERMISSIONS,
    mapGitHubError,
    parseNextLink,
    decodePrivateKey,
    API_BASE,
    API_VERSION,
    USER_AGENT,
};

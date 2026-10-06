// Test doubles for the GitHub HTTP API: no network, routes matched on "METHOD /path".
const crypto = require('crypto');
const { GitHubApp } = require('../../../services/github/githubApp');

let cachedKeys = null;
const testKeys = () => {
    if (!cachedKeys) {
        const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
        const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });
        cachedKeys = { pem, base64: Buffer.from(pem).toString('base64'), publicKey };
    }
    return cachedKeys;
};

const jsonResponse = (status, body, headers = {}) => new Response(
    body === undefined || status === 204 ? null : JSON.stringify(body),
    { status, headers: { 'content-type': 'application/json', ...headers } },
);

// routes: { 'GET /repos/o/r': (req) => jsonResponse(...) | {status, body, headers} }
const createFakeFetch = (routes = {}) => {
    const calls = [];
    // Plain function (not jest.fn) so the config's resetMocks cannot wipe the routing.
    const fetchImpl = async (url, init = {}) => {
        const parsed = new URL(url);
        const method = (init.method || 'GET').toUpperCase();
        const key = `${method} ${parsed.pathname}`;
        const call = {
            method,
            path: parsed.pathname,
            query: Object.fromEntries(parsed.searchParams),
            headers: init.headers || {},
            body: init.body ? JSON.parse(init.body) : undefined,
            url,
        };
        calls.push(call);
        const handler = routes[key];
        if (!handler) return jsonResponse(404, { message: 'Not Found' });
        const result = typeof handler === 'function' ? await handler(call) : handler;
        if (result instanceof Response) return result;
        return jsonResponse(result.status || 200, result.body, result.headers);
    };
    fetchImpl.calls = calls;
    return fetchImpl;
};

const tokenRoute = (token = 'ghs_test', expiresInMs = 60 * 60 * 1000) => (call) => ({
    status: 201,
    body: {
        token: typeof token === 'function' ? token(call) : token,
        expires_at: new Date(Date.now() + expiresInMs).toISOString(),
    },
});

const createTestApp = (routes, options = {}) => {
    const fetchImpl = createFakeFetch(routes);
    const app = new GitHubApp({ appId: '12345', privateKey: testKeys().base64, fetchImpl, ...options });
    return { app, fetchImpl };
};

// Points the shared githubApp singleton (used by the services) at a fake fetch.
const useFakeGitHub = (routes) => {
    const { githubApp } = require('../../../services/github/githubApp');
    const fetchImpl = createFakeFetch(routes);
    githubApp.fetchImpl = fetchImpl;
    githubApp.options = { appId: '12345', privateKey: testKeys().base64 };
    githubApp.tokenCache.clear();
    githubApp.inflight.clear();
    githubApp.budgets.clear();
    githubApp.appJwt = null;
    return fetchImpl;
};

const REPO = Object.freeze({
    gid: '11111111-1111-4111-8111-111111111111',
    repoId: 500,
    owner: 'octo',
    name: 'demo',
    fullName: 'octo/demo',
    defaultBranch: 'main',
    isPrivate: false,
    installationId: 77,
    suspendedAt: null,
});

module.exports = { testKeys, jsonResponse, createFakeFetch, tokenRoute, createTestApp, useFakeGitHub, REPO };

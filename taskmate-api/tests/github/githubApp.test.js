const jwt = require('jsonwebtoken');
const { GitHubApp, PERMISSIONS, parseNextLink } = require('../../services/github/githubApp');
const { testKeys, createTestApp, tokenRoute, jsonResponse } = require('./helpers/fakeGitHub');

describe('GitHubApp — app JWT', () => {
    test('signs RS256 with iss=appId, iat backdated 60 s and exp within 10 min', () => {
        const nowMs = Date.UTC(2026, 8, 11, 12, 0, 0);
        const { app } = createTestApp({}, { now: () => nowMs });
        const token = app.createAppJwt();
        const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
        expect(header.alg).toBe('RS256');

        const claims = jwt.verify(token, testKeys().publicKey, { algorithms: ['RS256'], clockTimestamp: nowMs / 1000 });
        expect(claims.iss).toBe('12345');
        expect(claims.iat).toBe(nowMs / 1000 - 60);
        expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
        expect(claims.exp).toBeGreaterThan(nowMs / 1000);
    });

    test('accepts a raw PEM as well as base64', () => {
        const app = new GitHubApp({ appId: '1', privateKey: testKeys().pem });
        expect(() => app.createAppJwt()).not.toThrow();
    });

    test('missing configuration → GITHUB_NOT_CONFIGURED without leaking the key', () => {
        const app = new GitHubApp({ appId: '1', privateKey: 'bm90LWEta2V5' });
        expect(() => app.createAppJwt()).toThrow(expect.objectContaining({ code: 'GITHUB_NOT_CONFIGURED', status: 503 }));
        const noId = new GitHubApp({ privateKey: testKeys().base64 });
        const previous = process.env.GITHUB_APP_ID;
        delete process.env.GITHUB_APP_ID;
        try {
            expect(() => noId.createAppJwt()).toThrow(expect.objectContaining({ code: 'GITHUB_NOT_CONFIGURED' }));
        } finally {
            if (previous !== undefined) process.env.GITHUB_APP_ID = previous;
        }
    });
});

describe('GitHubApp — installation tokens', () => {
    test('mints with repository_ids + minimal permissions using the app JWT', async () => {
        const { app, fetchImpl } = createTestApp({ 'POST /app/installations/77/access_tokens': tokenRoute('ghs_a') });
        const token = await app.getInstallationToken(77, { repoIds: [5, '3', 5], permissions: PERMISSIONS.read });
        expect(token).toBe('ghs_a');
        const call = fetchImpl.calls[0];
        expect(call.body).toEqual({ repository_ids: [3, 5], permissions: { contents: 'read' } });
        expect(call.headers.Authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
        expect(call.headers['X-GitHub-Api-Version']).toBe('2022-11-28');
        expect(call.headers.Accept).toBe('application/vnd.github+json');
        expect(call.headers['User-Agent']).toBeTruthy();
    });

    test('caches per installation + repo scope + permissions', async () => {
        let n = 0;
        const { app, fetchImpl } = createTestApp({
            'POST /app/installations/77/access_tokens': tokenRoute(() => `ghs_${++n}`),
        });
        const a = await app.getInstallationToken(77, { repoIds: [1] });
        const b = await app.getInstallationToken(77, { repoIds: [1] });
        const c = await app.getInstallationToken(77, { repoIds: [2] });
        const d = await app.getInstallationToken(77, { repoIds: [1], permissions: PERMISSIONS.writeRefs });
        expect(a).toBe(b);
        expect(new Set([a, c, d]).size).toBe(3);
        expect(fetchImpl.calls).toHaveLength(3);
    });

    test('concurrent requests share one mint', async () => {
        const { app, fetchImpl } = createTestApp({ 'POST /app/installations/77/access_tokens': tokenRoute('ghs_x') });
        const tokens = await Promise.all([1, 2, 3].map(() => app.getInstallationToken(77, { repoIds: [9] })));
        expect(tokens).toEqual(['ghs_x', 'ghs_x', 'ghs_x']);
        expect(fetchImpl.calls).toHaveLength(1);
    });

    test('refreshes about 5 minutes before expiry', async () => {
        let nowMs = Date.now();
        let n = 0;
        const { app, fetchImpl } = createTestApp({
            'POST /app/installations/77/access_tokens': () => ({
                status: 201,
                body: { token: `ghs_${++n}`, expires_at: new Date(nowMs + 60 * 60 * 1000).toISOString() },
            }),
        }, { now: () => nowMs });
        expect(await app.getInstallationToken(77)).toBe('ghs_1');
        nowMs += 54 * 60 * 1000;
        expect(await app.getInstallationToken(77)).toBe('ghs_1');
        nowMs += 2 * 60 * 1000;
        expect(await app.getInstallationToken(77)).toBe('ghs_2');
        expect(fetchImpl.calls).toHaveLength(2);
    });

    test('invalidateInstallation drops cached tokens', async () => {
        let n = 0;
        const { app } = createTestApp({ 'POST /app/installations/77/access_tokens': tokenRoute(() => `ghs_${++n}`) });
        await app.getInstallationToken(77);
        app.invalidateInstallation('77');
        expect(await app.getInstallationToken(77)).toBe('ghs_2');
    });

    test('suspended installation → INSTALLATION_SUSPENDED', async () => {
        const { app } = createTestApp({
            'POST /app/installations/77/access_tokens': { status: 403, body: { message: 'This installation has been suspended' } },
        });
        await expect(app.getInstallationToken(77)).rejects.toMatchObject({ code: 'INSTALLATION_SUSPENDED', status: 409 });
    });

    test('repo outside the installation → REPO_NOT_ACCESSIBLE', async () => {
        const { app } = createTestApp({
            'POST /app/installations/77/access_tokens': { status: 422, body: { message: 'There is at least one repository that does not exist' } },
        });
        await expect(app.getInstallationToken(77, { repoIds: [1] })).rejects.toMatchObject({ code: 'REPO_NOT_ACCESSIBLE', status: 403 });
    });

    test('rejects a non-numeric installation id', async () => {
        const { app } = createTestApp({});
        await expect(app.getInstallationToken('abc')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
});

describe('GitHubApp — request / paginate / errors', () => {
    const base = { 'POST /app/installations/1/access_tokens': tokenRoute('ghs_t') };

    test('uses the installation token and returns parsed JSON', async () => {
        const { app, fetchImpl } = createTestApp({ ...base, 'GET /repos/o/r': { body: { id: 5 } } });
        const { data } = await app.request({ installationId: 1 }, 'GET', '/repos/o/r', { repoIds: [5] });
        expect(data).toEqual({ id: 5 });
        expect(fetchImpl.calls[1].headers.Authorization).toBe('Bearer ghs_t');
    });

    test('follows Link rel="next" on the same origin only', async () => {
        const page2 = 'https://api.github.com/repos/o/r/commits?page=2';
        const { app } = createTestApp({
            ...base,
            'GET /repos/o/r/commits': (call) => (call.query.page === '2'
                ? jsonResponse(200, [{ sha: 'b' }], { link: '<https://evil.example.com/steal>; rel="next"' })
                : jsonResponse(200, [{ sha: 'a' }], { link: `<${page2}>; rel="next", <${page2}>; rel="last"` })),
        });
        const items = await app.paginate({ installationId: 1 }, '/repos/o/r/commits');
        expect(items.map((c) => c.sha)).toEqual(['a', 'b']);
    });

    test('paginate honours maxItems and itemsKey', async () => {
        const { app } = createTestApp({
            'GET /user/installations': { body: { installations: [{ id: 1 }, { id: 2 }, { id: 3 }] } },
        });
        const items = await app.paginate({ token: 'gho_user' }, '/user/installations', { itemsKey: 'installations', maxItems: 2 });
        expect(items).toEqual([{ id: 1 }, { id: 2 }]);
    });

    test('parseNextLink', () => {
        expect(parseNextLink('<https://api.github.com/x?page=3>; rel="next", <https://api.github.com/x?page=9>; rel="last"'))
            .toBe('https://api.github.com/x?page=3');
        expect(parseNextLink('<https://api.github.com/x?page=1>; rel="prev"')).toBeNull();
        expect(parseNextLink(null)).toBeNull();
    });

    test.each([
        [{ status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 120) } }, 'GITHUB_RATE_LIMITED', 503],
        [{ status: 429, headers: { 'retry-after': '30' } }, 'GITHUB_RATE_LIMITED', 503],
        [{ status: 403, body: { message: 'You have exceeded a secondary rate limit' } }, 'GITHUB_RATE_LIMITED', 503],
        [{ status: 409, body: { message: 'Git Repository is empty.' } }, 'REPO_EMPTY', 409],
        [{ status: 404, body: { message: 'Not Found' } }, 'REPO_NOT_ACCESSIBLE', 403],
        [{ status: 403, body: { message: 'Resource not accessible by integration' } }, 'REPO_NOT_ACCESSIBLE', 403],
        [{ status: 500, body: { message: 'boom' } }, 'GITHUB_ERROR', 502],
    ])('maps %j → %s', async (response, code, status) => {
        const { app } = createTestApp({ ...base, 'GET /repos/o/r': response });
        await expect(app.request({ installationId: 1 }, 'GET', '/repos/o/r')).rejects.toMatchObject({ code, status });
    });

    test('rate limit errors carry retryAfterSec', async () => {
        const { app } = createTestApp({ ...base, 'GET /repos/o/r': { status: 429, headers: { 'retry-after': '42' } } });
        await expect(app.request({ installationId: 1 }, 'GET', '/repos/o/r')).rejects.toMatchObject({ details: { retryAfterSec: 42 } });
    });

    test('notFoundCode turns 404 into that code', async () => {
        const { app } = createTestApp({ ...base, 'GET /repos/o/r/contents/x': { status: 404 } });
        await expect(app.request({ installationId: 1 }, 'GET', '/repos/o/r/contents/x', { notFoundCode: 'FILE_NOT_FOUND' }))
            .rejects.toMatchObject({ code: 'FILE_NOT_FOUND', status: 404 });
    });

    test('allowStatus returns the response instead of throwing', async () => {
        const { app } = createTestApp({ ...base, 'POST /repos/o/r/git/refs': { status: 422, body: { message: 'Reference already exists' } } });
        const res = await app.request({ installationId: 1 }, 'POST', '/repos/o/r/git/refs', { body: {}, allowStatus: [422] });
        expect(res.status).toBe(422);
        expect(res.data.message).toBe('Reference already exists');
    });

    test('network failure → GITHUB_ERROR 502', async () => {
        const app = new GitHubApp({ appId: '1', privateKey: testKeys().base64, fetchImpl: async () => { throw new Error('ECONNRESET'); } });
        await expect(app.request({ token: 'x' }, 'GET', '/user')).rejects.toMatchObject({ code: 'GITHUB_ERROR', status: 502 });
    });

    test('a 401 with a cached installation token re-mints once', async () => {
        let n = 0;
        let calls = 0;
        const { app } = createTestApp({
            'POST /app/installations/1/access_tokens': tokenRoute(() => `ghs_${++n}`),
            'GET /repos/o/r': (call) => {
                calls += 1;
                return call.headers.Authorization === 'Bearer ghs_1' ? { status: 401, body: {} } : { body: { ok: true } };
            },
        });
        const { data } = await app.request({ installationId: 1 }, 'GET', '/repos/o/r');
        expect(data).toEqual({ ok: true });
        expect(calls).toBe(2);
    });

    test('refuses absolute URLs to other hosts', async () => {
        const { app } = createTestApp({});
        await expect(app.request({ token: 'x' }, 'GET', 'https://evil.example.com/x')).rejects.toMatchObject({ code: 'GITHUB_ERROR' });
    });
});

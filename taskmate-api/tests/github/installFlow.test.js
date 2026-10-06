jest.mock('../../models/access.model', () => ({ isGroupAdmin: jest.fn(), isGroupMember: jest.fn() }));
jest.mock('../../models/github.model', () => ({
    upsertInstallation: jest.fn(),
    upsertRepository: jest.fn(),
    linkGroupRepository: jest.fn(),
    getGroupRepository: jest.fn(),
}));
jest.mock('../../helpers/transaction', () => ({ withTransaction: jest.fn(), isFkViolation: jest.fn() }));

const jwt = require('jsonwebtoken');
const accessModel = require('../../models/access.model');
const githubModel = require('../../models/github.model');
const transaction = require('../../helpers/transaction');
const { signAccessToken, verifyPurposeToken } = require('../../helpers/tokens');
const installFlow = require('../../services/github/installFlow');
const { useFakeGitHub } = require('./helpers/fakeGitHub');

const GID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';
const OTHER_UID = '33333333-3333-4333-8333-333333333333';
const TX = { id: 'tx' };

const ENV = {
    JWT_SECRET: process.env.JWT_SECRET || 'test',
    GITHUB_APP_SLUG: 'taskmate-test',
    GITHUB_APP_CLIENT_ID: 'Iv1.client',
    GITHUB_APP_CLIENT_SECRET: 'client-secret',
    FRONTEND_URL: 'http://localhost:3000, https://taskmate.example.com',
};
let savedEnv;
beforeAll(() => {
    savedEnv = {};
    for (const [key, value] of Object.entries(ENV)) {
        savedEnv[key] = process.env[key];
        process.env[key] = value;
    }
});
afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

const repo = (id, name) => ({ id, name, full_name: `octo/${name}`, private: id % 2 === 0, default_branch: 'main', owner: { login: 'octo' } });

const githubRoutes = ({ repos = [repo(500, 'demo')], installations = [{ id: 77 }], tokenBody } = {}) => ({
    'POST /login/oauth/access_token': { body: tokenBody || { access_token: 'ghu_user', token_type: 'bearer' } },
    'GET /user': { body: { login: 'octocat' } },
    'DELETE /applications/Iv1.client/token': { status: 204 },
    'GET /user/installations': { body: { total_count: installations.length, installations } },
    'GET /user/installations/77/repositories': { body: { total_count: repos.length, repositories: repos } },
    'GET /user/installations/88/repositories': { body: { total_count: 1, repositories: [repo(900, 'other')] } },
    'GET /app/installations/77': { body: { id: 77, account: { login: 'octo', type: 'Organization' }, suspended_at: null } },
    'POST /app/installations/77/access_tokens': { status: 201, body: { token: 'ghs_x', expires_at: new Date(Date.now() + 3600e3).toISOString() } },
});

const newState = () => new URL(installFlow.createInstallUrls({ gid: GID, uid: UID }).installUrl).searchParams.get('state');
const parse = (redirect) => {
    const url = new URL(redirect);
    return { origin: url.origin, path: url.pathname, ...Object.fromEntries(url.searchParams) };
};

beforeEach(() => {
    installFlow._stores.nonces.clear();
    installFlow._stores.selections.clear();
    accessModel.isGroupAdmin.mockResolvedValue(true);
    transaction.withTransaction.mockImplementation(async (fn) => fn(TX));
    githubModel.linkGroupRepository.mockResolvedValue({ previousRepoId: null });
    githubModel.getGroupRepository.mockResolvedValue({ gid: GID, repoId: 501, fullName: 'octo/two' });
});

describe('createInstallUrls', () => {
    test('install URL and authorize URL carry the same purpose-bound state', () => {
        const { installUrl, authorizeUrl } = installFlow.createInstallUrls({ gid: GID, uid: UID });
        const install = new URL(installUrl);
        const authorize = new URL(authorizeUrl);
        expect(`${install.origin}${install.pathname}`).toBe('https://github.com/apps/taskmate-test/installations/new');
        expect(`${authorize.origin}${authorize.pathname}`).toBe('https://github.com/login/oauth/authorize');
        expect(authorize.searchParams.get('client_id')).toBe('Iv1.client');
        const state = install.searchParams.get('state');
        expect(authorize.searchParams.get('state')).toBe(state);
        const claims = verifyPurposeToken('gh_install_state', state);
        expect(claims).toMatchObject({ gid: GID, uid: UID, typ: 'gh_install_state', aud: 'taskmate' });
        expect(claims.nonce).toMatch(/^[0-9a-f]{32}$/);
        expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
    });

    test('missing App configuration → GITHUB_NOT_CONFIGURED', () => {
        delete process.env.GITHUB_APP_SLUG;
        try {
            expect(() => installFlow.createInstallUrls({ gid: GID, uid: UID })).toThrow(expect.objectContaining({ code: 'GITHUB_NOT_CONFIGURED' }));
        } finally {
            process.env.GITHUB_APP_SLUG = ENV.GITHUB_APP_SLUG;
        }
    });
});

describe('handleCallback — state', () => {
    test('missing, garbage or login token as state → INVALID_STATE, no GitHub calls', async () => {
        const fetchImpl = useFakeGitHub(githubRoutes());
        for (const state of [undefined, 'garbage', signAccessToken({ userId: UID, username: 'u' })]) {
            const r = parse(await installFlow.handleCallback({ state, code: 'c', installation_id: '77' }));
            expect(r).toMatchObject({ status: 'error', code: 'INVALID_STATE' });
        }
        expect(fetchImpl.calls).toHaveLength(0);
    });

    test('expired state → INVALID_STATE', async () => {
        useFakeGitHub(githubRoutes());
        const past = Math.floor(Date.now() / 1000) - 3600;
        const expired = jwt.sign({ gid: GID, uid: UID, nonce: 'n', typ: 'gh_install_state', iat: past, exp: past + 600 }, ENV.JWT_SECRET, { algorithm: 'HS256', audience: 'taskmate' });
        const r = parse(await installFlow.handleCallback({ state: expired, code: 'c', installation_id: '77' }));
        expect(r.code).toBe('INVALID_STATE');
    });

    test('replayed state → INVALID_STATE the second time', async () => {
        useFakeGitHub(githubRoutes());
        const state = newState();
        expect(parse(await installFlow.handleCallback({ state, code: 'c', installation_id: '77' })).status).toBe('select');
        const again = parse(await installFlow.handleCallback({ state, code: 'c', installation_id: '77' }));
        expect(again).toMatchObject({ status: 'error', code: 'INVALID_STATE' });
    });

    test('a state signed for another purpose is rejected', async () => {
        const { signPurposeToken } = require('../../helpers/tokens');
        const other = signPurposeToken('password_reset', { gid: GID, uid: UID, nonce: 'x' }, 600);
        const r = parse(await installFlow.handleCallback({ state: other, code: 'c' }));
        expect(r.code).toBe('INVALID_STATE');
    });
});

describe('handleCallback — flow', () => {
    test('single repo → still a selection (never auto-linked), user token revoked', async () => {
        const fetchImpl = useFakeGitHub(githubRoutes());
        const r = parse(await installFlow.handleCallback({ state: newState(), code: 'abc', installation_id: '77', setup_action: 'install' }));
        expect(r).toMatchObject({ origin: 'http://localhost:3000', path: '/github', status: 'select', gid: GID });
        expect(githubModel.linkGroupRepository).not.toHaveBeenCalled();
        expect(transaction.withTransaction).not.toHaveBeenCalled();
        expect(installFlow.getSelection(r.selection, UID)).toEqual({
            gid: GID, githubLogin: 'octocat', repos: [{ repoId: 500, fullName: 'octo/demo', isPrivate: true }],
        });

        const exchange = fetchImpl.calls.find((c) => c.path === '/login/oauth/access_token');
        expect(exchange.body).toEqual({ client_id: 'Iv1.client', client_secret: 'client-secret', code: 'abc' });
        const listRepos = fetchImpl.calls.find((c) => c.path === '/user/installations/77/repositories');
        expect(listRepos.headers.Authorization).toBe('Bearer ghu_user');
        const revoke = fetchImpl.calls.find((c) => c.method === 'DELETE' && c.path === '/applications/Iv1.client/token');
        expect(revoke.body).toEqual({ access_token: 'ghu_user' });
        expect(revoke.headers.Authorization).toBe(`Basic ${Buffer.from('Iv1.client:client-secret').toString('base64')}`);
        expect(fetchImpl.calls.indexOf(revoke)).toBeGreaterThan(fetchImpl.calls.indexOf(listRepos));
    });

    test('linking a selection upserts installation + repo and links it for flow.uid', async () => {
        useFakeGitHub(githubRoutes());
        const r = parse(await installFlow.handleCallback({ state: newState(), code: 'abc', installation_id: '77' }));
        await installFlow.completeSelection({ gid: GID, uid: UID, selectionId: r.selection, repoId: 500 });
        expect(githubModel.upsertInstallation).toHaveBeenCalledWith({ installationId: 77, accountLogin: 'octo', accountType: 'Organization', suspendedAt: null }, { tx: TX });
        expect(githubModel.upsertRepository).toHaveBeenCalledWith({ repoId: 500, installationId: 77, name: 'demo', defaultBranch: 'main', isPrivate: true }, { tx: TX });
        expect(githubModel.linkGroupRepository).toHaveBeenCalledWith({ gid: GID, repoId: 500, connectedBy: UID }, { tx: TX });
    });

    test('a failed revocation is only logged and never blocks the flow', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        useFakeGitHub({ ...githubRoutes(), 'DELETE /applications/Iv1.client/token': { status: 500 } });
        const r = parse(await installFlow.handleCallback({ state: newState(), code: 'abc', installation_id: '77' }));
        expect(r.status).toBe('select');
        expect(warn.mock.calls.flat().join(' ')).not.toContain('ghu_user');
        warn.mockRestore();
    });

    test('the user token is revoked even when listing fails', async () => {
        const fetchImpl = useFakeGitHub(githubRoutes({ installations: [{ id: 88 }] }));
        await installFlow.handleCallback({ state: newState(), code: 'abc', installation_id: '77' });
        expect(fetchImpl.calls.some((c) => c.method === 'DELETE' && c.path === '/applications/Iv1.client/token')).toBe(true);
    });

    test('user is no longer admin at callback time → NOT_GROUP_ADMIN before exchanging the code', async () => {
        const fetchImpl = useFakeGitHub(githubRoutes());
        accessModel.isGroupAdmin.mockResolvedValue(false);
        const r = parse(await installFlow.handleCallback({ state: newState(), code: 'abc', installation_id: '77' }));
        expect(r).toMatchObject({ status: 'error', code: 'NOT_GROUP_ADMIN' });
        expect(accessModel.isGroupAdmin).toHaveBeenCalledWith(UID, GID);
        expect(fetchImpl.calls).toHaveLength(0);
    });

    test('installation_id not among the user\'s installations → INSTALLATION_NOT_FOUND, nothing linked', async () => {
        useFakeGitHub(githubRoutes({ installations: [{ id: 88 }] }));
        const r = parse(await installFlow.handleCallback({ state: newState(), code: 'abc', installation_id: '77' }));
        expect(r).toMatchObject({ status: 'error', code: 'INSTALLATION_NOT_FOUND' });
        expect(githubModel.linkGroupRepository).not.toHaveBeenCalled();
    });

    test('bad/expired OAuth code → GITHUB_ERROR', async () => {
        useFakeGitHub(githubRoutes({ tokenBody: { error: 'bad_verification_code' } }));
        const r = parse(await installFlow.handleCallback({ state: newState(), code: 'bad', installation_id: '77' }));
        expect(r).toMatchObject({ status: 'error', code: 'GITHUB_ERROR' });
    });

    test('setup_action=request without installation_id → pending', async () => {
        const fetchImpl = useFakeGitHub(githubRoutes());
        const r = parse(await installFlow.handleCallback({ state: newState(), setup_action: 'request' }));
        expect(r).toMatchObject({ status: 'pending', gid: GID });
        expect(fetchImpl.calls).toHaveLength(0);
    });

    test('user cancelled the authorization → ACCESS_DENIED', async () => {
        const r = parse(await installFlow.handleCallback({ state: newState(), error: 'access_denied' }));
        expect(r).toMatchObject({ status: 'error', code: 'ACCESS_DENIED' });
    });

    test('authorize-only flow (already installed) uses the user\'s installations', async () => {
        useFakeGitHub(githubRoutes({ installations: [{ id: 77 }, { id: 88 }] }));
        const r = parse(await installFlow.handleCallback({ state: newState(), code: 'abc' }));
        expect(r.status).toBe('select');
        const selection = installFlow.getSelection(r.selection, UID);
        expect(selection.repos.map((x) => x.repoId).sort()).toEqual([500, 900]);
    });

    test('no accessible repo → NO_REPOSITORIES; authorize-only without installations → INSTALLATION_NOT_FOUND', async () => {
        useFakeGitHub(githubRoutes({ repos: [] }));
        const r = parse(await installFlow.handleCallback({ state: newState(), code: 'abc', installation_id: '77' }));
        expect(r.code).toBe('NO_REPOSITORIES');
        useFakeGitHub(githubRoutes({ installations: [] }));
        const none = parse(await installFlow.handleCallback({ state: newState(), code: 'abc' }));
        expect(none.code).toBe('INSTALLATION_NOT_FOUND');
    });

    test('unexpected errors redirect with INTERNAL_ERROR and no details', async () => {
        useFakeGitHub(githubRoutes());
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        accessModel.isGroupAdmin.mockRejectedValue(new Error('Login failed for user sa'));
        const redirect = await installFlow.handleCallback({ state: newState(), code: 'abc', installation_id: '77' });
        expect(parse(redirect)).toMatchObject({ status: 'error', code: 'INTERNAL_ERROR' });
        expect(redirect).not.toMatch(/Login failed/);
        spy.mockRestore();
    });
});

describe('selections', () => {
    const openSelection = async () => {
        useFakeGitHub(githubRoutes({ repos: [repo(500, 'demo'), repo(501, 'two')] }));
        const r = parse(await installFlow.handleCallback({ state: newState(), code: 'abc', installation_id: '77' }));
        expect(r.status).toBe('select');
        return r.selection;
    };

    test('several repos → opaque 32-byte selection id, nothing linked yet', async () => {
        const id = await openSelection();
        expect(Buffer.from(id, 'base64url')).toHaveLength(32);
        expect(githubModel.linkGroupRepository).not.toHaveBeenCalled();
        expect(installFlow.getSelection(id, UID)).toEqual({
            gid: GID,
            githubLogin: 'octocat',
            repos: [{ repoId: 500, fullName: 'octo/demo', isPrivate: true }, { repoId: 501, fullName: 'octo/two', isPrivate: false }],
        });
    });

    test('another uid cannot read or use the selection', async () => {
        const id = await openSelection();
        expect(() => installFlow.getSelection(id, OTHER_UID)).toThrow(expect.objectContaining({ code: 'SELECTION_NOT_FOUND', status: 404 }));
        await expect(installFlow.completeSelection({ gid: GID, uid: OTHER_UID, selectionId: id, repoId: 501 }))
            .rejects.toMatchObject({ code: 'SELECTION_NOT_FOUND' });
        expect(installFlow.getSelection(id, UID).gid).toBe(GID);
    });

    test('repoId outside the selection → REPO_NOT_ACCESSIBLE', async () => {
        const id = await openSelection();
        await expect(installFlow.completeSelection({ gid: GID, uid: UID, selectionId: id, repoId: 999 }))
            .rejects.toMatchObject({ code: 'REPO_NOT_ACCESSIBLE', status: 403 });
    });

    test('another group → SELECTION_NOT_FOUND', async () => {
        const id = await openSelection();
        await expect(installFlow.completeSelection({ gid: '44444444-4444-4444-8444-444444444444', uid: UID, selectionId: id, repoId: 501 }))
            .rejects.toMatchObject({ code: 'SELECTION_NOT_FOUND' });
    });

    test('links the chosen repo once; a second use fails', async () => {
        const id = await openSelection();
        const result = await installFlow.completeSelection({ gid: GID, uid: UID, selectionId: id, repoId: '501' });
        expect(result).toMatchObject({ repoId: 501 });
        expect(githubModel.linkGroupRepository).toHaveBeenCalledWith({ gid: GID, repoId: 501, connectedBy: UID }, { tx: TX });
        await expect(installFlow.completeSelection({ gid: GID, uid: UID, selectionId: id, repoId: 501 }))
            .rejects.toMatchObject({ code: 'SELECTION_NOT_FOUND' });
    });

    test('a failed link restores the selection for a retry', async () => {
        const id = await openSelection();
        transaction.withTransaction.mockRejectedValueOnce(new Error('db down'));
        await expect(installFlow.completeSelection({ gid: GID, uid: UID, selectionId: id, repoId: 501 })).rejects.toThrow('db down');
        await expect(installFlow.completeSelection({ gid: GID, uid: UID, selectionId: id, repoId: 501 })).resolves.toBeTruthy();
    });
});

const crypto = require('crypto');
const { AppError, isAppError } = require('../../helpers/errors');
const { signPurposeToken, verifyPurposeToken } = require('../../helpers/tokens');
const accessModel = require('../../models/access.model');
const githubModel = require('../../models/github.model');
const transaction = require('../../helpers/transaction');
const { githubApp } = require('./githubApp');
const { TtlStore } = require('./ttlStore');
const oauth = require('./oauth');

const STATE_PURPOSE = 'gh_install_state';
const FLOW_TTL_MS = 10 * 60 * 1000;
const DEFAULT_FRONTEND_URL = 'http://localhost:3000';

const nonces = new TtlStore({ ttlMs: FLOW_TTL_MS });
const selections = new TtlStore({ ttlMs: FLOW_TTL_MS });

const sameId = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const invalidState = () => new AppError('INVALID_STATE', 'Invalid or expired state', 403);

// FRONTEND_URL may list several origins (CORS); the first one is the app's canonical URL.
const frontendUrl = () => {
    const first = String(process.env.FRONTEND_URL || '').split(',').map((s) => s.trim()).find(Boolean);
    return (first || DEFAULT_FRONTEND_URL).replace(/\/+$/, '');
};

// Redirects only ever go to FRONTEND_URL/github, never to a URL taken from the request.
const buildRedirect = (params) => {
    const url = new URL(`${frontendUrl()}/github`);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    return url.toString();
};

const createInstallUrls = ({ gid, uid }) => {
    const slug = process.env.GITHUB_APP_SLUG;
    const clientId = process.env.GITHUB_APP_CLIENT_ID;
    if (!slug || !clientId) throw new AppError('GITHUB_NOT_CONFIGURED', 'GitHub integration is not configured', 503);

    const nonce = crypto.randomBytes(16).toString('hex');
    nonces.set(nonce, { gid, uid });
    const state = signPurposeToken(STATE_PURPOSE, { gid, uid, nonce }, Math.floor(FLOW_TTL_MS / 1000));

    const installUrl = new URL(`https://github.com/apps/${encodeURIComponent(slug)}/installations/new`);
    installUrl.searchParams.set('state', state);
    const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('state', state);
    if (process.env.GITHUB_APP_CALLBACK_URL) authorizeUrl.searchParams.set('redirect_uri', process.env.GITHUB_APP_CALLBACK_URL);
    return { installUrl: installUrl.toString(), authorizeUrl: authorizeUrl.toString() };
};

// Signature + purpose + single-use nonce bound to the same gid/uid.
const consumeState = (state) => {
    if (typeof state !== 'string' || !state) throw invalidState();
    const claims = verifyPurposeToken(STATE_PURPOSE, state);
    const stored = claims.nonce ? nonces.take(claims.nonce) : null;
    if (!stored || !sameId(stored.gid, claims.gid) || !sameId(stored.uid, claims.uid)) throw invalidState();
    return { gid: claims.gid, uid: claims.uid };
};

const toRepoOption = (repo, installationId) => ({
    repoId: Number(repo.id),
    installationId: Number(installationId),
    owner: repo.owner && repo.owner.login ? repo.owner.login : String(repo.full_name || '').split('/')[0],
    name: String(repo.name),
    fullName: String(repo.full_name || `${repo.owner && repo.owner.login}/${repo.name}`),
    defaultBranch: String(repo.default_branch || 'main'),
    isPrivate: Boolean(repo.private),
});

// Installation data comes from GitHub with the App JWT (proves it is an installation of this App).
const fetchInstallation = async (installationId) => {
    const { data } = await githubApp.request({ app: true }, 'GET', `/app/installations/${Number(installationId)}`, {
        notFoundCode: 'INSTALLATION_NOT_FOUND',
    });
    const account = (data && data.account) || {};
    return {
        installationId: Number(data && data.id),
        accountLogin: String(account.login || ''),
        accountType: account.type === 'Organization' ? 'Organization' : 'User',
        suspendedAt: data && data.suspended_at ? new Date(data.suspended_at) : null,
    };
};

const linkRepository = async ({ gid, uid, option }) => {
    const installation = await fetchInstallation(option.installationId);
    return transaction.withTransaction(async (tx) => {
        await githubModel.upsertInstallation(installation, { tx });
        await githubModel.upsertRepository({
            repoId: option.repoId,
            installationId: option.installationId,
            name: option.name,
            defaultBranch: option.defaultBranch,
            isPrivate: option.isPrivate,
        }, { tx });
        return githubModel.linkGroupRepository({ gid, repoId: option.repoId, connectedBy: uid }, { tx });
    });
};

// Repos the *user* can reach through the installation(s): the explicit installation_id must be
// one of the user's installations; without it (authorize-only flow) all of them are used.
const collectRepoOptions = async (userToken, installationId) => {
    const installations = await oauth.listUserInstallations(userToken);
    const notFound = () => new AppError('INSTALLATION_NOT_FOUND', 'The installation is not accessible to this user', 403);
    let targets;
    if (installationId !== undefined) {
        const id = Number(installationId);
        if (!Number.isSafeInteger(id) || !installations.some((inst) => Number(inst.id) === id)) throw notFound();
        targets = [id];
    } else {
        if (installations.length === 0) throw notFound();
        targets = installations.slice(0, oauth.MAX_INSTALLATIONS).map((inst) => Number(inst.id));
    }
    const options = [];
    for (const id of targets) {
        const repos = await oauth.listUserInstallationRepos(userToken, id);
        repos.forEach((repo) => options.push(toRepoOption(repo, id)));
    }
    return options;
};

// Returns the frontend URL to redirect to (never throws).
const handleCallback = async (query = {}) => {
    const pick = (name) => (typeof query[name] === 'string' ? query[name] : undefined);
    let flow = null;
    try {
        flow = consumeState(pick('state'));
        if (pick('error')) return buildRedirect({ status: 'error', code: 'ACCESS_DENIED', gid: flow.gid });

        if (!(await accessModel.isGroupAdmin(flow.uid, flow.gid))) {
            throw new AppError('NOT_GROUP_ADMIN', 'Only the group admin can connect a repository', 403);
        }

        const installationIdParam = pick('installation_id');
        if (pick('setup_action') === 'request' && !installationIdParam) {
            return buildRedirect({ status: 'pending', gid: flow.gid });
        }
        const code = pick('code');
        if (!code) throw new AppError('VALIDATION_ERROR', 'Missing authorization code', 400);

        const userToken = await oauth.exchangeCodeForUserToken(code);
        let githubLogin;
        let options;
        try {
            githubLogin = await oauth.getAuthenticatedLogin(userToken);
            options = await collectRepoOptions(userToken, installationIdParam);
        } finally {
            await oauth.revokeUserToken(userToken);
        }

        if (options.length === 0) {
            throw new AppError('NO_REPOSITORIES', 'No repository is accessible to this user', 404);
        }
        // Never linked here, even with a single repo: the state proves who *started* the flow, not
        // which browser finished it. Linking needs POST /groups/:gid/repository with flow.uid's token.
        const selectionId = crypto.randomBytes(32).toString('base64url');
        selections.set(selectionId, {
            gid: flow.gid,
            uid: flow.uid,
            githubLogin,
            repos: new Map(options.map((option) => [option.repoId, option])),
        });
        return buildRedirect({ status: 'select', selection: selectionId, gid: flow.gid });
    } catch (err) {
        if (!isAppError(err)) console.error('GitHub callback failed:', err && err.message);
        const code = isAppError(err) ? err.code : 'INTERNAL_ERROR';
        return buildRedirect({ status: 'error', code, gid: flow && flow.gid });
    }
};

// Unknown, expired and other users' selections all look the same.
const readSelection = (selectionId, uid) => {
    const selection = typeof selectionId === 'string' ? selections.get(selectionId) : null;
    if (!selection || !sameId(selection.uid, uid)) {
        throw new AppError('SELECTION_NOT_FOUND', 'Selection not found or expired', 404);
    }
    return selection;
};

const getSelection = (selectionId, uid) => {
    const selection = readSelection(selectionId, uid);
    return {
        gid: selection.gid,
        githubLogin: selection.githubLogin,
        repos: [...selection.repos.values()].map(({ repoId, fullName, isPrivate }) => ({ repoId, fullName, isPrivate })),
    };
};

const completeSelection = async ({ gid, uid, selectionId, repoId }) => {
    const selection = readSelection(selectionId, uid);
    if (!sameId(selection.gid, gid)) throw new AppError('SELECTION_NOT_FOUND', 'Selection not found or expired', 404);
    const option = selection.repos.get(Number(repoId));
    if (!option) throw new AppError('REPO_NOT_ACCESSIBLE', 'The repository is not part of this selection', 403);

    const expiresAt = selections.expiryOf(selectionId);
    selections.take(selectionId);
    try {
        await linkRepository({ gid, uid, option });
    } catch (err) {
        selections.restore(selectionId, selection, expiresAt);
        throw err;
    }
    return githubModel.getGroupRepository(gid);
};

module.exports = {
    createInstallUrls,
    handleCallback,
    getSelection,
    completeSelection,
    buildRedirect,
    STATE_PURPOSE,
    _stores: { nonces, selections },
};

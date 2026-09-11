const { AppError } = require('../../helpers/errors');
const { githubApp, USER_AGENT, API_BASE, API_VERSION } = require('./githubApp');

const OAUTH_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const MAX_INSTALLATIONS = 10;
const MAX_REPOS = 1000;

const oauthError = () => new AppError('GITHUB_ERROR', 'GitHub authorization failed', 502);

// Exchanges the callback `code` for a user-to-server token. The caller must not store it.
const exchangeCodeForUserToken = async (code) => {
    const clientId = process.env.GITHUB_APP_CLIENT_ID;
    const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        throw new AppError('GITHUB_NOT_CONFIGURED', 'GitHub integration is not configured', 503);
    }
    const body = { client_id: clientId, client_secret: clientSecret, code };
    if (process.env.GITHUB_APP_CALLBACK_URL) body.redirect_uri = process.env.GITHUB_APP_CALLBACK_URL;

    let res;
    try {
        res = await githubApp.fetch(OAUTH_TOKEN_URL, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(githubApp.timeoutMs),
        });
    } catch {
        throw oauthError();
    }
    let data = null;
    try {
        data = await res.json();
    } catch {
        data = null;
    }
    // GitHub answers 200 with {error: 'bad_verification_code'} for bad/expired/reused codes.
    if (!res.ok || !data || typeof data.access_token !== 'string' || data.error) throw oauthError();
    return data.access_token;
};

const getAuthenticatedLogin = async (userToken) => {
    const { data } = await githubApp.request({ token: userToken }, 'GET', '/user');
    if (!data || typeof data.login !== 'string') throw oauthError();
    return data.login;
};

// Best effort: the token is useless to TaskMate after the callback, so it is revoked at once.
// Failures are only logged (never the token itself) and never block the flow.
const revokeUserToken = async (userToken) => {
    const clientId = process.env.GITHUB_APP_CLIENT_ID;
    const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
    if (!userToken || !clientId || !clientSecret) return false;
    try {
        const res = await githubApp.fetch(`${API_BASE}/applications/${encodeURIComponent(clientId)}/token`, {
            method: 'DELETE',
            headers: {
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': API_VERSION,
                'User-Agent': USER_AGENT,
                'Content-Type': 'application/json',
                Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
            },
            body: JSON.stringify({ access_token: userToken }),
            signal: AbortSignal.timeout(githubApp.timeoutMs),
        });
        if (res.status !== 204 && !res.ok) console.warn(`GitHub user token revocation answered ${res.status}`);
        return res.status === 204 || res.ok;
    } catch (error) {
        console.warn('GitHub user token revocation failed:', error && error.name);
        return false;
    }
};

const listUserInstallations = (userToken) =>
    githubApp.paginate({ token: userToken }, '/user/installations', { itemsKey: 'installations', maxItems: MAX_INSTALLATIONS * 10 });

// Repos of one installation that this user can access (installation ∩ user permissions).
const listUserInstallationRepos = (userToken, installationId) =>
    githubApp.paginate({ token: userToken }, `/user/installations/${Number(installationId)}/repositories`, {
        itemsKey: 'repositories',
        maxItems: MAX_REPOS,
    });

module.exports = {
    exchangeCodeForUserToken,
    getAuthenticatedLogin,
    revokeUserToken,
    listUserInstallations,
    listUserInstallationRepos,
    MAX_INSTALLATIONS,
    OAUTH_TOKEN_URL,
};

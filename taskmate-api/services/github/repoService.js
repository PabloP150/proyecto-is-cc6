const { TextDecoder } = require('util');
const { AppError } = require('../../helpers/errors');
const githubModel = require('../../models/github.model');
const { githubApp, PERMISSIONS } = require('./githubApp');

const MAX_TREE_ENTRIES = 5000;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_COMMITS = 30;
const MAX_PATH_LENGTH = 1024;
const MAX_REF_LENGTH = 255;
const MAX_COMMIT_MESSAGE = 2000;
const BINARY_SNIFF_BYTES = 8000;

const invalid = (message) => new AppError('VALIDATION_ERROR', message, 400);

const getConnectedRepo = async (gid) => {
    const repo = await githubModel.getGroupRepository(gid);
    if (!repo) throw new AppError('REPO_NOT_CONNECTED', 'This group has no connected repository', 409);
    if (repo.suspendedAt) throw new AppError('INSTALLATION_SUSPENDED', 'The GitHub App installation is suspended', 409);
    return repo;
};

const repoAuth = (repo) => ({ installationId: Number(repo.installationId) });

const repoPath = (repo) => `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;

const scope = (repo, permissions = PERMISSIONS.read) => ({ repoIds: [Number(repo.repoId)], permissions });

const checkPathForm = (value) => {
    if (value.length > MAX_PATH_LENGTH) throw invalid('path is too long');
    if (/[\x00-\x1f\x7f]/.test(value)) throw invalid('path contains control characters');
    if (value.includes('\\')) throw invalid('path must use forward slashes');
    if (value.startsWith('/') || /^[a-zA-Z]:/.test(value)) throw invalid('path must be relative');
    const segments = value.split('/');
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
        throw invalid('path contains an invalid segment');
    }
    return segments;
};

// Express already decoded the query once; a second decode catches encoded traversal such as
// %2e%2e. A literal "%" that does not decode (e.g. "100%.txt") is still a valid file name.
const validateRepoPath = (path) => {
    if (typeof path !== 'string' || !path) throw invalid('path is required');
    const segments = checkPathForm(path);
    let decoded = path;
    try {
        decoded = decodeURIComponent(path);
    } catch {
        decoded = path;
    }
    if (decoded !== path) checkPathForm(decoded);
    return { path, encoded: segments.map(encodeURIComponent).join('/') };
};

const validateRef = (ref) => {
    if (ref === undefined || ref === null || ref === '') return null;
    if (typeof ref !== 'string' || ref.length > MAX_REF_LENGTH) throw invalid('ref is invalid');
    if (/^[0-9a-f]{7,40}$/i.test(ref)) return ref;
    const ok = !ref.startsWith('-')
        && !/[\x00-\x20\x7f~^:?*[\\]/.test(ref)
        && !ref.includes('..') && !ref.includes('//') && !ref.includes('@{')
        && !ref.startsWith('/') && !ref.endsWith('/') && !ref.endsWith('.') && ref !== '@'
        && ref.split('/').every((part) => part && !part.startsWith('.') && !part.endsWith('.lock'));
    if (!ok) throw invalid('ref is invalid');
    return ref;
};

const resolveCommit = async (repo, ref) => {
    const { data } = await githubApp.request(repoAuth(repo), 'GET', `${repoPath(repo)}/commits`, {
        ...scope(repo),
        query: { sha: ref, per_page: 1 },
        notFoundCode: 'NOT_FOUND',
    });
    const commit = Array.isArray(data) ? data[0] : null;
    if (!commit) throw new AppError('REPO_EMPTY', 'The repository is empty', 409);
    return { sha: commit.sha, treeSha: commit.commit && commit.commit.tree && commit.commit.tree.sha };
};

const getTreeForRepo = async (repo, { ref } = {}) => {
    const effectiveRef = validateRef(ref) || repo.defaultBranch;
    const commit = await resolveCommit(repo, effectiveRef);
    const { data } = await githubApp.request(repoAuth(repo), 'GET', `${repoPath(repo)}/git/trees/${encodeURIComponent(commit.treeSha || commit.sha)}`, {
        ...scope(repo),
        query: { recursive: 1 },
    });
    const raw = Array.isArray(data && data.tree) ? data.tree : [];
    const entries = raw
        .filter((entry) => entry && (entry.type === 'blob' || entry.type === 'tree') && typeof entry.path === 'string')
        .slice(0, MAX_TREE_ENTRIES)
        .map((entry) => ({ path: entry.path, type: entry.type, size: entry.type === 'blob' ? Number(entry.size) || 0 : null }));
    return {
        ref: effectiveRef,
        sha: commit.sha,
        truncated: Boolean(data && data.truncated) || raw.length > MAX_TREE_ENTRIES,
        entries,
    };
};

const isBinary = (buffer) => {
    if (buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return true;
    try {
        new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        return false;
    } catch {
        return true;
    }
};

const toFilePayload = (data) => {
    if (Array.isArray(data)) throw invalid('path is a directory');
    if (!data || data.type !== 'file') throw invalid('path is not a regular file');
    const size = Number(data.size) || 0;
    if (size > MAX_FILE_BYTES || data.encoding === 'none') {
        throw new AppError('FILE_TOO_LARGE', 'File is larger than 1 MB', 413);
    }
    const buffer = Buffer.from(typeof data.content === 'string' ? data.content : '', data.encoding === 'base64' ? 'base64' : 'utf8');
    if (buffer.length > MAX_FILE_BYTES) throw new AppError('FILE_TOO_LARGE', 'File is larger than 1 MB', 413);
    const binary = isBinary(buffer);
    return {
        path: data.path,
        size,
        binary,
        content: binary ? null : buffer.toString('utf8'),
        htmlUrl: data.html_url || null,
    };
};

const getFileForRepo = async (repo, { path, ref } = {}) => {
    const { encoded } = validateRepoPath(path);
    const effectiveRef = validateRef(ref) || repo.defaultBranch;
    const { data } = await githubApp.request(repoAuth(repo), 'GET', `${repoPath(repo)}/contents/${encoded}`, {
        ...scope(repo),
        query: { ref: effectiveRef },
        notFoundCode: 'FILE_NOT_FOUND',
    });
    return toFilePayload(data);
};

const getReadmeForRepo = async (repo, { ref } = {}) => {
    const effectiveRef = validateRef(ref) || repo.defaultBranch;
    const { data } = await githubApp.request(repoAuth(repo), 'GET', `${repoPath(repo)}/readme`, {
        ...scope(repo),
        query: { ref: effectiveRef },
        notFoundCode: 'FILE_NOT_FOUND',
    });
    return toFilePayload(data);
};

const parsePerPage = (perPage) => {
    if (perPage === undefined || perPage === null || perPage === '') return MAX_COMMITS;
    const n = Number(perPage);
    if (!Number.isInteger(n) || n < 1 || n > MAX_COMMITS) throw invalid(`perPage must be between 1 and ${MAX_COMMITS}`);
    return n;
};

const getCommitsForRepo = async (repo, { ref, perPage } = {}) => {
    const effectiveRef = validateRef(ref) || repo.defaultBranch;
    const { data } = await githubApp.request(repoAuth(repo), 'GET', `${repoPath(repo)}/commits`, {
        ...scope(repo),
        query: { sha: effectiveRef, per_page: parsePerPage(perPage) },
        notFoundCode: 'NOT_FOUND',
    });
    return (Array.isArray(data) ? data : []).map((item) => {
        const commit = item.commit || {};
        const author = commit.author || {};
        return {
            sha: item.sha,
            shortSha: String(item.sha || '').slice(0, 7),
            message: String(commit.message || '').slice(0, MAX_COMMIT_MESSAGE),
            authorName: author.name || null,
            authorLogin: item.author && item.author.login ? item.author.login : null,
            date: author.date || null,
            htmlUrl: item.html_url || null,
        };
    });
};

const getRepoMeta = async (repo) => {
    const { data } = await githubApp.request(repoAuth(repo), 'GET', repoPath(repo), scope(repo));
    return data || {};
};

module.exports = {
    getConnectedRepo,
    repoAuth,
    repoPath,
    scope,
    validateRepoPath,
    validateRef,
    isBinary,
    getTreeForRepo,
    getFileForRepo,
    getReadmeForRepo,
    getCommitsForRepo,
    getRepoMeta,
    // Input is validated before touching the DB or GitHub.
    getTree: async (gid, opts = {}) => {
        validateRef(opts.ref);
        return getTreeForRepo(await getConnectedRepo(gid), opts);
    },
    getFile: async (gid, opts = {}) => {
        validateRepoPath(opts.path);
        validateRef(opts.ref);
        return getFileForRepo(await getConnectedRepo(gid), opts);
    },
    getReadme: async (gid, opts = {}) => {
        validateRef(opts.ref);
        return getReadmeForRepo(await getConnectedRepo(gid), opts);
    },
    getCommits: async (gid, opts = {}) => {
        validateRef(opts.ref);
        parsePerPage(opts.perPage);
        return getCommitsForRepo(await getConnectedRepo(gid), opts);
    },
    MAX_FILE_BYTES,
    MAX_TREE_ENTRIES,
};

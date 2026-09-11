const { isAppError } = require('../../helpers/errors');
const { githubApp, PERMISSIONS } = require('./githubApp');
const repoService = require('./repoService');

// Budget agreed with the Python agent: ~7k chars of snapshot + ~1.5k of existing tasks.
const SNAPSHOT_BUDGET = 7000;
const EXISTING_BUDGET = 1500;
const LIMITS = Object.freeze({
    description: 300,
    treeChars: 2600,
    readme: 1500,
    manifests: 3,
    manifestExcerpt: 450,
    commits: 10,
    commitMessage: 120,
    issues: 10,
    issueTitle: 120,
    existingTasks: 40,
    existingMilestones: 15,
});

const EXCLUDED_DIRS = new Set([
    'node_modules', 'dist', 'build', 'vendor', '.git', 'coverage', '.next', '.nuxt', 'out', 'target',
    '__pycache__', '.venv', 'venv', '.idea', '.vscode', 'bower_components', '.cache', '.gradle', 'pods',
    'deriveddata', '.terraform', '.pytest_cache', '.mypy_cache',
]);
const LOCKFILES = new Set([
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'npm-shrinkwrap.json', 'poetry.lock', 'pipfile.lock',
    'composer.lock', 'gemfile.lock', 'cargo.lock', 'go.sum', 'packages.lock.json', 'bun.lockb', 'mix.lock', 'podfile.lock',
]);
const EXCLUDED_EXT = new Set([
    // binaries and media
    'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'svgz', 'tiff', 'psd', 'pdf', 'zip', 'gz', 'tgz', 'bz2', 'xz',
    '7z', 'rar', 'jar', 'war', 'ear', 'class', 'exe', 'dll', 'so', 'dylib', 'bin', 'o', 'a', 'lib', 'obj', 'pyc',
    'pyo', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp3', 'mp4', 'mov', 'avi', 'wav', 'ogg', 'webm', 'flac', 'sqlite',
    'db', 'mdf', 'ldf', 'bak', 'dmg', 'iso', 'apk', 'ipa', 'map',
    // keys and certificates
    'pem', 'key', 'p12', 'pfx', 'jks', 'keystore', 'crt', 'cer', 'der', 'p8', 'asc', 'gpg', 'ppk',
]);
const SECRET_NAMES = /^(\.env.*|\.npmrc|\.pypirc|\.netrc|\.htpasswd|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|credentials(\.json)?|secrets?\.(json|ya?ml|toml))$/i;
const MANIFESTS = [
    'package.json', 'requirements.txt', 'pyproject.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts',
    'go.mod', 'cargo.toml', 'gemfile', 'composer.json', 'setup.py', 'pipfile', 'mix.exs', 'pubspec.yaml',
];

const REDACTED = '[REDACTED]';
const SECRET_PATTERNS = [
    /-----BEGIN [A-Z0-9 ]*(PRIVATE|SECRET)? ?KEY( BLOCK)?-----[\s\S]*?(-----END [A-Z0-9 ]*KEY( BLOCK)?-----|$)/g,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
    /\bAIza[0-9A-Za-z\-_]{35}\b/g,
    /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
    /\b(sk|rk)_(live|test)_[A-Za-z0-9]{16,}\b/g,
    /\bgsk_[A-Za-z0-9]{20,}\b/g,
    /\bsk-[A-Za-z0-9_-]{20,}\b/g,
    /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/gi,
];
// key = value / key: value where the key names a secret; the value is replaced, the key kept.
const KEY_VALUE_SECRET = /\b([A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|passw(?:or)?d|pwd|access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?key|credentials?)[A-Za-z0-9_.-]*)(\s*["']?\s*[:=]\s*["']?)([^\s"',;]{4,})/gi;

const redactSecrets = (text) => {
    if (typeof text !== 'string' || !text) return text || '';
    let out = text;
    for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, REDACTED);
    return out.replace(KEY_VALUE_SECRET, (match, key, sep, value) => (value === REDACTED ? match : `${key}${sep}${REDACTED}`));
};

const clip = (text, max) => {
    const value = String(text || '');
    return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
};

const basename = (path) => path.slice(path.lastIndexOf('/') + 1);

const isExcludedPath = (path) => {
    const segments = path.split('/');
    if (segments.slice(0, -1).some((dir) => EXCLUDED_DIRS.has(dir.toLowerCase()))) return true;
    const name = basename(path).toLowerCase();
    if (EXCLUDED_DIRS.has(name) || LOCKFILES.has(name) || SECRET_NAMES.test(name)) return true;
    if (/\.min\.(js|css)$/.test(name)) return true;
    const dot = name.lastIndexOf('.');
    return dot > 0 && EXCLUDED_EXT.has(name.slice(dot + 1));
};

// Shallow paths first so the budget keeps the project's shape rather than one deep folder.
const condenseTree = (entries, budget = LIMITS.treeChars) => {
    const paths = entries
        .filter((entry) => entry.type === 'blob' && !isExcludedPath(entry.path))
        .map((entry) => entry.path)
        .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
    const kept = [];
    let used = 0;
    for (const path of paths) {
        const cost = path.length + 3;
        if (used + cost > budget) break;
        kept.push(redactSecrets(path));
        used += cost;
    }
    return kept;
};

const packageJsonExcerpt = (text) => {
    try {
        const pkg = JSON.parse(text);
        const names = (obj) => Object.keys(obj || {}).join(', ');
        return [
            pkg.name && `name: ${pkg.name}`,
            pkg.description && `description: ${pkg.description}`,
            pkg.dependencies && `dependencies: ${names(pkg.dependencies)}`,
            pkg.devDependencies && `devDependencies: ${names(pkg.devDependencies)}`,
            pkg.scripts && `scripts: ${names(pkg.scripts)}`,
        ].filter(Boolean).join('\n');
    } catch {
        return '';
    }
};

const manifestExcerpt = (path, text) => {
    const name = basename(path).toLowerCase();
    let excerpt;
    if (name === 'package.json' || name === 'composer.json') {
        excerpt = packageJsonExcerpt(text);
    } else {
        excerpt = text.split('\n').map((line) => line.trimEnd()).filter((line) => line && !/^\s*#/.test(line)).join('\n');
    }
    return clip(redactSecrets(excerpt), LIMITS.manifestExcerpt);
};

const pickManifests = (entries) => entries
    .filter((entry) => entry.type === 'blob' && entry.path.split('/').length <= 2 && MANIFESTS.includes(basename(entry.path).toLowerCase()))
    .filter((entry) => !isExcludedPath(entry.path) && (entry.size || 0) <= repoService.MAX_FILE_BYTES)
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path))
    .slice(0, LIMITS.manifests);

const optional = async (promise, fallback) => {
    try {
        return await promise;
    } catch (err) {
        if (isAppError(err) && ['GITHUB_RATE_LIMITED', 'INSTALLATION_SUSPENDED'].includes(err.code)) throw err;
        return fallback;
    }
};

const fetchOpenIssues = async (repo) => {
    const { data } = await githubApp.request(repoService.repoAuth(repo), 'GET', `${repoService.repoPath(repo)}/issues`, {
        ...repoService.scope(repo, PERMISSIONS.snapshot),
        query: { state: 'open', per_page: 30, sort: 'updated' },
    });
    return (Array.isArray(data) ? data : [])
        .filter((issue) => issue && !issue.pull_request)
        .slice(0, LIMITS.issues)
        .map((issue) => ({ number: issue.number, title: clip(redactSecrets(String(issue.title || '')), LIMITS.issueTitle) }));
};

const size = (value) => JSON.stringify(value).length;

// Last resort if the sections together still exceed the budget: shrink the biggest parts first.
const enforceBudget = (snapshot, budget) => {
    while (size(snapshot) > budget && snapshot.tree.length > 20) snapshot.tree = snapshot.tree.slice(0, Math.floor(snapshot.tree.length * 0.8));
    if (size(snapshot) > budget && snapshot.readme) {
        const over = size(snapshot) - budget;
        snapshot.readme = clip(snapshot.readme, Math.max(0, snapshot.readme.length - over - 10));
    }
    while (size(snapshot) > budget && snapshot.manifests.length) snapshot.manifests.pop();
    while (size(snapshot) > budget && snapshot.issues.length) snapshot.issues.pop();
    while (size(snapshot) > budget && snapshot.commits.length) snapshot.commits.pop();
    while (size(snapshot) > budget && snapshot.tree.length) snapshot.tree.pop();
    return snapshot;
};

// Never includes source file contents: only paths, README, manifest excerpts, commits and issues.
const buildRepoSnapshot = async (repo) => {
    const [meta, tree, readme, commits, issues] = await Promise.all([
        optional(repoService.getRepoMeta(repo), {}),
        optional(repoService.getTreeForRepo(repo), { entries: [] }),
        optional(repoService.getReadmeForRepo(repo), null),
        optional(repoService.getCommitsForRepo(repo, { perPage: LIMITS.commits }), []),
        optional(fetchOpenIssues(repo), []),
    ]);

    const manifestFiles = await Promise.all(pickManifests(tree.entries || []).map((entry) =>
        optional(repoService.getFileForRepo(repo, { path: entry.path }), null)));

    const snapshot = {
        repo: {
            fullName: repo.fullName || `${repo.owner}/${repo.name}`,
            defaultBranch: repo.defaultBranch,
            description: clip(redactSecrets(meta.description || ''), LIMITS.description),
            language: meta.language || null,
        },
        tree: condenseTree(tree.entries || []),
        readme: readme && !readme.binary && readme.content ? clip(redactSecrets(readme.content), LIMITS.readme) : '',
        manifests: manifestFiles
            .filter((file) => file && !file.binary && file.content)
            .map((file) => ({ path: file.path, excerpt: manifestExcerpt(file.path, file.content) }))
            .filter((m) => m.excerpt),
        commits: commits.slice(0, LIMITS.commits).map((commit) => ({
            sha7: commit.shortSha,
            message: clip(redactSecrets(String(commit.message || '').split('\n')[0]), LIMITS.commitMessage),
            date: commit.date,
        })),
        issues,
    };
    return enforceBudget(snapshot, SNAPSHOT_BUDGET);
};

const toDateString = (value) => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

const buildExisting = (tasks = [], nodes = [], budget = EXISTING_BUDGET) => {
    const existing = {
        tasks: tasks.slice(0, LIMITS.existingTasks).map((t) => ({
            name: clip(t.name, 40),
            list: clip(t.list, 25),
            percentage: Number(t.percentage) || 0,
        })),
        milestones: nodes.slice(0, LIMITS.existingMilestones).map((n) => ({
            name: clip(n.name, 40),
            date: toDateString(n.date),
            completed: Boolean(n.completed),
        })),
    };
    while (size(existing) > budget && existing.tasks.length) existing.tasks.pop();
    while (size(existing) > budget && existing.milestones.length) existing.milestones.pop();
    return existing;
};

module.exports = {
    buildRepoSnapshot,
    buildExisting,
    redactSecrets,
    isExcludedPath,
    condenseTree,
    manifestExcerpt,
    SNAPSHOT_BUDGET,
    EXISTING_BUDGET,
};

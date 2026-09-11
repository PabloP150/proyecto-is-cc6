jest.mock('../../models/github.model', () => ({ getGroupRepository: jest.fn() }), { virtual: true });

const snapshotService = require('../../services/github/repoSnapshot');
const { useFakeGitHub, tokenRoute, REPO } = require('./helpers/fakeGitHub');

const { redactSecrets, isExcludedPath, buildRepoSnapshot, buildExisting, SNAPSHOT_BUDGET, EXISTING_BUDGET } = snapshotService;
const b64 = (text) => Buffer.from(text).toString('base64');
const file = (path, content) => ({ body: { type: 'file', path, size: Buffer.byteLength(content), encoding: 'base64', content: b64(content), html_url: `https://github.com/octo/demo/blob/main/${path}` } });

describe('redactSecrets', () => {
    test.each([
        ['token ghp_abcdefghijklmnopqrstuvwxyz0123456789 here', 'ghp_'],
        ['gho_ABCDEFGHIJKLMNOPQRSTUVWX1234', 'gho_'],
        ['github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz', 'github_pat_'],
        ['aws AKIAIOSFODNN7EXAMPLE key', 'AKIAIOSFODNN7EXAMPLE'],
        ['-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----', 'MIIEowIBAAKCAQEA'],
        ['-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA (truncated', 'b3BlbnNzaC1rZXktdjEAAAAA'],
        ['DB_PASSWORD=SuperSecret123', 'SuperSecret123'],
        ['"apiKey": "abcd1234efgh"', 'abcd1234efgh'],
        ['client_secret: s3cr3tvalue', 's3cr3tvalue'],
        ['GROQ_API_KEY=gsk_abcdefghijklmnopqrstuvwxyz012345', 'gsk_abcdefghijklmnopqrstuvwxyz012345'],
        ['mssql://sa:P4ssw0rd@db:1433/app', 'P4ssw0rd'],
        ['slack xoxb-1234567890-abcdefghij', 'xoxb-1234567890'],
    ])('redacts %j', (input, secret) => {
        const out = redactSecrets(input);
        expect(out).toContain('[REDACTED]');
        expect(out).not.toContain(secret);
    });

    test('keeps ordinary text', () => {
        expect(redactSecrets('Run npm test to execute the suite.')).toBe('Run npm test to execute the suite.');
        expect(redactSecrets('dependencies: jsonwebtoken, bcryptjs')).toBe('dependencies: jsonwebtoken, bcryptjs');
    });
});

describe('isExcludedPath', () => {
    test.each([
        'node_modules/a/index.js', 'dist/app.js', 'build/x.js', 'vendor/lib.php', '.git/config', 'web/node_modules/y.js',
        'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock', '.env', '.env.local', 'config/.env.production',
        'certs/server.pem', 'keys/app.key', 'id_rsa', 'assets/logo.png', 'fonts/a.woff2', 'app.min.js', 'secrets.json',
    ])('excludes %s', (path) => expect(isExcludedPath(path)).toBe(true));

    test.each(['src/index.js', 'README.md', 'package.json', 'docs/env.md', 'src/environment.ts', 'Dockerfile'])('keeps %s', (path) => {
        expect(isExcludedPath(path)).toBe(false);
    });
});

describe('buildRepoSnapshot', () => {
    const bigTree = [
        ...Array.from({ length: 4000 }, (_, i) => ({ path: `src/module${i}/component${i}/very/deep/file${i}.js`, type: 'blob', size: 10 })),
        { path: 'package.json', type: 'blob', size: 300 },
        { path: 'src/secret-config.js', type: 'blob', size: 30 },
        { path: '.env', type: 'blob', size: 30 },
        { path: 'node_modules/x/index.js', type: 'blob', size: 5 },
        { path: 'src', type: 'tree' },
    ];
    const routes = () => ({
        'POST /app/installations/77/access_tokens': tokenRoute('ghs_snap'),
        'GET /repos/octo/demo': { body: { description: 'Demo app with key AKIAIOSFODNN7EXAMPLE', language: 'JavaScript', default_branch: 'main' } },
        'GET /repos/octo/demo/commits': (call) => (call.query.per_page === '1'
            ? { body: [{ sha: 'c'.repeat(40), commit: { tree: { sha: 't'.repeat(40) } } }] }
            : { body: Array.from({ length: 10 }, (_, i) => ({ sha: `${i}abcdef0123456789`, commit: { message: `feat: step ${i}\n\nlong body ${'x'.repeat(500)}`, author: { date: '2026-09-01T00:00:00Z' } } })) }),
        [`GET /repos/octo/demo/git/trees/${'t'.repeat(40)}`]: { body: { truncated: false, tree: bigTree } },
        'GET /repos/octo/demo/readme': file('README.md', `# Demo\n${'Lorem ipsum dolor sit amet. '.repeat(400)}\nGROQ_API_KEY=gsk_abcdefghijklmnopqrstuvwxyz012345`),
        'GET /repos/octo/demo/contents/package.json': file('package.json', JSON.stringify({ name: 'demo', dependencies: { express: '^4', jsonwebtoken: '^9' }, devDependencies: { jest: '^30' }, scripts: { test: 'jest', start: 'node .' } })),
        'GET /repos/octo/demo/issues': { body: [{ number: 1, title: 'Bug in login' }, { number: 2, title: 'A PR', pull_request: {} }] },
    });

    test('stays within the budget, redacts, excludes and never reads source files', async () => {
        const fetchImpl = useFakeGitHub(routes());
        const snapshot = await buildRepoSnapshot({ ...REPO });
        expect(JSON.stringify(snapshot).length).toBeLessThanOrEqual(SNAPSHOT_BUDGET);
        expect(snapshot.repo).toEqual({ fullName: 'octo/demo', defaultBranch: 'main', description: 'Demo app with key [REDACTED]', language: 'JavaScript' });
        expect(snapshot.tree[0]).toBe('package.json');
        expect(snapshot.tree).not.toContain('.env');
        expect(snapshot.tree.some((p) => p.includes('node_modules'))).toBe(false);
        expect(snapshot.readme.length).toBeLessThanOrEqual(1500);
        expect(snapshot.readme.startsWith('# Demo')).toBe(true);
        expect(snapshot.manifests).toEqual([{
            path: 'package.json',
            excerpt: 'name: demo\ndependencies: express, jsonwebtoken\ndevDependencies: jest\nscripts: test, start',
        }]);
        expect(snapshot.commits).toHaveLength(10);
        expect(snapshot.commits[0]).toEqual({ sha7: '0abcdef', message: 'feat: step 0', date: '2026-09-01T00:00:00Z' });
        expect(snapshot.issues).toEqual([{ number: 1, title: 'Bug in login' }]);

        const contentReads = fetchImpl.calls.filter((c) => c.path.includes('/contents/')).map((c) => c.path);
        expect(contentReads).toEqual(['/repos/octo/demo/contents/package.json']);
        const issuesMint = fetchImpl.calls.find((c) => c.path.endsWith('/access_tokens') && c.body.permissions.issues);
        expect(issuesMint.body.permissions).toEqual({ contents: 'read', issues: 'read' });
    });

    test('an empty repository still produces a (small) snapshot', async () => {
        useFakeGitHub({
            ...routes(),
            'GET /repos/octo/demo/commits': { status: 409, body: { message: 'Git Repository is empty.' } },
            'GET /repos/octo/demo/readme': { status: 404 },
            'GET /repos/octo/demo/issues': { body: [] },
        });
        const snapshot = await buildRepoSnapshot({ ...REPO });
        expect(snapshot.tree).toEqual([]);
        expect(snapshot.commits).toEqual([]);
        expect(snapshot.readme).toBe('');
    });

    test('a GitHub rate limit aborts the snapshot', async () => {
        useFakeGitHub({ ...routes(), 'GET /repos/octo/demo': { status: 429, headers: { 'retry-after': '10' } } });
        await expect(buildRepoSnapshot({ ...REPO })).rejects.toMatchObject({ code: 'GITHUB_RATE_LIMITED' });
    });
});

describe('buildExisting', () => {
    test('caps existing tasks/milestones to the budget', () => {
        const tasks = Array.from({ length: 200 }, (_, i) => ({ name: `Task number ${i} with a long name`, list: 'To Do', percentage: 10 }));
        const nodes = Array.from({ length: 30 }, (_, i) => ({ name: `M${i}`, date: new Date('2026-10-01T00:00:00Z'), completed: i % 2 === 0 }));
        const existing = buildExisting(tasks, nodes);
        expect(JSON.stringify(existing).length).toBeLessThanOrEqual(EXISTING_BUDGET);
        expect(existing.tasks[0]).toEqual({ name: 'Task number 0 with a long name', list: 'To Do', percentage: 10 });
        expect(existing.milestones.length).toBeLessThanOrEqual(15);
    });
});

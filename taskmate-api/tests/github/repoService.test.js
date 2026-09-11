jest.mock('../../models/github.model', () => ({ getGroupRepository: jest.fn() }));

const githubModel = require('../../models/github.model');
const repoService = require('../../services/github/repoService');
const { useFakeGitHub, tokenRoute, REPO } = require('./helpers/fakeGitHub');

const GID = REPO.gid;
const TOKEN_ROUTE = { 'POST /app/installations/77/access_tokens': tokenRoute('ghs_repo') };

const fileBody = (content, extra = {}) => ({
    type: 'file',
    path: 'src/a.js',
    size: Buffer.byteLength(content),
    encoding: 'base64',
    content: Buffer.from(content).toString('base64'),
    html_url: 'https://github.com/octo/demo/blob/main/src/a.js',
    ...extra,
});

beforeEach(() => {
    githubModel.getGroupRepository.mockResolvedValue({ ...REPO });
});

describe('validateRepoPath — traversal and malformed paths', () => {
    test.each([
        ['../etc/passwd'],
        ['src/../../secret'],
        ['..'],
        ['./a'],
        ['%2e%2e/secret'],
        ['src/%2E%2E/%2e%2e/x'],
        ['%2e%2e%2fsecret'],
        ['/etc/passwd'],
        ['C:/Windows/system.ini'],
        ['src\\..\\secret'],
        ['a\u0000b'],
        ['a\nb'],
        ['a//b'],
        ['a/'],
        ['x'.repeat(1025)],
        [''],
    ])('rejects %j', (path) => {
        expect(() => repoService.validateRepoPath(path)).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR', status: 400 }));
    });

    test('accepts normal paths and encodes each segment', () => {
        expect(repoService.validateRepoPath('src/mi archivo#1.js').encoded).toBe('src/mi%20archivo%231.js');
        expect(repoService.validateRepoPath('docs/100%.md').path).toBe('docs/100%.md');
        expect(repoService.validateRepoPath('.github/workflows/ci.yml').encoded).toBe('.github/workflows/ci.yml');
    });
});

describe('validateRef', () => {
    test.each([['main'], ['feature/x'], ['v1.2.3'], ['a1b2c3d'], ['0123456789abcdef0123456789abcdef01234567']])('accepts %j', (ref) => {
        expect(repoService.validateRef(ref)).toBe(ref);
    });
    test.each([['../main'], ['-x'], ['a b'], ['a..b'], ['x.lock'], ['a@{1}'], ['a\\b'], ['x'.repeat(256)]])('rejects %j', (ref) => {
        expect(() => repoService.validateRef(ref)).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    });
    test('empty means default branch', () => {
        expect(repoService.validateRef(undefined)).toBeNull();
        expect(repoService.validateRef('')).toBeNull();
    });
});

describe('getFile', () => {
    test('returns text content with metadata, scoped token for the repo', async () => {
        const fetchImpl = useFakeGitHub({ ...TOKEN_ROUTE, 'GET /repos/octo/demo/contents/src/a.js': { body: fileBody('console.log(1);\n') } });
        const file = await repoService.getFile(GID, { path: 'src/a.js' });
        expect(file).toEqual({
            path: 'src/a.js',
            size: 16,
            binary: false,
            content: 'console.log(1);\n',
            htmlUrl: 'https://github.com/octo/demo/blob/main/src/a.js',
        });
        const [mint, get] = fetchImpl.calls;
        expect(mint.body).toEqual({ repository_ids: [500], permissions: { contents: 'read' } });
        expect(get.query.ref).toBe('main');
    });

    test('> 1 MB → FILE_TOO_LARGE 413 without decoding', async () => {
        useFakeGitHub({ ...TOKEN_ROUTE, 'GET /repos/octo/demo/contents/big.bin': { body: { type: 'file', path: 'big.bin', size: 1024 * 1024 + 1, encoding: 'none', content: '' } } });
        await expect(repoService.getFile(GID, { path: 'big.bin' })).rejects.toMatchObject({ code: 'FILE_TOO_LARGE', status: 413 });
    });

    test('binary files come back with binary=true and no content', async () => {
        const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
        useFakeGitHub({
            ...TOKEN_ROUTE,
            'GET /repos/octo/demo/contents/logo.png': { body: { type: 'file', path: 'logo.png', size: png.length, encoding: 'base64', content: png.toString('base64') } },
        });
        const file = await repoService.getFile(GID, { path: 'logo.png' });
        expect(file.binary).toBe(true);
        expect(file.content).toBeNull();
    });

    test('invalid UTF-8 without NUL is also binary', () => {
        expect(repoService.isBinary(Buffer.from([0xff, 0xfe, 0x41]))).toBe(true);
        expect(repoService.isBinary(Buffer.from('ñandú ✓'))).toBe(false);
    });

    test('directories are rejected', async () => {
        useFakeGitHub({ ...TOKEN_ROUTE, 'GET /repos/octo/demo/contents/src': { body: [{ type: 'file' }] } });
        await expect(repoService.getFile(GID, { path: 'src' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    test('missing file → FILE_NOT_FOUND 404', async () => {
        useFakeGitHub({ ...TOKEN_ROUTE });
        await expect(repoService.getFile(GID, { path: 'nope.txt' })).rejects.toMatchObject({ code: 'FILE_NOT_FOUND', status: 404 });
    });

    test('traversal is rejected before any DB or GitHub call', async () => {
        const fetchImpl = useFakeGitHub({});
        await expect(repoService.getFile(GID, { path: '%2e%2e/x' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        expect(githubModel.getGroupRepository).not.toHaveBeenCalled();
        expect(fetchImpl.calls).toHaveLength(0);
    });

    test('no repo → REPO_NOT_CONNECTED; suspended → INSTALLATION_SUSPENDED', async () => {
        useFakeGitHub({});
        githubModel.getGroupRepository.mockResolvedValueOnce(null);
        await expect(repoService.getFile(GID, { path: 'a' })).rejects.toMatchObject({ code: 'REPO_NOT_CONNECTED', status: 409 });
        githubModel.getGroupRepository.mockResolvedValueOnce({ ...REPO, suspendedAt: new Date() });
        await expect(repoService.getFile(GID, { path: 'a' })).rejects.toMatchObject({ code: 'INSTALLATION_SUSPENDED', status: 409 });
    });
});

describe('getReadme', () => {
    test('returns the README', async () => {
        useFakeGitHub({ ...TOKEN_ROUTE, 'GET /repos/octo/demo/readme': { body: fileBody('# Demo', { path: 'README.md' }) } });
        const readme = await repoService.getReadme(GID, {});
        expect(readme).toMatchObject({ path: 'README.md', content: '# Demo', binary: false });
    });
});

describe('getTree', () => {
    const commitsRoute = { body: [{ sha: 'c'.repeat(40), commit: { tree: { sha: 't'.repeat(40) } } }] };

    test('resolves the ref to a commit and caps entries at 5000 with truncated=true', async () => {
        const tree = Array.from({ length: 5003 }, (_, i) => ({ path: `f${i}.txt`, type: 'blob', size: i }));
        tree.push({ path: 'sub', type: 'commit' });
        const fetchImpl = useFakeGitHub({
            ...TOKEN_ROUTE,
            'GET /repos/octo/demo/commits': commitsRoute,
            [`GET /repos/octo/demo/git/trees/${'t'.repeat(40)}`]: { body: { sha: 't'.repeat(40), truncated: false, tree } },
        });
        const result = await repoService.getTree(GID, { ref: 'dev' });
        expect(result.ref).toBe('dev');
        expect(result.sha).toBe('c'.repeat(40));
        expect(result.truncated).toBe(true);
        expect(result.entries).toHaveLength(5000);
        expect(result.entries[0]).toEqual({ path: 'f0.txt', type: 'blob', size: 0 });
        expect(fetchImpl.calls[1].query).toMatchObject({ sha: 'dev', per_page: '1' });
        expect(fetchImpl.calls[2].query).toMatchObject({ recursive: '1' });
    });

    test('empty repository → REPO_EMPTY 409', async () => {
        useFakeGitHub({ ...TOKEN_ROUTE, 'GET /repos/octo/demo/commits': { status: 409, body: { message: 'Git Repository is empty.' } } });
        await expect(repoService.getTree(GID, {})).rejects.toMatchObject({ code: 'REPO_EMPTY', status: 409 });
    });
});

describe('getCommits', () => {
    test('maps commits and caps perPage at 30', async () => {
        const fetchImpl = useFakeGitHub({
            ...TOKEN_ROUTE,
            'GET /repos/octo/demo/commits': {
                body: [{
                    sha: 'abcdef1234567890abcdef1234567890abcdef12',
                    html_url: 'https://github.com/octo/demo/commit/abcdef1',
                    author: { login: 'octocat' },
                    commit: { message: 'feat: x\n\nbody', author: { name: 'Octo Cat', date: '2026-09-01T10:00:00Z' } },
                }],
            },
        });
        const commits = await repoService.getCommits(GID, { perPage: '5' });
        expect(commits).toEqual([{
            sha: 'abcdef1234567890abcdef1234567890abcdef12',
            shortSha: 'abcdef1',
            message: 'feat: x\n\nbody',
            authorName: 'Octo Cat',
            authorLogin: 'octocat',
            date: '2026-09-01T10:00:00Z',
            htmlUrl: 'https://github.com/octo/demo/commit/abcdef1',
        }]);
        expect(fetchImpl.calls[1].query).toMatchObject({ sha: 'main', per_page: '5' });
        await expect(repoService.getCommits(GID, { perPage: 31 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(repoService.getCommits(GID, { perPage: 'x' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
});

jest.mock('../../models/github.model', () => ({
    getGroupRepository: jest.fn(),
    getTaskBranch: jest.fn(),
    insertTaskBranch: jest.fn(),
    findTaskByBranch: jest.fn(),
}));
jest.mock('../../models/tasks.model', () => ({ getTask: jest.fn() }));

const githubModel = require('../../models/github.model');
const tasksModel = require('../../models/tasks.model');
const { AppError } = require('../../helpers/errors');
const { createTaskBranch, cleanupTaskBranch, cleanupBranchesWithin, cleanupTaskBranchInBackground, CLEANUP_WAIT_MS } = require('../../services/github/branchService');
const { githubApp } = require('../../services/github/githubApp');
const { useFakeGitHub, tokenRoute, REPO } = require('./helpers/fakeGitHub');

const TID = 'ABCDEF12-3456-4789-8abc-def012345678';
const UID = '22222222-2222-4222-8222-222222222222';
const GID = REPO.gid;
const BRANCH = 'tm/anadir-autenticacion-abcdef12';
const HEAD = 'a'.repeat(40);
const EXISTING_HEAD = 'b'.repeat(40);

const routes = (overrides = {}) => ({
    'POST /app/installations/77/access_tokens': tokenRoute('ghs_write'),
    'GET /repos/octo/demo/git/ref/heads/main': { body: { object: { sha: HEAD } } },
    'POST /repos/octo/demo/git/refs': { status: 201, body: { ref: `refs/heads/${BRANCH}` } },
    [`GET /repos/octo/demo/git/ref/heads/${BRANCH}`]: { body: { object: { sha: EXISTING_HEAD } } },
    [`DELETE /repos/octo/demo/git/refs/heads/${BRANCH}`]: { status: 204 },
    ...overrides,
});

const call = () => createTaskBranch({ tid: TID, gid: GID, uid: UID });

beforeEach(() => {
    tasksModel.getTask.mockResolvedValue([{ tid: TID, gid: GID.toUpperCase(), name: 'Añadir autenticación' }]);
    githubModel.getGroupRepository.mockResolvedValue({ ...REPO });
    githubModel.getTaskBranch.mockResolvedValue(null);
    githubModel.findTaskByBranch.mockResolvedValue(null);
    githubModel.insertTaskBranch.mockResolvedValue(undefined);
});

test('creates the ref from the default-branch HEAD, inserts the row → 201', async () => {
    const fetchImpl = useFakeGitHub(routes());
    const res = await call();
    expect(res.status).toBe(201);
    expect(res.data).toEqual({
        tid: TID,
        branchName: BRANCH,
        branchUrl: 'https://github.com/octo/demo/tree/tm/anadir-autenticacion-abcdef12',
        baseSha: HEAD,
        created: true,
    });
    const post = fetchImpl.calls.find((c) => c.method === 'POST' && c.path.endsWith('/git/refs'));
    expect(post.body).toEqual({ ref: `refs/heads/${BRANCH}`, sha: HEAD });
    expect(fetchImpl.calls[0].body.permissions).toEqual({ contents: 'write' });
    expect(fetchImpl.calls[0].body.repository_ids).toEqual([500]);
    expect(githubModel.insertTaskBranch).toHaveBeenCalledWith({ tid: TID, repoId: 500, branchName: BRANCH, baseSha: HEAD, createdBy: UID });
});

test('idempotent repeat → 200 created:false without calling GitHub', async () => {
    const fetchImpl = useFakeGitHub(routes());
    githubModel.getTaskBranch.mockResolvedValue({ tid: TID, repoId: '500', branchName: BRANCH, baseSha: HEAD });
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.data.created).toBe(false);
    expect(res.data.branchName).toBe(BRANCH);
    expect(fetchImpl.calls).toHaveLength(0);
});

test('task already linked in another repo → BRANCH_CONFLICT', async () => {
    useFakeGitHub(routes());
    githubModel.getTaskBranch.mockResolvedValue({ tid: TID, repoId: 999, branchName: BRANCH, baseSha: HEAD });
    await expect(call()).rejects.toMatchObject({ code: 'BRANCH_CONFLICT', status: 409 });
});

test('422 "already exists" and unclaimed → adopts the existing ref (200, created:false)', async () => {
    const fetchImpl = useFakeGitHub(routes({ 'POST /repos/octo/demo/git/refs': { status: 422, body: { message: 'Reference already exists' } } }));
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ created: false, baseSha: EXISTING_HEAD });
    expect(githubModel.findTaskByBranch).toHaveBeenCalledWith(500, BRANCH);
    expect(githubModel.insertTaskBranch).toHaveBeenCalledWith(expect.objectContaining({ baseSha: EXISTING_HEAD }));
    expect(fetchImpl.calls.some((c) => c.method === 'DELETE')).toBe(false);
});

test('422 "already exists" claimed by another task → BRANCH_CONFLICT, nothing inserted', async () => {
    useFakeGitHub(routes({ 'POST /repos/octo/demo/git/refs': { status: 422, body: { message: 'Reference already exists' } } }));
    githubModel.findTaskByBranch.mockResolvedValue({ tid: 'other', gid: GID });
    await expect(call()).rejects.toMatchObject({ code: 'BRANCH_CONFLICT' });
    expect(githubModel.insertTaskBranch).not.toHaveBeenCalled();
});

test('other 422 → GITHUB_ERROR', async () => {
    useFakeGitHub(routes({ 'POST /repos/octo/demo/git/refs': { status: 422, body: { message: 'Object does not exist' } } }));
    await expect(call()).rejects.toMatchObject({ code: 'GITHUB_ERROR', status: 502 });
});

test('DB failure after creating the ref → deletes only that ref and rethrows', async () => {
    const fetchImpl = useFakeGitHub(routes());
    const dbError = new Error('deadlock');
    githubModel.insertTaskBranch.mockRejectedValue(dbError);
    await expect(call()).rejects.toBe(dbError);
    const deletes = fetchImpl.calls.filter((c) => c.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0].path).toBe(`/repos/octo/demo/git/refs/heads/${BRANCH}`);
});

test('DB failure after adopting → no compensation', async () => {
    const fetchImpl = useFakeGitHub(routes({ 'POST /repos/octo/demo/git/refs': { status: 422, body: { message: 'Reference already exists' } } }));
    githubModel.insertTaskBranch.mockRejectedValue(new AppError('BRANCH_CONFLICT', 'x', 409));
    await expect(call()).rejects.toMatchObject({ code: 'BRANCH_CONFLICT' });
    expect(fetchImpl.calls.some((c) => c.method === 'DELETE')).toBe(false);
});

test('concurrent request linked the same branch first → 200 and the ref is kept', async () => {
    const fetchImpl = useFakeGitHub(routes());
    githubModel.insertTaskBranch.mockRejectedValue(new AppError('BRANCH_CONFLICT', 'x', 409));
    githubModel.getTaskBranch
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ tid: TID, repoId: 500, branchName: BRANCH, baseSha: HEAD });
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.data.created).toBe(false);
    expect(fetchImpl.calls.some((c) => c.method === 'DELETE')).toBe(false);
});

test('empty repository → REPO_EMPTY 409, no ref created', async () => {
    const fetchImpl = useFakeGitHub(routes({ 'GET /repos/octo/demo/git/ref/heads/main': { status: 409, body: { message: 'Git Repository is empty.' } } }));
    await expect(call()).rejects.toMatchObject({ code: 'REPO_EMPTY', status: 409 });
    expect(fetchImpl.calls.some((c) => c.method === 'POST' && c.path.endsWith('/git/refs'))).toBe(false);
});

test('unknown task or task of another group → TASK_NOT_FOUND', async () => {
    useFakeGitHub(routes());
    tasksModel.getTask.mockResolvedValueOnce([]);
    await expect(call()).rejects.toMatchObject({ code: 'TASK_NOT_FOUND', status: 404 });
    tasksModel.getTask.mockResolvedValueOnce([{ tid: TID, gid: '99999999-9999-4999-8999-999999999999', name: 'x' }]);
    await expect(call()).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' });
});

test('no connected repo → REPO_NOT_CONNECTED', async () => {
    useFakeGitHub(routes());
    githubModel.getGroupRepository.mockResolvedValue(null);
    await expect(call()).rejects.toMatchObject({ code: 'REPO_NOT_CONNECTED' });
});

describe('cleanupTaskBranch', () => {
    const LINK = Object.freeze({ tid: TID, gid: GID, repoId: 500, owner: 'octo', repoName: 'demo', branchName: BRANCH, baseSha: HEAD });
    const URL = `https://github.com/octo/demo/tree/${BRANCH}`;
    // The branch's current head; also the head of the PR that was just merged in the squash cases.
    const BRANCH_HEAD = 'c'.repeat(40);
    const META = 'GET /repos/octo/demo';
    const REF = `GET /repos/octo/demo/git/ref/heads/${BRANCH}`;
    const compareOf = (sha, base = 'main', path = '/repos/octo/demo') => `GET ${path}/compare/${base}...${sha}`;
    const COMPARE = compareOf(BRANCH_HEAD);
    const PULLS = 'GET /repos/octo/demo/pulls';
    const DELETE = `DELETE /repos/octo/demo/git/refs/heads/${BRANCH}`;
    const OPEN_PR = { number: 7, state: 'open' };

    // Default: every commit is in main, no open PR from or into the branch, the delete succeeds.
    const cleanupRoutes = (overrides = {}) => ({
        'POST /app/installations/77/access_tokens': tokenRoute((c) => `ghs_${Object.keys(c.body.permissions).join('_')}`),
        [META]: { body: { id: 500, name: 'demo', owner: { login: 'octo' }, default_branch: 'main' } },
        [REF]: { body: { object: { sha: BRANCH_HEAD } } },
        [COMPARE]: { body: { status: 'behind', ahead_by: 0, behind_by: 2 } },
        [PULLS]: { body: [] },
        [DELETE]: { status: 204 },
        ...overrides,
    });
    // Answers the open-PR lookups by their filter: `asHead` for PRs from the branch, `asBase` for PRs into it.
    const pullsBy = ({ asHead = [], asBase = [] } = {}) => (c) => ({ body: c.query.head ? asHead : asBase });
    const requested = (fetchImpl) => fetchImpl.calls.filter((c) => !c.path.endsWith('/access_tokens')).map((c) => `${c.method} ${c.path}`);
    const deleteCalls = (fetchImpl) => fetchImpl.calls.filter((c) => c.method === 'DELETE');
    const pullQueries = (fetchImpl, path = '/repos/octo/demo/pulls') => fetchImpl.calls.filter((c) => c.path === path).map((c) => c.query);
    const deferred = () => {
        let resolve;
        const promise = new Promise((r) => { resolve = r; });
        return { promise, resolve };
    };
    const flush = async (rounds = 10) => {
        for (let i = 0; i < rounds; i += 1) await new Promise((r) => setImmediate(r));
    };

    beforeEach(() => {
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    test('every commit already in main and no open PR → deleted, with the minimal scope per request', async () => {
        const fetchImpl = useFakeGitHub(cleanupRoutes());
        await expect(cleanupTaskBranch(LINK)).resolves.toEqual({ name: BRANCH, outcome: 'deleted', url: null });
        // The compare goes by the head sha read from refs/heads (COMPARE is keyed by it), never by name.
        expect(requested(fetchImpl)).toEqual([META, REF, COMPARE, PULLS, PULLS, DELETE]);
        const tokenFor = (path) => fetchImpl.calls.find((c) => c.path === path).headers.Authorization;
        expect(tokenFor('/repos/octo/demo')).toBe('Bearer ghs_contents');
        expect(tokenFor(`/repos/octo/demo/compare/main...${BRANCH_HEAD}`)).toBe('Bearer ghs_contents');
        expect(tokenFor('/repos/octo/demo/pulls')).toBe('Bearer ghs_pull_requests');
        expect(tokenFor(`/repos/octo/demo/git/refs/heads/${BRANCH}`)).toBe('Bearer ghs_contents');
        const mints = fetchImpl.calls.filter((c) => c.path.endsWith('/access_tokens')).map((c) => c.body);
        expect(mints).toEqual([
            { permissions: { contents: 'read' }, repository_ids: [500] },
            { permissions: { pull_requests: 'read' }, repository_ids: [500] },
            { permissions: { contents: 'write' }, repository_ids: [500] },
        ]);
        const queries = pullQueries(fetchImpl);
        expect(queries).toHaveLength(2);
        expect(queries).toEqual(expect.arrayContaining([
            { head: `octo:${BRANCH}`, state: 'open', per_page: '1' },
            { base: BRANCH, state: 'open', per_page: '1' },
        ]));
        expect(githubModel.getGroupRepository).toHaveBeenCalledWith(GID);
    });

    test('commits not in main (ahead_by > 0) → kept_unmerged with the branch URL, nothing deleted', async () => {
        const fetchImpl = useFakeGitHub(cleanupRoutes({ [COMPARE]: { body: { status: 'ahead', ahead_by: 2 } } }));
        await expect(cleanupTaskBranch(LINK)).resolves.toEqual({ name: BRANCH, outcome: 'kept_unmerged', url: URL });
        expect(requested(fetchImpl)).toEqual([META, REF, COMPARE, PULLS, PULLS]);
    });

    test('squash/rebase merge: ahead_by > 0 but the head is the merged PR head → deleted', async () => {
        const fetchImpl = useFakeGitHub(cleanupRoutes({ [COMPARE]: { body: { status: 'diverged', ahead_by: 3 } } }));
        await expect(cleanupTaskBranch(LINK, { mergedHeadSha: BRANCH_HEAD.toUpperCase() }))
            .resolves.toEqual({ name: BRANCH, outcome: 'deleted', url: null });
        expect(requested(fetchImpl)).toEqual([META, REF, COMPARE, PULLS, PULLS, DELETE]);
    });

    test('a push after the merge (head ≠ merged PR head) → kept_unmerged', async () => {
        const pushed = 'd'.repeat(40);
        const fetchImpl = useFakeGitHub(cleanupRoutes({
            [REF]: { body: { object: { sha: pushed } } },
            [compareOf(pushed)]: { body: { status: 'diverged', ahead_by: 4 } },
        }));
        await expect(cleanupTaskBranch(LINK, { mergedHeadSha: BRANCH_HEAD })).resolves.toMatchObject({ outcome: 'kept_unmerged', url: URL });
        expect(deleteCalls(fetchImpl)).toHaveLength(0);
    });

    test('a malformed merged head sha is ignored (only ahead_by decides)', async () => {
        const fetchImpl = useFakeGitHub(cleanupRoutes({ [COMPARE]: { body: { ahead_by: 1 } } }));
        await expect(cleanupTaskBranch(LINK, { mergedHeadSha: 'main' })).resolves.toMatchObject({ outcome: 'kept_unmerged' });
        expect(deleteCalls(fetchImpl)).toHaveLength(0);
    });

    test('an open PR from the branch (any base) → kept_open_pr, even when merged', async () => {
        const fetchImpl = useFakeGitHub(cleanupRoutes({ [PULLS]: pullsBy({ asHead: [{ ...OPEN_PR, base: { ref: 'develop' } }] }) }));
        await expect(cleanupTaskBranch(LINK)).resolves.toEqual({ name: BRANCH, outcome: 'kept_open_pr', url: URL });
        expect(deleteCalls(fetchImpl)).toHaveLength(0);
    });

    test('an open PR into the branch (stacked PR) → kept_open_pr: deleting its base would close it', async () => {
        const fetchImpl = useFakeGitHub(cleanupRoutes({ [PULLS]: pullsBy({ asBase: [{ ...OPEN_PR, base: { ref: BRANCH } }] }) }));
        await expect(cleanupTaskBranch(LINK)).resolves.toEqual({ name: BRANCH, outcome: 'kept_open_pr', url: URL });
        expect(deleteCalls(fetchImpl)).toHaveLength(0);
    });

    test('branch already gone (ref 404) → missing, no URL, nothing else asked', async () => {
        const fetchImpl = useFakeGitHub(cleanupRoutes({ [REF]: { status: 404, body: { message: 'Not Found' } } }));
        await expect(cleanupTaskBranch(LINK, { mergedHeadSha: BRANCH_HEAD })).resolves.toEqual({ name: BRANCH, outcome: 'missing', url: null });
        expect(requested(fetchImpl)).toEqual([META, REF]);
    });

    test('compare 404 while the branch exists (no shared history, base renamed) → error, URL kept, no delete', async () => {
        const fetchImpl = useFakeGitHub(cleanupRoutes({ [COMPARE]: { status: 404, body: { message: 'Not Found' } } }));
        await expect(cleanupTaskBranch(LINK, { mergedHeadSha: BRANCH_HEAD })).resolves.toEqual({ name: BRANCH, outcome: 'error', url: URL });
        expect(requested(fetchImpl)).toEqual([META, REF, COMPARE]);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('GITHUB_ERROR'));
    });

    test.each([
        ['404', { status: 404, body: { message: 'Not Found' } }],
        ['422 "Reference does not exist"', { status: 422, body: { message: 'Reference does not exist' } }],
    ])('deleted meanwhile (DELETE %s) → missing', async (_label, response) => {
        useFakeGitHub(cleanupRoutes({ [DELETE]: response }));
        await expect(cleanupTaskBranch(LINK)).resolves.toEqual({ name: BRANCH, outcome: 'missing', url: null });
    });

    test('DELETE refused for another reason (e.g. protected branch) → error, URL kept', async () => {
        useFakeGitHub(cleanupRoutes({ [DELETE]: { status: 422, body: { message: 'Cannot delete this protected branch' } } }));
        await expect(cleanupTaskBranch(LINK)).resolves.toEqual({ name: BRANCH, outcome: 'error', url: URL });
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('GITHUB_ERROR'));
    });

    // With the merged PR head equal to the branch head, only the failed check stands between the
    // branch and the delete.
    test.each([
        ['repository lookup fails', { [META]: { status: 500, body: {} } }, [META]],
        ['GitHub answers for another repository id', { [META]: { body: { id: 999, name: 'demo', owner: { login: 'octo' }, default_branch: 'main' } } }, [META]],
        ['repository without default branch', { [META]: { body: { id: 500, name: 'demo', owner: { login: 'octo' } } } }, [META]],
        ['head ref lookup fails (500)', { [REF]: { status: 500, body: {} } }, [META, REF]],
        ['head ref without a commit', { [REF]: { body: {} } }, [META, REF]],
        ['head ref with a malformed sha', { [REF]: { body: { object: { sha: 'main' } } } }, [META, REF]],
        ['compare fails (500)', { [COMPARE]: { status: 500, body: {} } }, [META, REF, COMPARE]],
        ['compare without ahead_by', { [COMPARE]: { body: { status: 'identical' } } }, [META, REF, COMPARE]],
        ['compare rate limited', { [COMPARE]: { status: 403, body: { message: 'API rate limit exceeded' }, headers: { 'x-ratelimit-remaining': '0' } } }, [META, REF, COMPARE]],
        ['open PR lookups fail', { [PULLS]: { status: 502, body: {} } }, [META, REF, COMPARE, PULLS, PULLS]],
        ['only the lookup of PRs into the branch fails', { [PULLS]: (c) => (c.query.base ? { status: 502, body: {} } : { body: [] }) }, [META, REF, COMPARE, PULLS, PULLS]],
        ['open PR lookup returns no list', { [PULLS]: { body: { message: 'odd' } } }, [META, REF, COMPARE, PULLS, PULLS]],
        ['token mint fails', { 'POST /app/installations/77/access_tokens': { status: 500, body: {} } }, []],
    ])('%s → error and NO delete', async (_label, overrides, expected) => {
        const fetchImpl = useFakeGitHub(cleanupRoutes(overrides));
        await expect(cleanupTaskBranch(LINK, { mergedHeadSha: BRANCH_HEAD })).resolves.toEqual({ name: BRANCH, outcome: 'error', url: URL });
        expect(requested(fetchImpl)).toEqual(expected);
        expect(deleteCalls(fetchImpl)).toHaveLength(0);
    });

    test('GitHub unreachable → error, no delete', async () => {
        const fetchImpl = useFakeGitHub(cleanupRoutes({ [COMPARE]: () => { throw new TypeError('fetch failed'); } }));
        await expect(cleanupTaskBranch(LINK)).resolves.toMatchObject({ outcome: 'error' });
        expect(deleteCalls(fetchImpl)).toHaveLength(0);
    });

    test('owner renamed on GitHub: the open-PR filter uses the current login, not the stored one', async () => {
        const moved = '/repos/octo-renamed/demo';
        const fetchImpl = useFakeGitHub(cleanupRoutes({
            // GitHub follows the rename; the stored login "octo" would match no PR in the head filter.
            [META]: { body: { id: 500, name: 'demo', owner: { login: 'octo-renamed' }, default_branch: 'main' } },
            [`GET ${moved}/git/ref/heads/${BRANCH}`]: { body: { object: { sha: BRANCH_HEAD } } },
            [compareOf(BRANCH_HEAD, 'main', moved)]: { body: { ahead_by: 0 } },
            [`GET ${moved}/pulls`]: (c) => ({ body: c.query.head === `octo-renamed:${BRANCH}` ? [OPEN_PR] : [] }),
            [`DELETE ${moved}/git/refs/heads/${BRANCH}`]: { status: 204 },
        }));
        await expect(cleanupTaskBranch(LINK)).resolves.toEqual({
            name: BRANCH, outcome: 'kept_open_pr', url: `https://github.com/octo-renamed/demo/tree/${BRANCH}`,
        });
        expect(pullQueries(fetchImpl, `${moved}/pulls`).map((q) => q.head).filter(Boolean)).toEqual([`octo-renamed:${BRANCH}`]);
        expect(deleteCalls(fetchImpl)).toHaveLength(0);
    });

    test('default branch changed on GitHub: rule b compares against the current one', async () => {
        const fetchImpl = useFakeGitHub(cleanupRoutes({
            [META]: { body: { id: 500, name: 'demo', owner: { login: 'octo' }, default_branch: 'trunk' } },
            // Merged into the stored "main" but not into the real default branch.
            [compareOf(BRANCH_HEAD, 'trunk')]: { body: { ahead_by: 3 } },
        }));
        await expect(cleanupTaskBranch(LINK)).resolves.toMatchObject({ outcome: 'kept_unmerged' });
        expect(requested(fetchImpl)).toContain(compareOf(BRANCH_HEAD, 'trunk'));
        expect(requested(fetchImpl)).not.toContain(COMPARE);
        expect(deleteCalls(fetchImpl)).toHaveLength(0);
    });

    test('a branch that became the default branch on GitHub → skipped, its ref never read', async () => {
        const fetchImpl = useFakeGitHub(cleanupRoutes({
            [META]: { body: { id: 500, name: 'demo', owner: { login: 'octo' }, default_branch: BRANCH } },
        }));
        await expect(cleanupTaskBranch(LINK)).resolves.toEqual({ name: BRANCH, outcome: 'skipped', url: URL });
        expect(requested(fetchImpl)).toEqual([META]);
    });

    test('the cleanup keeps a reserve of the request budget: below 6 + 20 → error without calling GitHub', async () => {
        const fetchImpl = useFakeGitHub(cleanupRoutes());
        const budget = jest.spyOn(githubApp, 'availableBudget').mockReturnValue(25);
        await expect(cleanupTaskBranch(LINK)).resolves.toEqual({ name: BRANCH, outcome: 'error', url: URL });
        expect(fetchImpl.calls).toHaveLength(0);
        expect(githubApp.availableBudget).toHaveBeenCalledWith(77);

        budget.mockReturnValue(26);
        await expect(cleanupTaskBranch(LINK)).resolves.toMatchObject({ outcome: 'deleted' });
    });

    test('the default branch itself is never touched → skipped', async () => {
        const fetchImpl = useFakeGitHub(cleanupRoutes());
        await expect(cleanupTaskBranch({ ...LINK, branchName: 'main' }))
            .resolves.toEqual({ name: 'main', outcome: 'skipped', url: 'https://github.com/octo/demo/tree/main' });
        expect(fetchImpl.calls).toHaveLength(0);
    });

    test('group now linked to another repository → skipped, URL of the branch\'s own repository', async () => {
        const fetchImpl = useFakeGitHub(cleanupRoutes());
        githubModel.getGroupRepository.mockResolvedValue({ ...REPO, repoId: 999, name: 'other' });
        await expect(cleanupTaskBranch(LINK)).resolves.toEqual({ name: BRANCH, outcome: 'skipped', url: URL });
        expect(fetchImpl.calls).toHaveLength(0);
    });

    test('group without a repository, or a suspended installation → skipped', async () => {
        const fetchImpl = useFakeGitHub(cleanupRoutes());
        githubModel.getGroupRepository.mockResolvedValueOnce(null);
        await expect(cleanupTaskBranch(LINK)).resolves.toMatchObject({ outcome: 'skipped', url: URL });
        githubModel.getGroupRepository.mockResolvedValueOnce({ ...REPO, suspendedAt: new Date() });
        await expect(cleanupTaskBranch(LINK)).resolves.toMatchObject({ outcome: 'skipped', url: URL });
        expect(fetchImpl.calls).toHaveLength(0);
    });

    test('integration not configured (no App credentials) → skipped', async () => {
        const fetchImpl = useFakeGitHub(cleanupRoutes());
        const saved = { id: process.env.GITHUB_APP_ID, key: process.env.GITHUB_APP_PRIVATE_KEY };
        delete process.env.GITHUB_APP_ID;
        delete process.env.GITHUB_APP_PRIVATE_KEY;
        githubApp.options = {};
        try {
            await expect(cleanupTaskBranch(LINK)).resolves.toEqual({ name: BRANCH, outcome: 'skipped', url: URL });
        } finally {
            if (saved.id !== undefined) process.env.GITHUB_APP_ID = saved.id;
            if (saved.key !== undefined) process.env.GITHUB_APP_PRIVATE_KEY = saved.key;
        }
        expect(fetchImpl.calls).toHaveLength(0);
    });

    test('a DB failure while checking the repository link → error; never rejects, even without a link', async () => {
        useFakeGitHub(cleanupRoutes());
        githubModel.getGroupRepository.mockRejectedValue(new Error('db down'));
        await expect(cleanupTaskBranch(LINK)).resolves.toEqual({ name: BRANCH, outcome: 'error', url: URL });
        await expect(cleanupTaskBranch(null)).resolves.toEqual({ name: null, outcome: 'skipped', url: null });
    });

    describe('cleanupBranchesWithin (HTTP handlers)', () => {
        const OTHER = 'tm/otra-tarea-12345678';
        const OTHER_HEAD = 'e'.repeat(40);
        const otherRoutes = {
            [`GET /repos/octo/demo/git/ref/heads/${OTHER}`]: { body: { object: { sha: OTHER_HEAD } } },
            [compareOf(OTHER_HEAD)]: { body: { ahead_by: 5 } },
        };

        test('no links → [] without touching GitHub', async () => {
            const fetchImpl = useFakeGitHub(cleanupRoutes());
            await expect(cleanupBranchesWithin([])).resolves.toEqual([]);
            await expect(cleanupBranchesWithin(undefined)).resolves.toEqual([]);
            expect(fetchImpl.calls).toHaveLength(0);
            expect(githubModel.getGroupRepository).not.toHaveBeenCalled();
        });

        test('one result per link, in order', async () => {
            useFakeGitHub(cleanupRoutes(otherRoutes));
            await expect(cleanupBranchesWithin([LINK, { ...LINK, branchName: OTHER }])).resolves.toEqual([
                { name: BRANCH, outcome: 'deleted', url: null },
                { name: OTHER, outcome: 'kept_unmerged', url: `https://github.com/octo/demo/tree/${OTHER}` },
            ]);
        });

        test('still running at the deadline → answered as error; it finishes in the background and logs the outcome', async () => {
            const gate = deferred();
            const fetchImpl = useFakeGitHub(cleanupRoutes({
                ...otherRoutes,
                [COMPARE]: async () => { await gate.promise; return { body: { ahead_by: 0 } }; },
            }));
            const results = await cleanupBranchesWithin([LINK, { ...LINK, branchName: OTHER }], { waitMs: 30 });
            expect(results).toEqual([
                { name: BRANCH, outcome: 'error', url: URL },
                { name: OTHER, outcome: 'kept_unmerged', url: `https://github.com/octo/demo/tree/${OTHER}` },
            ]);
            expect(deleteCalls(fetchImpl)).toHaveLength(0);

            gate.resolve();
            await flush();
            expect(deleteCalls(fetchImpl)).toHaveLength(1);
            expect(console.log).toHaveBeenCalledWith(`GitHub branch cleanup of ${BRANCH} (task ${TID}) after the response: deleted`);
        });

        test(`waits ${CLEANUP_WAIT_MS} ms by default`, async () => {
            const gate = deferred();
            useFakeGitHub(cleanupRoutes({ [REF]: async () => { await gate.promise; return { status: 404, body: {} }; } }));
            jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
            try {
                let answered = null;
                const pending = cleanupBranchesWithin([LINK]).then((r) => { answered = r; });
                await jest.advanceTimersByTimeAsync(CLEANUP_WAIT_MS - 1);
                expect(answered).toBeNull();
                await jest.advanceTimersByTimeAsync(1);
                await pending;
                expect(answered).toEqual([{ name: BRANCH, outcome: 'error', url: URL }]);
            } finally {
                jest.useRealTimers();
            }
            gate.resolve();
            await flush();
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining('after the response: missing'));
        });

        test('a list is cleaned up at most 3 branches at a time', async () => {
            const gates = [];
            let inFlight = 0;
            let maxInFlight = 0;
            const names = [0, 1, 2, 3, 4].map((i) => `tm/t${i}-0000000${i}`);
            const routes = cleanupRoutes({ [COMPARE]: { body: { ahead_by: 1 } } });
            names.forEach((name) => {
                routes[`GET /repos/octo/demo/git/ref/heads/${name}`] = async () => {
                    inFlight += 1;
                    maxInFlight = Math.max(maxInFlight, inFlight);
                    const gate = deferred();
                    gates.push(gate);
                    await gate.promise;
                    inFlight -= 1;
                    return { body: { object: { sha: BRANCH_HEAD } } };
                };
            });
            useFakeGitHub(routes);
            const pending = cleanupBranchesWithin(names.map((branchName) => ({ ...LINK, branchName })));
            await flush();
            expect(gates).toHaveLength(3);
            gates[0].resolve();
            await flush();
            expect(gates).toHaveLength(4);
            gates.slice(1).forEach((g) => g.resolve());
            await flush();
            gates.forEach((g) => g.resolve());
            const results = await pending;
            expect(results.map((r) => r.outcome)).toEqual(['kept_unmerged', 'kept_unmerged', 'kept_unmerged', 'kept_unmerged', 'kept_unmerged']);
            expect(maxInFlight).toBe(3);
        });
    });

    test('cleanupTaskBranchInBackground returns at once, passes the merged head and logs the outcome', async () => {
        const fetchImpl = useFakeGitHub(cleanupRoutes({ [COMPARE]: { body: { ahead_by: 2 } } }));
        expect(cleanupTaskBranchInBackground(LINK, { mergedHeadSha: BRANCH_HEAD })).toBeUndefined();
        expect(fetchImpl.calls).toHaveLength(0);
        await flush();
        expect(deleteCalls(fetchImpl)).toHaveLength(1);
        expect(console.log).toHaveBeenCalledWith(`GitHub branch cleanup of ${BRANCH} (task ${TID}): deleted`);

        cleanupTaskBranchInBackground(null);
        cleanupTaskBranchInBackground({ ...LINK, branchName: null });
        await flush();
        expect(githubModel.getGroupRepository).toHaveBeenCalledTimes(1);
    });
});

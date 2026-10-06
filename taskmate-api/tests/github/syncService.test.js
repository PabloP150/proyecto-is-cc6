jest.mock('../../models/github.model', () => ({
    getGroupRepository: jest.fn(),
    getTaskLinksByGroup: jest.fn(),
    upsertRepository: jest.fn(),
    applyPullRequest: jest.fn(),
    findTaskByBranch: jest.fn(),
}));
jest.mock('../../helpers/transaction', () => ({ withTransaction: jest.fn(), isFkViolation: jest.fn() }));
jest.mock('../../models/tasks.model', () => ({ completeTask: jest.fn() }));
jest.mock('../../services/AnalyticsIntegration', () => ({ onTaskCompletion: jest.fn() }));

const githubModel = require('../../models/github.model');
const transaction = require('../../helpers/transaction');
const tasksModel = require('../../models/tasks.model');
const AnalyticsIntegration = require('../../services/AnalyticsIntegration');
const { githubApp } = require('../../services/github/githubApp');
const { syncGroup } = require('../../services/github/syncService');
const { useFakeGitHub, tokenRoute, REPO } = require('./helpers/fakeGitHub');

const TX = { id: 'tx' };
const pr = (overrides = {}) => ({
    id: 1, number: 3, title: 'x', draft: false,
    head: { ref: 'tm/a-11111111', sha: 'e'.repeat(40), repo: { id: 500 } },
    base: { ref: 'main' },
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-02T00:00:00Z',
    closed_at: '2026-09-02T00:00:00Z', merged_at: '2026-09-02T00:00:00Z',
    ...overrides,
});

beforeEach(() => {
    transaction.withTransaction.mockImplementation(async (fn) => fn(TX));
    githubModel.getGroupRepository.mockResolvedValue({ ...REPO });
    githubModel.getTaskLinksByGroup.mockResolvedValue([
        { tid: 'T1', branchName: 'tm/a-11111111', pr: null },
        { tid: 'T2', branchName: 'tm/b-22222222', pr: null },
    ]);
    githubModel.applyPullRequest.mockResolvedValue({ state: 'merged', changed: true, becameMerged: true });
    githubModel.findTaskByBranch.mockResolvedValue({ tid: 'T1', gid: REPO.gid });
    tasksModel.completeTask.mockResolvedValue({ status: 'completed' });
    AnalyticsIntegration.onTaskCompletion.mockResolvedValue({ success: true });
});

test('queries pulls per task branch with owner:branch and applies them like the webhook', async () => {
    const fetchImpl = useFakeGitHub({
        'POST /app/installations/77/access_tokens': tokenRoute('ghs_sync'),
        'GET /repos/octo/demo': { body: { id: 500, name: 'demo', default_branch: 'main', private: false } },
        'GET /repos/octo/demo/pulls': (call) => ({ body: call.query.head === 'octo:tm/a-11111111' ? [pr(), pr({ id: 2, head: { ref: 'tm/a-11111111', repo: { id: 999 } } })] : [] }),
    });
    const result = await syncGroup(REPO.gid);
    expect(result).toEqual({ branchesChecked: 2, pullRequestsFound: 1, updated: 1 });
    const pulls = fetchImpl.calls.filter((c) => c.path === '/repos/octo/demo/pulls');
    expect(pulls.map((c) => c.query.head)).toEqual(['octo:tm/a-11111111', 'octo:tm/b-22222222']);
    expect(pulls[0].query.state).toBe('all');
    expect(githubModel.applyPullRequest).toHaveBeenCalledTimes(1);
    expect(tasksModel.completeTask).toHaveBeenCalledWith('T1', { tx: TX, source: 'github_pr' });
    expect(githubModel.upsertRepository).not.toHaveBeenCalled();
    await new Promise((r) => setImmediate(r));
    expect(AnalyticsIntegration.onTaskCompletion).toHaveBeenCalledWith('T1', true, { percentage: 100 });
});

test('cost is capped by the installation budget and branches that can still change go first', async () => {
    const fetchImpl = useFakeGitHub({
        'POST /app/installations/77/access_tokens': tokenRoute('ghs_sync'),
        'GET /repos/octo/demo': { body: { id: 500, name: 'demo', default_branch: 'main' } },
        'GET /repos/octo/demo/pulls': { body: [] },
    });
    githubModel.getTaskLinksByGroup.mockResolvedValue([
        { tid: 'T1', branchName: 'tm/closed-1', pr: { state: 'closed' } },
        { tid: 'T2', branchName: 'tm/open-2', pr: { state: 'open' } },
        { tid: 'T3', branchName: 'tm/none-3', pr: null },
    ]);
    jest.spyOn(githubApp, 'availableBudget').mockReturnValue(22);
    const result = await syncGroup(REPO.gid);
    expect(result).toEqual({ branchesChecked: 2, pullRequestsFound: 0, updated: 0 });
    const heads = fetchImpl.calls.filter((c) => c.path === '/repos/octo/demo/pulls').map((c) => c.query.head);
    expect(heads).toEqual(['octo:tm/open-2', 'octo:tm/none-3']);
});

test('never checks more than 30 branches per sync', async () => {
    useFakeGitHub({
        'POST /app/installations/77/access_tokens': tokenRoute('ghs_sync'),
        'GET /repos/octo/demo': { body: { id: 500, name: 'demo', default_branch: 'main' } },
        'GET /repos/octo/demo/pulls': { body: [] },
    });
    githubModel.getTaskLinksByGroup.mockResolvedValue(Array.from({ length: 45 }, (_, i) => ({ tid: `T${i}`, branchName: `tm/b-${i}`, pr: null })));
    const result = await syncGroup(REPO.gid);
    expect(result.branchesChecked).toBe(30);
});

test('refreshes a changed default branch before deciding completions', async () => {
    useFakeGitHub({
        'POST /app/installations/77/access_tokens': tokenRoute('ghs_sync'),
        'GET /repos/octo/demo': { body: { id: 500, name: 'demo', default_branch: 'trunk', private: false } },
        'GET /repos/octo/demo/pulls': { body: [pr()] },
    });
    githubModel.getTaskLinksByGroup.mockResolvedValue([{ tid: 'T1', branchName: 'tm/a-11111111', pr: null }]);
    await syncGroup(REPO.gid);
    expect(githubModel.upsertRepository).toHaveBeenCalledWith(expect.objectContaining({ repoId: 500, defaultBranch: 'trunk' }));
    expect(tasksModel.completeTask).not.toHaveBeenCalled();
});

test('no connected repository → REPO_NOT_CONNECTED', async () => {
    useFakeGitHub({});
    githubModel.getGroupRepository.mockResolvedValue(null);
    await expect(syncGroup(REPO.gid)).rejects.toMatchObject({ code: 'REPO_NOT_CONNECTED' });
});

describe('branch cleanup of the tasks the sync completes', () => {
    const BRANCH = 'tm/a-11111111';
    const LINK = { tid: 'T1', gid: REPO.gid, repoId: 500, owner: 'octo', repoName: 'demo', branchName: BRANCH, baseSha: 'a'.repeat(40) };
    const flush = async (rounds = 10) => {
        for (let i = 0; i < rounds; i += 1) await new Promise((r) => setImmediate(r));
    };
    const HEAD_SHA = 'e'.repeat(40);
    const META = { id: 500, name: 'demo', owner: { login: 'octo' }, default_branch: 'main' };
    const syncRoutes = (compare) => ({
        'POST /app/installations/77/access_tokens': tokenRoute('ghs_sync'),
        'GET /repos/octo/demo': { body: META },
        // The sync asks for every PR of a branch; the cleanup only for open ones.
        'GET /repos/octo/demo/pulls': (call) => ({ body: call.query.state === 'open' || call.query.head !== `octo:${BRANCH}` ? [] : [pr()] }),
        [`GET /repos/octo/demo/git/ref/heads/${BRANCH}`]: { body: { object: { sha: HEAD_SHA } } },
        [`GET /repos/octo/demo/compare/main...${HEAD_SHA}`]: compare,
        [`DELETE /repos/octo/demo/git/refs/heads/${BRANCH}`]: { status: 204 },
    });
    const cleanupLog = () => console.log.mock.calls.map(([line]) => line).filter((line) => String(line).startsWith('GitHub branch cleanup'));

    beforeEach(() => {
        githubModel.getTaskLinksByGroup.mockResolvedValue([{ tid: 'T1', branchName: BRANCH, pr: null }]);
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    test('runs in the background with the merged PR head; the sync result does not wait for it', async () => {
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const fetchImpl = useFakeGitHub(syncRoutes(async () => { await gate; return { body: { ahead_by: 1 } }; }));
        tasksModel.completeTask.mockResolvedValue({ status: 'completed', branch: LINK });

        await expect(syncGroup(REPO.gid)).resolves.toEqual({ branchesChecked: 1, pullRequestsFound: 1, updated: 1 });
        expect(fetchImpl.calls.some((c) => c.method === 'DELETE')).toBe(false);

        release();
        await flush();
        expect(fetchImpl.calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual([`/repos/octo/demo/git/refs/heads/${BRANCH}`]);
        expect(console.log).toHaveBeenCalledWith(`GitHub branch cleanup of ${BRANCH} (task T1): deleted`);
    });

    test('near the budget limit the sync still resolves: cleanups that would dip into the reserve report error', async () => {
        const branches = ['tm/a-11111111', 'tm/b-22222222', 'tm/c-33333333'];
        const tidOf = (branchName) => `T${branches.indexOf(branchName) + 1}`;
        githubModel.getTaskLinksByGroup.mockResolvedValue(branches.map((branchName) => ({ tid: tidOf(branchName), branchName, pr: null })));
        githubModel.findTaskByBranch.mockImplementation(async (_repoId, branchName) => ({ tid: tidOf(branchName), gid: REPO.gid }));
        tasksModel.completeTask.mockImplementation(async (tid) => ({
            status: 'completed', branch: { ...LINK, tid, branchName: branches[Number(tid.slice(1)) - 1] },
        }));
        const routes = {
            'POST /app/installations/77/access_tokens': tokenRoute('ghs_sync'),
            'GET /repos/octo/demo': { body: META },
            'GET /repos/octo/demo/pulls': (call) => {
                if (call.query.state === 'open') return { body: [] };
                const ref = call.query.head.split(':')[1];
                return { body: [pr({ id: branches.indexOf(ref) + 1, head: { ref, sha: HEAD_SHA, repo: { id: 500 } } })] };
            },
            [`GET /repos/octo/demo/compare/main...${HEAD_SHA}`]: { body: { ahead_by: 0 } },
        };
        branches.forEach((name) => {
            routes[`GET /repos/octo/demo/git/ref/heads/${name}`] = { body: { object: { sha: HEAD_SHA } } };
            routes[`DELETE /repos/octo/demo/git/refs/heads/${name}`] = { status: 204 };
        });
        const fetchImpl = useFakeGitHub(routes);
        // 26 requests: the sync spends 4 (repository + 3 branches), leaving its reserve of 20 plus 2,
        // fewer than one cleanup (6) needs on top of the reserve.
        githubApp.options.hourlyBudget = 26;

        await expect(syncGroup(REPO.gid)).resolves.toEqual({ branchesChecked: 3, pullRequestsFound: 3, updated: 3 });
        await flush();
        expect(cleanupLog().sort()).toEqual(branches.map((name) => `GitHub branch cleanup of ${name} (task ${tidOf(name)}): error`));
        expect(fetchImpl.calls.some((c) => c.method === 'DELETE')).toBe(false);
        expect(githubApp.availableBudget(77)).toBeGreaterThanOrEqual(20);
    });

    test('nothing to clean up when the task was already completed', async () => {
        const fetchImpl = useFakeGitHub(syncRoutes({ body: { ahead_by: 0 } }));
        tasksModel.completeTask.mockResolvedValue({ status: 'already_completed' });
        await syncGroup(REPO.gid);
        await flush();
        expect(fetchImpl.calls.some((c) => c.path.includes('/compare/') || c.method === 'DELETE')).toBe(false);
    });
});

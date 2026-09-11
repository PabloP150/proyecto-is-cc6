jest.mock('../../models/github.model', () => ({
    getGroupRepository: jest.fn(),
    getTaskLinksByGroup: jest.fn(),
    upsertRepository: jest.fn(),
    applyPullRequest: jest.fn(),
    findTaskByBranch: jest.fn(),
}), { virtual: true });
jest.mock('../../helpers/transaction', () => ({ withTransaction: jest.fn(), isFkViolation: jest.fn() }), { virtual: true });
jest.mock('../../models/tasks.model', () => ({ completeTask: jest.fn() }));

const githubModel = require('../../models/github.model');
const transaction = require('../../helpers/transaction');
const tasksModel = require('../../models/tasks.model');
const { syncGroup } = require('../../services/github/syncService');
const { useFakeGitHub, tokenRoute, REPO } = require('./helpers/fakeGitHub');

const TX = { id: 'tx' };
const pr = (overrides = {}) => ({
    id: 1, number: 3, title: 'x', draft: false,
    head: { ref: 'tm/a-11111111', repo: { id: 500 } },
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
});

test('queries pulls per task branch with owner:branch and applies them like the webhook', async () => {
    const fetchImpl = useFakeGitHub({
        'POST /app/installations/77/access_tokens': tokenRoute('ghs_sync'),
        'GET /repos/octo/demo': { body: { id: 500, name: 'demo', default_branch: 'main', private: false } },
        'GET /repos/octo/demo/pulls': (call) => ({ body: call.query.head === 'octo:tm/a-11111111' ? [pr(), pr({ id: 2, head: { ref: 'tm/a-11111111', repo: { id: 999 } } })] : [] }),
    });
    const result = await syncGroup(REPO.gid);
    expect(result).toEqual({ checked: 2, updated: 1 });
    const pulls = fetchImpl.calls.filter((c) => c.path === '/repos/octo/demo/pulls');
    expect(pulls.map((c) => c.query.head)).toEqual(['octo:tm/a-11111111', 'octo:tm/b-22222222']);
    expect(pulls[0].query.state).toBe('all');
    expect(githubModel.applyPullRequest).toHaveBeenCalledTimes(1);
    expect(tasksModel.completeTask).toHaveBeenCalledWith('T1', { tx: TX, source: 'github_pr' });
    expect(githubModel.upsertRepository).not.toHaveBeenCalled();
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

// GitHub branch cleanup when a task leaves the board through the tasks API (complete, trash,
// delete list). GitHub is faked at the HTTP level. The handlers' 5 s wait is shortened here so the
// slow case runs fast; the default itself is covered in tests/github/branchService.test.js.
jest.mock('../../models/github.model', () => ({ getGroupRepository: jest.fn() }));
jest.mock('../../services/github/branchService', () => {
    const actual = jest.requireActual('../../services/github/branchService');
    return { ...actual, cleanupBranchesWithin: (links) => actual.cleanupBranchesWithin(links, { waitMs: 100 }) };
});

const { ids, registerMocks, applyDefaults, bearer } = require('./support/mocks');

registerMocks();

const request = require('supertest');
const app = require('../../app');
const githubModel = require('../../models/github.model');
const { useFakeGitHub, tokenRoute, REPO } = require('../github/helpers/fakeGitHub');

const { BOB, GROUP_A, TASK_A, DONE_A } = ids;

const BRANCH = 'tm/login-a0000000';
const OTHER = 'tm/signup-b0000000';
const URL_OF = (name) => `https://github.com/octo/demo/tree/${name}`;
const link = (branchName, tid = TASK_A) => ({ tid, gid: GROUP_A, repoId: 500, owner: 'octo', repoName: 'demo', branchName, baseSha: 'a'.repeat(40) });
// Each branch's head commit: the cleanup reads it from refs/heads and compares by sha.
const HEADS = { [BRANCH]: 'b'.repeat(40), [OTHER]: 'c'.repeat(40) };
const headRef = (name) => `GET /repos/octo/demo/git/ref/heads/${name}`;
const compare = (name) => `GET /repos/octo/demo/compare/main...${HEADS[name]}`;
const remove = (name) => `DELETE /repos/octo/demo/git/refs/heads/${name}`;

// BRANCH is fully merged into main; OTHER has commits of its own.
const routes = (overrides = {}) => ({
    'POST /app/installations/77/access_tokens': tokenRoute('ghs_cleanup'),
    'GET /repos/octo/demo': { body: { id: 500, name: 'demo', owner: { login: 'octo' }, default_branch: 'main' } },
    [headRef(BRANCH)]: { body: { object: { sha: HEADS[BRANCH] } } },
    [headRef(OTHER)]: { body: { object: { sha: HEADS[OTHER] } } },
    [compare(BRANCH)]: { body: { ahead_by: 0 } },
    [compare(OTHER)]: { body: { ahead_by: 3 } },
    'GET /repos/octo/demo/pulls': { body: [] },
    [remove(BRANCH)]: { status: 204 },
    [remove(OTHER)]: { status: 204 },
    ...overrides,
});
const deletes = (fetchImpl) => fetchImpl.calls.filter((c) => c.method === 'DELETE').map((c) => c.path);
const flush = async (rounds = 10) => {
    for (let i = 0; i < rounds; i += 1) await new Promise((r) => setImmediate(r));
};

let m;
beforeEach(() => {
    m = applyDefaults();
    githubModel.getGroupRepository.mockResolvedValue({ ...REPO, gid: GROUP_A });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

const post = (path) => request(app).post(path).set(bearer(BOB));

describe('POST /api/tasks/:tid/complete', () => {
    test('a merged branch is deleted and reported without URL', async () => {
        const fetchImpl = useFakeGitHub(routes());
        m.tasks.completeTask.mockResolvedValue({ status: 'completed', task: {}, branch: link(BRANCH) });
        const res = await post(`/api/tasks/${TASK_A}/complete`);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ data: { tid: TASK_A, status: 'completed', branch: { name: BRANCH, outcome: 'deleted', url: null } } });
        expect(deletes(fetchImpl)).toEqual([`/repos/octo/demo/git/refs/heads/${BRANCH}`]);
        expect(m.integration.onTaskCompletion).toHaveBeenCalledWith(TASK_A, true, expect.any(Object));
    });

    test('a branch with unmerged commits is kept and reported with its URL', async () => {
        const fetchImpl = useFakeGitHub(routes());
        m.tasks.completeTask.mockResolvedValue({ status: 'completed', branch: link(OTHER) });
        const res = await post(`/api/tasks/${TASK_A}/complete`);
        expect(res.body.data.branch).toEqual({ name: OTHER, outcome: 'kept_unmerged', url: URL_OF(OTHER) });
        expect(deletes(fetchImpl)).toEqual([]);
    });

    test('no branch → no `branch` field and no GitHub call', async () => {
        const fetchImpl = useFakeGitHub(routes());
        m.tasks.completeTask.mockResolvedValue({ status: 'completed', branch: null });
        const res = await post(`/api/tasks/${TASK_A}/complete`);
        expect(res.body).toEqual({ data: { tid: TASK_A, status: 'completed' } });
        expect(fetchImpl.calls).toHaveLength(0);
    });

    test('already_completed never reports nor touches a branch', async () => {
        const fetchImpl = useFakeGitHub(routes());
        m.tasks.completeTask.mockResolvedValue({ status: 'already_completed', branch: link(BRANCH, DONE_A) });
        const res = await post(`/api/tasks/${DONE_A}/complete`);
        expect(res.body).toEqual({ data: { tid: DONE_A, status: 'already_completed' } });
        expect(fetchImpl.calls).toHaveLength(0);
    });

    test('a failing GitHub check still completes the task: 200 with outcome error', async () => {
        const fetchImpl = useFakeGitHub(routes({ [compare(BRANCH)]: { status: 500, body: {} } }));
        m.tasks.completeTask.mockResolvedValue({ status: 'completed', branch: link(BRANCH) });
        const res = await post(`/api/tasks/${TASK_A}/complete`);
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ tid: TASK_A, status: 'completed', branch: { name: BRANCH, outcome: 'error', url: URL_OF(BRANCH) } });
        expect(deletes(fetchImpl)).toEqual([]);
    });

    test('bounded wait: a slow GitHub is answered as error, the cleanup finishes afterwards and is logged', async () => {
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const fetchImpl = useFakeGitHub(routes({ [compare(BRANCH)]: async () => { await gate; return { body: { ahead_by: 0 } }; } }));
        m.tasks.completeTask.mockResolvedValue({ status: 'completed', branch: link(BRANCH) });

        const started = Date.now();
        const res = await post(`/api/tasks/${TASK_A}/complete`);
        expect(Date.now() - started).toBeLessThan(2000);
        expect(res.status).toBe(200);
        expect(res.body.data.branch).toEqual({ name: BRANCH, outcome: 'error', url: URL_OF(BRANCH) });
        expect(deletes(fetchImpl)).toEqual([]);

        release();
        await flush();
        expect(deletes(fetchImpl)).toEqual([`/repos/octo/demo/git/refs/heads/${BRANCH}`]);
        expect(console.log).toHaveBeenCalledWith(`GitHub branch cleanup of ${BRANCH} (task ${TASK_A}) after the response: deleted`);
    });
});

describe('POST /api/tasks/:tid/trash', () => {
    test('keeps the current fields and adds the branch outcome (open PR → kept)', async () => {
        const fetchImpl = useFakeGitHub(routes({ 'GET /repos/octo/demo/pulls': (c) => ({ body: c.query.head ? [{ number: 4, state: 'open' }] : [] }) }));
        m.tasks.trashTask.mockResolvedValue({ status: 'deleted', task: {}, branch: link(BRANCH) });
        const res = await post(`/api/tasks/${TASK_A}/trash`);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ data: { tid: TASK_A, status: 'deleted', branch: { name: BRANCH, outcome: 'kept_open_pr', url: URL_OF(BRANCH) } } });
        expect(deletes(fetchImpl)).toEqual([]);
        expect(m.integration.onTaskDeletion).toHaveBeenCalledWith(TASK_A);
    });

    test('branch already gone on GitHub → missing without URL', async () => {
        useFakeGitHub(routes({ [headRef(BRANCH)]: { status: 404, body: { message: 'Not Found' } } }));
        m.tasks.trashTask.mockResolvedValue({ status: 'deleted', task: {}, branch: link(BRANCH) });
        const res = await post(`/api/tasks/${TASK_A}/trash`);
        expect(res.body.data.branch).toEqual({ name: BRANCH, outcome: 'missing', url: null });
    });

    test('no branch → response unchanged', async () => {
        const fetchImpl = useFakeGitHub(routes());
        const res = await post(`/api/tasks/${TASK_A}/trash`);
        expect(res.body).toEqual({ data: { tid: TASK_A, status: 'deleted' } });
        expect(fetchImpl.calls).toHaveLength(0);
    });
});

describe('DELETE /api/tasks/list/:gid/:list', () => {
    test('keeps the message and adds one entry per branch, in order', async () => {
        const fetchImpl = useFakeGitHub(routes());
        m.tasks.deleteTasksByList.mockResolvedValue({ rowCount: 3, branches: [link(BRANCH), link(OTHER)] });
        const res = await request(app).delete(`/api/tasks/list/${GROUP_A}/L`).set(bearer(BOB));
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            message: 'Lista eliminada exitosamente',
            branches: [
                { name: BRANCH, outcome: 'deleted', url: null },
                { name: OTHER, outcome: 'kept_unmerged', url: URL_OF(OTHER) },
            ],
        });
        expect(m.tasks.deleteTasksByList).toHaveBeenCalledWith(GROUP_A, 'L');
        expect(deletes(fetchImpl)).toEqual([`/repos/octo/demo/git/refs/heads/${BRANCH}`]);
    });

    test('no branches → empty array', async () => {
        const fetchImpl = useFakeGitHub(routes());
        const res = await request(app).delete(`/api/tasks/list/${GROUP_A}/L`).set(bearer(BOB));
        expect(res.body).toEqual({ message: 'Lista eliminada exitosamente', branches: [] });
        expect(fetchImpl.calls).toHaveLength(0);
    });

    test('the group switched repositories after the delete → skipped, nothing touched', async () => {
        const fetchImpl = useFakeGitHub(routes());
        githubModel.getGroupRepository.mockResolvedValue({ ...REPO, gid: GROUP_A, repoId: 900, name: 'nuevo' });
        m.tasks.deleteTasksByList.mockResolvedValue({ rowCount: 1, branches: [link(BRANCH)] });
        const res = await request(app).delete(`/api/tasks/list/${GROUP_A}/L`).set(bearer(BOB));
        expect(res.body.branches).toEqual([{ name: BRANCH, outcome: 'skipped', url: URL_OF(BRANCH) }]);
        expect(fetchImpl.calls).toHaveLength(0);
    });
});

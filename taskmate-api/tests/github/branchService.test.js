jest.mock('../../models/github.model', () => ({
    getGroupRepository: jest.fn(),
    getTaskBranch: jest.fn(),
    insertTaskBranch: jest.fn(),
    findTaskByBranch: jest.fn(),
}), { virtual: true });
jest.mock('../../models/tasks.model', () => ({ getTask: jest.fn() }));

const githubModel = require('../../models/github.model');
const tasksModel = require('../../models/tasks.model');
const { AppError } = require('../../helpers/errors');
const { createTaskBranch } = require('../../services/github/branchService');
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

import { apiFetch } from '../../../api/client';
import * as github from '../../../api/github';

jest.mock('../../../api/client', () => ({ apiFetch: jest.fn() }));

const GID = 'AAAA-1111';

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ data: { ok: true } });
});

const lastCall = () => apiFetch.mock.calls[apiFetch.mock.calls.length - 1];

describe('api/github', () => {
  it.each([
    ['install', () => github.install(GID), 'POST', `/api/github/groups/${GID}/install`],
    ['getSelection', () => github.getSelection('sel 1'), 'GET', '/api/github/selections/sel%201'],
    ['getRepository', () => github.getRepository(GID), 'GET', `/api/github/groups/${GID}/repository`],
    ['unlinkRepository', () => github.unlinkRepository(GID), 'DELETE', `/api/github/groups/${GID}/repository`],
    ['getTree', () => github.getTree(GID, { ref: 'main' }), 'GET', `/api/github/groups/${GID}/tree?ref=main`],
    ['getTree without ref', () => github.getTree(GID), 'GET', `/api/github/groups/${GID}/tree`],
    [
      'getFile',
      () => github.getFile(GID, 'src/a b.js', { ref: 'dev' }),
      'GET',
      `/api/github/groups/${GID}/file?path=src%2Fa+b.js&ref=dev`,
    ],
    ['getReadme', () => github.getReadme(GID), 'GET', `/api/github/groups/${GID}/readme`],
    ['getCommits', () => github.getCommits(GID, { perPage: 30 }), 'GET', `/api/github/groups/${GID}/commits?perPage=30`],
    ['createTaskBranch', () => github.createTaskBranch('T-1'), 'POST', '/api/github/tasks/T-1/branch'],
    ['getTaskLinks', () => github.getTaskLinks(GID), 'GET', `/api/github/groups/${GID}/task-links`],
    ['syncGroup', () => github.syncGroup(GID), 'POST', `/api/github/groups/${GID}/sync`],
  ])('%s calls the right endpoint and returns data', async (_name, call, method, path) => {
    await expect(call()).resolves.toEqual({ ok: true });
    const [calledPath, options] = lastCall();
    expect(calledPath).toBe(path);
    expect(options.method).toBe(method);
  });

  it('linkRepository posts selectionId and repoId', async () => {
    await github.linkRepository(GID, { selectionId: 'sel', repoId: 42 });
    const [path, options] = lastCall();
    expect(path).toBe(`/api/github/groups/${GID}/repository`);
    expect(options).toMatchObject({ method: 'POST', body: { selectionId: 'sel', repoId: 42 } });
  });

  it('returns null for 204 responses and a null repository', async () => {
    apiFetch.mockResolvedValueOnce(null);
    await expect(github.unlinkRepository(GID)).resolves.toBeNull();
    apiFetch.mockResolvedValueOnce({ data: null });
    await expect(github.getRepository(GID)).resolves.toBeNull();
  });

  it('forwards the abort signal and propagates errors', async () => {
    const controller = new AbortController();
    const error = Object.assign(new Error('x'), { code: 'NOT_GROUP_MEMBER', status: 403 });
    apiFetch.mockRejectedValueOnce(error);
    await expect(github.getTree(GID, { signal: controller.signal })).rejects.toBe(error);
    expect(lastCall()[1].signal).toBe(controller.signal);
  });
});

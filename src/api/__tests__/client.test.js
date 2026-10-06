import { API_BASE } from '../../config';
import { api, apiFetch, ApiError, RATE_LIMIT_MESSAGE, UNAUTHORIZED_EVENT } from '../client';

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: () => Promise.resolve(body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)),
});

describe('api client', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('adds the Bearer token from localStorage and parses JSON', async () => {
    localStorage.setItem('token', 'jwt-123');
    global.fetch.mockResolvedValue(response(200, { data: [{ tid: 't1' }] }));

    const data = await api.get('/api/tasks?gid=g1');

    expect(data).toEqual({ data: [{ tid: 't1' }] });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe(`${API_BASE}/api/tasks?gid=g1`);
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer jwt-123');
  });

  it('falls back to the token stored inside the user object', async () => {
    localStorage.setItem('user', JSON.stringify({ uid: 'u1', name: 'ana', token: 'jwt-user' }));
    global.fetch.mockResolvedValue(response(200, {}));

    await api.get('/api/groups/user-groups');

    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer jwt-user');
  });

  it('sends plain-object bodies as JSON', async () => {
    global.fetch.mockResolvedValue(response(201, { data: { tid: 't9' } }));

    await api.post('/api/tasks', { name: 'Tarea' });

    const [, init] = global.fetch.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ name: 'Tarea' }));
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('supports DELETE with a body', async () => {
    global.fetch.mockResolvedValue(response(200, { message: 'ok' }));

    await api.del('/api/groups/leave', { body: { gid: 'g1' } });

    const [, init] = global.fetch.mock.calls[0];
    expect(init.method).toBe('DELETE');
    expect(init.body).toBe(JSON.stringify({ gid: 'g1' }));
  });

  it('returns null for 204 and empty bodies', async () => {
    global.fetch.mockResolvedValueOnce(response(204));
    await expect(api.del('/api/github/groups/g1/repository')).resolves.toBeNull();

    global.fetch.mockResolvedValueOnce(response(200, ''));
    await expect(api.get('/api/x')).resolves.toBeNull();
  });

  it('throws ApiError with status, code and message from the error envelope', async () => {
    global.fetch.mockResolvedValue(response(404, { success: false, error: 'Task not found', code: 'TASK_NOT_FOUND' }));

    const err = await api.post('/api/tasks/t1/complete').catch(e => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, code: 'TASK_NOT_FOUND', message: 'Task not found' });
  });

  it('uses a friendly message for rate limiting', async () => {
    global.fetch.mockResolvedValue(response(429, { success: false, error: 'Too many requests', code: 'RATE_LIMITED' }));

    const err = await api.get('/api/tasks').catch(e => e);

    expect(err).toMatchObject({ status: 429, code: 'RATE_LIMITED', message: RATE_LIMIT_MESSAGE });
  });

  it('dispatches taskmate:unauthorized on 401 for authenticated requests', async () => {
    const listener = jest.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, listener);
    localStorage.setItem('token', 'expired');
    global.fetch.mockResolvedValue(response(401, { success: false, error: 'Invalid or expired token.' }));

    const err = await api.get('/api/tasks').catch(e => e);

    expect(err).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(UNAUTHORIZED_EVENT, listener);
  });

  it('does not send the token nor dispatch the event when auth is false (login)', async () => {
    const listener = jest.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, listener);
    localStorage.setItem('token', 'old');
    global.fetch.mockResolvedValue(response(401, { success: false, error: 'Invalid credentials' }));

    const err = await api.post('/api/users/login', { username: 'a', password: 'b' }, { auth: false }).catch(e => e);

    expect(err.message).toBe('Invalid credentials');
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(UNAUTHORIZED_EVENT, listener);
  });

  it('passes the AbortSignal through and rethrows AbortError untouched', async () => {
    const controller = new AbortController();
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    global.fetch.mockRejectedValue(abortError);

    const err = await apiFetch('/api/nodes/group/g1', { signal: controller.signal }).catch(e => e);

    expect(global.fetch.mock.calls[0][1].signal).toBe(controller.signal);
    expect(err).toBe(abortError);
  });

  it('wraps network failures in an ApiError with code NETWORK_ERROR', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const err = await api.get('/api/tasks').catch(e => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });
});

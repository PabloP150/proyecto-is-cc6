import { API_BASE } from '../config';

export const UNAUTHORIZED_EVENT = 'taskmate:unauthorized';
export const RATE_LIMIT_MESSAGE = 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.';

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'HTTP_ERROR', details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

// The token is written both to 'token' and inside 'user' by the login flow; either may be missing.
export function getAuthToken() {
  try {
    const token = localStorage.getItem('token');
    if (token && token !== 'undefined' && token !== 'null') return token;
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    return user?.token || null;
  } catch {
    return null;
  }
}

const isRawBody = (body) =>
  typeof body === 'string' ||
  (typeof FormData !== 'undefined' && body instanceof FormData) ||
  (typeof Blob !== 'undefined' && body instanceof Blob) ||
  (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams);

async function parseBody(res) {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toApiError(res, payload) {
  const envelope = payload && typeof payload === 'object' ? payload : {};
  const nested = envelope.error && typeof envelope.error === 'object' ? envelope.error : null;
  const message =
    (nested ? nested.message : envelope.error) ||
    envelope.message ||
    (typeof payload === 'string' && payload) ||
    `HTTP ${res.status}`;
  const code =
    (nested && nested.code) ||
    envelope.code ||
    (res.status === 401 ? 'UNAUTHENTICATED' : res.status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR');
  if (code === 'RATE_LIMITED') {
    return new ApiError(RATE_LIMIT_MESSAGE, { status: res.status, code });
  }
  return new ApiError(String(message), { status: res.status, code });
}

/**
 * fetch wrapper for the TaskMate REST API.
 * - `path` is relative to API_BASE (absolute URLs are used as-is).
 * - Plain-object bodies are sent as JSON.
 * - Adds `Authorization: Bearer <token>` unless `auth: false` (login/register).
 * - Resolves with the parsed JSON (`null` on 204 / empty body).
 * - Rejects with ApiError on non-2xx and on network failures; AbortError is rethrown untouched.
 * - A 401 on an authenticated request dispatches the `taskmate:unauthorized` window event.
 */
export async function apiFetch(path, { method = 'GET', body, headers = {}, signal, auth = true } = {}) {
  const url = /^https?:\/\//i.test(path) ? path : `${API_BASE}${path}`;
  const finalHeaders = { Accept: 'application/json', ...headers };

  let finalBody = body;
  if (body !== undefined && body !== null && !isRawBody(body)) {
    finalBody = JSON.stringify(body);
    if (!Object.keys(finalHeaders).some((h) => h.toLowerCase() === 'content-type')) {
      finalHeaders['Content-Type'] = 'application/json';
    }
  }

  if (auth) {
    const token = getAuthToken();
    const hasAuthHeader = Object.keys(finalHeaders).some((h) => h.toLowerCase() === 'authorization');
    if (token && !hasAuthHeader) finalHeaders.Authorization = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: finalHeaders,
      body: finalBody === null ? undefined : finalBody,
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError('Could not reach the server. Check your connection.', { status: 0, code: 'NETWORK_ERROR' });
  }

  const payload = await parseBody(res);

  if (!res.ok) {
    const error = toApiError(res, payload);
    if (res.status === 401 && auth && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: { path, code: error.code } }));
    }
    throw error;
  }

  return payload;
}

export const api = {
  get: (path, options) => apiFetch(path, { ...options, method: 'GET' }),
  post: (path, body, options) => apiFetch(path, { ...options, method: 'POST', body }),
  put: (path, body, options) => apiFetch(path, { ...options, method: 'PUT', body }),
  // DELETE bodies are still used by some legacy routes (e.g. /api/groups/leave): pass { body }.
  del: (path, options) => apiFetch(path, { ...options, method: 'DELETE' }),
};

export const errorMessage = (err, fallback = 'Unexpected error') => err?.message || fallback;

export default api;

import { apiFetch } from './client';

// One function per /api/deploy REST endpoint. Each resolves with the response `data`
// field and rejects with the ApiError thrown by apiFetch. Mirrors src/api/github.js.

const BASE = '/api/deploy';
const seg = (value) => encodeURIComponent(String(value));

const query = (params) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.append(key, String(value));
  });
  const text = search.toString();
  return text ? `?${text}` : '';
};

const unwrap = (payload) =>
  payload && typeof payload === 'object' && 'data' in payload ? payload.data : null;

const request = async (path, { method = 'GET', body, signal } = {}) =>
  unwrap(await apiFetch(`${BASE}${path}`, { method, body, signal }));

export const getDeployTarget = (gid, { provider = 'vercel', signal } = {}) =>
  request(`/groups/${seg(gid)}/target${query({ provider })}`, { signal });

export const linkDeployTarget = (gid, { provider = 'vercel', projectRef }, { signal } = {}) =>
  request(`/groups/${seg(gid)}/target`, { method: 'PUT', body: { provider, projectRef }, signal });

export const unlinkDeployTarget = (gid, { provider = 'vercel', signal } = {}) =>
  request(`/groups/${seg(gid)}/target${query({ provider })}`, { method: 'DELETE', signal });

export const getDeployments = (gid, { limit, signal } = {}) =>
  request(`/groups/${seg(gid)}/deployments${query({ limit })}`, { signal });

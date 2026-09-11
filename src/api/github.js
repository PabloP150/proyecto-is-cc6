import { apiFetch } from './client';

// One function per /api/github REST endpoint. Each resolves with the response `data`
// field (null for 204) and rejects with the ApiError thrown by apiFetch.

const BASE = '/api/github';
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

export const install = (gid, { signal } = {}) =>
  request(`/groups/${seg(gid)}/install`, { method: 'POST', signal });

export const getSelection = (selectionId, { signal } = {}) =>
  request(`/selections/${seg(selectionId)}`, { signal });

export const linkRepository = (gid, { selectionId, repoId }, { signal } = {}) =>
  request(`/groups/${seg(gid)}/repository`, {
    method: 'POST',
    body: { selectionId, repoId },
    signal,
  });

export const getRepository = (gid, { signal } = {}) =>
  request(`/groups/${seg(gid)}/repository`, { signal });

export const unlinkRepository = (gid, { signal } = {}) =>
  request(`/groups/${seg(gid)}/repository`, { method: 'DELETE', signal });

export const getTree = (gid, { ref, signal } = {}) =>
  request(`/groups/${seg(gid)}/tree${query({ ref })}`, { signal });

export const getFile = (gid, path, { ref, signal } = {}) =>
  request(`/groups/${seg(gid)}/file${query({ path, ref })}`, { signal });

export const getReadme = (gid, { ref, signal } = {}) =>
  request(`/groups/${seg(gid)}/readme${query({ ref })}`, { signal });

export const getCommits = (gid, { ref, perPage, signal } = {}) =>
  request(`/groups/${seg(gid)}/commits${query({ ref, perPage })}`, { signal });

export const createTaskBranch = (tid, { signal } = {}) =>
  request(`/tasks/${seg(tid)}/branch`, { method: 'POST', signal });

export const getTaskLinks = (gid, { signal } = {}) =>
  request(`/groups/${seg(gid)}/task-links`, { signal });

export const syncGroup = (gid, { signal } = {}) =>
  request(`/groups/${seg(gid)}/sync`, { method: 'POST', signal });

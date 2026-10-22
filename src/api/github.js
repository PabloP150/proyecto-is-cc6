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

export const setAiAnalysis = (gid, enabled, { signal } = {}) =>
  request(`/groups/${seg(gid)}/ai-analysis`, { method: 'PUT', body: { enabled: Boolean(enabled) }, signal });

// ---------------------------------------------------------------- Phase 4: CI/CD

export const getPipeline = (gid, { signal } = {}) =>
  request(`/groups/${seg(gid)}/pipeline`, { signal });

/**
 * New proposal for the setup screen; `dir`/`stack` switch to another project of the repository.
 * `ai: true` asks the AI for it (the group must allow AI analysis).
 */
export const proposePipeline = (gid, { dir, stack, ai } = {}, { signal } = {}) =>
  request(`/groups/${seg(gid)}/pipeline/proposal`, { method: 'POST', body: { dir, stack, ai }, signal });

export const previewPipeline = (gid, spec, { signal } = {}) =>
  request(`/groups/${seg(gid)}/pipeline/preview`, { method: 'POST', body: { spec }, signal });

export const applyPipeline = (gid, spec, { signal } = {}) =>
  request(`/groups/${seg(gid)}/pipeline`, { method: 'PUT', body: { spec }, signal });

export const listWorkflows = (gid, { signal } = {}) =>
  request(`/groups/${seg(gid)}/actions/workflows`, { signal });

export const listRuns = (gid, { branch, status, workflow, page, signal } = {}) =>
  request(`/groups/${seg(gid)}/actions/runs${query({ branch, status, workflow, page })}`, { signal });

export const getRun = (gid, runId, { signal } = {}) =>
  request(`/groups/${seg(gid)}/actions/runs/${seg(runId)}`, { signal });

export const getJobLog = (gid, jobId, { signal } = {}) =>
  request(`/groups/${seg(gid)}/actions/jobs/${seg(jobId)}/logs`, { signal });

export const getJobAnnotations = (gid, jobId, { signal } = {}) =>
  request(`/groups/${seg(gid)}/actions/jobs/${seg(jobId)}/annotations`, { signal });

/** Runs the TaskMate CI (no deploy) on a branch. */
export const dispatchPipeline = (gid, ref, { signal } = {}) =>
  request(`/groups/${seg(gid)}/actions/runs`, { method: 'POST', body: { ref }, signal });

export const rerunFailed = (gid, runId, { signal } = {}) =>
  request(`/groups/${seg(gid)}/actions/runs/${seg(runId)}/rerun-failed`, { method: 'POST', signal });

export const cancelRun = (gid, runId, { signal } = {}) =>
  request(`/groups/${seg(gid)}/actions/runs/${seg(runId)}/cancel`, { method: 'POST', signal });

export const getDeployments = (gid, { signal } = {}) =>
  request(`/groups/${seg(gid)}/deployments`, { signal });

/** Admin: deploy (or roll back to) a version right away. */
export const deployNow = (gid, { environment, version }, { signal } = {}) =>
  request(`/groups/${seg(gid)}/deployments`, { method: 'POST', body: { environment, version }, signal });

/** Member: ask the admins to deploy a version. */
export const requestDeploy = (gid, { environment = 'production', version }, { signal } = {}) =>
  request(`/groups/${seg(gid)}/deploy-requests`, { method: 'POST', body: { environment, version }, signal });

export const approveDeployRequest = (gid, requestId, { signal } = {}) =>
  request(`/groups/${seg(gid)}/deploy-requests/${seg(requestId)}/approve`, { method: 'POST', signal });

export const rejectDeployRequest = (gid, requestId, note, { signal } = {}) =>
  request(`/groups/${seg(gid)}/deploy-requests/${seg(requestId)}/reject`, { method: 'POST', body: { note: note || undefined }, signal });

export const cancelDeployRequest = (gid, requestId, { signal } = {}) =>
  request(`/groups/${seg(gid)}/deploy-requests/${seg(requestId)}/cancel`, { method: 'POST', signal });

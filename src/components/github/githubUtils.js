// Shared helpers for the GitHub UI: safe URLs, readable errors, dates and ids.

const ERROR_MESSAGES = {
  VALIDATION_ERROR: 'The request is not valid.',
  UNAUTHENTICATED: 'Your session expired. Please log in again.',
  NETWORK_ERROR: 'Could not reach the server. Check your connection.',
  NOT_GROUP_MEMBER: 'You are not a member of this group.',
  NOT_GROUP_ADMIN: 'Only the group admin can do this.',
  INVALID_STATE: 'The connection request is not valid or has expired. Please try again.',
  REPO_NOT_ACCESSIBLE: 'The GitHub App has no access to that repository.',
  NOT_FOUND: 'We could not find what you were looking for.',
  TASK_NOT_FOUND: 'The task no longer exists.',
  FILE_NOT_FOUND: 'The file does not exist on this branch.',
  SELECTION_NOT_FOUND:
    'The repository selection expired or was already used. Connect the repository again.',
  REPO_NOT_CONNECTED: 'This group has no GitHub repository connected.',
  REPO_EMPTY: 'The repository is empty: make a first commit before creating branches.',
  INSTALLATION_SUSPENDED: 'The GitHub App installation is suspended.',
  BRANCH_CONFLICT: 'A branch with that name is already linked to another task.',
  FILE_TOO_LARGE: 'The file is larger than 1 MB and cannot be shown here.',
  RATE_LIMITED: 'Too many requests. Wait a moment and try again.',
  GITHUB_ERROR: 'GitHub returned an error. Try again later.',
  GITHUB_RATE_LIMITED: 'The GitHub API usage limit was reached. Try again later.',
  DB_BUSY: 'The server is busy. Try again in a few seconds.',
  INTERNAL_ERROR: 'An unexpected server error occurred.',
  GITHUB_NOT_CONFIGURED: 'The GitHub integration is not configured on the server.',
  AI_ANALYSIS_DISABLED: 'AI analysis is turned off for this repository. An admin can turn it on from the GitHub page.',
  // Phase 4 (CI/CD)
  APP_PERMISSIONS_MISSING:
    'The GitHub App does not have the CI/CD permissions on this repository yet. Whoever installed it must accept them on GitHub.',
  PAGES_UNAVAILABLE:
    'GitHub Pages is not available for this repository on its current plan (private repositories need GitHub Pro).',
  WORKFLOW_CONFLICT:
    'A .github/workflows/taskmate-ci.yml workflow already exists that TaskMate did not create. Rename or delete it to continue.',
  WORKFLOW_CHANGED: 'The workflow changed on GitHub while you were setting it up. Please try again.',
  BRANCH_PROTECTED:
    'The main branch is protected and only accepts changes through pull requests, so TaskMate cannot push the pipeline.',
  INVALID_PIPELINE: 'The pipeline configuration is not valid for this repository.',
  PIPELINE_UNSUPPORTED: 'No Node.js project, Python project or static site was found in the repository.',
  RUN_NOT_FOUND: 'That run no longer exists on GitHub.',
  LOG_NOT_AVAILABLE: 'The log is not available yet (the job is still running) or has expired.',
  PIPELINE_NOT_CONFIGURED: 'This repository does not have a TaskMate pipeline yet.',
  PIPELINE_OUTDATED: 'The workflow on that branch is outdated and cannot be run from TaskMate; push the pipeline again.',
  BRANCH_NOT_FOUND: 'That branch does not exist in the repository.',
  RUN_NOT_RERUNNABLE: 'Only finished runs with failed jobs (and less than a month old) can be re-run.',
  RUN_NOT_CANCELLABLE: 'The run has already finished.',
  DEPLOY_NOT_CONFIGURED: 'This repository pipeline has no deploy step.',
  VERSION_NOT_VERIFIED: 'That commit did not pass TaskMate CI, so it cannot be deployed.',
  DEPLOY_REQUEST_PENDING: 'There is already a pending request for that environment.',
  DEPLOY_REQUEST_NOT_FOUND: 'The request no longer exists.',
  DEPLOY_REQUEST_DECIDED: 'Another admin already answered that request.',
  NOT_REQUESTER: 'Only the person who asked for the deploy can cancel the request.',
  BRANCH_WORKFLOW_OUTDATED:
    'That branch does not have the current TaskMate workflow: update it from the main branch (merge or rebase) and try again.',
  VERSION_NOT_STAGING: 'Only the version currently on staging can be requested for production.',
  DEPLOY_REQUEST_STALE:
    'The request became outdated (the staging version or the repository changed) and was cancelled; ask again.',
  WORKFLOW_DISABLED:
    'The TaskMate workflow is disabled on GitHub. Enable it in the repository Actions tab and try again.',
};

// Codes the OAuth/installation callback may put in ?status=error&code=<CODE>.
const CALLBACK_ERROR_MESSAGES = {
  ...ERROR_MESSAGES,
  INVALID_STATE: 'The connection link expired or was already used. Click “Connect repository” again.',
  NOT_GROUP_ADMIN: 'You are no longer an admin of this group, so the repository could not be connected.',
  ACCESS_DENIED: 'The authorization was cancelled on GitHub.',
  INSTALLATION_NOT_FOUND: 'Your GitHub account has no access to that App installation.',
  NO_REPOSITORIES: 'The installation has no access to any repository.',
  NO_WRITABLE_REPOSITORIES:
    'Your GitHub account has no write access to any repository in the installation. Only someone who can write to a repository can connect it.',
};

export function errorMessage(err, fallback = 'An unexpected error occurred.') {
  const code = err && err.code;
  return (code && ERROR_MESSAGES[code]) || fallback;
}

export function callbackErrorMessage(code) {
  if (code && CALLBACK_ERROR_MESSAGES[code]) return CALLBACK_ERROR_MESSAGES[code];
  const safeCode = typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code) ? code : null;
  return safeCode
    ? `The repository could not be connected (code ${safeCode}).`
    : 'The repository could not be connected.';
}

export const isAbortError = (err) => Boolean(err) && err.name === 'AbortError';

// Only ever navigate/link to github.com over https (the API values are not trusted blindly).
export function isGitHubUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('https://github.com/')) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'github.com';
  } catch {
    return false;
  }
}

export const safeGitHubUrl = (url) => (isGitHubUrl(url) ? url : null);

// Isolated so tests can mock the full-page redirect.
export function assignLocation(url) {
  window.location.assign(url);
}

const FULL_NAME_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function repoHtmlUrl(repo) {
  if (!repo) return null;
  if (isGitHubUrl(repo.htmlUrl)) return repo.htmlUrl.replace(/\/+$/, '');
  if (typeof repo.fullName === 'string' && FULL_NAME_RE.test(repo.fullName)) {
    return `https://github.com/${repo.fullName}`;
  }
  return null;
}

export const encodePath = (path) =>
  String(path)
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');

export function branchUrl(repoUrl, branchName) {
  if (!repoUrl || !branchName) return null;
  return `${repoUrl}/tree/${encodePath(branchName)}`;
}

export function pullRequestUrl(repoUrl, number) {
  if (!repoUrl || !Number.isInteger(Number(number))) return null;
  return `${repoUrl}/pull/${Number(number)}`;
}

export function blobUrl(repoUrl, ref, path, kind = 'blob') {
  if (!repoUrl || !ref || !path) return null;
  return `${repoUrl}/${kind}/${encodePath(ref)}/${encodePath(path)}`;
}

export { normalizeId, sameId } from '../../utils/ids';

export function getCurrentUserId() {
  try {
    const stored = localStorage.getItem('userId');
    if (stored && stored !== 'undefined' && stored !== 'null') return stored;
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    return (user && (user.uid || user.userId || user.id)) || null;
  } catch {
    return null;
  }
}

const RELATIVE_UNITS = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];

export function formatRelativeDate(value, now = Date.now()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.round((date.getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

export function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' });
}

// Plan dates are calendar days (YYYY-MM-DD); build them in local time to avoid a UTC day shift.
export function formatDay(value) {
  if (typeof value !== 'string') return '';
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Static surfaces reuse the design-system Card without its clickable hover/scale.
export const staticCardSx = {
  cursor: 'default',
  p: { xs: 2, sm: 3 },
  '&:hover': { transform: 'none' },
  '&:active': { transform: 'none' },
};

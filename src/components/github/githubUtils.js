// Shared helpers for the GitHub UI: safe URLs, readable errors, dates and ids.

// Window event fired when tasks were created outside the task page (e.g. an AI plan was saved).
export const TASKS_CHANGED_EVENT = 'taskmate:tasks-changed';

const ERROR_MESSAGES = {
  VALIDATION_ERROR: 'La solicitud no es válida.',
  UNAUTHENTICATED: 'Tu sesión expiró. Inicia sesión de nuevo.',
  NETWORK_ERROR: 'No se pudo conectar con el servidor. Revisa tu conexión.',
  NOT_GROUP_MEMBER: 'No perteneces a este grupo.',
  NOT_GROUP_ADMIN: 'Solo el administrador del grupo puede hacer esto.',
  INVALID_STATE: 'La solicitud de conexión no es válida o expiró. Vuelve a intentarlo.',
  REPO_NOT_ACCESSIBLE: 'La GitHub App no tiene acceso a ese repositorio.',
  NOT_FOUND: 'No se encontró lo que buscabas.',
  TASK_NOT_FOUND: 'La tarea ya no existe.',
  FILE_NOT_FOUND: 'El archivo no existe en esta rama.',
  SELECTION_NOT_FOUND:
    'La selección de repositorios expiró o ya se usó. Vuelve a conectar el repositorio.',
  REPO_NOT_CONNECTED: 'Este grupo no tiene un repositorio de GitHub conectado.',
  REPO_EMPTY: 'El repositorio está vacío: haz un primer commit para poder crear ramas.',
  INSTALLATION_SUSPENDED: 'La instalación de la GitHub App está suspendida.',
  BRANCH_CONFLICT: 'Ya existe una rama con ese nombre vinculada a otra tarea.',
  FILE_TOO_LARGE: 'El archivo supera 1 MB y no se puede mostrar aquí.',
  RATE_LIMITED: 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.',
  GITHUB_ERROR: 'GitHub respondió con un error. Inténtalo más tarde.',
  GITHUB_RATE_LIMITED: 'Se alcanzó el límite de uso de la API de GitHub. Inténtalo más tarde.',
  DB_BUSY: 'El servidor está ocupado. Inténtalo de nuevo en unos segundos.',
  INTERNAL_ERROR: 'Ocurrió un error inesperado en el servidor.',
};

// Codes the OAuth/installation callback may put in ?status=error&code=<CODE>.
const CALLBACK_ERROR_MESSAGES = {
  ...ERROR_MESSAGES,
  INVALID_STATE: 'El enlace de conexión expiró o ya se usó. Vuelve a pulsar «Conectar repositorio».',
  NOT_GROUP_ADMIN: 'Ya no eres administrador de este grupo, así que no se pudo conectar el repositorio.',
  ACCESS_DENIED: 'Se canceló la autorización en GitHub.',
  INSTALLATION_NOT_FOUND: 'Tu cuenta de GitHub no tiene acceso a esa instalación de la App.',
  NO_REPOSITORIES: 'La instalación no tiene acceso a ningún repositorio.',
};

export function errorMessage(err, fallback = 'Ocurrió un error inesperado.') {
  const code = err && err.code;
  return (code && ERROR_MESSAGES[code]) || fallback;
}

export function callbackErrorMessage(code) {
  if (code && CALLBACK_ERROR_MESSAGES[code]) return CALLBACK_ERROR_MESSAGES[code];
  const safeCode = typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code) ? code : null;
  return safeCode
    ? `No se pudo conectar el repositorio (código ${safeCode}).`
    : 'No se pudo conectar el repositorio.';
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

// GUIDs come uppercase from SQL Server and lowercase from uuid(); compare case-insensitively.
export const normalizeId = (id) => (id === undefined || id === null ? '' : String(id).toLowerCase());
export const sameId = (a, b) => normalizeId(a) !== '' && normalizeId(a) === normalizeId(b);

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
  const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return 'hace un momento';
}

export function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });
}

// Plan dates are calendar days (YYYY-MM-DD); build them in local time to avoid a UTC day shift.
export function formatDay(value) {
  if (typeof value !== 'string') return '';
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
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

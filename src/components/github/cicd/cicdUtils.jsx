// Shared helpers for the CI/CD tab: run/job/step states, durations and labels.
import BlockIcon from '@mui/icons-material/Block';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import ScheduleIcon from '@mui/icons-material/Schedule';
import { CircularProgress } from '@mui/material';

const STATES = {
  success: { label: 'Succeeded', color: '#4ade80' },
  failure: { label: 'Failed', color: '#f87171' },
  cancelled: { label: 'Cancelled', color: '#9ca3af' },
  skipped: { label: 'Skipped', color: '#9ca3af' },
  running: { label: 'Running', color: '#fbbf24' },
  queued: { label: 'Queued', color: '#93c5fd' },
  neutral: { label: 'Neutral', color: '#9ca3af' },
};

const FAILED = new Set(['failure', 'timed_out', 'startup_failure', 'action_required']);

/** GitHub's (status, conclusion) pair of a run, job or step → one of the STATES keys. */
export function stateOf(status, conclusion) {
  if (status && status !== 'completed') return status === 'in_progress' ? 'running' : 'queued';
  if (conclusion === 'success') return 'success';
  if (FAILED.has(conclusion)) return 'failure';
  if (conclusion === 'cancelled') return 'cancelled';
  if (conclusion === 'skipped') return 'skipped';
  return 'neutral';
}

export const stateLabel = (key) => (STATES[key] || STATES.neutral).label;
export const stateColor = (key) => (STATES[key] || STATES.neutral).color;
export const isActive = (key) => key === 'running' || key === 'queued';

/** Icon for a state, labelled for screen readers. */
export function StateIcon({ state, size = 18 }) {
  const common = { sx: { fontSize: size, color: stateColor(state) }, titleAccess: stateLabel(state) };
  if (state === 'running') {
    return <CircularProgress size={size - 4} thickness={5} sx={{ color: stateColor(state) }} aria-label={stateLabel(state)} />;
  }
  if (state === 'success') return <CheckCircleIcon {...common} />;
  if (state === 'failure') return <CancelIcon {...common} />;
  if (state === 'queued') return <ScheduleIcon {...common} />;
  if (state === 'cancelled') return <BlockIcon {...common} />;
  return <RemoveCircleOutlineIcon {...common} />;
}

export function formatDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '';
  const totalSeconds = Math.round(n / 1000);
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes} min ${seconds} s` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

const EVENTS = {
  push: 'Push',
  pull_request: 'Pull request',
  workflow_dispatch: 'Manual',
  schedule: 'Scheduled',
  release: 'Release',
};

export const eventLabel = (event) => EVENTS[event] || (event ? String(event) : '');

export const STATUS_FILTERS = [
  { value: '', label: 'All statuses' },
  { value: 'in_progress', label: 'Running' },
  { value: 'queued', label: 'Queued' },
  { value: 'success', label: 'Succeeded' },
  { value: 'failure', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export const STACK_LABELS = { node: 'Node.js', python: 'Python', static: 'Static site' };

export const projectLabel = (project) =>
  `${project.dir === '.' ? 'Repository root' : project.dir} · ${STACK_LABELS[project.stack] || project.stack}`;

export const monoSx = { fontFamily: '"JetBrains Mono", "Fira Code", Menlo, Consolas, monospace' };

// Pages and deployment URLs are https links GitHub returns (github.io or a custom domain).
export function safeHttpsUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('https://')) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

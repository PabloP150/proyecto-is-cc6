import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { Alert, Box, CircularProgress, IconButton, List, ListItem, Tooltip, Typography } from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { getRun } from '../../../api/github';
import Button from '../../ui/Button';
import { useGroupEvents, useRealtime } from '../../realtime/RealtimeContext';
import { errorMessage, isAbortError, safeGitHubUrl } from '../githubUtils';
import { formatDuration, isActive, StateIcon, stateLabel, stateOf } from './cicdUtils';
import { JobAnnotations, JobLog } from './JobLog';
import useVisibleInterval from './useVisibleInterval';

const POLL_MS = 10 * 1000;
const SAFETY_POLL_MS = 60 * 1000;

function JobCard({ gid, job }) {
  const state = stateOf(job.status, job.conclusion);
  const href = safeGitHubUrl(job.htmlUrl);
  const [showLog, setShowLog] = useState(false);
  const finished = job.status === 'completed';
  return (
    <Box
      component="section"
      aria-label={`Job ${job.name}`}
      sx={{ border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 2, p: 1.5, background: 'rgba(15, 23, 42, 0.35)' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <StateIcon state={state} />
        <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 0 }} noWrap title={job.name}>
          {job.name}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {isActive(state) ? stateLabel(state) : formatDuration(job.durationMs)}
        </Typography>
        {href && (
          <Tooltip title="Ver el job en GitHub" arrow>
            <IconButton size="small" component="a" href={href} target="_blank" rel="noopener noreferrer" aria-label={`Ver el job ${job.name} en GitHub`}>
              <OpenInNewIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      {job.steps.length > 0 && (
        <List dense disablePadding aria-label={`Pasos de ${job.name}`} sx={{ mt: 0.5 }}>
          {job.steps.map((step) => {
            const stepState = stateOf(step.status, step.conclusion);
            return (
              <ListItem key={step.number} disableGutters sx={{ gap: 1, py: 0.25, pl: 3.5 }}>
                <StateIcon state={stepState} size={14} />
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap title={step.name}>
                  {step.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {stepState === 'skipped' ? 'Omitido' : formatDuration(step.durationMs)}
                </Typography>
              </ListItem>
            );
          })}
        </List>
      )}
      {state === 'failure' && <JobAnnotations gid={gid} jobId={job.id} />}
      {finished && (
        <Box sx={{ mt: 0.5 }}>
          <Button variant="ghost" size="small" onClick={() => setShowLog((v) => !v)} aria-expanded={showLog}>
            {showLog ? 'Ocultar log' : 'Ver log'}
          </Button>
          {showLog && <JobLog gid={gid} jobId={job.id} />}
        </Box>
      )}
    </Box>
  );
}

/** Jobs and steps of one workflow run; refreshes itself while the run is not finished. Props: gid, runId. */
export default function RunDetail({ gid, runId }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));
    getRun(gid, runId, { signal: controller.signal })
      .then((data) => setState({ loading: false, error: null, data }))
      .catch((err) => {
        if (isAbortError(err)) return;
        setState((prev) => ({ ...prev, loading: false, error: errorMessage(err, 'No se pudo cargar la ejecución.') }));
      });
    return () => controller.abort();
  }, [gid, runId, version]);

  const { loading, error, data } = state;
  const running = Boolean(data && data.run && data.run.status !== 'completed');
  const { connected } = useRealtime();
  // Filtered before the debounce: an event of another run right after one of this run must not
  // replace it (and so drop the reload).
  const isThisRun = useCallback((event) => Boolean(event) && Number(event.runId) === Number(runId), [runId]);
  useGroupEvents(gid, ['ci_run', 'ci_job'], reload, { debounceMs: 800, filter: isThisRun });
  // Live events keep it fresh; polling is the fallback without the /events connection and, slowly,
  // a safety net with it (an event can be lost).
  useVisibleInterval(reload, connected ? SAFETY_POLL_MS : POLL_MS, running && !loading);

  if (loading && !data) {
    return (
      <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 2 }}>
        <CircularProgress size={18} />
        <Typography variant="body2" color="text.secondary">
          Cargando jobs…
        </Typography>
      </Box>
    );
  }
  if (error && !data) {
    return (
      <Alert
        severity="error"
        action={
          <Button variant="ghost" size="small" onClick={reload}>
            Reintentar
          </Button>
        }
      >
        {error}
      </Alert>
    );
  }
  const jobs = (data && data.jobs) || [];
  return (
    <Box sx={{ display: 'grid', gap: 1 }} aria-busy={loading}>
      {jobs.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Esta ejecución todavía no tiene jobs.
        </Typography>
      ) : (
        jobs.map((job) => <JobCard key={job.id} gid={gid} job={job} />)
      )}
    </Box>
  );
}

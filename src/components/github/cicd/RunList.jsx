import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RefreshIcon from '@mui/icons-material/Refresh';
import ReplayIcon from '@mui/icons-material/Replay';
import StopIcon from '@mui/icons-material/Stop';
import {
  Alert,
  Box,
  ButtonBase,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Link,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { cancelRun, dispatchPipeline, listRuns, listWorkflows, rerunFailed } from '../../../api/github';
import { useGroupEvents, useRealtime } from '../../realtime/RealtimeContext';
import Button from '../../ui/Button';
import { errorMessage, formatDateTime, formatRelativeDate, isAbortError, safeGitHubUrl } from '../githubUtils';
import { eventLabel, formatDuration, isActive, monoSx, StateIcon, stateLabel, stateOf, STATUS_FILTERS } from './cicdUtils';
import RunDetail from './RunDetail';
import useVisibleInterval from './useVisibleInterval';

const POLL_MS = 15 * 1000;
// Live events can be lost (a reconnection, a webhook GitHub never delivered): while a run is
// active the list is still checked now and then even with the live connection.
const SAFETY_POLL_MS = 60 * 1000;
const RERUNNABLE = new Set(['failure', 'cancelled', 'timed_out', 'startup_failure']);

// Same rule as the API: deploys TaskMate dispatched are re-run or cancelled only by the admin.
const isDeployRun = (run) => run.isTaskmate && run.event === 'workflow_dispatch' && /^Deploy a /.test(run.title || '');

function RunActions({ gid, run, isAdmin, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const state = stateOf(run.status, run.conclusion);
  const allowed = !isDeployRun(run) || isAdmin;
  const canRerun = allowed && run.status === 'completed' && RERUNNABLE.has(run.conclusion);
  const canCancel = allowed && isActive(state);
  if (!canRerun && !canCancel) {
    return isDeployRun(run) && !isAdmin ? (
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
        Solo el administrador del grupo puede re-ejecutar o cancelar un deploy.
      </Typography>
    ) : null;
  }

  const act = async (kind) => {
    setBusy(kind);
    setFeedback(null);
    try {
      if (kind === 'rerun') await rerunFailed(gid, run.id);
      else await cancelRun(gid, run.id);
      setFeedback({ severity: 'success', message: kind === 'rerun' ? 'Se re-ejecutan los jobs fallidos.' : 'Se pidió cancelar la ejecución.' });
      if (onChanged) onChanged();
    } catch (err) {
      setFeedback({ severity: 'error', message: errorMessage(err, 'GitHub no aceptó la acción.') });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
      {canRerun && (
        <Button variant="ghost" size="small" startIcon={busy === 'rerun' ? <CircularProgress size={14} color="inherit" /> : <ReplayIcon />} onClick={() => act('rerun')} disabled={Boolean(busy)}>
          Re-ejecutar fallidos
        </Button>
      )}
      {canCancel && (
        <Button variant="ghost" size="small" startIcon={busy === 'cancel' ? <CircularProgress size={14} color="inherit" /> : <StopIcon />} onClick={() => act('cancel')} disabled={Boolean(busy)}>
          Cancelar
        </Button>
      )}
      {feedback && (
        <Typography variant="caption" role="status" sx={{ color: feedback.severity === 'error' ? 'error.light' : 'success.light' }}>
          {feedback.message}
        </Typography>
      )}
    </Box>
  );
}

function RunPipelineDialog({ open, gid, defaultBranch, onClose, onDone }) {
  const [branch, setBranch] = useState(defaultBranch || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setBranch(defaultBranch || '');
      setError(null);
    }
  }, [open, defaultBranch]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await dispatchPipeline(gid, branch.trim());
      onDone(branch.trim());
    } catch (err) {
      setError(errorMessage(err, 'No se pudo ejecutar el pipeline.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} aria-labelledby="ci-run-title" fullWidth maxWidth="xs">
      <Box component="form" onSubmit={submit}>
        <DialogTitle id="ci-run-title">Ejecutar pipeline</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Corre el CI de TaskMate (instalar, análisis estático, pruebas y build) en una rama. No despliega nada.
          </DialogContentText>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Rama"
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            inputProps={{ maxLength: 255, spellCheck: false, style: monoSx }}
          />
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button variant="ghost" size="small" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" size="small" disabled={busy || !branch.trim()} startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <PlayArrowIcon />}>
            Ejecutar
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

function RunRow({ gid, run, expanded, onToggle, isAdmin, onChanged }) {
  const state = stateOf(run.status, run.conclusion);
  const href = safeGitHubUrl(run.htmlUrl);
  const detailId = `ci-run-${run.id}`;
  const who = (run.triggeringActor && run.triggeringActor.login) || (run.actor && run.actor.login);
  return (
    <Box component="li" sx={{ listStyle: 'none', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
      <ButtonBase
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={detailId}
        sx={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: 1.5, py: 1.25, px: 0.5, borderRadius: 1 }}
      >
        <Box sx={{ pt: 0.25 }}>
          <StateIcon state={state} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" noWrap title={run.title} sx={{ fontWeight: 500 }}>
            {run.title || run.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
            <span>
              {run.name}
              {run.runNumber ? ` #${run.runNumber}` : ''}
            </span>
            <span aria-hidden>·</span>
            <span>{eventLabel(run.event)}</span>
            {run.branch && (
              <Chip size="small" variant="outlined" label={run.branch} sx={{ height: 18, fontSize: '0.7rem', ...monoSx }} />
            )}
            {run.shortSha && <Box component="span" sx={monoSx}>{run.shortSha}</Box>}
            {who && <span>{who}</span>}
            {run.createdAt && (
              <time dateTime={String(run.createdAt)} title={formatDateTime(run.createdAt)}>
                {formatRelativeDate(run.createdAt)}
              </time>
            )}
          </Typography>
        </Box>
        <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
          <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
            {isActive(state) ? stateLabel(state) : formatDuration(run.durationMs) || stateLabel(state)}
          </Typography>
          {expanded ? <ExpandLessIcon fontSize="small" aria-hidden /> : <ExpandMoreIcon fontSize="small" aria-hidden />}
        </Box>
      </ButtonBase>
      {/* The flex wrapper of Collapse must let a wide log shrink instead of widening the page. */}
      <Collapse in={expanded} unmountOnExit sx={{ '& .MuiCollapse-wrapperInner': { minWidth: 0 } }}>
        <Box id={detailId} sx={{ pb: 1.5, pl: { xs: 0, sm: 4 }, minWidth: 0 }}>
          {href && (
            <Link href={href} target="_blank" rel="noopener noreferrer" variant="caption" sx={{ display: 'inline-block', mb: 1 }}>
              Ver la ejecución en GitHub
            </Link>
          )}
          <RunActions gid={gid} run={run} isAdmin={isAdmin} onChanged={onChanged} />
          <RunDetail gid={gid} runId={run.id} />
        </Box>
      </Collapse>
    </Box>
  );
}

/**
 * Workflow runs of the group's repository with workflow/status filters, live (and, while something
 * runs, polled every 15 s without the /events connection or every minute with it as a safety net).
 * Props: gid, refreshKey (bump to reload), isAdmin, canRun (a TaskMate pipeline exists), defaultBranch.
 */
export default function RunList({ gid, refreshKey = 0, isAdmin = false, canRun = false, defaultBranch }) {
  const [runOpen, setRunOpen] = useState(false);
  const [notice, setNotice] = useState(null);
  const [workflows, setWorkflows] = useState([]);
  const [filters, setFilters] = useState({ workflow: '', status: '' });
  const [state, setState] = useState({ loading: true, error: null, runs: [], totalCount: 0, page: 1 });
  const [version, setVersion] = useState(0);
  const [expanded, setExpanded] = useState(null);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    listWorkflows(gid, { signal: controller.signal })
      .then((data) => setWorkflows(Array.isArray(data) ? data : []))
      .catch(() => setWorkflows([]));
    return () => controller.abort();
  }, [gid, refreshKey]);

  // Page 1 again on every filter change or refresh; "Ver más" appends the following pages.
  const fetchPage = useCallback(
    (page, signal) =>
      listRuns(gid, { workflow: filters.workflow || undefined, status: filters.status || undefined, page, signal }),
    [gid, filters]
  );

  useEffect(() => {
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));
    fetchPage(1, controller.signal)
      .then((data) => setState({ loading: false, error: null, runs: data.runs || [], totalCount: data.totalCount || 0, page: 1 }))
      .catch((err) => {
        if (isAbortError(err)) return;
        setState((prev) => ({ ...prev, loading: false, error: err }));
      });
    return () => controller.abort();
  }, [fetchPage, version, refreshKey]);

  const loadMore = async () => {
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const data = await fetchPage(state.page + 1);
      setState((prev) => {
        const seen = new Set(prev.runs.map((r) => r.id));
        return { ...prev, loading: false, runs: [...prev.runs, ...(data.runs || []).filter((r) => !seen.has(r.id))], page: prev.page + 1 };
      });
    } catch (err) {
      setState((prev) => ({ ...prev, loading: false, error: err }));
    }
  };

  const anyActive = useMemo(() => state.runs.some((run) => isActive(stateOf(run.status, run.conclusion))), [state.runs]);
  const { connected } = useRealtime();
  useGroupEvents(gid, ['ci_run'], reload, { debounceMs: 1000 });
  useVisibleInterval(reload, connected ? SAFETY_POLL_MS : POLL_MS, anyActive && !state.loading);

  // GitHub creates the run a few seconds after the dispatch; the ci_run event (or this) shows it.
  const handleDispatched = (branch) => {
    setRunOpen(false);
    setNotice(`Listo: el pipeline se ejecutará en «${branch}» en unos segundos.`);
    setTimeout(reload, 4000);
  };

  const { loading, error, runs, totalCount } = state;
  const permissionsMissing = error && error.code === 'APP_PERMISSIONS_MISSING';

  return (
    <Box component="section" aria-label="Ejecuciones del pipeline">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
        <Typography variant="h6" component="h2" sx={{ flex: '1 1 auto' }}>
          Ejecuciones
        </Typography>
        <TextField
          select
          size="small"
          label="Workflow"
          value={filters.workflow}
          onChange={(event) => setFilters((prev) => ({ ...prev, workflow: event.target.value }))}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">Todos los workflows</MenuItem>
          {workflows.map((w) => (
            <MenuItem key={w.id} value={String(w.id)}>
              {w.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Estado"
          value={filters.status}
          onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
          sx={{ minWidth: 160 }}
        >
          {STATUS_FILTERS.map((f) => (
            <MenuItem key={f.value} value={f.value}>
              {f.label}
            </MenuItem>
          ))}
        </TextField>
        <Tooltip title="Actualizar" arrow>
          <span>
            <IconButton onClick={reload} disabled={loading} aria-label="Actualizar ejecuciones" size="small">
              <RefreshIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        {canRun && (
          <Button variant="primary" size="small" startIcon={<PlayArrowIcon />} onClick={() => setRunOpen(true)}>
            Ejecutar pipeline
          </Button>
        )}
      </Box>

      {notice && (
        <Alert severity="success" onClose={() => setNotice(null)} sx={{ mb: 1 }}>
          {notice}
        </Alert>
      )}

      {loading && runs.length === 0 && !error && (
        <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 4, justifyContent: 'center' }}>
          <CircularProgress size={22} />
          <Typography color="text.secondary">Cargando ejecuciones…</Typography>
        </Box>
      )}

      {error && (
        <Alert
          severity={permissionsMissing ? 'warning' : 'error'}
          action={
            <Button variant="ghost" size="small" onClick={reload}>
              Reintentar
            </Button>
          }
          sx={{ mb: 1 }}
        >
          {errorMessage(error, 'No se pudieron cargar las ejecuciones.')}
        </Alert>
      )}

      {!loading && !error && runs.length === 0 && (
        <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
          {filters.workflow || filters.status ? 'No hay ejecuciones con estos filtros.' : 'Este repositorio todavía no tiene ejecuciones de GitHub Actions.'}
        </Typography>
      )}

      {runs.length > 0 && (
        <Box component="ul" sx={{ m: 0, p: 0 }} aria-busy={loading}>
          {runs.map((run) => (
            <RunRow
              key={run.id}
              gid={gid}
              run={run}
              isAdmin={isAdmin}
              onChanged={() => setTimeout(reload, 2000)}
              expanded={expanded === run.id}
              onToggle={() => setExpanded((current) => (current === run.id ? null : run.id))}
            />
          ))}
        </Box>
      )}

      {canRun && (
        <RunPipelineDialog open={runOpen} gid={gid} defaultBranch={defaultBranch} onClose={() => setRunOpen(false)} onDone={handleDispatched} />
      )}

      {runs.length > 0 && runs.length < totalCount && (
        <Box sx={{ textAlign: 'center', mt: 1.5 }}>
          <Button variant="ghost" size="small" onClick={loadMore} disabled={loading}>
            Ver más
          </Button>
        </Box>
      )}
    </Box>
  );
}

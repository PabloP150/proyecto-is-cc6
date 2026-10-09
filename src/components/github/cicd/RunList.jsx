import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Alert,
  Box,
  ButtonBase,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  Link,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { listRuns, listWorkflows } from '../../../api/github';
import Button from '../../ui/Button';
import { errorMessage, formatDateTime, formatRelativeDate, isAbortError, safeGitHubUrl } from '../githubUtils';
import { eventLabel, formatDuration, isActive, monoSx, StateIcon, stateLabel, stateOf, STATUS_FILTERS } from './cicdUtils';
import RunDetail from './RunDetail';
import useVisibleInterval from './useVisibleInterval';

const POLL_MS = 15 * 1000;

function RunRow({ gid, run, expanded, onToggle }) {
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
      <Collapse in={expanded} unmountOnExit>
        <Box id={detailId} sx={{ pb: 1.5, pl: { xs: 0, sm: 4 } }}>
          {href && (
            <Link href={href} target="_blank" rel="noopener noreferrer" variant="caption" sx={{ display: 'inline-block', mb: 1 }}>
              Ver la ejecución en GitHub
            </Link>
          )}
          <RunDetail gid={gid} runId={run.id} />
        </Box>
      </Collapse>
    </Box>
  );
}

/**
 * Workflow runs of the group's repository with workflow/status filters. Refreshes itself while
 * something is queued or running. Props: gid, refreshKey (bump to reload).
 */
export default function RunList({ gid, refreshKey = 0 }) {
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
  useVisibleInterval(reload, POLL_MS, anyActive && !state.loading);

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
      </Box>

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
              expanded={expanded === run.id}
              onToggle={() => setExpanded((current) => (current === run.id ? null : run.id))}
            />
          ))}
        </Box>
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

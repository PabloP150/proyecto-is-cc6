import RefreshIcon from '@mui/icons-material/Refresh';
import { Alert, Box, CircularProgress, FormControlLabel, IconButton, Switch, Tooltip, Typography } from '@mui/material';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getJobAnnotations, getJobLog } from '../../../api/github';
import Button from '../../ui/Button';
import { errorMessage, isAbortError } from '../githubUtils';
import { monoSx } from './cicdUtils';

const GROUP = '##[group]';
const ERROR = '##[error]';
const WARNING = '##[warning]';
const IMPORTANT_RE = /^##\[(error|warning)\]|\berror\b|\bfailed\b|✕|✖/i;

const LEVEL_COLORS = { failure: '#f87171', warning: '#fbbf24', notice: '#93c5fd' };
const LEVEL_LABELS = { failure: 'Error', warning: 'Advertencia', notice: 'Aviso' };

// GitHub's log commands become readable lines: groups as headers, errors and warnings colored.
function LogLine({ line }) {
  if (line.startsWith('##[endgroup]')) return null;
  let text = line;
  let sx = {};
  if (line.startsWith(GROUP)) {
    text = `▸ ${line.slice(GROUP.length)}`;
    sx = { color: '#93c5fd', fontWeight: 600 };
  } else if (line.startsWith(ERROR)) {
    text = `✖ ${line.slice(ERROR.length)}`;
    sx = { color: '#f87171', fontWeight: 600 };
  } else if (line.startsWith(WARNING)) {
    text = `⚠ ${line.slice(WARNING.length)}`;
    sx = { color: '#fbbf24' };
  }
  return (
    <Box component="span" sx={{ display: 'block', minHeight: '1.2em', ...sx }}>
      {text}
    </Box>
  );
}

/** The end of a job's log (GitHub serves the full one), with an "only errors" filter. Props: gid, jobId. */
export function JobLog({ gid, jobId }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [version, setVersion] = useState(0);
  const pre = useRef(null);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));
    getJobLog(gid, jobId, { signal: controller.signal })
      .then((data) => setState({ loading: false, error: null, data }))
      .catch((err) => {
        if (isAbortError(err)) return;
        setState({ loading: false, data: null, error: errorMessage(err, 'No se pudo cargar el log.') });
      });
    return () => controller.abort();
  }, [gid, jobId, version]);

  const lines = state.data ? state.data.lines || [] : [];
  const shown = onlyErrors ? lines.filter((line) => IMPORTANT_RE.test(line)) : lines;

  // The interesting part of a failed job is at the end.
  useLayoutEffect(() => {
    if (pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [shown.length, onlyErrors]);

  if (state.loading && !state.data) {
    return (
      <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
        <CircularProgress size={16} />
        <Typography variant="caption" color="text.secondary">
          Cargando log…
        </Typography>
      </Box>
    );
  }
  if (state.error) {
    return (
      <Alert severity="warning" sx={{ mt: 1 }} action={<Button variant="ghost" size="small" onClick={reload}>Reintentar</Button>}>
        {state.error}
      </Alert>
    );
  }
  return (
    <Box sx={{ mt: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <FormControlLabel
          control={<Switch size="small" checked={onlyErrors} onChange={(event) => setOnlyErrors(event.target.checked)} />}
          label={<Typography variant="caption">Solo errores</Typography>}
        />
        {state.data && state.data.truncated && (
          <Typography variant="caption" color="text.secondary">
            Se muestra el final del log.
          </Typography>
        )}
        <Tooltip title="Actualizar log" arrow>
          <IconButton size="small" onClick={reload} aria-label="Actualizar log" sx={{ ml: 'auto' }}>
            <RefreshIcon fontSize="inherit" />
          </IconButton>
        </Tooltip>
      </Box>
      <Box
        ref={pre}
        component="pre"
        tabIndex={0}
        aria-label={`Log del job ${jobId}`}
        sx={{
          ...monoSx,
          m: 0,
          p: 1.25,
          maxWidth: '100%',
          maxHeight: 380,
          overflow: 'auto',
          fontSize: '0.72rem',
          lineHeight: 1.45,
          borderRadius: 1,
          background: 'rgba(0, 0, 0, 0.4)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        {shown.length === 0 ? (onlyErrors ? 'No hay líneas con errores.' : 'El log está vacío.') : shown.map((line, i) => <LogLine key={i} line={line} />)}
      </Box>
    </Box>
  );
}

/**
 * Errors and warnings of a job with their file and line (GitHub annotations). Props: gid, jobId.
 * When they cannot be loaded it says why (e.g. the App still lacks the CI/CD permissions) instead
 * of looking like a job without errors.
 */
export function JobAnnotations({ gid, jobId }) {
  const [state, setState] = useState({ loading: true, items: [], error: null });

  useEffect(() => {
    const controller = new AbortController();
    getJobAnnotations(gid, jobId, { signal: controller.signal })
      .then((items) => setState({ loading: false, items: Array.isArray(items) ? items : [], error: null }))
      .catch((err) => {
        if (isAbortError(err)) return;
        const reason = errorMessage(err, null);
        setState({
          loading: false,
          items: [],
          error: reason ? `No se pudieron cargar los errores y advertencias: ${reason}` : 'No se pudieron cargar los errores y advertencias de este job.',
        });
      });
    return () => controller.abort();
  }, [gid, jobId]);

  if (state.error) {
    return (
      <Typography variant="caption" component="p" role="status" sx={{ mt: 1, color: 'warning.light' }}>
        {state.error}
      </Typography>
    );
  }
  if (state.loading || state.items.length === 0) return null;
  return (
    <Box component="ul" aria-label="Errores y advertencias" sx={{ listStyle: 'none', m: 0, mt: 1, p: 0, display: 'grid', gap: 0.5 }}>
      {state.items.map((item, i) => (
        <Box
          component="li"
          key={i}
          sx={{ borderLeft: `3px solid ${LEVEL_COLORS[item.level] || LEVEL_COLORS.notice}`, pl: 1, py: 0.25, background: 'rgba(0, 0, 0, 0.2)', borderRadius: 0.5 }}
        >
          <Typography variant="caption" sx={{ color: LEVEL_COLORS[item.level], fontWeight: 600, mr: 1 }}>
            {LEVEL_LABELS[item.level] || 'Aviso'}
          </Typography>
          {item.path && (
            <Typography component="span" variant="caption" sx={{ ...monoSx, mr: 1 }}>
              {item.path}
              {item.startLine ? `:${item.startLine}` : ''}
            </Typography>
          )}
          <Typography component="span" variant="caption" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
            {item.title ? `${item.title}: ` : ''}
            {item.message}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

import FactCheckIcon from '@mui/icons-material/FactCheck';
import { Alert, Box, Button, Chip, CircularProgress, List, ListItem, Stack, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { auditTask } from '../../api/github';
import { errorMessage, isAbortError } from './githubUtils';

const VERDICT = {
  pass: { severity: 'success', label: 'Sin problemas' },
  warn: { severity: 'warning', label: 'Revisar' },
  fail: { severity: 'error', label: 'Problemas graves' },
};
const SEVERITY_COLOR = { high: '#f87171', medium: '#fbbf24', low: '#94a3b8' };

function Finding({ f }) {
  return (
    <ListItem divider sx={{ display: 'block', py: 0.75 }}>
      <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
        <Chip size="small" label={f.severity} sx={{ color: SEVERITY_COLOR[f.severity], fontWeight: 600 }} variant="outlined" />
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{f.title}</Typography>
        <Typography variant="caption" sx={{ fontFamily: 'monospace' }} color="text.secondary">
          {f.path}{f.line ? `:${f.line}` : ''}
        </Typography>
        {f.source !== 'rule' && <Chip size="small" label="IA, orientativo" variant="outlined" />}
      </Stack>
      {f.detail && <Typography variant="caption" component="div" sx={{ mt: 0.25 }}>{f.detail}</Typography>}
      {f.suggestion && <Typography variant="caption" component="div" color="text.secondary">→ {f.suggestion}</Typography>}
    </ListItem>
  );
}

/** AI actions over the task branch, run by the local AI server. */
export default function TaskAiPanel({ tid }) {
  const [state, setState] = useState({ loading: false, error: null, audit: null });
  const controller = useRef(null);

  useEffect(() => () => controller.current && controller.current.abort(), []);

  const runAudit = async () => {
    if (controller.current) controller.current.abort();
    controller.current = new AbortController();
    setState({ loading: true, error: null, audit: null });
    try {
      const audit = await auditTask(tid, { signal: controller.current.signal });
      setState({ loading: false, error: null, audit });
    } catch (err) {
      if (isAbortError(err)) return;
      setState({ loading: false, audit: null, error: errorMessage(err, 'No se pudo auditar la rama.') });
    }
  };

  const { audit } = state;
  const verdict = audit && (VERDICT[audit.verdict] || VERDICT.warn);

  return (
    <Box component="section" aria-label="IA sobre la rama" sx={{ mt: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>IA sobre la rama</Typography>
        <Button size="small" variant="outlined" startIcon={<FactCheckIcon />} onClick={runAudit} disabled={state.loading}>
          Auditar
        </Button>
      </Stack>

      {state.loading && (
        <Stack role="status" direction="row" spacing={1} alignItems="center" sx={{ py: 1 }}>
          <CircularProgress size={18} />
          <Typography variant="caption">Auditando con el modelo local (puede tardar ~20 s)…</Typography>
        </Stack>
      )}
      {state.error && <Alert severity="error" sx={{ mt: 1 }}>{state.error}</Alert>}

      {audit && (
        <Box sx={{ mt: 1 }}>
          <Alert severity={verdict.severity}>
            {verdict.label} · {audit.files ? audit.files.length : 0} archivos ·{' '}
            {audit.counts ? `${audit.counts.high} altos, ${audit.counts.medium} medios, ${audit.counts.low} bajos` : ''}
          </Alert>
          {audit.findings && audit.findings.length > 0 && (
            <List dense disablePadding>
              {audit.findings.map((f, i) => <Finding key={`${f.path}:${f.line}:${i}`} f={f} />)}
            </List>
          )}
        </Box>
      )}
    </Box>
  );
}

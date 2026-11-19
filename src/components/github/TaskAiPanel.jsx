import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import RateReviewIcon from '@mui/icons-material/RateReview';
import ScienceIcon from '@mui/icons-material/Science';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Link,
  List,
  ListItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { auditTask, generateTaskTests, getTaskReview, reviewTaskPr } from '../../api/github';
import { safeHttpsUrl } from './cicd/cicdUtils';
import { errorMessage, isAbortError } from './githubUtils';

const VERDICT = {
  pass: { severity: 'success', label: 'Sin problemas' },
  warn: { severity: 'warning', label: 'Revisar' },
  fail: { severity: 'error', label: 'Problemas graves' },
};
const SEVERITY_COLOR = { high: '#f87171', medium: '#fbbf24', low: '#94a3b8' };
const SYNTAX = {
  true: { label: 'sintaxis ok', color: 'success' },
  false: { label: 'inválido', color: 'error' },
  null: { label: 'sin verificar', color: 'default' },
};
const ACTIONS = {
  audit: { run: auditTask, wait: 'Auditando con el modelo local (puede tardar ~20 s)…', fail: 'No se pudo auditar la rama.' },
  tests: { run: generateTaskTests, wait: 'Generando pruebas con el modelo local (puede tardar ~30 s)…', fail: 'No se pudieron generar las pruebas.' },
  review: { run: reviewTaskPr, wait: 'Revisando el pull request (puede tardar ~30 s)…', fail: 'No se pudo revisar el pull request.' },
};
const POSTED = {
  posted: 'Publicada en GitHub',
  no_permission: 'No publicada en GitHub: la GitHub App necesita el permiso «Pull requests: write».',
  failed: 'No se pudo publicar en GitHub.',
};

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

function AuditResult({ audit }) {
  const verdict = VERDICT[audit.verdict] || VERDICT.warn;
  return (
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
  );
}

function Proposal({ p }) {
  const syntax = SYNTAX[String(p.syntax_ok)] || SYNTAX.null;
  const copy = () => navigator.clipboard && navigator.clipboard.writeText(p.code).catch(() => {});
  return (
    <Accordion disableGutters>
      <AccordionSummary>
        <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{p.test_path}</Typography>
          <Typography variant="caption" color="text.secondary">para {p.source}</Typography>
          <Chip size="small" label={p.framework} variant="outlined" />
          <Chip size="small" label={syntax.label} color={syntax.color} variant="outlined" />
          <Typography variant="caption">{p.cases.length} casos</Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        {p.problem && <Alert severity="warning" sx={{ mb: 1 }}>{p.problem}</Alert>}
        {p.cases.length > 0 && (
          <List dense disablePadding sx={{ mb: 1 }}>
            {p.cases.map((c, i) => (
              <ListItem key={`${c.name}:${i}`} sx={{ py: 0 }}>
                <Typography variant="caption"><b>{c.name}</b>{c.covers ? ` — ${c.covers}` : ''}</Typography>
              </ListItem>
            ))}
          </List>
        )}
        {p.code && (
          <Box sx={{ position: 'relative' }}>
            <Tooltip title="Copiar">
              <IconButton size="small" onClick={copy} aria-label={`Copiar ${p.test_path}`} sx={{ position: 'absolute', top: 4, right: 4 }}>
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Box component="pre" sx={{ m: 0, p: 1.5, fontSize: 12, overflow: 'auto', maxHeight: 360, bgcolor: 'action.hover', borderRadius: 1 }}>
              {p.code}
            </Box>
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

function ReviewResult({ review }) {
  if (review.status === 'pending') return <Alert severity="info" sx={{ mt: 1 }}>Revisión en curso para el último commit…</Alert>;
  if (review.status === 'failed') {
    return <Alert severity="error" sx={{ mt: 1 }}>La última revisión falló ({review.errorCode || 'error'}).</Alert>;
  }
  const r = review.result || {};
  const verdict = VERDICT[review.verdict] || VERDICT.warn;
  const url = safeHttpsUrl(review.reviewUrl);
  return (
    <Box sx={{ mt: 1 }}>
      <Alert severity={verdict.severity}>
        PR #{review.prNumber} · commit {String(review.headSha || '').slice(0, 7)} · {verdict.label}
        {r.comments ? ` · ${r.comments.length} comentarios en línea` : ''}
      </Alert>
      {r.summary && <Typography variant="body2" sx={{ mt: 1 }}>{r.summary}</Typography>}
      {r.risks && r.risks.length > 0 && (
        <List dense disablePadding>
          {r.risks.map((risk, i) => (
            <ListItem key={i} sx={{ py: 0 }}><Typography variant="caption">• {risk}</Typography></ListItem>
          ))}
        </List>
      )}
      <Typography variant="caption" component="div" color="text.secondary" sx={{ mt: 0.5 }}>
        {review.posted === 'posted' && url
          ? <Link href={url} target="_blank" rel="noopener noreferrer">{POSTED.posted}</Link>
          : POSTED[review.posted]}
      </Typography>
    </Box>
  );
}

function TestsResult({ tests }) {
  const proposals = tests.proposals || [];
  return (
    <Box sx={{ mt: 1 }}>
      <Alert severity="info" sx={{ mb: 1 }}>
        {proposals.length} {proposals.length === 1 ? 'archivo de pruebas propuesto' : 'archivos de pruebas propuestos'}.
        No se ejecutaron ni se subieron: revísalos antes de agregarlos a la rama.
      </Alert>
      {proposals.map((p) => <Proposal key={p.test_path} p={p} />)}
      {(tests.skipped || []).map((s) => (
        <Typography key={s.path} variant="caption" component="div" color="text.secondary">
          Omitido {s.path}: {s.reason}
        </Typography>
      ))}
    </Box>
  );
}

/** AI actions over the task branch, run by the local AI server. */
export default function TaskAiPanel({ tid, aiEnabled, prOpen }) {
  const [state, setState] = useState({ loading: null, error: null, audit: null, tests: null, review: null });
  const controller = useRef(null);

  useEffect(() => () => controller.current && controller.current.abort(), []);

  // The webhook reviews task PRs on its own: show the stored result when the panel opens.
  useEffect(() => {
    if (!aiEnabled || !tid) return undefined;
    const ac = new AbortController();
    getTaskReview(tid, { signal: ac.signal })
      .then((review) => review && setState((s) => (s.review ? s : { ...s, review })))
      .catch(() => {});
    return () => ac.abort();
  }, [tid, aiEnabled]);

  const run = async (kind) => {
    if (controller.current) controller.current.abort();
    controller.current = new AbortController();
    setState((s) => ({ ...s, loading: kind, error: null }));
    try {
      const result = await ACTIONS[kind].run(tid, { signal: controller.current.signal });
      setState((s) => ({ ...s, loading: null, [kind]: result }));
    } catch (err) {
      if (isAbortError(err)) return;
      setState((s) => ({ ...s, loading: null, error: errorMessage(err, ACTIONS[kind].fail) }));
    }
  };

  if (!aiEnabled) {
    return (
      <Alert severity="info" sx={{ mt: 2 }}>
        El análisis con IA está desactivado para este proyecto; un administrador puede activarlo en GitHub.
      </Alert>
    );
  }

  return (
    <Box component="section" aria-label="IA sobre la rama" sx={{ mt: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>IA sobre la rama</Typography>
        <Button size="small" variant="outlined" startIcon={<FactCheckIcon />} onClick={() => run('audit')} disabled={Boolean(state.loading)}>
          Auditar
        </Button>
        <Button size="small" variant="outlined" startIcon={<ScienceIcon />} onClick={() => run('tests')} disabled={Boolean(state.loading)}>
          Generar pruebas
        </Button>
        {prOpen && (
          <Button size="small" variant="outlined" startIcon={<RateReviewIcon />} onClick={() => run('review')} disabled={Boolean(state.loading)}>
            Revisar PR
          </Button>
        )}
      </Stack>

      {state.loading && (
        <Stack role="status" direction="row" spacing={1} alignItems="center" sx={{ py: 1 }}>
          <CircularProgress size={18} />
          <Typography variant="caption">{ACTIONS[state.loading].wait}</Typography>
        </Stack>
      )}
      {state.error && <Alert severity="error" sx={{ mt: 1 }}>{state.error}</Alert>}
      {state.audit && <AuditResult audit={state.audit} />}
      {state.review && <ReviewResult review={state.review} />}
      {state.tests && <TestsResult tests={state.tests} />}
    </Box>
  );
}

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
  pass: { severity: 'success', label: 'No issues' },
  warn: { severity: 'warning', label: 'Needs review' },
  fail: { severity: 'error', label: 'Serious issues' },
};
const SEVERITY_COLOR = { high: '#f87171', medium: '#fbbf24', low: '#94a3b8' };
const SYNTAX = {
  true: { label: 'syntax ok', color: 'success' },
  false: { label: 'invalid', color: 'error' },
  null: { label: 'not checked', color: 'default' },
};
const ACTIONS = {
  audit: { run: auditTask, wait: 'Auditing with the local model (can take ~20 s)…', fail: 'Could not audit the branch.' },
  tests: { run: generateTaskTests, wait: 'Generating tests with the local model (can take ~30 s)…', fail: 'Could not generate the tests.' },
  review: { run: reviewTaskPr, wait: 'Reviewing the pull request (can take ~30 s)…', fail: 'Could not review the pull request.' },
};
const POSTED = {
  posted: 'Posted on GitHub',
  no_permission: 'Not posted on GitHub: the GitHub App needs the “Pull requests: write” permission.',
  failed: 'Could not post on GitHub.',
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
        {f.source !== 'rule' && <Chip size="small" label="AI, advisory" variant="outlined" />}
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
        {verdict.label} · {audit.files ? audit.files.length : 0} files ·{' '}
        {audit.counts ? `${audit.counts.high} high, ${audit.counts.medium} medium, ${audit.counts.low} low` : ''}
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
            <Tooltip title="Copy">
              <IconButton size="small" onClick={copy} aria-label={`Copy ${p.test_path}`} sx={{ position: 'absolute', top: 4, right: 4 }}>
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
  if (review.status === 'pending') return <Alert severity="info" sx={{ mt: 1 }}>Review in progress for the latest commit…</Alert>;
  if (review.status === 'failed') {
    return <Alert severity="error" sx={{ mt: 1 }}>The last review failed ({review.errorCode || 'error'}).</Alert>;
  }
  const r = review.result || {};
  const verdict = VERDICT[review.verdict] || VERDICT.warn;
  const url = safeHttpsUrl(review.reviewUrl);
  return (
    <Box sx={{ mt: 1 }}>
      <Alert severity={verdict.severity}>
        PR #{review.prNumber} · commit {String(review.headSha || '').slice(0, 7)} · {verdict.label}
        {r.comments ? ` · ${r.comments.length} inline comments` : ''}
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
        {proposals.length} {proposals.length === 1 ? 'proposed test file' : 'proposed test files'}.
        They were not run or pushed: review them before adding them to the branch.
      </Alert>
      {proposals.map((p) => <Proposal key={p.test_path} p={p} />)}
      {(tests.skipped || []).map((s) => (
        <Typography key={s.path} variant="caption" component="div" color="text.secondary">
          Skipped {s.path}: {s.reason}
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
        AI analysis is turned off for this project; an admin can turn it on from the GitHub page.
      </Alert>
    );
  }

  return (
    <Box component="section" aria-label="AI on the branch" sx={{ mt: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>AI on the branch</Typography>
        <Button size="small" variant="outlined" startIcon={<FactCheckIcon />} onClick={() => run('audit')} disabled={Boolean(state.loading)}>
          Audit
        </Button>
        <Button size="small" variant="outlined" startIcon={<ScienceIcon />} onClick={() => run('tests')} disabled={Boolean(state.loading)}>
          Generate tests
        </Button>
        {prOpen && (
          <Button size="small" variant="outlined" startIcon={<RateReviewIcon />} onClick={() => run('review')} disabled={Boolean(state.loading)}>
            Review PR
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

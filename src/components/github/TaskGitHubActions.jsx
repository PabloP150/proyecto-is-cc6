import CallSplitIcon from '@mui/icons-material/CallSplit';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { Alert, Box, Chip, CircularProgress, IconButton, Snackbar, Tooltip } from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createTaskBranch } from '../../api/github';
import { errorMessage, safeGitHubUrl } from './githubUtils';

const PR_STYLES = {
  open: { label: 'abierto', color: '#10b981', background: 'rgba(16, 185, 129, 0.15)' },
  draft: { label: 'borrador', color: '#cbd5e1', background: 'rgba(148, 163, 184, 0.18)' },
  closed: { label: 'cerrado', color: '#f87171', background: 'rgba(239, 68, 68, 0.15)' },
  merged: { label: 'fusionado', color: '#c084fc', background: 'rgba(168, 85, 247, 0.18)' },
};

export function prStatus(pr) {
  if (!pr) return null;
  if (pr.state === 'merged' || pr.mergedAt) return 'merged';
  if (pr.state === 'closed') return 'closed';
  return pr.isDraft ? 'draft' : 'open';
}

const iconButtonSx = {
  color: 'white',
  background: 'rgba(59, 130, 246, 0.1)',
  border: '1px solid rgba(59, 130, 246, 0.3)',
  borderRadius: 1,
  transition: 'all 0.3s cubic-bezier(.4, 2, .3, 1)',
  '&:hover': {
    background: 'rgba(59, 130, 246, 0.2)',
    transform: 'scale(1.1)',
    boxShadow: '0 4px 12px 0 rgba(59, 130, 246, 0.3)',
  },
};

const stop = (event) => event.stopPropagation();

/**
 * Branch/PR controls for one task. `link` comes from useTaskLinks().getLink(tid);
 * `onChange(result)` fires after a branch is created so the parent can refresh its links.
 */
export default function TaskGitHubActions({ tid, link, repoConnected, onChange }) {
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The freshly created branch shows immediately, before the parent refreshes `link`.
  const branchName = (link && link.branchName) || (created && created.branchName) || null;
  const branchHref = safeGitHubUrl((link && link.branchUrl) || (created && created.branchUrl));
  const pr = link ? link.pr : null;

  const handleCreate = useCallback(
    async (event) => {
      event.stopPropagation();
      if (creating) return;
      setCreating(true);
      try {
        const result = await createTaskBranch(tid);
        if (!mounted.current) return;
        setCreated(result);
        setFeedback({
          open: true,
          severity: 'success',
          message: result && result.branchName ? `Rama ${result.branchName} lista en GitHub.` : 'Rama lista en GitHub.',
        });
        if (onChange) onChange(result);
      } catch (err) {
        if (!mounted.current) return;
        setFeedback({ open: true, severity: 'error', message: errorMessage(err, 'No se pudo crear la rama.') });
      } finally {
        if (mounted.current) setCreating(false);
      }
    },
    [creating, onChange, tid]
  );

  const handleCopy = useCallback(
    async (event) => {
      event.stopPropagation();
      const command = `git checkout ${branchName}`;
      try {
        if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('clipboard');
        await navigator.clipboard.writeText(command);
        setFeedback({ open: true, severity: 'success', message: `Comando copiado: ${command}` });
      } catch {
        setFeedback({ open: true, severity: 'warning', message: `No se pudo copiar. Ejecuta: ${command}` });
      }
    },
    [branchName]
  );

  const closeFeedback = (event, reason) => {
    if (reason === 'clickaway') return;
    setFeedback((prev) => (prev ? { ...prev, open: false } : prev));
  };

  if (!repoConnected) return null;

  const status = prStatus(pr);
  const prStyle = status ? PR_STYLES[status] : null;
  const prHref = pr ? safeGitHubUrl(pr.htmlUrl) : null;

  return (
    <Box
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', minWidth: 0 }}
      onClick={stop}
    >
      {branchName ? (
        <>
          <Tooltip title={`Copiar «git checkout ${branchName}»`} arrow>
            <Chip
              icon={<CallSplitIcon />}
              label={branchName}
              size="small"
              onClick={handleCopy}
              aria-label={`Rama ${branchName}. Copiar comando git checkout`}
              sx={{
                maxWidth: 240,
                fontFamily: 'monospace',
                color: '#e2e8f0',
                background: 'rgba(59, 130, 246, 0.15)',
                border: '1px solid rgba(59, 130, 246, 0.35)',
                '& .MuiChip-icon': { color: '#93c5fd' },
              }}
            />
          </Tooltip>
          {branchHref && (
            <Tooltip title="Ver rama en GitHub" arrow>
              <IconButton
                component="a"
                href={branchHref}
                target="_blank"
                rel="noopener noreferrer"
                size="small"
                aria-label="Ver rama en GitHub"
                onClick={stop}
                sx={iconButtonSx}
              >
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </>
      ) : (
        <Tooltip title="Crear rama en GitHub" arrow>
          <span>
            <IconButton
              size="small"
              aria-label="Crear rama en GitHub"
              aria-busy={creating}
              disabled={creating}
              onClick={handleCreate}
              sx={iconButtonSx}
            >
              {creating ? <CircularProgress size={18} aria-label="Creando rama" /> : <CallSplitIcon fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
      )}

      {pr && prStyle && (
        <Tooltip title={pr.title ? String(pr.title) : `Pull request #${pr.number}`} arrow>
          <Chip
            size="small"
            label={`PR #${pr.number} ${prStyle.label}`}
            aria-label={`PR #${pr.number} ${prStyle.label}${pr.title ? `: ${pr.title}` : ''}`}
            data-status={status}
            {...(prHref
              ? { component: 'a', href: prHref, target: '_blank', rel: 'noopener noreferrer', clickable: true, onClick: stop }
              : {})}
            sx={{
              fontWeight: 600,
              color: prStyle.color,
              background: prStyle.background,
              border: `1px solid ${prStyle.color}55`,
            }}
          />
        </Tooltip>
      )}

      <Snackbar
        open={Boolean(feedback && feedback.open)}
        autoHideDuration={3500}
        onClose={closeFeedback}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {feedback ? (
          <Alert onClose={closeFeedback} severity={feedback.severity} variant="filled" sx={{ width: '100%' }}>
            {feedback.message}
          </Alert>
        ) : (
          <span />
        )}
      </Snackbar>
    </Box>
  );
}

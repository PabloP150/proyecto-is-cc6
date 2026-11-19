import DescriptionIcon from '@mui/icons-material/Description';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Link,
  List,
  ListItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { getTaskFiles, getTaskOverlaps } from '../../api/github';
import { blobUrl, errorMessage, isAbortError, repoHtmlUrl } from './githubUtils';
import TaskAiPanel from './TaskAiPanel';

// Matches the CHECK constraint on dbo.TaskFiles, so an unknown status cannot render.
const STATUS_META = {
  added: { label: 'nuevo', color: '#10b981' },
  modified: { label: 'modificado', color: '#60a5fa' },
  removed: { label: 'eliminado', color: '#f87171' },
  renamed: { label: 'renombrado', color: '#c084fc' },
  copied: { label: 'copiado', color: '#94a3b8' },
  changed: { label: 'cambiado', color: '#60a5fa' },
};

const statusMeta = (status) => STATUS_META[status] || { label: status || '—', color: '#94a3b8' };

function FileRow({ file, repoUrl, ref_, overlappingTasks }) {
  const { label, color } = statusMeta(file.status);
  // A removed file has no blob to open at the head commit; link the others.
  const href = file.status === 'removed' ? null : blobUrl(repoUrl, ref_, file.path);

  return (
    <ListItem divider sx={{ display: 'block', py: 1 }}>
      <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
        <Chip
          label={label}
          size="small"
          sx={{ color, background: `${color}22`, fontWeight: 600, minWidth: 92 }}
        />
        <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', flexGrow: 1 }}>
          {file.path}
        </Typography>

        {(file.additions > 0 || file.deletions > 0) && (
          <Typography variant="caption" sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
            <Box component="span" sx={{ color: '#10b981' }}>+{file.additions}</Box>{' '}
            <Box component="span" sx={{ color: '#f87171' }}>−{file.deletions}</Box>
          </Typography>
        )}

        {href && (
          <Tooltip title="Abrir en GitHub">
            <IconButton
              component={Link}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              size="small"
              aria-label={`Abrir ${file.path} en GitHub`}
            >
              <OpenInNewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Stack>

      {/* Groundwork for Fase 7: another task touching the same path is a merge conflict waiting. */}
      {overlappingTasks && overlappingTasks.length > 0 && (
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5, pl: 1 }}>
          <WarningAmberIcon fontSize="inherit" sx={{ color: '#fbbf24' }} />
          <Typography variant="caption" sx={{ color: '#fbbf24' }}>
            También lo tocan: {overlappingTasks.map((t) => t.taskName || t.tid.slice(0, 8)).join(', ')}
          </Typography>
        </Stack>
      )}
    </ListItem>
  );
}

/**
 * The files a task changed, with direct links to their paths on GitHub.
 *
 * The proposal's "interfaz de tareas más detallada": a task should show the code and
 * documentation it actually touched, not just its branch and PR.
 */
export default function TaskFilesDialog({ open, onClose, tid, taskName, link, repo }) {
  const [state, setState] = useState({ files: [], overlaps: [], loading: true, error: null, backfilled: false });

  useEffect(() => {
    if (!open || !tid) return undefined;
    const controller = new AbortController();
    let active = true;

    setState((s) => ({ ...s, loading: true, error: null }));

    (async () => {
      try {
        const result = await getTaskFiles(tid, { signal: controller.signal });
        if (!active) return;
        const files = (result && result.files) || [];

        // Overlaps are extra context: a failure there must not hide the file list.
        let overlaps = [];
        if (files.length > 0) {
          try {
            const found = await getTaskOverlaps(tid, { signal: controller.signal });
            overlaps = (found && found.overlaps) || [];
          } catch {
            overlaps = [];
          }
        }

        if (active) {
          setState({
            files,
            overlaps,
            loading: false,
            error: null,
            backfilled: Boolean(result && result.backfilled),
          });
        }
      } catch (err) {
        if (!active || isAbortError(err)) return;
        setState({
          files: [],
          overlaps: [],
          loading: false,
          backfilled: false,
          error: errorMessage(err, 'No se pudieron cargar los archivos de la tarea.'),
        });
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [open, tid]);

  const repoUrl = repoHtmlUrl(repo);
  // Prefer the commit the files were read at, so links point at the code as the task left it.
  const ref_ = (state.files[0] && state.files[0].headSha) || (link && link.branchName) || (repo && repo.defaultBranch);

  const overlapsByPath = state.overlaps.reduce((acc, item) => {
    (acc[item.path] = acc[item.path] || []).push(item);
    return acc;
  }, {});

  const totals = state.files.reduce(
    (acc, f) => ({ additions: acc.additions + (f.additions || 0), deletions: acc.deletions + (f.deletions || 0) }),
    { additions: 0, deletions: 0 },
  );

  return (
    <Dialog open={Boolean(open)} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <DescriptionIcon />
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="h6" noWrap>
              Archivos de la tarea
            </Typography>
            {taskName && (
              <Typography variant="body2" color="text.secondary" noWrap>
                {taskName}
              </Typography>
            )}
          </Box>
          {link && link.pr && link.pr.number && repoUrl && (
            <Link
              href={`${repoUrl}/pull/${link.pr.number}`}
              target="_blank"
              rel="noopener noreferrer"
              variant="body2"
            >
              PR #{link.pr.number}
            </Link>
          )}
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        {state.loading && (
          <Box role="status" sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={26} />
          </Box>
        )}

        {!state.loading && state.error && <Alert severity="error">{state.error}</Alert>}

        {!state.loading && !state.error && state.files.length === 0 && (
          <Alert severity="info">
            Esta tarea todavía no tiene archivos registrados. Se registran automáticamente cuando
            se fusiona el pull request de su rama.
          </Alert>
        )}

        {!state.loading && !state.error && state.files.length > 0 && (
          <>
            <Stack direction="row" spacing={2} sx={{ mb: 1 }} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="body2" color="text.secondary">
                {state.files.length} {state.files.length === 1 ? 'archivo' : 'archivos'}
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                <Box component="span" sx={{ color: '#10b981' }}>+{totals.additions}</Box>{' '}
                <Box component="span" sx={{ color: '#f87171' }}>−{totals.deletions}</Box>
              </Typography>
              {state.backfilled && (
                <Chip size="small" label="recuperado de GitHub" variant="outlined" />
              )}
            </Stack>
            <Divider />
            <List disablePadding>
              {state.files.map((file) => (
                <FileRow
                  key={file.path}
                  file={file}
                  repoUrl={repoUrl}
                  ref_={ref_}
                  overlappingTasks={overlapsByPath[file.path]}
                />
              ))}
            </List>
          </>
        )}

        {link && link.branchName && <TaskAiPanel
            tid={tid}
            aiEnabled={Boolean(repo && repo.aiAnalysisEnabled)}
            prOpen={Boolean(link.pr && link.pr.state === 'open')}
          />}
      </DialogContent>
    </Dialog>
  );
}

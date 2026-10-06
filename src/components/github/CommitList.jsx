import RefreshIcon from '@mui/icons-material/Refresh';
import { Alert, Box, CircularProgress, IconButton, Link, List, ListItem, Tooltip, Typography } from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { getCommits } from '../../api/github';
import Button from '../ui/Button';
import { errorMessage, formatDateTime, formatRelativeDate, isAbortError, safeGitHubUrl } from './githubUtils';

const PER_PAGE = 30;

const firstLine = (message) => String(message || '').split(/\r?\n/)[0].trim() || '(sin mensaje)';

/** Latest commits of the group's repository. Props: gid, gitRef (optional branch/sha). */
export default function CommitList({ gid, gitRef }) {
  const [state, setState] = useState({ loading: true, error: null, commits: [] });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!gid) {
      setState({ loading: false, error: null, commits: [] });
      return undefined;
    }
    const controller = new AbortController();
    let active = true;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    getCommits(gid, { ref: gitRef, perPage: PER_PAGE, signal: controller.signal })
      .then((data) => {
        if (active) setState({ loading: false, error: null, commits: Array.isArray(data) ? data : [] });
      })
      .catch((err) => {
        if (!active || isAbortError(err)) return;
        setState({ loading: false, error: errorMessage(err, 'No se pudieron cargar los commits.'), commits: [] });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [gid, gitRef, version]);

  const { loading, error, commits } = state;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="h6" component="h2">
          Commits recientes
        </Typography>
        <Tooltip title="Actualizar" arrow>
          <span>
            <IconButton onClick={reload} disabled={loading} aria-label="Actualizar commits" size="small">
              <RefreshIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {loading && commits.length === 0 && (
        <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 4, justifyContent: 'center' }}>
          <CircularProgress size={22} />
          <Typography color="text.secondary">Cargando commits…</Typography>
        </Box>
      )}

      {error && (
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
      )}

      {!loading && !error && commits.length === 0 && (
        <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
          Este repositorio todavía no tiene commits.
        </Typography>
      )}

      {commits.length > 0 && (
        <List disablePadding aria-label="Commits recientes" aria-busy={loading}>
          {commits.map((commit) => {
            const href = safeGitHubUrl(commit.htmlUrl);
            const shortSha = String(commit.shortSha || String(commit.sha || '').slice(0, 7));
            const title = firstLine(commit.message);
            const author = commit.authorLogin || commit.authorName || 'Autor desconocido';
            return (
              <ListItem
                key={commit.sha || shortSha}
                disableGutters
                sx={{ gap: 1.5, alignItems: 'flex-start', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', py: 1.25 }}
              >
                <Box
                  component={href ? 'a' : 'span'}
                  {...(href ? { href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Ver commit ${shortSha} en GitHub` } : {})}
                  sx={{
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                    px: 1,
                    py: 0.25,
                    borderRadius: 1,
                    color: '#93c5fd',
                    background: 'rgba(59, 130, 246, 0.12)',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    textDecoration: 'none',
                    flexShrink: 0,
                    '&:hover': href ? { background: 'rgba(59, 130, 246, 0.25)' } : undefined,
                    '&:focus-visible': { outline: '2px solid #3b82f6', outlineOffset: 2 },
                  }}
                >
                  {shortSha}
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" noWrap title={title} sx={{ fontWeight: 500 }}>
                    {href ? (
                      <Link href={href} target="_blank" rel="noopener noreferrer" color="inherit" underline="hover" tabIndex={-1}>
                        {title}
                      </Link>
                    ) : (
                      title
                    )}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {author}
                    {commit.date && (
                      <>
                        {' · '}
                        <time dateTime={String(commit.date)} title={formatDateTime(commit.date)}>
                          {formatRelativeDate(commit.date)}
                        </time>
                      </>
                    )}
                  </Typography>
                </Box>
              </ListItem>
            );
          })}
        </List>
      )}
    </Box>
  );
}

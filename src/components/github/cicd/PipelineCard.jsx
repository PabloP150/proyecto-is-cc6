import BuildCircleIcon from '@mui/icons-material/BuildCircle';
import TuneIcon from '@mui/icons-material/Tune';
import { Alert, Box, Chip, CircularProgress, Link, Typography } from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { getPipeline } from '../../../api/github';
import Button from '../../ui/Button';
import Card from '../../ui/Card';
import { errorMessage, formatDateTime, isAbortError, repoHtmlUrl, staticCardSx } from '../githubUtils';
import { monoSx, safeHttpsUrl, STACK_LABELS } from './cicdUtils';

function PagesStatus({ pages }) {
  if (!pages) return null;
  if (pages.error === 'APP_PERMISSIONS_MISSING') {
    return (
      <Alert severity="warning" sx={{ mt: 1.5 }}>
        TaskMate cannot read GitHub Pages because the CI/CD permissions of the App have not been accepted yet.
      </Alert>
    );
  }
  if (pages.enabled === false) {
    return (
      <Alert severity="warning" sx={{ mt: 1.5 }}>
        GitHub Pages is disabled in the repository. An admin can push the pipeline again to enable it.
      </Alert>
    );
  }
  const url = safeHttpsUrl(pages.url);
  return url ? (
    <Typography variant="body2" sx={{ mt: 1 }}>
      Site:{' '}
      <Link href={url} target="_blank" rel="noopener noreferrer" sx={monoSx}>
        {url}
      </Link>
    </Typography>
  ) : null;
}

// The workflow on GitHub was written by an older TaskMate template, or was removed from the repo.
function WorkflowStatus({ workflow, isAdmin }) {
  if (!workflow) return null;
  if (workflow.present === false) {
    return (
      <Alert severity="warning" sx={{ mt: 1.5 }}>
        The TaskMate workflow is no longer in the repository, so the pipeline does not run.{' '}
        {isAdmin ? 'Click “Edit pipeline” and push it again.' : 'Ask the group admin to push it again.'}
      </Alert>
    );
  }
  if (!workflow.outdated) return null;
  return (
    <Alert severity="info" sx={{ mt: 1.5 }}>
      The repository workflow comes from an older TaskMate version and lacks the latest improvements (queued deploys, no
      rebuilding the other environment).{' '}
      {isAdmin ? 'Click “Edit pipeline” and push it again to update it.' : 'Ask the group admin to push it again.'}
    </Alert>
  );
}

/**
 * The TaskMate pipeline of the group's repository (or a prompt to configure it).
 * Props: gid, repo, isAdmin, refreshKey, onConfigure(), onLoaded(data).
 */
export default function PipelineCard({ gid, repo, isAdmin, refreshKey = 0, onConfigure, onLoaded }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));
    getPipeline(gid, { signal: controller.signal })
      .then((data) => {
        setState({ loading: false, error: null, data });
        if (onLoaded) onLoaded(data);
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        setState({ loading: false, error: errorMessage(err, 'Could not load the pipeline.'), data: null });
      });
    return () => controller.abort();
    // onLoaded is a notification for the parent; a new function identity must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gid, refreshKey, version]);

  const { loading, error, data } = state;
  const pipeline = data && data.pipeline;
  const repoUrl = repoHtmlUrl(repo);
  const workflowUrl = repoUrl && data ? `${repoUrl}/blob/${encodeURIComponent(repo.defaultBranch || 'main')}/${data.workflowPath}` : null;

  return (
    <Card variant="default" component="section" aria-label="CI/CD pipeline" sx={staticCardSx}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 1 }}>
        <BuildCircleIcon aria-hidden />
        <Typography variant="h6" component="h2" sx={{ flex: '1 1 auto' }}>
          CI/CD pipeline
        </Typography>
        {isAdmin && !loading && !error && (
          <Button variant={pipeline ? 'ghost' : 'primary'} size="small" startIcon={<TuneIcon />} onClick={onConfigure}>
            {pipeline ? 'Edit pipeline' : 'Set up pipeline'}
          </Button>
        )}
      </Box>

      {loading && !data && (
        <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 2 }}>
          <CircularProgress size={20} />
          <Typography color="text.secondary">Loading pipeline…</Typography>
        </Box>
      )}
      {error && (
        <Alert
          severity="error"
          action={
            <Button variant="ghost" size="small" onClick={reload}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {data && !pipeline && (
        <Typography color="text.secondary">
          {isAdmin
            ? 'This repository does not have a TaskMate pipeline yet. Set it up to build, test, analyze and deploy on every change.'
            : 'This repository does not have a TaskMate pipeline yet. Ask the group admin to set it up.'}
        </Typography>
      )}

      {pipeline && (
        <>
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1 }} aria-label="Stages">
            {pipeline.spec && pipeline.spec.project && (
              <Chip size="small" color="primary" variant="outlined" label={STACK_LABELS[pipeline.spec.project.stack] || pipeline.spec.project.stack} />
            )}
            {pipeline.stages.map((stage) => (
              <Chip key={stage.key} size="small" variant="outlined" label={stage.label} />
            ))}
          </Box>
          <Typography variant="caption" color="text.secondary" component="div">
            Configured by {pipeline.configuredBy || 'an admin'}
            {pipeline.configuredAt ? ` · ${formatDateTime(pipeline.configuredAt)}` : ''}
            {workflowUrl && (
              <>
                {' · '}
                <Link href={workflowUrl} target="_blank" rel="noopener noreferrer" sx={monoSx}>
                  {data.workflowPath}
                </Link>
              </>
            )}
          </Typography>
          <WorkflowStatus workflow={data.workflow} isAdmin={isAdmin} />
          <PagesStatus pages={data.pages} />
        </>
      )}
    </Card>
  );
}

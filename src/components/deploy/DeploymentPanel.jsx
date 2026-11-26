import CancelIcon from '@mui/icons-material/Cancel';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloudQueueIcon from '@mui/icons-material/CloudQueue';
import ErrorIcon from '@mui/icons-material/Error';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Link,
  List,
  ListItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { getDeployTarget, getDeployments, linkDeployTarget, unlinkDeployTarget } from '../../api/deploy';
import { errorMessage, formatDateTime, isAbortError, staticCardSx } from '../github/githubUtils';
import Button from '../ui/Button';
import Card from '../ui/Card';

// One entry per state in the Deployments CHECK constraint, so an unknown state is
// impossible rather than silently rendered as "unknown".
const STATE_META = {
  queued: { label: 'Queued', color: 'default', Icon: HourglassEmptyIcon },
  building: { label: 'Building', color: 'info', Icon: CloudQueueIcon },
  ready: { label: 'Deployed', color: 'success', Icon: CheckCircleIcon },
  error: { label: 'Failed', color: 'error', Icon: ErrorIcon },
  canceled: { label: 'Cancelled', color: 'warning', Icon: CancelIcon },
};

const stateMeta = (state) => STATE_META[state] || { label: state || '—', color: 'default', Icon: CloudQueueIcon };

function DeploymentRow({ deployment }) {
  const { label, color, Icon } = stateMeta(deployment.state);
  return (
    <ListItem divider sx={{ display: 'block', py: 1.5 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Chip icon={<Icon />} label={label} color={color} size="small" />
        {deployment.environment === 'production' ? (
          <Chip label="production" size="small" variant="outlined" />
        ) : (
          <Chip label="preview" size="small" variant="outlined" />
        )}
        {deployment.branch && (
          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
            {deployment.branch}
          </Typography>
        )}
        {deployment.commitSha && (
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
            {deployment.commitSha.slice(0, 7)}
          </Typography>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Typography variant="caption" color="text.secondary">
          {formatDateTime(deployment.updatedAt || deployment.createdAt)}
        </Typography>
      </Stack>

      {deployment.url && (
        <Link href={deployment.url} target="_blank" rel="noopener noreferrer" variant="body2">
          {deployment.url}
        </Link>
      )}

      {/* The proposal asks to "alertar sobre fallos en el pipeline": the reason is the alert. */}
      {deployment.state === 'error' && deployment.errorMessage && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {deployment.errorMessage}
        </Alert>
      )}
    </ListItem>
  );
}

function TargetSetup({ gid, isAdmin, onLinked }) {
  const [projectRef, setProjectRef] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleLink = async () => {
    setSaving(true);
    setError(null);
    try {
      await linkDeployTarget(gid, { provider: 'vercel', projectRef: projectRef.trim() });
      onLinked();
    } catch (err) {
      setError(errorMessage(err, 'Could not link the Vercel project.'));
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <Alert severity="info">
        This group does not have a deployment project linked yet. A group admin
        can link it.
      </Alert>
    );
  }

  return (
    <Stack spacing={2}>
      <Alert severity="info">
        Paste the Vercel <strong>Project ID</strong> (Settings → General) and add the webhook
        <Typography component="span" sx={{ fontFamily: 'monospace', mx: 0.5 }}>
          /api/deploy/webhook/vercel
        </Typography>
        in Vercel for <em>deployment</em> events.
      </Alert>
      {error && <Alert severity="error">{error}</Alert>}
      <Stack direction="row" spacing={1}>
        <TextField
          label="Vercel Project ID"
          size="small"
          fullWidth
          value={projectRef}
          onChange={(event) => setProjectRef(event.target.value)}
          placeholder="prj_XXXXXXXXXXXXXXXXXXXX"
          inputProps={{ 'aria-label': 'Vercel Project ID' }}
        />
        <Button onClick={handleLink} disabled={saving || !projectRef.trim()}>
          {saving ? 'Vinculando…' : 'Vincular'}
        </Button>
      </Stack>
    </Stack>
  );
}

/**
 * Deployment lifecycle for a group: the Vercel project it is linked to, and the deployments
 * reported by that project's webhooks.
 */
export default function DeploymentPanel({ gid, isAdmin = false }) {
  const [target, setTarget] = useState(null);
  const [deployments, setDeployments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!gid) return undefined;
    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setError(null);

    (async () => {
      try {
        const linked = await getDeployTarget(gid, { signal: controller.signal });
        if (!active) return;
        setTarget(linked);
        // Only ask for deployments once we know there is somewhere they could come from.
        setDeployments(linked ? await getDeployments(gid, { limit: 20, signal: controller.signal }) || [] : []);
      } catch (err) {
        if (!active || isAbortError(err)) return;
        setError(errorMessage(err, 'Could not load the deployments.'));
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [gid, version]);

  const handleUnlink = async () => {
    try {
      await unlinkDeployTarget(gid, { provider: 'vercel' });
      refresh();
    } catch (err) {
      setError(errorMessage(err, 'Could not unlink the project.'));
    }
  };

  if (loading) {
    return (
      <Box role="status" sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  return (
    <Card sx={staticCardSx}>
      <Stack spacing={2} sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Deployments
          </Typography>
          {target && (
            <>
              <Button variant="text" onClick={refresh}>
                Refresh
              </Button>
              {isAdmin && (
                <Button variant="text" color="error" startIcon={<LinkOffIcon />} onClick={handleUnlink}>
                  Unlink
                </Button>
              )}
            </>
          )}
        </Stack>

        {error && <Alert severity="error">{error}</Alert>}

        {!target && <TargetSetup gid={gid} isAdmin={isAdmin} onLinked={refresh} />}

        {target && (
          <>
            <Typography variant="body2" color="text.secondary">
              Vercel project:{' '}
              <Typography component="span" sx={{ fontFamily: 'monospace' }}>
                {target.projectRef}
              </Typography>
            </Typography>

            {deployments.length === 0 ? (
              <Alert severity="info">
                No deployments received yet. They will show up here as soon as Vercel sends the
                first webhook.
              </Alert>
            ) : (
              <List disablePadding>
                {deployments.map((deployment) => (
                  <DeploymentRow
                    key={`${deployment.provider}:${deployment.deploymentId}`}
                    deployment={deployment}
                  />
                ))}
              </List>
            )}
          </>
        )}
      </Stack>
    </Card>
  );
}

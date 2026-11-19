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
  queued: { label: 'En cola', color: 'default', Icon: HourglassEmptyIcon },
  building: { label: 'Compilando', color: 'info', Icon: CloudQueueIcon },
  ready: { label: 'Desplegado', color: 'success', Icon: CheckCircleIcon },
  error: { label: 'Falló', color: 'error', Icon: ErrorIcon },
  canceled: { label: 'Cancelado', color: 'warning', Icon: CancelIcon },
};

const stateMeta = (state) => STATE_META[state] || { label: state || '—', color: 'default', Icon: CloudQueueIcon };

function DeploymentRow({ deployment }) {
  const { label, color, Icon } = stateMeta(deployment.state);
  return (
    <ListItem divider sx={{ display: 'block', py: 1.5 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Chip icon={<Icon />} label={label} color={color} size="small" />
        {deployment.environment === 'production' ? (
          <Chip label="producción" size="small" variant="outlined" />
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
      setError(errorMessage(err, 'No se pudo vincular el proyecto de Vercel.'));
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <Alert severity="info">
        Este grupo todavía no tiene un proyecto de despliegue vinculado. Un administrador del grupo
        puede vincularlo.
      </Alert>
    );
  }

  return (
    <Stack spacing={2}>
      <Alert severity="info">
        Pega el <strong>Project ID</strong> de Vercel (Settings → General) y añade el webhook
        <Typography component="span" sx={{ fontFamily: 'monospace', mx: 0.5 }}>
          /api/deploy/webhook/vercel
        </Typography>
        en Vercel para los eventos de <em>deployment</em>.
      </Alert>
      {error && <Alert severity="error">{error}</Alert>}
      <Stack direction="row" spacing={1}>
        <TextField
          label="Project ID de Vercel"
          size="small"
          fullWidth
          value={projectRef}
          onChange={(event) => setProjectRef(event.target.value)}
          placeholder="prj_XXXXXXXXXXXXXXXXXXXX"
          inputProps={{ 'aria-label': 'Project ID de Vercel' }}
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
        setError(errorMessage(err, 'No se pudieron cargar los despliegues.'));
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
      setError(errorMessage(err, 'No se pudo desvincular el proyecto.'));
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
            Despliegues
          </Typography>
          {target && (
            <>
              <Button variant="text" onClick={refresh}>
                Actualizar
              </Button>
              {isAdmin && (
                <Button variant="text" color="error" startIcon={<LinkOffIcon />} onClick={handleUnlink}>
                  Desvincular
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
              Proyecto de Vercel:{' '}
              <Typography component="span" sx={{ fontFamily: 'monospace' }}>
                {target.projectRef}
              </Typography>
            </Typography>

            {deployments.length === 0 ? (
              <Alert severity="info">
                Todavía no se han recibido despliegues. Aparecerán aquí en cuanto Vercel envíe el
                primer webhook.
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

import CloudDoneIcon from '@mui/icons-material/CloudDone';
import HistoryIcon from '@mui/icons-material/History';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import UndoIcon from '@mui/icons-material/Undo';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Link,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import {
  approveDeployRequest,
  cancelDeployRequest,
  deployNow,
  getDeployments,
  rejectDeployRequest,
  requestDeploy,
} from '../../../api/github';
import { useGroupEvents, useRealtime } from '../../realtime/RealtimeContext';
import Button from '../../ui/Button';
import Card from '../../ui/Card';
import { errorMessage, formatDateTime, formatRelativeDate, isAbortError, repoHtmlUrl, sameId, staticCardSx } from '../githubUtils';
import { monoSx, safeHttpsUrl } from './cicdUtils';
import useVisibleInterval from './useVisibleInterval';

const POLL_MS = 15 * 1000;
// With the live connection, a deploy in progress is still checked now and then: an event can be lost.
const SAFETY_POLL_MS = 60 * 1000;
// A deploy TaskMate just started has no GitHub Deployment until its run reaches the step that creates
// it (the run may queue behind another deploy): until the panel shows it, it is checked as if it
// were in progress, for at most this long.
const AWAIT_DEPLOY_MS = 10 * 60 * 1000;
// The newest deploy of an environment (history is newest first); a different one means a new Deployment.
const newestDeployKey = (history, environment) => {
  const newest = (Array.isArray(history) ? history : []).find((deploy) => deploy.environment === environment);
  return newest ? [newest.id, newest.sha, newest.createdAt].join('|') : '';
};
const ENV_LABELS = { staging: 'Staging', production: 'Producción' };
const envName = (environment) => (ENV_LABELS[environment] || String(environment || '')).toLowerCase();
// The request or the version changed under the user (someone else acted, staging moved): reload so
// the panel shows what is true now; the error stays in the dialog.
const OUTDATED_CODES = new Set([
  'DEPLOY_REQUEST_STALE',
  'DEPLOY_REQUEST_DECIDED',
  'DEPLOY_REQUEST_NOT_FOUND',
  'DEPLOY_REQUEST_PENDING',
  'VERSION_NOT_STAGING',
]);
const STATE_LABELS = {
  success: 'Publicado',
  inactive: 'Reemplazado',
  failure: 'Falló',
  error: 'Falló',
  in_progress: 'Desplegando',
  queued: 'En cola',
  pending: 'Pendiente',
  waiting: 'Esperando',
};
const STATE_COLORS = { success: 'success', failure: 'error', error: 'error', in_progress: 'warning', queued: 'info', pending: 'info', waiting: 'info' };
const REQUEST_LABELS = { pending: 'Pendiente', approved: 'Aprobada', rejected: 'Rechazada', cancelled: 'Cancelada' };
const REQUEST_COLORS = { pending: 'warning', approved: 'success', rejected: 'error', cancelled: 'default' };

const commitLink = (repo, sha) => {
  const base = repoHtmlUrl(repo);
  return base && /^[0-9a-f]{40}$/i.test(sha || '') ? `${base}/commit/${sha}` : null;
};

function Sha({ repo, sha, short }) {
  const href = commitLink(repo, sha);
  const label = short || String(sha || '').slice(0, 7);
  return href ? (
    <Link href={href} target="_blank" rel="noopener noreferrer" sx={monoSx}>
      {label}
    </Link>
  ) : (
    <Box component="span" sx={monoSx}>
      {label}
    </Box>
  );
}

function EnvironmentCard({ environment, info, repo, children }) {
  const live = info && info.live;
  const inProgress = info && info.inProgress;
  const failed = info && info.lastFailed;
  const url = live ? safeHttpsUrl(live.url) : null;
  let chip = <Chip size="small" variant="outlined" label="Sin versión" />;
  if (inProgress) chip = <Chip size="small" color="warning" label="Desplegando…" />;
  else if (failed) chip = <Chip size="small" color="error" label="Falló el último deploy" />;
  else if (live) chip = <Chip size="small" color="success" icon={<CloudDoneIcon />} label="En línea" />;

  return (
    <Box
      component="section"
      aria-label={`Entorno ${ENV_LABELS[environment]}`}
      sx={{ flex: '1 1 260px', minWidth: 0, p: 2, borderRadius: 2, border: '1px solid rgba(255, 255, 255, 0.1)', background: 'rgba(15, 23, 42, 0.35)' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600, flex: 1 }}>
          {ENV_LABELS[environment]}
        </Typography>
        {chip}
      </Box>
      {live ? (
        <Typography variant="body2" component="div" sx={{ display: 'grid', gap: 0.25 }}>
          <span>
            Versión <Sha repo={repo} sha={live.sha} short={live.shortSha} />
            {' · '}
            <time dateTime={String(live.finishedAt || live.createdAt)} title={formatDateTime(live.finishedAt || live.createdAt)}>
              {formatRelativeDate(live.finishedAt || live.createdAt)}
            </time>
          </span>
          <Typography variant="caption" color="text.secondary">
            {live.automatic ? 'Automático al pasar el CI en la rama principal' : `Pedido por ${live.requestedBy}`}
          </Typography>
          {url && (
            <Link href={url} target="_blank" rel="noopener noreferrer" variant="body2" sx={{ ...monoSx, wordBreak: 'break-all' }}>
              {url}
            </Link>
          )}
        </Typography>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {environment === 'staging'
            ? 'Todavía no hay versión: se publica sola cuando un cambio en la rama principal pasa el CI.'
            : 'Todavía no hay versión en producción.'}
        </Typography>
      )}
      {inProgress && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'warning.light' }}>
          Publicando <Sha repo={repo} sha={inProgress.sha} short={inProgress.shortSha} />…
        </Typography>
      )}
      {failed && !inProgress && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'error.light' }}>
          Falló el deploy de <Sha repo={repo} sha={failed.sha} short={failed.shortSha} />
          {failed.logUrl && (
            <>
              {' · '}
              <Link href={failed.logUrl} target="_blank" rel="noopener noreferrer" color="inherit">
                ver ejecución
              </Link>
            </>
          )}
        </Typography>
      )}
      {children && <Box sx={{ mt: 1.5, display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>{children}</Box>}
    </Box>
  );
}

function ConfirmDialog({ open, title, children, confirmLabel, busy, error, onConfirm, onClose, confirmDisabled }) {
  return (
    <Dialog open={open} onClose={() => !busy && onClose()} aria-labelledby="cd-confirm-title" fullWidth maxWidth="sm">
      <DialogTitle id="cd-confirm-title">{title}</DialogTitle>
      <DialogContent>
        {children}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button variant="ghost" size="small" onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button variant="primary" size="small" onClick={onConfirm} disabled={busy || confirmDisabled} startIcon={busy ? <CircularProgress size={14} color="inherit" /> : null}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function RequestRow({ request, repo, uid, isAdmin, onAct, busy }) {
  const mine = sameId(request.requestedBy, uid);
  const pending = request.status === 'pending';
  return (
    <Box component="li" sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', py: 1, borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
      <Chip size="small" color={REQUEST_COLORS[request.status] || 'default'} label={REQUEST_LABELS[request.status] || request.status} />
      <Typography variant="body2" sx={{ flex: '1 1 240px', minWidth: 0 }}>
        {request.requestedByUsername || 'Un miembro'} pidió publicar <Sha repo={repo} sha={request.versionSha} /> en{' '}
        {envName(request.environment)}
        <Typography component="span" variant="caption" color="text.secondary">
          {' · '}
          {formatRelativeDate(request.requestedAt)}
          {!pending && request.decidedByUsername ? ` · respondió ${request.decidedByUsername}` : ''}
          {request.note ? ` · «${request.note}»` : ''}
        </Typography>
      </Typography>
      {pending && isAdmin && (
        <>
          <Button variant="primary" size="small" onClick={() => onAct('approve', request)} disabled={busy}>
            Aprobar
          </Button>
          <Button variant="ghost" size="small" onClick={() => onAct('reject', request)} disabled={busy}>
            Rechazar
          </Button>
        </>
      )}
      {pending && mine && !isAdmin && (
        <Button variant="ghost" size="small" onClick={() => onAct('cancel', request)} disabled={busy}>
          Cancelar solicitud
        </Button>
      )}
    </Box>
  );
}

/**
 * Continuous delivery of the group's pipeline (Phase 4): staging and production with their live
 * version, "promote to production" (admins deploy, members ask), approvals, rollback and history.
 * Props: gid, repo, isAdmin, uid, refreshKey.
 */
export default function DeployPanel({ gid, repo, isAdmin, uid, refreshKey = 0 }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState(null); // {kind: 'promote'|'rollback'|'approve'|'reject', ...}
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [rollbackSha, setRollbackSha] = useState('');
  const [note, setNote] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [awaiting, setAwaiting] = useState(null); // {environment, since}: a deploy started here, not shown yet
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));
    getDeployments(gid, { signal: controller.signal })
      .then((data) => setState({ loading: false, error: null, data }))
      .catch((err) => {
        if (isAbortError(err)) return;
        setState((prev) => ({ ...prev, loading: false, error: errorMessage(err, 'No se pudieron cargar los entornos.') }));
      });
    return () => controller.abort();
  }, [gid, refreshKey, version]);

  const data = state.data;
  const environments = data && data.environments;
  const deploying = Boolean(environments && (environments.staging.inProgress || environments.production.inProgress));
  const { connected } = useRealtime();
  useGroupEvents(gid, ['deployment', 'deploy_request'], reload, { debounceMs: 800 });

  // The started deploy shows up (in progress, or already finished): the usual checks take over.
  useEffect(() => {
    if (awaiting && data && newestDeployKey(data.history, awaiting.environment) !== awaiting.since) setAwaiting(null);
  }, [awaiting, data]);
  // A run that fails before creating its Deployment (or never starts) never shows up.
  useEffect(() => {
    if (!awaiting) return undefined;
    const id = setTimeout(() => setAwaiting(null), AWAIT_DEPLOY_MS);
    return () => clearTimeout(id);
  }, [awaiting]);
  useVisibleInterval(reload, connected ? SAFETY_POLL_MS : POLL_MS, (deploying || Boolean(awaiting)) && !state.loading);

  if (state.loading && !data) {
    return (
      <Card variant="default" component="section" sx={staticCardSx}>
        <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <CircularProgress size={20} />
          <Typography color="text.secondary">Cargando entornos…</Typography>
        </Box>
      </Card>
    );
  }
  if (state.error && !data) {
    return (
      <Card variant="default" component="section" sx={staticCardSx}>
        <Alert severity="error" action={<Button variant="ghost" size="small" onClick={reload}>Reintentar</Button>}>
          {state.error}
        </Alert>
      </Card>
    );
  }
  if (!data || !data.deploys) return null;

  const staging = environments.staging.live;
  const production = environments.production.live;
  const requests = data.requests || [];
  const pendingProduction = requests.find((r) => r.status === 'pending' && r.environment === 'production');
  const alreadyLive = Boolean(staging && production && staging.sha === production.sha);

  const openDialog = (next) => {
    setDialogError(null);
    setNote('');
    setDialog(next);
  };

  // deployTo: the environment the action starts a deploy in (none for requests and rejections).
  const run = async (action, success, deployTo) => {
    setBusy(true);
    setDialogError(null);
    try {
      await action();
      setDialog(null);
      setNotice(success);
      if (deployTo) setAwaiting({ environment: deployTo, since: newestDeployKey(data.history, deployTo) });
      reload();
    } catch (err) {
      setDialogError(errorMessage(err, 'No se pudo completar la acción.'));
      if (err && OUTDATED_CODES.has(err.code)) reload();
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (!dialog) return undefined;
    // The version shown when the dialog opened: a live reload meanwhile must not change what is promoted.
    if (dialog.kind === 'promote' && isAdmin) {
      const { sha: version, shortSha } = dialog.version;
      return run(() => deployNow(gid, { environment: 'production', version }), `Se está publicando ${shortSha} en producción.`, 'production');
    }
    if (dialog.kind === 'promote') {
      return run(() => requestDeploy(gid, { environment: 'production', version: dialog.version.sha }), 'Solicitud enviada a los administradores del grupo.');
    }
    if (dialog.kind === 'rollback') {
      const target = data.rollbackCandidates.find((d) => d.sha === rollbackSha);
      return run(
        () => deployNow(gid, { environment: 'production', version: rollbackSha }),
        `Producción vuelve a ${target ? target.shortSha : rollbackSha.slice(0, 7)}.`,
        'production'
      );
    }
    if (dialog.kind === 'approve') {
      return run(
        () => approveDeployRequest(gid, dialog.request.requestId),
        `Solicitud aprobada: se está publicando en ${envName(dialog.request.environment)}.`,
        dialog.request.environment || 'production'
      );
    }
    if (dialog.kind === 'reject') {
      return run(() => rejectDeployRequest(gid, dialog.request.requestId, note.trim()), 'Solicitud rechazada.');
    }
    return undefined;
  };

  const actOnRequest = (kind, request) => {
    if (kind === 'cancel') {
      setBusy(true);
      cancelDeployRequest(gid, request.requestId)
        .then(() => {
          setNotice('Solicitud cancelada.');
          reload();
        })
        .catch((err) => {
          setNotice(errorMessage(err, 'No se pudo cancelar la solicitud.'));
          if (err && OUTDATED_CODES.has(err.code)) reload();
        })
        .finally(() => setBusy(false));
      return;
    }
    openDialog({ kind, request });
  };

  let stagingActions = null;
  if (staging) {
    if (alreadyLive) {
      stagingActions = (
        <Typography variant="caption" color="text.secondary">
          Producción ya tiene esta versión.
        </Typography>
      );
    } else if (pendingProduction && !isAdmin) {
      stagingActions = (
        <Typography variant="caption" color="text.secondary">
          Hay una solicitud de producción pendiente.
        </Typography>
      );
    } else {
      stagingActions = (
        <Button
          variant="primary"
          size="small"
          startIcon={<RocketLaunchIcon />}
          onClick={() => openDialog({ kind: 'promote', version: { sha: staging.sha, shortSha: staging.shortSha } })}
        >
          {isAdmin ? 'Publicar en producción' : 'Solicitar producción'}
        </Button>
      );
    }
  }

  const dialogContent = () => {
    if (!dialog) return null;
    if (dialog.kind === 'promote') {
      const { version } = dialog;
      const moved = Boolean(staging && staging.sha !== version.sha);
      return (
        <>
          <DialogContentText component="div">
            {isAdmin ? (
              <>
                Se publicará la versión de staging <Sha repo={repo} sha={version.sha} short={version.shortSha} /> en producción (la raíz del
                sitio). GitHub Pages se actualiza en aproximadamente un minuto.
              </>
            ) : (
              <>
                Se enviará una solicitud a los administradores del grupo para publicar <Sha repo={repo} sha={version.sha} short={version.shortSha} /> en
                producción. Te avisaremos cuando la respondan.
              </>
            )}
          </DialogContentText>
          {moved && (
            <Typography variant="caption" component="p" role="status" sx={{ mt: 1.5, color: 'warning.light' }}>
              Staging cambió a <Sha repo={repo} sha={staging.sha} short={staging.shortSha} /> mientras este diálogo estaba abierto. Esta acción
              usa {version.shortSha || String(version.sha).slice(0, 7)}; para usar la nueva versión, cancela y vuelve a abrir.
            </Typography>
          )}
        </>
      );
    }
    if (dialog.kind === 'rollback') {
      return (
        <>
          <DialogContentText sx={{ mb: 1 }}>Elige la versión anterior a la que vuelve producción:</DialogContentText>
          <RadioGroup value={rollbackSha} onChange={(event) => setRollbackSha(event.target.value)} aria-label="Versión anterior">
            {data.rollbackCandidates.map((deploy) => (
              <FormControlLabel
                key={deploy.sha}
                value={deploy.sha}
                control={<Radio size="small" />}
                label={
                  <Typography variant="body2">
                    <Box component="span" sx={monoSx}>
                      {deploy.shortSha}
                    </Box>
                    <Typography component="span" variant="caption" color="text.secondary">
                      {' · '}
                      {formatDateTime(deploy.createdAt)}
                      {deploy.requestedBy ? ` · ${deploy.requestedBy}` : ''}
                    </Typography>
                  </Typography>
                }
              />
            ))}
          </RadioGroup>
        </>
      );
    }
    if (dialog.kind === 'approve') {
      return (
        <DialogContentText component="div">
          {dialog.request.requestedByUsername || 'Un miembro'} pidió publicar <Sha repo={repo} sha={dialog.request.versionSha} /> en{' '}
          {envName(dialog.request.environment)}. Al aprobar, TaskMate lo despliega de inmediato.
        </DialogContentText>
      );
    }
    return (
      <>
        <DialogContentText sx={{ mb: 2 }}>
          Se rechazará la solicitud de {dialog.request.requestedByUsername || 'este miembro'}. Puedes dejarle un motivo.
        </DialogContentText>
        <TextField fullWidth size="small" label="Motivo (opcional)" value={note} onChange={(event) => setNote(event.target.value)} inputProps={{ maxLength: 500 }} />
      </>
    );
  };

  const DIALOG_TITLES = {
    promote: isAdmin ? 'Publicar en producción' : 'Solicitar producción',
    rollback: 'Rollback de producción',
    approve: 'Aprobar y publicar',
    reject: 'Rechazar solicitud',
  };
  const CONFIRM_LABELS = { promote: isAdmin ? 'Publicar' : 'Enviar solicitud', rollback: 'Volver a esta versión', approve: 'Aprobar', reject: 'Rechazar' };

  return (
    <Card variant="default" component="section" aria-label="Entornos y deploys" sx={staticCardSx}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5, flexWrap: 'wrap' }}>
        <RocketLaunchIcon aria-hidden />
        <Typography variant="h6" component="h2" sx={{ flex: 1 }}>
          Entornos
        </Typography>
        {state.loading && <CircularProgress size={16} aria-label="Actualizando entornos" />}
      </Box>

      {notice && (
        <Alert severity="info" onClose={() => setNotice(null)} sx={{ mb: 1.5 }}>
          {notice}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <EnvironmentCard environment="staging" info={environments.staging} repo={repo}>
          {stagingActions}
        </EnvironmentCard>
        <EnvironmentCard environment="production" info={environments.production} repo={repo}>
          {isAdmin && data.rollbackCandidates.length > 0 && (
            <Button
              variant="ghost"
              size="small"
              startIcon={<UndoIcon />}
              onClick={() => {
                setRollbackSha(data.rollbackCandidates[0].sha);
                openDialog({ kind: 'rollback' });
              }}
            >
              Rollback…
            </Button>
          )}
        </EnvironmentCard>
      </Box>

      {requests.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" component="h3">
            Solicitudes de producción
          </Typography>
          <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
            {requests.slice(0, 6).map((request) => (
              <RequestRow key={request.requestId} request={request} repo={repo} uid={uid} isAdmin={isAdmin} onAct={actOnRequest} busy={busy} />
            ))}
          </Box>
        </Box>
      )}

      {data.history.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Button variant="ghost" size="small" startIcon={<HistoryIcon />} onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
            {showHistory ? 'Ocultar historial' : 'Historial de deploys'}
          </Button>
          {showHistory && (
            <Box component="ul" aria-label="Historial de deploys" sx={{ m: 0, mt: 1, p: 0, listStyle: 'none' }}>
              {data.history.map((deploy) => (
                <Box component="li" key={deploy.id || `${deploy.environment}-${deploy.sha}-${deploy.createdAt}`} sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', py: 0.5 }}>
                  <Chip size="small" variant="outlined" label={ENV_LABELS[deploy.environment] || deploy.environment} />
                  <Sha repo={repo} sha={deploy.sha} short={deploy.shortSha} />
                  <Chip size="small" color={STATE_COLORS[deploy.state] || 'default'} label={STATE_LABELS[deploy.state] || deploy.state} />
                  <Typography variant="caption" color="text.secondary">
                    {deploy.requestedBy || 'automático'} · {formatRelativeDate(deploy.createdAt)}
                  </Typography>
                  {deploy.logUrl && (
                    <Link href={deploy.logUrl} target="_blank" rel="noopener noreferrer" variant="caption">
                      ejecución
                    </Link>
                  )}
                </Box>
              ))}
            </Box>
          )}
        </Box>
      )}

      <ConfirmDialog
        open={Boolean(dialog)}
        title={dialog ? DIALOG_TITLES[dialog.kind] : ''}
        confirmLabel={dialog ? CONFIRM_LABELS[dialog.kind] : ''}
        busy={busy}
        error={dialogError}
        confirmDisabled={Boolean(dialog && dialog.kind === 'rollback' && !rollbackSha)}
        onConfirm={confirm}
        onClose={() => setDialog(null)}
      >
        {dialogContent()}
      </ConfirmDialog>
    </Card>
  );
}

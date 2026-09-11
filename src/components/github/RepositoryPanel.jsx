import GitHubIcon from '@mui/icons-material/GitHub';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import LockIcon from '@mui/icons-material/Lock';
import PublicIcon from '@mui/icons-material/Public';
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
  Link,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { install, unlinkRepository } from '../../api/github';
import Button from '../ui/Button';
import Card from '../ui/Card';
import { assignLocation, errorMessage, formatDateTime, isGitHubUrl, repoHtmlUrl, staticCardSx } from './githubUtils';

function InfoRow({ label, children }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', py: 0.5 }}>
      <Typography component="dt" variant="body2" color="text.secondary" sx={{ minWidth: 170 }}>
        {label}
      </Typography>
      <Typography component="dd" variant="body2" sx={{ m: 0, wordBreak: 'break-word' }}>
        {children}
      </Typography>
    </Box>
  );
}

/**
 * Connection status of the group's repository plus admin-only Conectar/Desconectar.
 * Props: gid, repo (getRepository data | null), isAdmin, onUnlinked().
 */
export default function RepositoryPanel({ gid, repo, isAdmin, onUnlinked }) {
  const [connecting, setConnecting] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [unlinkError, setUnlinkError] = useState(null);

  // Both actions ask for a fresh single-use `state`; only github.com URLs are followed.
  const startConnect = async (kind) => {
    setConnecting(kind);
    setActionError(null);
    try {
      const data = await install(gid);
      const url = data && (kind === 'authorize' ? data.authorizeUrl : data.installUrl);
      if (!isGitHubUrl(url)) {
        setActionError('El servidor devolvió una dirección de GitHub no válida; no se abrió.');
        setConnecting(null);
        return;
      }
      assignLocation(url);
    } catch (err) {
      setActionError(errorMessage(err, 'No se pudo iniciar la conexión con GitHub.'));
      setConnecting(null);
    }
  };

  const handleUnlink = async () => {
    setUnlinking(true);
    setUnlinkError(null);
    try {
      await unlinkRepository(gid);
      setConfirmOpen(false);
      if (onUnlinked) onUnlinked();
    } catch (err) {
      setUnlinkError(errorMessage(err, 'No se pudo desconectar el repositorio.'));
    } finally {
      setUnlinking(false);
    }
  };

  if (!repo) {
    return (
      <Card variant="default" component="section" aria-label="Estado del repositorio" sx={staticCardSx}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
          <GitHubIcon aria-hidden />
          <Typography variant="h6" component="h2">
            Sin repositorio conectado
          </Typography>
        </Box>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          Conecta un repositorio de GitHub para explorar sus archivos, crear ramas por tarea y actualizar el progreso con
          los pull requests.
        </Typography>
        {isAdmin ? (
          <>
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              <Button variant="primary" onClick={() => startConnect('install')} disabled={Boolean(connecting)} startIcon={<GitHubIcon />}>
                {connecting === 'install' ? <CircularProgress size={18} sx={{ mr: 1, color: 'inherit' }} /> : null}
                Conectar repositorio
              </Button>
              <Button variant="ghost" onClick={() => startConnect('authorize')} disabled={Boolean(connecting)}>
                {connecting === 'authorize' ? <CircularProgress size={18} sx={{ mr: 1, color: 'inherit' }} /> : null}
                Ya instalé la App
              </Button>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
              Se abrirá GitHub para instalar la TaskMate App y elegir el repositorio. Si la App ya está instalada en tu
              cuenta u organización, usa «Ya instalé la App».
            </Typography>
          </>
        ) : (
          <Alert severity="info">Solo el administrador del grupo puede conectar un repositorio.</Alert>
        )}
        {actionError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {actionError}
          </Alert>
        )}
      </Card>
    );
  }

  const url = repoHtmlUrl(repo);
  const installation = repo.installation || {};
  const suspended = Boolean(installation.suspended || repo.suspendedAt);

  return (
    <Card variant="default" component="section" aria-label="Estado del repositorio" sx={staticCardSx}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 1.5 }}>
        <GitHubIcon aria-hidden />
        <Typography variant="h6" component="h2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
          {url ? (
            <Link href={url} target="_blank" rel="noopener noreferrer" color="inherit" underline="hover">
              {String(repo.fullName)}
            </Link>
          ) : (
            String(repo.fullName)
          )}
        </Typography>
        <Chip
          size="small"
          variant="outlined"
          icon={repo.isPrivate ? <LockIcon /> : <PublicIcon />}
          label={repo.isPrivate ? 'Privado' : 'Público'}
        />
      </Box>

      {suspended && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          La instalación de la GitHub App está suspendida. Mientras siga así no se podrá leer el repositorio ni crear
          ramas; pide a quien la instaló que la reactive en GitHub.
        </Alert>
      )}

      <Box component="dl" sx={{ m: 0, mb: 2 }}>
        <InfoRow label="Rama por defecto">
          <Box component="span" sx={{ fontFamily: 'monospace' }}>
            {String(repo.defaultBranch || '—')}
          </Box>
        </InfoRow>
        <InfoRow label="Instalación de la App">{String(installation.accountLogin || repo.owner || '—')}</InfoRow>
        <InfoRow label="Conectado por">
          {String(repo.connectedByUsername || 'Usuario desconocido')}
          {repo.connectedAt ? ` · ${formatDateTime(repo.connectedAt)}` : ''}
        </InfoRow>
      </Box>

      {isAdmin && (
        <Button variant="ghost" size="small" startIcon={<LinkOffIcon />} onClick={() => setConfirmOpen(true)}>
          Desconectar
        </Button>
      )}

      <Dialog open={confirmOpen} onClose={() => !unlinking && setConfirmOpen(false)} aria-labelledby="gh-unlink-title">
        <DialogTitle id="gh-unlink-title">¿Desconectar el repositorio?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            El grupo dejará de estar vinculado a {String(repo.fullName)} en TaskMate. Esto no desinstala la GitHub App: sigue
            instalada en tu cuenta u organización y puedes quitarla desde la configuración de GitHub.
          </DialogContentText>
          {unlinkError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {unlinkError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button variant="ghost" size="small" onClick={() => setConfirmOpen(false)} disabled={unlinking}>
            Cancelar
          </Button>
          <Button variant="secondary" size="small" onClick={handleUnlink} disabled={unlinking}>
            {unlinking ? <CircularProgress size={16} sx={{ mr: 1, color: 'inherit' }} /> : null}
            Desconectar
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

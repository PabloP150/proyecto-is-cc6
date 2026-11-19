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
  FormControlLabel,
  Link,
  Switch,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { install, setAiAnalysis, unlinkRepository } from '../../api/github';
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

export const AI_CONSENT_TEXT =
  'AI analysis reads the file structure, READMEs, dependency files, the recent commits and issues of the repository. The source code is NEVER read.';

function AiAnalysisSetting({ gid, enabled, isAdmin, onChange }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleToggle = async (event) => {
    const next = event.target.checked;
    setSaving(true);
    setError(null);
    try {
      const data = await setAiAnalysis(gid, next);
      if (onChange) onChange(data && typeof data.aiAnalysisEnabled === 'boolean' ? data.aiAnalysisEnabled : next);
    } catch (err) {
      setError(errorMessage(err, 'Could not change the AI analysis permission.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ mb: 2, p: 2, borderRadius: 2, border: '1px solid rgba(255, 255, 255, 0.1)', background: 'rgba(15, 23, 42, 0.35)' }}>
      {isAdmin ? (
        <FormControlLabel
          control={<Switch checked={enabled} onChange={handleToggle} disabled={saving} />}
          label="Allow AI analysis"
        />
      ) : (
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          AI analysis: {enabled ? 'allowed' : 'off'}
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {AI_CONSENT_TEXT}
        {!isAdmin && ' Only the group admin can change this permission.'}
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
    </Box>
  );
}

/**
 * Connection status of the group's repository plus admin-only Conectar/Desconectar and the
 * "Permitir análisis con IA" permission.
 * Props: gid, repo (getRepository data | null), isAdmin, onUnlinked(), onRepoChange(patch).
 */
export default function RepositoryPanel({ gid, repo, isAdmin, onUnlinked, onRepoChange }) {
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
        setActionError('The server returned an invalid GitHub address; it was not opened.');
        setConnecting(null);
        return;
      }
      assignLocation(url);
    } catch (err) {
      setActionError(errorMessage(err, 'Could not start the connection with GitHub.'));
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
      setUnlinkError(errorMessage(err, 'Could not disconnect the repository.'));
    } finally {
      setUnlinking(false);
    }
  };

  if (!repo) {
    return (
      <Card variant="default" component="section" aria-label="Repository status" sx={staticCardSx}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
          <GitHubIcon aria-hidden />
          <Typography variant="h6" component="h2">
            No repository connected
          </Typography>
        </Box>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          Connect a GitHub repository to explore its files, create branches per task and update progress from
          pull requests.
        </Typography>
        {isAdmin ? (
          <>
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              <Button variant="primary" onClick={() => startConnect('install')} disabled={Boolean(connecting)} startIcon={<GitHubIcon />}>
                {connecting === 'install' ? <CircularProgress size={18} sx={{ mr: 1, color: 'inherit' }} /> : null}
                Connect repository
              </Button>
              <Button variant="ghost" onClick={() => startConnect('authorize')} disabled={Boolean(connecting)}>
                {connecting === 'authorize' ? <CircularProgress size={18} sx={{ mr: 1, color: 'inherit' }} /> : null}
                I already installed the App
              </Button>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
              GitHub will open to install the TaskMate App or give it access to another repository; after saving you come back here to
              choose it. If the App already has access to the repository, use “I already installed the App”.
            </Typography>
          </>
        ) : (
          <Alert severity="info">Only the group admin can connect a repository.</Alert>
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
    <Card variant="default" component="section" aria-label="Repository status" sx={staticCardSx}>
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
          label={repo.isPrivate ? 'Private' : 'Public'}
        />
      </Box>

      {suspended && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          The GitHub App installation is suspended. Until it is reactivated the repository cannot be read and branches
          cannot be created; ask whoever installed it to reactivate it on GitHub.
        </Alert>
      )}

      <AiAnalysisSetting
        gid={gid}
        enabled={repo.aiAnalysisEnabled === true}
        isAdmin={isAdmin}
        onChange={(aiAnalysisEnabled) => onRepoChange && onRepoChange({ aiAnalysisEnabled })}
      />

      <Box component="dl" sx={{ m: 0, mb: 2 }}>
        <InfoRow label="Default branch">
          <Box component="span" sx={{ fontFamily: 'monospace' }}>
            {String(repo.defaultBranch || '—')}
          </Box>
        </InfoRow>
        <InfoRow label="App installation">{String(installation.accountLogin || repo.owner || '—')}</InfoRow>
        <InfoRow label="Connected by">
          {String(repo.connectedByUsername || 'Unknown user')}
          {repo.connectedAt ? ` · ${formatDateTime(repo.connectedAt)}` : ''}
        </InfoRow>
      </Box>

      {isAdmin && (
        <Button variant="ghost" size="small" startIcon={<LinkOffIcon />} onClick={() => setConfirmOpen(true)}>
          Disconnect
        </Button>
      )}

      <Dialog open={confirmOpen} onClose={() => !unlinking && setConfirmOpen(false)} aria-labelledby="gh-unlink-title">
        <DialogTitle id="gh-unlink-title">Disconnect the repository?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            The group will no longer be linked to {String(repo.fullName)} in TaskMate. This does not uninstall the GitHub App: it stays
            installed on your account or organization and you can remove it from the GitHub settings.
          </DialogContentText>
          {unlinkError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {unlinkError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button variant="ghost" size="small" onClick={() => setConfirmOpen(false)} disabled={unlinking}>
            Cancel
          </Button>
          <Button variant="secondary" size="small" onClick={handleUnlink} disabled={unlinking}>
            {unlinking ? <CircularProgress size={16} sx={{ mr: 1, color: 'inherit' }} /> : null}
            Disconnect
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

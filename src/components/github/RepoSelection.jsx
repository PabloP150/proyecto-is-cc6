import LockIcon from '@mui/icons-material/Lock';
import PublicIcon from '@mui/icons-material/Public';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  FormControlLabel,
  Radio,
  RadioGroup,
  Typography,
} from '@mui/material';
import { useEffect, useId, useState } from 'react';
import { getSelection, linkRepository } from '../../api/github';
import Button from '../ui/Button';
import Card from '../ui/Card';
import { errorMessage, isAbortError, sameId, staticCardSx } from './githubUtils';

const EXPIRED_MESSAGE =
  'La selección de repositorios expiró (dura 10 minutos) o ya se usó. Vuelve a pulsar «Conectar repositorio».';

/**
 * Lets the admin pick one repository after installing the GitHub App on several.
 * Props: selectionId, groups ([{gid, name}], to name the selection's group), onLinked(repo, gid), onCancel().
 */
export default function RepoSelection({ selectionId, groups, onLinked, onCancel }) {
  const headingId = useId();
  const [state, setState] = useState({ loading: true, error: null, expired: false, selection: null });
  const [repoId, setRepoId] = useState('');
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({ loading: true, error: null, expired: false, selection: null });
    getSelection(selectionId, { signal: controller.signal })
      .then((selection) => {
        if (!active) return;
        const repos = selection && Array.isArray(selection.repos) ? selection.repos : [];
        setState({ loading: false, error: null, expired: false, selection: { ...selection, repos } });
        if (repos.length === 1) setRepoId(String(repos[0].repoId));
      })
      .catch((err) => {
        if (!active || isAbortError(err)) return;
        const expired = err && (err.code === 'SELECTION_NOT_FOUND' || err.status === 404);
        setState({
          loading: false,
          expired,
          error: expired ? EXPIRED_MESSAGE : errorMessage(err, 'No se pudo cargar la lista de repositorios.'),
          selection: null,
        });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [selectionId]);

  const { loading, error, expired, selection } = state;
  const repos = selection ? selection.repos : [];
  const group = selection && Array.isArray(groups) ? groups.find((g) => sameId(g.gid, selection.gid)) : null;
  const groupName = group && group.name ? String(group.name) : '';

  const handleLink = async () => {
    const chosen = repos.find((r) => String(r.repoId) === repoId);
    if (!chosen || !selection) return;
    setLinking(true);
    setLinkError(null);
    try {
      const repo = await linkRepository(selection.gid, { selectionId, repoId: chosen.repoId });
      if (onLinked) onLinked(repo, selection.gid);
    } catch (err) {
      if (err && err.code === 'SELECTION_NOT_FOUND') {
        setState({ loading: false, expired: true, error: EXPIRED_MESSAGE, selection: null });
      } else {
        setLinkError(errorMessage(err, 'No se pudo vincular el repositorio.'));
      }
      setLinking(false);
    }
  };

  return (
    <Card variant="default" component="section" aria-labelledby={headingId} sx={staticCardSx}>
      <Typography id={headingId} variant="h6" component="h2" sx={{ mb: 0.5 }}>
        Elige el repositorio
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        La GitHub App tiene acceso a varios repositorios. Elige el que quieres vincular
        {groupName ? ` al grupo «${groupName}»` : ' a este grupo'}.
      </Typography>

      {loading && (
        <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 2 }}>
          <CircularProgress size={22} />
          <Typography color="text.secondary">Cargando repositorios…</Typography>
        </Box>
      )}

      {error && (
        <Alert severity={expired ? 'warning' : 'error'} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {!loading && !error && repos.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          La instalación no tiene acceso a ningún repositorio. Agrega uno desde la configuración de la App en GitHub.
        </Alert>
      )}

      {repos.length > 0 && (
        <RadioGroup
          aria-labelledby={headingId}
          value={repoId}
          onChange={(event) => setRepoId(event.target.value)}
          sx={{ mb: 2, maxHeight: 360, overflowY: 'auto', flexWrap: 'nowrap' }}
        >
          {repos.map((repo) => (
            <FormControlLabel
              key={repo.repoId}
              value={String(repo.repoId)}
              disabled={linking}
              control={<Radio />}
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{String(repo.fullName)}</Typography>
                  <Chip
                    size="small"
                    icon={repo.isPrivate ? <LockIcon /> : <PublicIcon />}
                    label={repo.isPrivate ? 'Privado' : 'Público'}
                    variant="outlined"
                  />
                </Box>
              }
            />
          ))}
        </RadioGroup>
      )}

      {linkError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {linkError}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {onCancel && (
          <Button variant="ghost" size="small" onClick={onCancel} disabled={linking}>
            {expired || error ? 'Cerrar' : 'Cancelar'}
          </Button>
        )}
        {!expired && !error && (
          <Button variant="primary" size="small" onClick={handleLink} disabled={!repoId || linking || loading}>
            {linking ? <CircularProgress size={16} sx={{ mr: 1, color: 'inherit' }} /> : null}
            Vincular repositorio
          </Button>
        )}
      </Box>
    </Card>
  );
}

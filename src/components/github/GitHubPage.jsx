import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import GitHubIcon from '@mui/icons-material/GitHub';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import SyncIcon from '@mui/icons-material/Sync';
import { Alert, Box, Chip, CircularProgress, Container, Snackbar, Tab, Tabs, Typography } from '@mui/material';
import { useCallback, useContext, useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import { getRepository, syncGroup } from '../../api/github';
import { GroupContext } from '../GroupContext';
import Button from '../ui/Button';
import Card from '../ui/Card';
import CommitList from './CommitList';
import RepoExplorer from './RepoExplorer';
import RepoSelection from './RepoSelection';
import RepositoryPanel from './RepositoryPanel';
import {
  callbackErrorMessage,
  errorMessage,
  getCurrentUserId,
  isAbortError,
  sameId,
  staticCardSx,
} from './githubUtils';

const PENDING_MESSAGE =
  'La instalación quedó pendiente: un propietario de la organización debe aprobarla en GitHub. ' +
  'Cuando la apruebe, vuelve aquí y pulsa «Ya instalé la App».';

function readStoredGroup() {
  try {
    return {
      id: localStorage.getItem('selectedGroupId') || null,
      name: localStorage.getItem('selectedGroupName') || '',
    };
  } catch {
    return { id: null, name: '' };
  }
}

function CenteredStatus({ children }) {
  return (
    <Box role="status" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 6 }}>
      <CircularProgress size={24} />
      <Typography color="text.secondary">{children}</Typography>
    </Box>
  );
}

function GroupPrompt({ title, message }) {
  return (
    <Card variant="default" component="section" sx={{ ...staticCardSx, textAlign: 'center', py: 5 }}>
      <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
        {title}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        {message}
      </Typography>
      <Button variant="primary" component={RouterLink} to="/groups">
        Ir a Grupos
      </Button>
    </Card>
  );
}

/** Route /github: repository connection, file explorer, commits, PR sync and AI analysis. */
export default function GitHubPage() {
  const { selectedGroupId, setSelectedGroupId, selectedGroupName, setSelectedGroupName } = useContext(GroupContext) || {};
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const uid = getCurrentUserId();
  const stored = readStoredGroup();
  const gid = selectedGroupId || stored.id;

  const [notice, setNotice] = useState(null);
  const [selectionId, setSelectionId] = useState(null);
  const [groupsState, setGroupsState] = useState({ loading: true, error: null, groups: [] });
  const [repoState, setRepoState] = useState({ gid: null, loading: true, error: null, repo: null });
  const [repoVersion, setRepoVersion] = useState(0);
  const [tab, setTab] = useState('repo');
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState(null);

  const selectGroup = useCallback(
    (id, name) => {
      if (setSelectedGroupId) setSelectedGroupId(id);
      if (setSelectedGroupName) setSelectedGroupName(name || '');
      try {
        localStorage.setItem('selectedGroupId', id);
        localStorage.setItem('selectedGroupName', name || '');
      } catch {
        // Storage may be unavailable (private mode); the context still holds the group.
      }
    },
    [setSelectedGroupId, setSelectedGroupName]
  );

  // Reloads (and the GitHub redirect back here) start with an empty context.
  useEffect(() => {
    if (!selectedGroupId && stored.id && setSelectedGroupId) {
      setSelectedGroupId(stored.id);
      if (setSelectedGroupName) setSelectedGroupName(stored.name);
    }
  }, [selectedGroupId, stored.id, stored.name, setSelectedGroupId, setSelectedGroupName]);

  // Result of the install/authorize callback: ?status=connected|select|pending|error&selection&code.
  useEffect(() => {
    const status = searchParams.get('status');
    if (!status) return;
    if (status === 'select' && searchParams.get('selection')) {
      setSelectionId(searchParams.get('selection'));
      setNotice(null);
    } else if (status === 'connected') {
      setNotice({ severity: 'success', message: 'Repositorio conectado correctamente.' });
    } else if (status === 'pending') {
      setNotice({ severity: 'info', message: PENDING_MESSAGE });
    } else if (status === 'error' || status === 'select') {
      setNotice({ severity: 'error', message: callbackErrorMessage(searchParams.get('code')) });
    }
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!uid) {
      setGroupsState({ loading: false, error: null, groups: [] });
      return undefined;
    }
    const controller = new AbortController();
    apiFetch(`/api/groups/user-groups?uid=${encodeURIComponent(uid)}`, { signal: controller.signal })
      .then((res) => {
        const groups = res && Array.isArray(res.groups) ? res.groups : [];
        setGroupsState({ loading: false, error: null, groups });
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        setGroupsState({ loading: false, error: errorMessage(err, 'No se pudieron cargar tus grupos.'), groups: [] });
      });
    return () => controller.abort();
  }, [uid]);

  useEffect(() => {
    if (!gid) return undefined;
    const controller = new AbortController();
    setRepoState((prev) => ({ ...prev, loading: true, error: null }));
    getRepository(gid, { signal: controller.signal })
      .then((repo) => setRepoState({ gid, loading: false, error: null, repo: repo || null }))
      .catch((err) => {
        if (isAbortError(err)) return;
        setRepoState({ gid, loading: false, repo: null, error: errorMessage(err, 'No se pudo cargar el repositorio.') });
      });
    return () => controller.abort();
  }, [gid, repoVersion]);

  const reloadRepo = useCallback(() => setRepoVersion((v) => v + 1), []);

  const { groups } = groupsState;
  const group = groups.find((g) => sameId(g.gid, gid)) || null;
  const isAdmin = Boolean(group && uid && sameId(group.adminId, uid));
  const groupName = (group && group.name) || selectedGroupName || stored.name || '';
  const repoCurrent = repoState.gid && sameId(repoState.gid, gid);
  const repo = repoCurrent ? repoState.repo : null;
  const repoLoading = !repoCurrent || repoState.loading;
  const suspended = Boolean(repo && ((repo.installation && repo.installation.suspended) || repo.suspendedAt));
  const usable = Boolean(repo) && !suspended;
  const groupMissing = Boolean(gid) && !groupsState.loading && !groupsState.error && !group;

  useEffect(() => {
    if (!usable && tab !== 'repo') setTab('repo');
  }, [usable, tab]);

  const handleLinked = (linkedRepo, linkedGid) => {
    setSelectionId(null);
    if (linkedGid && !sameId(linkedGid, gid)) {
      const target = groups.find((g) => sameId(g.gid, linkedGid));
      selectGroup(target ? target.gid : linkedGid, target ? target.name : '');
    }
    const name = linkedRepo && linkedRepo.fullName ? ` ${linkedRepo.fullName}` : '';
    setNotice({ severity: 'success', message: `Repositorio${name} conectado correctamente.` });
    setTab('repo');
    reloadRepo();
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = (await syncGroup(gid)) || {};
      setToast({
        severity: 'success',
        message: `Sincronización completa: ${Number(result.checked) || 0} PR revisados, ${Number(result.updated) || 0} actualizados.`,
      });
    } catch (err) {
      const limited = err && err.code === 'RATE_LIMITED';
      setToast({
        severity: limited ? 'warning' : 'error',
        message: limited
          ? 'Ya se sincronizó hace poco. Espera unos 30 segundos e inténtalo de nuevo.'
          : errorMessage(err, 'No se pudo sincronizar con GitHub.'),
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleAnalyze = () => {
    selectGroup(gid, groupName);
    navigate('/chat', { state: { analyzeGroupId: gid } });
  };

  const closeToast = (event, reason) => {
    if (reason === 'clickaway') return;
    setToast((prev) => (prev ? { ...prev, open: false } : prev));
  };

  let content;
  if (!gid) {
    content = (
      <GroupPrompt
        title="Selecciona un grupo"
        message="Para conectar o explorar un repositorio de GitHub, primero elige el grupo con el que quieres trabajar."
      />
    );
  } else if (groupMissing) {
    content = (
      <GroupPrompt
        title="Grupo no disponible"
        message="El grupo seleccionado ya no existe o ya no perteneces a él. Elige otro grupo."
      />
    );
  } else {
    content = (
      <>
        <Tabs
          value={tab}
          onChange={(event, value) => setTab(value)}
          aria-label="Secciones de GitHub"
          textColor="inherit"
          indicatorColor="secondary"
          variant="scrollable"
          allowScrollButtonsMobile
          sx={{ mb: 2, borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}
        >
          <Tab value="repo" label="Repositorio" id="gh-tab-repo" aria-controls="gh-panel" />
          <Tab value="files" label="Archivos" id="gh-tab-files" aria-controls="gh-panel" disabled={!usable} />
          <Tab value="commits" label="Commits" id="gh-tab-commits" aria-controls="gh-panel" disabled={!usable} />
        </Tabs>
        <Box role="tabpanel" id="gh-panel" aria-labelledby={`gh-tab-${tab}`}>
          {tab === 'repo' &&
            (repoLoading ? (
              <CenteredStatus>Cargando repositorio…</CenteredStatus>
            ) : repoState.error ? (
              <Alert
                severity="error"
                action={
                  <Button variant="ghost" size="small" onClick={reloadRepo}>
                    Reintentar
                  </Button>
                }
              >
                {repoState.error}
              </Alert>
            ) : (
              <RepositoryPanel gid={gid} repo={repo} isAdmin={isAdmin} onUnlinked={() => {
                setToast({ open: true, severity: 'success', message: 'Repositorio desconectado del grupo.' });
                reloadRepo();
              }} />
            ))}
          {tab === 'files' && usable && <RepoExplorer gid={gid} repo={repo} />}
          {tab === 'commits' && usable && (
            <Card variant="default" component="section" sx={staticCardSx}>
              <CommitList gid={gid} gitRef={repo.defaultBranch || undefined} />
            </Card>
          )}
        </Box>
      </>
    );
  }

  return (
    <Container component="main" maxWidth="lg" sx={{ py: 4, position: 'relative', zIndex: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap', mb: 3 }}>
        <Box sx={{ flex: '1 1 320px', minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <GitHubIcon sx={{ fontSize: 34 }} aria-hidden />
            <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
              GitHub
            </Typography>
            {gid && groupName && <Chip label={`Grupo: ${groupName}`} size="small" color="primary" variant="outlined" />}
          </Box>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Conecta el repositorio del grupo, explora su código y deja que la IA proponga las siguientes tareas.
          </Typography>
        </Box>
        {gid && usable && !groupMissing && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: { xs: 'stretch', sm: 'flex-end' }, gap: 1, maxWidth: 420 }}>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Button variant="ghost" size="small" startIcon={syncing ? <CircularProgress size={16} color="inherit" /> : <SyncIcon />} onClick={handleSync} disabled={syncing}>
                Sincronizar PRs
              </Button>
              <Button variant="accent" size="small" startIcon={<AutoAwesomeIcon />} onClick={handleAnalyze} aria-describedby="gh-ai-consent">
                Analizar con IA
              </Button>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start' }}>
              <InfoOutlinedIcon sx={{ fontSize: 16, mt: '2px', color: 'text.secondary' }} aria-hidden />
              <Typography id="gh-ai-consent" variant="caption" color="text.secondary">
                Al analizar con IA se envía a Groq (el proveedor de IA) solo la estructura de archivos, el README, los
                archivos de dependencias, los commits y los issues recientes. Nunca se envía el código fuente.
              </Typography>
            </Box>
          </Box>
        )}
      </Box>

      {notice && (
        <Alert severity={notice.severity} onClose={() => setNotice(null)} sx={{ mb: 2 }}>
          {notice.message}
        </Alert>
      )}
      {groupsState.error && gid && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {groupsState.error} Las acciones de administrador no están disponibles.
        </Alert>
      )}
      {selectionId && (
        <Box sx={{ mb: 3 }}>
          <RepoSelection
            selectionId={selectionId}
            groups={groups}
            onLinked={handleLinked}
            onCancel={() => setSelectionId(null)}
          />
        </Box>
      )}

      {content}

      <Snackbar
        open={Boolean(toast && toast.open !== false)}
        autoHideDuration={4000}
        onClose={closeToast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast ? (
          <Alert onClose={closeToast} severity={toast.severity} variant="filled" sx={{ width: '100%' }}>
            {toast.message}
          </Alert>
        ) : (
          <span />
        )}
      </Snackbar>
    </Container>
  );
}

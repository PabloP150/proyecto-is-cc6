import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DescriptionIcon from '@mui/icons-material/Description';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FolderIcon from '@mui/icons-material/Folder';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import SearchIcon from '@mui/icons-material/Search';
import {
  Alert,
  Box,
  CircularProgress,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getFile, getReadme, getTree } from '../../api/github';
import Button from '../ui/Button';
import Card from '../ui/Card';
import FileViewer from './FileViewer';
import { blobUrl, encodePath, errorMessage, isAbortError, repoHtmlUrl, staticCardSx } from './githubUtils';

const MAX_FILTER_RESULTS = 500;

export function buildTree(entries) {
  const root = { name: '', path: '', type: 'tree', children: new Map() };
  entries.forEach((entry) => {
    if (!entry || typeof entry.path !== 'string' || !entry.path) return;
    const parts = entry.path.split('/').filter(Boolean);
    let node = root;
    parts.forEach((part, index) => {
      const isLast = index === parts.length - 1;
      let child = node.children.get(part);
      if (!child) {
        child = {
          name: part,
          path: parts.slice(0, index + 1).join('/'),
          type: isLast ? entry.type : 'tree',
          size: isLast ? entry.size : undefined,
          children: new Map(),
        };
        node.children.set(part, child);
      } else if (isLast) {
        child.type = entry.type;
        child.size = entry.size;
      }
      node = child;
    });
  });
  return root;
}

const sortChildren = (node) =>
  Array.from(node.children.values()).sort((a, b) => {
    if ((a.type === 'tree') !== (b.type === 'tree')) return a.type === 'tree' ? -1 : 1;
    return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
  });

const dirname = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function TreeNodes({ node, depth, expanded, forceExpand, onToggle, onOpen, selectedPath }) {
  return sortChildren(node).map((child) => {
    const isFolder = child.type === 'tree';
    const open = isFolder && (forceExpand || expanded.has(child.path));
    const selected = !isFolder && child.path === selectedPath;
    return (
      <Box component="li" key={child.path} sx={{ listStyle: 'none' }}>
        <ListItemButton
          dense
          selected={selected}
          aria-expanded={isFolder ? open : undefined}
          aria-current={selected ? 'true' : undefined}
          onClick={() => (isFolder ? onToggle(child.path) : onOpen(child.path))}
          sx={{ pl: 1 + depth * 2, borderRadius: 1, py: 0.25 }}
        >
          <ListItemIcon sx={{ minWidth: 44, color: isFolder ? '#fbbf24' : 'text.secondary' }}>
            {isFolder ? (
              <>
                {open ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
                {open ? <FolderOpenIcon fontSize="small" /> : <FolderIcon fontSize="small" />}
              </>
            ) : (
              <Box component="span" sx={{ pl: 2.5, display: 'inline-flex' }}>
                <InsertDriveFileOutlinedIcon fontSize="small" />
              </Box>
            )}
          </ListItemIcon>
          <ListItemText
            primary={child.name}
            primaryTypographyProps={{ noWrap: true, title: child.path, sx: { fontFamily: 'monospace', fontSize: '0.85rem' } }}
          />
        </ListItemButton>
        {open && child.children.size > 0 && (
          <Box component="ul" sx={{ m: 0, p: 0 }} role="group">
            <TreeNodes
              node={child}
              depth={depth + 1}
              expanded={expanded}
              forceExpand={forceExpand}
              onToggle={onToggle}
              onOpen={onOpen}
              selectedPath={selectedPath}
            />
          </Box>
        )}
      </Box>
    );
  });
}

const toViewerError = (err, fallback) => ({
  code: err && err.code,
  status: err && err.status,
  message: errorMessage(err, fallback),
});

/**
 * File browser for the group's repository. Props: gid, repo (from getRepository: htmlUrl,
 * fullName, defaultBranch). Opens the README by default.
 */
export default function RepoExplorer({ gid, repo }) {
  const [tree, setTree] = useState({ loading: true, error: null, data: null });
  const [treeVersion, setTreeVersion] = useState(0);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());
  const [view, setView] = useState({ path: null, kind: 'readme', loading: true, error: null, file: null });
  const requestRef = useRef(null);

  const repoUrl = repoHtmlUrl(repo);
  const ref = (tree.data && (tree.data.ref || tree.data.sha)) || (repo && repo.defaultBranch) || null;

  const loadView = useCallback(
    (kind, path) => {
      if (requestRef.current) requestRef.current.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setView({ path, kind, loading: true, error: null, file: null });
      const request =
        kind === 'readme'
          ? getReadme(gid, { signal: controller.signal })
          : getFile(gid, path, { ref: ref || undefined, signal: controller.signal });
      request
        .then((file) => {
          if (controller.signal.aborted) return;
          setView({ path: (file && file.path) || path, kind, loading: false, error: null, file });
        })
        .catch((err) => {
          if (controller.signal.aborted || isAbortError(err)) return;
          const missingReadme = kind === 'readme' && (err.code === 'FILE_NOT_FOUND' || err.code === 'NOT_FOUND');
          setView({
            path,
            kind,
            loading: false,
            file: null,
            error: missingReadme ? null : toViewerError(err, 'No se pudo cargar el archivo.'),
          });
        });
    },
    [gid, ref]
  );

  useEffect(() => {
    if (!gid) return undefined;
    const controller = new AbortController();
    setTree((prev) => ({ ...prev, loading: true, error: null }));
    getTree(gid, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setTree({ loading: false, error: null, data: data || { entries: [] } });
      })
      .catch((err) => {
        if (controller.signal.aborted || isAbortError(err)) return;
        setTree({ loading: false, error: errorMessage(err, 'No se pudo cargar el árbol del repositorio.'), data: null });
      });
    return () => controller.abort();
  }, [gid, treeVersion]);

  // The README opens by default for each group.
  useEffect(() => {
    if (gid) loadView('readme', null);
    return () => {
      if (requestRef.current) requestRef.current.abort();
    };
    // loadView changes with `ref`; the README only needs reloading when the group changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gid]);

  const entries = useMemo(() => (tree.data && Array.isArray(tree.data.entries) ? tree.data.entries : []), [tree.data]);
  const query = filter.trim().toLowerCase();
  const { root, matchCount, capped } = useMemo(() => {
    if (!query) return { root: buildTree(entries), matchCount: entries.length, capped: false };
    const matches = entries.filter((e) => e && typeof e.path === 'string' && e.path.toLowerCase().includes(query));
    return {
      root: buildTree(matches.slice(0, MAX_FILTER_RESULTS)),
      matchCount: matches.length,
      capped: matches.length > MAX_FILTER_RESULTS,
    };
  }, [entries, query]);

  const toggleFolder = useCallback((path) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const openFile = useCallback((path) => loadView('file', path), [loadView]);

  const viewPath = view.path || (view.file && view.file.path) || '';
  const dir = dirname(viewPath);
  const baseFor = (kind) =>
    repoUrl && ref ? `${repoUrl}/${kind}/${encodePath(ref)}/${dir ? `${encodePath(dir)}/` : ''}` : null;
  const linkBase = baseFor('blob');
  const imageBase = baseFor('raw');
  const fallbackUrl = viewPath ? blobUrl(repoUrl, ref, viewPath) : null;

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(240px, 320px) 1fr' }, gap: 2 }}>
      <Card variant="default" component="nav" aria-label="Archivos del repositorio" sx={{ ...staticCardSx, p: 1.5, minWidth: 0 }}>
        <TextField
          size="small"
          fullWidth
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar archivos…"
          inputProps={{ 'aria-label': 'Filtrar archivos por nombre o ruta' }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
          sx={{ mb: 1 }}
        />
        <Button
          variant="ghost"
          size="small"
          fullWidth
          startIcon={<DescriptionIcon fontSize="small" />}
          onClick={() => loadView('readme', null)}
          aria-pressed={view.kind === 'readme'}
          sx={{ mb: 1, justifyContent: 'flex-start' }}
        >
          README
        </Button>

        {tree.data && tree.data.truncated && (
          <Alert severity="warning" sx={{ mb: 1 }}>
            El repositorio es muy grande: solo se muestran los primeros {entries.length} elementos.
          </Alert>
        )}
        {query && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }} role="status">
            {matchCount === 0
              ? 'Ningún archivo coincide con el filtro.'
              : capped
                ? `Mostrando ${MAX_FILTER_RESULTS} de ${matchCount} coincidencias.`
                : `${matchCount} ${matchCount === 1 ? 'coincidencia' : 'coincidencias'}.`}
          </Typography>
        )}

        {tree.loading && !tree.data && (
          <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2, justifyContent: 'center' }}>
            <CircularProgress size={20} />
            <Typography variant="body2" color="text.secondary">
              Cargando árbol…
            </Typography>
          </Box>
        )}
        {tree.error && (
          <Alert
            severity="error"
            action={
              <Button variant="ghost" size="small" onClick={() => setTreeVersion((v) => v + 1)}>
                Reintentar
              </Button>
            }
          >
            {tree.error}
          </Alert>
        )}
        {tree.data && !tree.error && entries.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
            El repositorio está vacío.
          </Typography>
        )}
        {entries.length > 0 && (
          <List component="ul" dense disablePadding sx={{ maxHeight: '65vh', overflowY: 'auto' }}>
            <TreeNodes
              node={root}
              depth={0}
              expanded={expanded}
              forceExpand={Boolean(query)}
              onToggle={toggleFolder}
              onOpen={openFile}
              selectedPath={view.kind === 'file' ? view.path : null}
            />
          </List>
        )}
      </Card>

      <Card variant="default" component="section" aria-label="Vista del archivo" sx={{ ...staticCardSx, minWidth: 0 }}>
        <FileViewer
          path={view.path}
          loading={view.loading}
          error={view.error}
          file={view.file}
          fallbackUrl={fallbackUrl}
          linkBase={linkBase}
          imageBase={imageBase}
          onRetry={() => loadView(view.kind, view.path)}
          emptyMessage={
            view.kind === 'readme'
              ? 'Este repositorio no tiene README. Selecciona un archivo del árbol para verlo.'
              : undefined
          }
        />
      </Card>
    </Box>
  );
}

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
        TaskMate no puede leer GitHub Pages porque la App todavía no tiene los permisos de CI/CD aceptados.
      </Alert>
    );
  }
  if (pages.enabled === false) {
    return (
      <Alert severity="warning" sx={{ mt: 1.5 }}>
        GitHub Pages está desactivado en el repositorio. Un administrador puede volver a subir el pipeline para activarlo.
      </Alert>
    );
  }
  const url = safeHttpsUrl(pages.url);
  return url ? (
    <Typography variant="body2" sx={{ mt: 1 }}>
      Sitio:{' '}
      <Link href={url} target="_blank" rel="noopener noreferrer" sx={monoSx}>
        {url}
      </Link>
    </Typography>
  ) : null;
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
        setState({ loading: false, error: errorMessage(err, 'No se pudo cargar el pipeline.'), data: null });
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
    <Card variant="default" component="section" aria-label="Pipeline de CI/CD" sx={staticCardSx}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 1 }}>
        <BuildCircleIcon aria-hidden />
        <Typography variant="h6" component="h2" sx={{ flex: '1 1 auto' }}>
          Pipeline de CI/CD
        </Typography>
        {isAdmin && !loading && !error && (
          <Button variant={pipeline ? 'ghost' : 'primary'} size="small" startIcon={<TuneIcon />} onClick={onConfigure}>
            {pipeline ? 'Editar pipeline' : 'Configurar pipeline'}
          </Button>
        )}
      </Box>

      {loading && !data && (
        <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 2 }}>
          <CircularProgress size={20} />
          <Typography color="text.secondary">Cargando pipeline…</Typography>
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

      {data && !pipeline && (
        <Typography color="text.secondary">
          {isAdmin
            ? 'Este repositorio todavía no tiene un pipeline de TaskMate. Configúralo para compilar, probar, analizar y desplegar con cada cambio.'
            : 'Este repositorio todavía no tiene un pipeline de TaskMate. Pide al administrador del grupo que lo configure.'}
        </Typography>
      )}

      {pipeline && (
        <>
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1 }} aria-label="Etapas">
            {pipeline.spec && pipeline.spec.project && (
              <Chip size="small" color="primary" variant="outlined" label={STACK_LABELS[pipeline.spec.project.stack] || pipeline.spec.project.stack} />
            )}
            {pipeline.stages.map((stage) => (
              <Chip key={stage.key} size="small" variant="outlined" label={stage.label} />
            ))}
          </Box>
          <Typography variant="caption" color="text.secondary" component="div">
            Configurado por {pipeline.configuredBy || 'un administrador'}
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
          <PagesStatus pages={data.pages} />
        </>
      )}
    </Card>
  );
}

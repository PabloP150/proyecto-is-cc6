import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Link,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { applyPipeline, previewPipeline, proposePipeline } from '../../../api/github';
import Button from '../../ui/Button';
import { errorMessage, isAbortError, safeGitHubUrl } from '../githubUtils';
import { monoSx, projectLabel, safeHttpsUrl } from './cicdUtils';

const PREVIEW_DELAY_MS = 300;
const OUTPUT_DIRS = { vite: 'dist', cra: 'build' };
const FRAMEWORKS = [
  { value: 'vite', label: 'Vite' },
  { value: 'cra', label: 'Create React App' },
  { value: 'static', label: 'Estático (rutas relativas)' },
];

const projectKey = (p) => `${p.stack}:${p.dir}`;

const INTROS = {
  saved: 'Esta es la configuración actual del pipeline. Cámbiala y vuelve a subirla.',
  ai: 'La IA revisó el repositorio y propone este pipeline. Ajústalo antes de subirlo.',
  detected: 'TaskMate revisó el repositorio y propone este pipeline. Ajústalo antes de subirlo.',
};
const SOURCE_LABELS = { saved: 'Guardado', ai: 'Propuesto por IA', detected: 'Detectado' };

// Servers and watchers never finish, so they are listed (the admin sees why) but cannot be chosen.
function ScriptSelect({ id, label, value, scripts, longRunning = [], noneLabel, onChange, helperText }) {
  return (
    <TextField
      id={id}
      select
      size="small"
      fullWidth
      label={label}
      value={value || ''}
      onChange={(event) => onChange(event.target.value || null)}
      helperText={helperText}
    >
      <MenuItem value="">{noneLabel}</MenuItem>
      {Object.entries(scripts).map(([name, command]) => {
        const neverEnds = longRunning.includes(name);
        return (
          <MenuItem key={name} value={name} disabled={neverEnds}>
            <Box component="span" sx={monoSx}>
              {name === 'test' ? 'npm test' : `npm run ${name}`}
            </Box>
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1, ...monoSx }} noWrap>
              {command}
            </Typography>
            {neverEnds && (
              <Typography component="span" variant="caption" color="warning.main" sx={{ ml: 1 }}>
                (inicia un servidor o vigila cambios: nunca termina)
              </Typography>
            )}
          </MenuItem>
        );
      })}
    </TextField>
  );
}

function NodeFields({ spec, project, options, onChange }) {
  const scripts = project.scripts || {};
  const longRunning = project.longRunning || [];
  const setScript = (key) => (name) => onChange({ ...spec, [key]: name ? { kind: 'script', name } : null });
  return (
    <>
      <TextField
        id="ci-runtime"
        select
        size="small"
        fullWidth
        label="Versión de Node.js"
        value={spec.runtime || ''}
        onChange={(event) => onChange({ ...spec, runtime: event.target.value })}
      >
        {options.nodeVersions.map((v) => (
          <MenuItem key={v} value={v}>
            Node.js {v}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        id="ci-install"
        select
        size="small"
        fullWidth
        label="Instalar dependencias"
        value={(spec.install && spec.install.kind) || 'npm-install'}
        onChange={(event) => onChange({ ...spec, install: { kind: event.target.value } })}
      >
        {project.lockfile === 'npm' && <MenuItem value="npm-ci">npm ci (usa package-lock.json)</MenuItem>}
        <MenuItem value="npm-install">npm install</MenuItem>
      </TextField>
      <ScriptSelect
        id="ci-lint"
        label="Análisis estático (lint)"
        value={spec.lint && spec.lint.name}
        scripts={scripts}
        longRunning={longRunning}
        noneLabel="Sin lint"
        onChange={setScript('lint')}
      />
      <FormControlLabel
        control={<Switch checked={spec.audit === true} onChange={(event) => onChange({ ...spec, audit: event.target.checked })} />}
        label="Auditoría de dependencias (npm audit)"
      />
      <ScriptSelect id="ci-test" label="Pruebas" value={spec.test && spec.test.name} scripts={scripts} longRunning={longRunning} noneLabel="Sin pruebas" onChange={setScript('test')} />
      <ScriptSelect id="ci-build" label="Build" value={spec.build && spec.build.name} scripts={scripts} longRunning={longRunning} noneLabel="Sin build" onChange={setScript('build')} />
    </>
  );
}

function PythonFields({ spec, project, options, onChange }) {
  const installValue = spec.install ? spec.install.kind : '';
  const changeInstall = (kind) => {
    if (kind === 'pip') onChange({ ...spec, install: { kind: 'pip', files: [...project.requirementFiles] } });
    else if (kind === 'pip-project') onChange({ ...spec, install: { kind: 'pip-project' } });
    else onChange({ ...spec, install: null });
  };
  return (
    <>
      <TextField
        id="ci-runtime"
        select
        size="small"
        fullWidth
        label="Versión de Python"
        value={spec.runtime || ''}
        onChange={(event) => onChange({ ...spec, runtime: event.target.value })}
      >
        {options.pythonVersions.map((v) => (
          <MenuItem key={v} value={v}>
            Python {v}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        id="ci-install"
        select
        size="small"
        fullWidth
        label="Instalar dependencias"
        value={installValue}
        onChange={(event) => changeInstall(event.target.value)}
      >
        <MenuItem value="">Sin instalación</MenuItem>
        {project.requirementFiles.length > 0 && (
          <MenuItem value="pip">pip install -r {project.requirementFiles.join(', ')}</MenuItem>
        )}
        {project.pyproject && <MenuItem value="pip-project">pip install . (pyproject.toml)</MenuItem>}
      </TextField>
      <FormControlLabel
        control={<Switch checked={Boolean(spec.lint)} onChange={(event) => onChange({ ...spec, lint: event.target.checked ? { kind: 'ruff' } : null })} />}
        label="Análisis estático con Ruff"
      />
      <FormControlLabel
        control={<Switch checked={Boolean(spec.test)} onChange={(event) => onChange({ ...spec, test: event.target.checked ? { kind: 'pytest' } : null })} />}
        label="Pruebas con pytest"
      />
    </>
  );
}

function DeployFields({ spec, project, onChange }) {
  const deploy = spec.deploy;
  if (project.stack === 'python') {
    return (
      <Typography variant="body2" color="text.secondary">
        Los proyectos de Python no se despliegan a GitHub Pages (solo sitios estáticos).
      </Typography>
    );
  }
  if (project.stack === 'static') {
    return (
      <TextField
        id="ci-site-dir"
        select
        size="small"
        fullWidth
        label="Carpeta del sitio"
        value={deploy ? deploy.outputDir : ''}
        onChange={(event) => onChange({ ...spec, deploy: { target: 'github-pages', framework: 'static', outputDir: event.target.value } })}
      >
        {project.siteDirs.map((dir) => (
          <MenuItem key={dir} value={dir}>
            {dir === '.' ? 'La carpeta del proyecto' : dir}
          </MenuItem>
        ))}
      </TextField>
    );
  }
  const enable = (on) => {
    if (!on) return onChange({ ...spec, deploy: null });
    const framework = project.framework || 'static';
    const outputDir = OUTPUT_DIRS[framework] || (project.siteDirs || []).find((dir) => dir !== '.') || 'dist';
    return onChange({ ...spec, deploy: { target: 'github-pages', framework, outputDir } });
  };
  return (
    <>
      <FormControlLabel
        control={<Switch checked={Boolean(deploy)} onChange={(event) => enable(event.target.checked)} />}
        label="Desplegar a GitHub Pages"
      />
      {deploy && (
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
          <TextField
            id="ci-framework"
            select
            size="small"
            label="Tipo de sitio"
            value={deploy.framework}
            onChange={(event) => {
              const framework = event.target.value;
              onChange({ ...spec, deploy: { ...deploy, framework, outputDir: OUTPUT_DIRS[framework] || deploy.outputDir } });
            }}
          >
            {FRAMEWORKS.map((f) => (
              <MenuItem key={f.value} value={f.value}>
                {f.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            id="ci-output-dir"
            size="small"
            label="Carpeta que se publica"
            value={deploy.outputDir}
            onChange={(event) => onChange({ ...spec, deploy: { ...deploy, outputDir: event.target.value.trim() } })}
            inputProps={{ maxLength: 200, spellCheck: false, style: monoSx }}
          />
        </Box>
      )}
    </>
  );
}

function Stages({ stages }) {
  if (!stages || stages.length === 0) return null;
  return (
    <Box component="ol" aria-label="Etapas del pipeline" sx={{ m: 0, pl: 3, display: 'grid', gap: 0.75 }}>
      {stages.map((stage) => (
        <li key={stage.key}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {stage.label}
          </Typography>
          {stage.commands.map((command) => (
            <Typography key={command} variant="caption" color="text.secondary" component="div" sx={monoSx}>
              {command}
            </Typography>
          ))}
        </li>
      ))}
    </Box>
  );
}

/**
 * Admin dialog: TaskMate proposes the pipeline for the repository, the admin adjusts it (only
 * choices the backend accepts; no free-form commands) and TaskMate commits the workflow.
 * Props: open, gid, defaultBranch, onClose(), onApplied(result).
 */
export default function PipelineSetup({ open, gid, defaultBranch, onClose, onApplied }) {
  // `ai`: the request in flight asked the AI (it can take several seconds).
  const [proposal, setProposal] = useState({ loading: false, error: null, data: null, ai: false });
  const [spec, setSpec] = useState(null);
  const [rendered, setRendered] = useState({ stages: [], yaml: '' });
  const [preview, setPreview] = useState({ loading: false, error: null });
  const [showYaml, setShowYaml] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState(null);
  const [result, setResult] = useState(null);
  const dirty = useRef(false);
  const inflight = useRef(null);

  // A new request supersedes the one in flight (an AI proposal may arrive after a project switch).
  const load = useCallback(
    (project) => {
      if (inflight.current) inflight.current.abort();
      const controller = new AbortController();
      inflight.current = controller;
      setProposal((prev) => ({ ...prev, loading: true, error: null, ai: Boolean(project && project.ai) }));
      setApplyError(null);
      proposePipeline(gid, project || {}, { signal: controller.signal })
        .then((data) => {
          dirty.current = false;
          setProposal({ loading: false, error: null, data, ai: false });
          setSpec(data.spec);
          setRendered({ stages: data.stages || [], yaml: data.yaml || '' });
          setPreview({ loading: false, error: null });
        })
        .catch((err) => {
          if (isAbortError(err)) return;
          setProposal((prev) => ({ ...prev, loading: false, ai: false, error: errorMessage(err, 'No se pudo analizar el repositorio.') }));
        });
    },
    [gid]
  );

  useEffect(() => {
    if (!open) return undefined;
    setResult(null);
    setShowYaml(false);
    load();
    return () => {
      if (inflight.current) inflight.current.abort();
    };
  }, [open, load]);

  // Every edit is re-validated and re-rendered by the backend (single source of the YAML).
  useEffect(() => {
    if (!open || !spec || !dirty.current) return undefined;
    const controller = new AbortController();
    setPreview({ loading: true, error: null });
    const timer = setTimeout(() => {
      previewPipeline(gid, spec, { signal: controller.signal })
        .then((data) => {
          setRendered({ stages: data.stages || [], yaml: data.yaml || '' });
          setPreview({ loading: false, error: null });
        })
        .catch((err) => {
          if (isAbortError(err)) return;
          setPreview({ loading: false, error: errorMessage(err, 'No se pudo actualizar la vista previa.') });
        });
    }, PREVIEW_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, gid, spec]);

  const change = (next) => {
    dirty.current = true;
    setSpec(next);
  };

  const handleApply = async () => {
    setApplying(true);
    setApplyError(null);
    try {
      const data = await applyPipeline(gid, spec);
      setResult(data);
      if (onApplied) onApplied(data);
    } catch (err) {
      setApplyError(errorMessage(err, 'No se pudo subir el pipeline al repositorio.'));
    } finally {
      setApplying(false);
    }
  };

  const data = proposal.data;
  const aiInfo = (data && data.ai) || null;
  const projects = (data && data.facts && data.facts.projects) || [];
  const project = spec ? projects.find((p) => p.dir === spec.project.dir && p.stack === spec.project.stack) : null;
  const branch = defaultBranch || 'la rama principal';
  const busy = proposal.loading || applying;
  const canApply = Boolean(spec && project) && !busy && !preview.loading && !preview.error && !result;
  const commitUrl = result && result.commit ? safeGitHubUrl(result.commit.url) : null;
  const siteUrl = result && result.pages ? safeHttpsUrl(result.pages.url) : null;

  return (
    <Dialog open={open} onClose={() => !applying && onClose()} fullWidth maxWidth="md" aria-labelledby="ci-setup-title">
      <DialogTitle id="ci-setup-title">Configurar pipeline de CI/CD</DialogTitle>
      <DialogContent dividers>
        {proposal.loading && !data && (
          <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 4, justifyContent: 'center' }}>
            <CircularProgress size={22} />
            <Typography color="text.secondary">Analizando el repositorio…</Typography>
          </Box>
        )}
        {proposal.error && (
          <Alert
            severity="error"
            action={
              <Button variant="ghost" size="small" onClick={() => load()}>
                Reintentar
              </Button>
            }
          >
            {proposal.error}
          </Alert>
        )}

        {result && (
          <Alert severity="success" sx={{ mb: 2 }}>
            {result.commit && result.commit.changed === false
              ? 'El pipeline ya estaba en el repositorio con esta misma configuración.'
              : 'Pipeline subido al repositorio. GitHub lo ejecutará en unos segundos.'}
            {commitUrl && (
              <>
                {' '}
                <Link href={commitUrl} target="_blank" rel="noopener noreferrer">
                  Ver commit
                </Link>
              </>
            )}
            {siteUrl && (
              <Box component="span" sx={{ display: 'block', mt: 0.5 }}>
                Sitio de GitHub Pages:{' '}
                <Link href={siteUrl} target="_blank" rel="noopener noreferrer" sx={monoSx}>
                  {siteUrl}
                </Link>
              </Box>
            )}
          </Alert>
        )}

        {data && spec && project && !result && (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 2 }} aria-busy={proposal.loading}>
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: '1 1 260px', minWidth: 0 }}>
                  <AutoAwesomeIcon fontSize="small" sx={{ color: '#fbbf24' }} aria-hidden />
                  <Typography variant="body2">{INTROS[data.source] || INTROS.detected}</Typography>
                </Box>
                {aiInfo && aiInfo.available && (
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => load({ dir: spec.project.dir, stack: spec.project.stack, ai: true })}
                    disabled={busy}
                    startIcon={proposal.loading && proposal.ai ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeIcon />}
                    aria-describedby="ci-ai-consent"
                  >
                    Proponer con IA
                  </Button>
                )}
              </Box>
              {aiInfo && (
                <Typography id="ci-ai-consent" variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5, mb: 0 }}>
                  {aiInfo.available
                    ? 'Se envía a Groq la lista de proyectos y scripts del repositorio, nunca el código fuente.'
                    : 'Activa «Permitir análisis con IA» en la pestaña Repositorio para que la IA proponga el pipeline.'}
                </Typography>
              )}
              {proposal.loading && proposal.ai && (
                <Typography role="status" variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5, mb: 0 }}>
                  La IA está revisando el repositorio…
                </Typography>
              )}
            </Box>
            {(data.notes || []).length > 0 && (
              <Alert severity="info">
                {data.notes.map((note) => (
                  <Box key={note} component="span" sx={{ display: 'block' }}>
                    {note}
                  </Box>
                ))}
              </Alert>
            )}

            <TextField
              id="ci-project"
              select
              size="small"
              fullWidth
              label="Proyecto"
              value={projectKey(project)}
              disabled={busy || projects.length < 2}
              onChange={(event) => {
                const target = projects.find((p) => projectKey(p) === event.target.value);
                if (target) load({ dir: target.dir, stack: target.stack });
              }}
            >
              {projects.map((p) => (
                <MenuItem key={projectKey(p)} value={projectKey(p)}>
                  {projectLabel(p)}
                </MenuItem>
              ))}
            </TextField>

            <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, display: 'grid', gap: 1.5 }} disabled={busy}>
              <Typography component="legend" variant="subtitle2" sx={{ mb: 1 }}>
                Build, pruebas y análisis estático
              </Typography>
              {project.stack === 'node' && <NodeFields spec={spec} project={project} options={data.options} onChange={change} />}
              {project.stack === 'python' && <PythonFields spec={spec} project={project} options={data.options} onChange={change} />}
              {project.stack === 'static' && (
                <Typography variant="body2" color="text.secondary">
                  Un sitio estático no se compila: el CI solo verifica que exista su index.html.
                </Typography>
              )}
            </Box>

            <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, display: 'grid', gap: 1.5 }} disabled={busy}>
              <Typography component="legend" variant="subtitle2" sx={{ mb: 1 }}>
                Deploy
              </Typography>
              <DeployFields spec={spec} project={project} onChange={change} />
              {spec.deploy && (
                <Typography variant="caption" color="text.secondary">
                  Staging se publica en /staging/ y se actualiza solo con cada cambio en {branch} que pasa el CI. Producción
                  se publica en la raíz del sitio cuando un administrador lo aprueba en TaskMate.
                </Typography>
              )}
            </Box>

            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Typography variant="subtitle2">Etapas</Typography>
                {preview.loading && <CircularProgress size={14} aria-label="Actualizando vista previa" />}
              </Box>
              {preview.error ? <Alert severity="warning">{preview.error}</Alert> : <Stages stages={rendered.stages} />}
            </Box>

            <Box>
              <Button variant="ghost" size="small" onClick={() => setShowYaml((v) => !v)} aria-expanded={showYaml} aria-controls="ci-yaml">
                {showYaml ? 'Ocultar el archivo YAML' : 'Ver el archivo YAML'}
              </Button>
              {/* Rendered only while open: long YAML lines must never widen the dialog. */}
              {showYaml && (
                <Box
                  id="ci-yaml"
                  component="pre"
                  tabIndex={0}
                  aria-label="Vista previa de .github/workflows/taskmate-ci.yml"
                  sx={{
                    ...monoSx,
                    mt: 1,
                    mb: 0,
                    p: 1.5,
                    maxWidth: '100%',
                    maxHeight: 360,
                    overflow: 'auto',
                    fontSize: '0.75rem',
                    borderRadius: 1,
                    background: 'rgba(0, 0, 0, 0.35)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                  }}
                >
                  {rendered.yaml}
                </Box>
              )}
            </Box>

            <Alert severity="warning" icon={<CloudUploadIcon />}>
              Al subirlo, TaskMate hará un commit en <strong>{branch}</strong> con{' '}
              <Box component="span" sx={monoSx}>
                .github/workflows/taskmate-ci.yml
              </Box>
              {spec.deploy ? ' y activará GitHub Pages para que publique desde GitHub Actions.' : '.'}
              {data.workflowExists && data.source !== 'saved' && ' El archivo ya existe: si lo creó TaskMate se reemplaza.'}
            </Alert>
          </Box>
        )}

        {applyError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {applyError}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        {data && data.source && !result && (
          <Chip size="small" variant="outlined" label={SOURCE_LABELS[data.source] || SOURCE_LABELS.detected} sx={{ mr: 'auto', ml: 1 }} />
        )}
        <Button variant="ghost" size="small" onClick={onClose} disabled={applying}>
          {result ? 'Cerrar' : 'Cancelar'}
        </Button>
        {!result && (
          <Button variant="primary" size="small" onClick={handleApply} disabled={!canApply} startIcon={applying ? <CircularProgress size={16} color="inherit" /> : <CloudUploadIcon />}>
            Subir al repositorio
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

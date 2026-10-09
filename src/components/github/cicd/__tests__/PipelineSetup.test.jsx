import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { applyPipeline, previewPipeline, proposePipeline } from '../../../../api/github';
import theme from '../../../../theme/theme';
import PipelineSetup from '../PipelineSetup';

jest.mock('../../../../api/github', () => ({
  proposePipeline: jest.fn(),
  previewPipeline: jest.fn(),
  applyPipeline: jest.fn(),
}));

const NODE = {
  dir: '.',
  stack: 'node',
  validManifest: true,
  scripts: { lint: 'eslint .', test: 'vitest run', build: 'vite build' },
  lockfile: 'npm',
  runtime: '22',
  framework: 'vite',
  siteDirs: ['.'],
};
const PYTHON = { dir: 'api', stack: 'python', requirementFiles: ['requirements.txt'], pyproject: false, runtime: null, usesPytest: true };
const SPEC = {
  version: 1,
  project: { dir: '.', stack: 'node' },
  runtime: '22',
  install: { kind: 'npm-ci' },
  lint: { kind: 'script', name: 'lint' },
  audit: false,
  test: { kind: 'script', name: 'test' },
  build: { kind: 'script', name: 'build' },
  deploy: { target: 'github-pages', framework: 'vite', outputDir: 'dist' },
};
const PROPOSAL = {
  source: 'detected',
  notes: ['Nota de prueba.'],
  facts: { projects: [NODE, PYTHON] },
  options: { nodeVersions: ['20', '22', '24', '26'], pythonVersions: ['3.12', '3.13'] },
  workflowExists: false,
  spec: SPEC,
  stages: [
    { key: 'install', label: 'Instalar dependencias', commands: ['npm ci'] },
    { key: 'lint', label: 'Análisis estático', commands: ['npm run lint'] },
  ],
  yaml: '# taskmate-pipeline: 1\nname: TaskMate CI/CD\n',
};

const renderSetup = (props = {}) =>
  render(
    <ThemeProvider theme={theme}>
      <PipelineSetup open gid="G1" defaultBranch="main" onClose={jest.fn()} onApplied={jest.fn()} {...props} />
    </ThemeProvider>
  );

const pick = async (label, option) => {
  fireEvent.mouseDown(screen.getByLabelText(label));
  fireEvent.click(await screen.findByRole('option', { name: option }));
};

beforeEach(() => {
  proposePipeline.mockReset().mockResolvedValue(PROPOSAL);
  previewPipeline.mockReset().mockImplementation((gid, spec) => Promise.resolve({ spec, stages: [{ key: 'install', label: 'Instalar dependencias', commands: ['npm ci'] }], yaml: 'preview' }));
  applyPipeline.mockReset();
});

describe('PipelineSetup', () => {
  test('shows the proposal: notes, project, stages and the commit it will make', async () => {
    renderSetup();
    expect(await screen.findByText('Nota de prueba.')).toBeInTheDocument();
    expect(proposePipeline).toHaveBeenCalledWith('G1', {}, expect.anything());
    expect(screen.getByLabelText('Proyecto')).toHaveTextContent('Raíz del repositorio · Node.js');
    const stages = screen.getByRole('list', { name: 'Etapas del pipeline' });
    expect(within(stages).getByText('npm run lint')).toBeInTheDocument();
    expect(screen.getByText(/hará un commit en/)).toHaveTextContent('main');
    expect(screen.getByText(/activará GitHub Pages/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver el archivo YAML' }));
    expect(screen.getByLabelText('Vista previa de .github/workflows/taskmate-ci.yml')).toHaveTextContent('taskmate-pipeline: 1');
  });

  test('editing re-renders through the backend with the edited spec', async () => {
    renderSetup();
    await screen.findByText('Nota de prueba.');
    await pick('Análisis estático (lint)', 'Sin lint');
    fireEvent.click(screen.getByLabelText('Auditoría de dependencias (npm audit)'));
    await waitFor(() => expect(previewPipeline).toHaveBeenCalled());
    const [, spec] = previewPipeline.mock.calls[previewPipeline.mock.calls.length - 1];
    expect(spec.lint).toBeNull();
    expect(spec.audit).toBe(true);
    expect(spec.test).toEqual({ kind: 'script', name: 'test' });
  });

  test('turning the deploy off drops it from the spec', async () => {
    renderSetup();
    await screen.findByText('Nota de prueba.');
    fireEvent.click(screen.getByLabelText('Desplegar a GitHub Pages'));
    await waitFor(() => expect(previewPipeline).toHaveBeenCalled());
    expect(previewPipeline.mock.calls[0][1].deploy).toBeNull();
    expect(screen.getByText(/hará un commit en/)).not.toHaveTextContent('GitHub Pages');
  });

  test('switching project asks for a new proposal for it', async () => {
    renderSetup();
    await screen.findByText('Nota de prueba.');
    proposePipeline.mockResolvedValue({
      ...PROPOSAL,
      notes: [],
      spec: { ...SPEC, project: { dir: 'api', stack: 'python' }, runtime: '3.13', install: { kind: 'pip', files: ['requirements.txt'] }, lint: { kind: 'ruff' }, test: { kind: 'pytest' }, build: null, deploy: null },
    });
    await pick('Proyecto', 'api · Python');
    expect(proposePipeline).toHaveBeenLastCalledWith('G1', { dir: 'api', stack: 'python' }, expect.anything());
    expect(await screen.findByLabelText('Análisis estático con Ruff')).toBeChecked();
    expect(screen.getByText(/no se despliegan a GitHub Pages/)).toBeInTheDocument();
  });

  test('uploads the spec and shows the commit and the site', async () => {
    const onApplied = jest.fn();
    applyPipeline.mockResolvedValue({
      commit: { sha: 'c'.repeat(40), url: 'https://github.com/acme/app/commit/ccc', changed: true },
      pages: { enabled: true, changed: true, url: 'https://acme.github.io/app/' },
    });
    renderSetup({ onApplied });
    await screen.findByText('Nota de prueba.');
    fireEvent.click(screen.getByRole('button', { name: 'Subir al repositorio' }));
    expect(await screen.findByText(/Pipeline subido al repositorio/)).toBeInTheDocument();
    expect(applyPipeline).toHaveBeenCalledWith('G1', SPEC);
    expect(screen.getByRole('link', { name: 'Ver commit' })).toHaveAttribute('href', 'https://github.com/acme/app/commit/ccc');
    expect(screen.getByRole('link', { name: 'https://acme.github.io/app/' })).toBeInTheDocument();
    expect(onApplied).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Subir al repositorio' })).not.toBeInTheDocument();
  });

  test('a commit URL outside github.com is not linked', async () => {
    applyPipeline.mockResolvedValue({ commit: { sha: 'c', url: 'javascript:alert(1)', changed: true }, pages: { url: 'http://insecure' } });
    renderSetup();
    await screen.findByText('Nota de prueba.');
    fireEvent.click(screen.getByRole('button', { name: 'Subir al repositorio' }));
    await screen.findByText(/Pipeline subido/);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  test('explains GitHub errors in Spanish', async () => {
    applyPipeline.mockRejectedValue(Object.assign(new Error('x'), { code: 'BRANCH_PROTECTED' }));
    renderSetup();
    await screen.findByText('Nota de prueba.');
    fireEvent.click(screen.getByRole('button', { name: 'Subir al repositorio' }));
    expect(await screen.findByText(/rama principal está protegida/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Subir al repositorio' })).toBeEnabled();
  });

  test('a failed analysis can be retried', async () => {
    proposePipeline.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'APP_PERMISSIONS_MISSING' }));
    renderSetup();
    expect(await screen.findByText(/todavía no tiene los permisos de CI\/CD/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Nota de prueba.')).toBeInTheDocument();
  });

  test('an invalid edit blocks the upload until it is fixed', async () => {
    previewPipeline.mockRejectedValue(Object.assign(new Error('x'), { code: 'INVALID_PIPELINE' }));
    renderSetup();
    await screen.findByText('Nota de prueba.');
    fireEvent.change(screen.getByLabelText('Carpeta que se publica'), { target: { value: '../x' } });
    expect(await screen.findByText(/no es válida para este repositorio/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Subir al repositorio' })).toBeDisabled();
  });
});

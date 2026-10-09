import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getPipeline, listRuns, listWorkflows, proposePipeline } from '../../../../api/github';
import theme from '../../../../theme/theme';
import CicdPanel from '../CicdPanel';

jest.mock('../../../../api/github', () => ({
  getPipeline: jest.fn(),
  listRuns: jest.fn(),
  listWorkflows: jest.fn(),
  proposePipeline: jest.fn(),
  previewPipeline: jest.fn(),
  applyPipeline: jest.fn(),
  getRun: jest.fn(),
}));

const REPO = { fullName: 'acme/app', htmlUrl: 'https://github.com/acme/app', defaultBranch: 'main' };
const CONFIGURED = {
  workflowPath: '.github/workflows/taskmate-ci.yml',
  pipeline: {
    workflowPath: '.github/workflows/taskmate-ci.yml',
    commitSha: 'c'.repeat(40),
    configuredAt: '2026-10-09T10:00:00Z',
    configuredBy: 'ana',
    spec: { project: { dir: '.', stack: 'node' } },
    stages: [
      { key: 'install', label: 'Instalar dependencias', commands: [] },
      { key: 'deploy', label: 'Deploy a GitHub Pages', commands: [] },
    ],
    deploys: true,
  },
  pages: { enabled: true, buildType: 'workflow', url: 'https://acme.github.io/app/' },
};

const renderPanel = (isAdmin = true) =>
  render(
    <ThemeProvider theme={theme}>
      <CicdPanel gid="G1" repo={REPO} isAdmin={isAdmin} />
    </ThemeProvider>
  );

beforeEach(() => {
  getPipeline.mockReset().mockResolvedValue({ pipeline: null, workflowPath: '.github/workflows/taskmate-ci.yml', pages: null });
  listRuns.mockReset().mockResolvedValue({ runs: [], totalCount: 0, page: 1 });
  listWorkflows.mockReset().mockResolvedValue([]);
  proposePipeline.mockReset().mockReturnValue(new Promise(() => {}));
});

describe('CicdPanel', () => {
  test('admin without a pipeline can open the setup', async () => {
    renderPanel(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Configurar pipeline' }));
    expect(await screen.findByRole('dialog', { name: 'Configurar pipeline de CI/CD' })).toBeInTheDocument();
    await waitFor(() => expect(proposePipeline).toHaveBeenCalledWith('G1', {}, expect.anything()));
  });

  test('members see the state but cannot configure', async () => {
    renderPanel(false);
    expect(await screen.findByText(/Pide al administrador del grupo que lo configure/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Configurar pipeline' })).not.toBeInTheDocument();
  });

  test('a configured pipeline shows its stages, who configured it, the workflow and the site', async () => {
    getPipeline.mockResolvedValue(CONFIGURED);
    renderPanel(true);
    expect(await screen.findByText('Deploy a GitHub Pages')).toBeInTheDocument();
    expect(screen.getByText(/Configurado por ana/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '.github/workflows/taskmate-ci.yml' })).toHaveAttribute(
      'href',
      'https://github.com/acme/app/blob/main/.github/workflows/taskmate-ci.yml'
    );
    expect(screen.getByRole('link', { name: 'https://acme.github.io/app/' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar pipeline' })).toBeInTheDocument();
  });

  test('Pages problems are reported', async () => {
    getPipeline.mockResolvedValue({ ...CONFIGURED, pages: { enabled: null, error: 'APP_PERMISSIONS_MISSING' } });
    renderPanel(true);
    expect(await screen.findByText(/no puede leer GitHub Pages/)).toBeInTheDocument();
  });
});

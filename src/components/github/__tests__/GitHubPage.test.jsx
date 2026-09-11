import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import * as github from '../../../api/github';
import theme from '../../../theme/theme';
import { GroupContext } from '../../GroupContext';
import GitHubPage from '../GitHubPage';
import { assignLocation } from '../githubUtils';

jest.mock('react-markdown', () => ({ __esModule: true, default: () => null }));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => {} }));
jest.mock('rehype-sanitize', () => ({ __esModule: true, default: () => {} }));
jest.mock('../../../api/github', () => ({
  install: jest.fn(),
  getSelection: jest.fn(),
  linkRepository: jest.fn(),
  getRepository: jest.fn(),
  unlinkRepository: jest.fn(),
  getTree: jest.fn(),
  getFile: jest.fn(),
  getReadme: jest.fn(),
  getCommits: jest.fn(),
  syncGroup: jest.fn(),
  setAiAnalysis: jest.fn(),
}));
jest.mock('../githubUtils', () => ({ ...jest.requireActual('../githubUtils'), assignLocation: jest.fn() }));

const REPO = {
  gid: 'G1',
  repoId: 5,
  owner: 'acme',
  name: 'app',
  fullName: 'acme/app',
  defaultBranch: 'main',
  isPrivate: true,
  installationId: 9,
  suspendedAt: null,
  connectedAt: '2026-09-01T10:00:00Z',
  connectedBy: 'U1',
  connectedByUsername: 'pablo',
  htmlUrl: 'https://github.com/acme/app',
  installation: { accountLogin: 'acme-org', suspended: false },
  aiAnalysisEnabled: true,
};

const groupsFor = (adminId = 'U1') => [
  { gid: 'G1', name: 'Equipo Web', adminId },
  { gid: 'G2', name: 'Equipo Móvil', adminId: 'U1' },
];

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function ChatProbe() {
  const location = useLocation();
  return <div data-testid="chat">{location.state && location.state.analyzeGroupId}</div>;
}

const showPage = ({ url = '/github', ctx = {}, adminId = 'U1' } = {}) => {
  const groups = groupsFor(adminId);
  const value = {
    selectedGroupId: 'G1',
    setSelectedGroupId: jest.fn(),
    selectedGroupName: 'Equipo Web',
    setSelectedGroupName: jest.fn(),
    groups,
    refreshGroups: jest.fn().mockResolvedValue(groups),
    ...ctx,
  };
  render(
    <ThemeProvider theme={theme}>
      <GroupContext.Provider value={value}>
        <MemoryRouter initialEntries={[url]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route
              path="/github"
              element={
                <>
                  <GitHubPage />
                  <LocationProbe />
                </>
              }
            />
            <Route path="/chat" element={<ChatProbe />} />
          </Routes>
        </MemoryRouter>
      </GroupContext.Provider>
    </ThemeProvider>
  );
  return value;
};

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('userId', 'U1');
  github.getRepository.mockResolvedValue(null);
  github.getCommits.mockResolvedValue([]);
});

describe('GitHubPage', () => {
  it('asks to pick a group when none is selected', async () => {
    const ctx = showPage({ ctx: { selectedGroupId: null, selectedGroupName: '' } });
    expect(screen.getByText('Selecciona un grupo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir a Grupos' })).toHaveAttribute('href', '/groups');
    await waitFor(() => expect(ctx.refreshGroups).toHaveBeenCalled());
    expect(github.getRepository).not.toHaveBeenCalled();
  });

  it('uses the GroupContext groups (refreshed once) instead of its own request', async () => {
    const ctx = showPage();
    expect(await screen.findByRole('button', { name: /Conectar repositorio/ })).toBeInTheDocument();
    expect(ctx.refreshGroups).toHaveBeenCalledTimes(1);
    expect(github.getRepository).toHaveBeenCalledWith('G1', expect.any(Object));
  });

  it('lets the admin connect a repository', async () => {
    showPage();
    expect(await screen.findByRole('button', { name: /Conectar repositorio/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ya instalé la App/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Archivos' })).toBeDisabled();
  });

  it('tells non-admins that only the admin can connect', async () => {
    showPage({ adminId: 'U2' });
    expect(await screen.findByText('Solo el administrador del grupo puede conectar un repositorio.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Conectar repositorio/ })).not.toBeInTheDocument();
  });

  it('redirects to installUrl and authorizeUrl only on github.com', async () => {
    github.install.mockResolvedValue({
      installUrl: 'https://github.com/apps/taskmate/installations/new?state=abc',
      authorizeUrl: 'https://github.com/login/oauth/authorize?client_id=1&state=def',
    });
    showPage();
    fireEvent.click(await screen.findByRole('button', { name: /Conectar repositorio/ }));
    await waitFor(() => expect(assignLocation).toHaveBeenCalledWith('https://github.com/apps/taskmate/installations/new?state=abc'));
    expect(github.install).toHaveBeenCalledWith('G1');
  });

  it('uses authorizeUrl for "Ya instalé la App"', async () => {
    github.install.mockResolvedValue({
      installUrl: 'https://github.com/apps/taskmate/installations/new?state=abc',
      authorizeUrl: 'https://github.com/login/oauth/authorize?client_id=1&state=def',
    });
    showPage();
    fireEvent.click(await screen.findByRole('button', { name: /Ya instalé la App/ }));
    await waitFor(() => expect(assignLocation).toHaveBeenCalledWith('https://github.com/login/oauth/authorize?client_id=1&state=def'));
  });

  it.each(['https://evil.example/install', ['javascript', 'alert(1)'].join(':'), 'https://github.com.evil.io/x'])(
    'refuses to redirect to %s',
    async (url) => {
      github.install.mockResolvedValue({ installUrl: url, authorizeUrl: url });
      showPage();
      fireEvent.click(await screen.findByRole('button', { name: /Conectar repositorio/ }));
      expect(await screen.findByText(/dirección de GitHub no válida/)).toBeInTheDocument();
      expect(assignLocation).not.toHaveBeenCalled();
    }
  );

  it('shows a connected repository with sync, analysis and the consent notice', async () => {
    github.getRepository.mockResolvedValue(REPO);
    showPage();
    expect(await screen.findByRole('link', { name: 'acme/app' })).toHaveAttribute('href', 'https://github.com/acme/app');
    expect(screen.getByText('Privado')).toBeInTheDocument();
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByText('acme-org')).toBeInTheDocument();
    expect(screen.getByText(/pablo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desconectar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sincronizar PRs/ })).toBeEnabled();
    const consent = screen.getAllByText(/Groq/).find((el) => el.id === 'gh-ai-consent');
    expect(consent).toHaveTextContent('Nunca se envía el código fuente');
    expect(screen.getByRole('button', { name: /Analizar con IA/ })).toHaveAttribute('aria-describedby', consent.id);
    expect(screen.getByRole('tab', { name: 'Archivos' })).toBeEnabled();
  });

  it('warns about a suspended installation and disables GitHub actions', async () => {
    github.getRepository.mockResolvedValue({ ...REPO, installation: { accountLogin: 'acme-org', suspended: true } });
    showPage();
    expect(await screen.findByText(/La instalación de la GitHub App está suspendida/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Analizar con IA/ })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Commits' })).toBeDisabled();
  });

  it('opens the chat with the group to analyze', async () => {
    github.getRepository.mockResolvedValue(REPO);
    const ctx = showPage();
    fireEvent.click(await screen.findByRole('button', { name: /Analizar con IA/ }));
    expect(await screen.findByTestId('chat')).toHaveTextContent('G1');
    expect(ctx.setSelectedGroupId).toHaveBeenCalledWith('G1');
    expect(ctx.setSelectedGroupName).toHaveBeenCalledWith('Equipo Web');
  });

  it('syncs pull requests and explains the rate limit', async () => {
    github.getRepository.mockResolvedValue(REPO);
    github.syncGroup.mockResolvedValueOnce({ branchesChecked: 4, pullRequestsFound: 3, updated: 1 });
    showPage();
    fireEvent.click(await screen.findByRole('button', { name: /Sincronizar PRs/ }));
    expect(await screen.findByText('Sincronización completa: 4 ramas revisadas, 3 PR encontrados, 1 actualizados.')).toBeInTheDocument();

    github.syncGroup.mockRejectedValueOnce(Object.assign(new Error('429'), { code: 'RATE_LIMITED', status: 429 }));
    fireEvent.click(screen.getByRole('button', { name: /Sincronizar PRs/ }));
    expect(await screen.findByText(/Espera unos 30 segundos/)).toBeInTheDocument();
  });

  it('disconnects after confirming, explaining the App stays installed', async () => {
    github.getRepository.mockResolvedValueOnce(REPO).mockResolvedValue(null);
    github.unlinkRepository.mockResolvedValue(null);
    showPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Desconectar' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Esto no desinstala la GitHub App');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Desconectar' }));
    await waitFor(() => expect(github.unlinkRepository).toHaveBeenCalledWith('G1'));
    expect(await screen.findByRole('button', { name: /Conectar repositorio/ })).toBeInTheDocument();
  });

  describe('callback query params', () => {
    it('status=select shows the repository selection and cleans the URL', async () => {
      github.getSelection.mockResolvedValue({ gid: 'G1', repos: [{ repoId: 1, fullName: 'acme/web', isPrivate: false }] });
      showPage({ url: '/github?status=select&selection=sel-9' });
      expect(await screen.findByText('Elige el repositorio')).toBeInTheDocument();
      expect(github.getSelection).toHaveBeenCalledWith('sel-9', expect.any(Object));
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/github$/));
      expect(await screen.findByText('acme/web')).toBeInTheDocument();
    });

    it('status=connected shows a success message', async () => {
      showPage({ url: '/github?status=connected' });
      expect(await screen.findByText('Repositorio conectado correctamente.')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/github$/));
    });

    it('status=pending explains that an org owner must approve', async () => {
      showPage({ url: '/github?status=pending' });
      expect(await screen.findByText(/un propietario de la organización debe aprobarla/)).toBeInTheDocument();
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/github$/));
    });

    it.each([
      ['INVALID_STATE', /El enlace de conexión expiró o ya se usó/],
      ['NOT_GROUP_ADMIN', /Ya no eres administrador de este grupo/],
      ['SOMETHING_NEW', /No se pudo conectar el repositorio \(código SOMETHING_NEW\)/],
      ['<b>x</b>', /^No se pudo conectar el repositorio\.$/],
    ])('status=error&code=%s shows a readable message', async (code, text) => {
      showPage({ url: `/github?status=error&code=${encodeURIComponent(code)}` });
      expect(await screen.findByText(text)).toBeInTheDocument();
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/github$/));
    });
  });

  it('selects the callback group (gid) before showing the repository selection', async () => {
    github.getSelection.mockResolvedValue({ gid: 'G2', githubLogin: 'octo', repos: [{ repoId: 1, fullName: 'acme/web', isPrivate: false }] });
    const ctx = showPage({ url: '/github?status=select&selection=sel-1&gid=G2' });
    await waitFor(() => expect(ctx.setSelectedGroupId).toHaveBeenCalledWith('G2'));
    expect(ctx.setSelectedGroupName).toHaveBeenCalledWith('Equipo Móvil');
    expect(await screen.findByText('Conectando como @octo')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/github$/));
  });

  describe('AI analysis permission', () => {
    it('lets the admin enable it and then allows the analysis', async () => {
      github.getRepository.mockResolvedValue({ ...REPO, aiAnalysisEnabled: false });
      github.setAiAnalysis.mockResolvedValue({ aiAnalysisEnabled: true });
      showPage();
      const analyze = await screen.findByRole('button', { name: /Analizar con IA/ });
      expect(analyze).toBeDisabled();
      expect(screen.getByText(/Actívalo con «Permitir análisis con IA»/)).toBeInTheDocument();

      const toggle = screen.getByRole('checkbox', { name: 'Permitir análisis con IA' });
      expect(toggle).not.toBeChecked();
      fireEvent.click(toggle);

      await waitFor(() => expect(github.setAiAnalysis).toHaveBeenCalledWith('G1', true));
      await waitFor(() => expect(screen.getByRole('button', { name: /Analizar con IA/ })).toBeEnabled());
      expect(screen.getByRole('checkbox', { name: 'Permitir análisis con IA' })).toBeChecked();
    });

    it('explains what is sent to Groq next to the toggle', async () => {
      github.getRepository.mockResolvedValue(REPO);
      showPage();
      await screen.findByRole('checkbox', { name: 'Permitir análisis con IA' });
      expect(screen.getAllByText(/Groq/).length).toBeGreaterThanOrEqual(2);
    });

    it('shows the state to non-admins without a toggle', async () => {
      github.getRepository.mockResolvedValue({ ...REPO, aiAnalysisEnabled: false });
      showPage({ adminId: 'U2' });
      expect(await screen.findByText('Análisis con IA: desactivado')).toBeInTheDocument();
      expect(screen.queryByRole('checkbox', { name: 'Permitir análisis con IA' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Analizar con IA/ })).toBeDisabled();
      expect(screen.getByText(/Pide al administrador del grupo que lo active/)).toBeInTheDocument();
    });

    it('keeps the toggle state when saving fails', async () => {
      github.getRepository.mockResolvedValue({ ...REPO, aiAnalysisEnabled: false });
      github.setAiAnalysis.mockRejectedValue(Object.assign(new Error('403'), { code: 'NOT_GROUP_ADMIN', status: 403 }));
      showPage();
      fireEvent.click(await screen.findByRole('checkbox', { name: 'Permitir análisis con IA' }));
      expect(await screen.findByText('Solo el administrador del grupo puede hacer esto.')).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'Permitir análisis con IA' })).not.toBeChecked();
    });
  });
});

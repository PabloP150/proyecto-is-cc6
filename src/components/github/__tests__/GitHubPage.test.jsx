import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { apiFetch } from '../../../api/client';
import * as github from '../../../api/github';
import theme from '../../../theme/theme';
import { GroupContext } from '../../GroupContext';
import GitHubPage from '../GitHubPage';
import { assignLocation } from '../githubUtils';

jest.mock('react-markdown', () => ({ __esModule: true, default: () => null }));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => {} }));
jest.mock('rehype-sanitize', () => ({ __esModule: true, default: () => {} }));
jest.mock('../../../api/client', () => ({ apiFetch: jest.fn() }));
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
};

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function ChatProbe() {
  const location = useLocation();
  return <div data-testid="chat">{location.state && location.state.analyzeGroupId}</div>;
}

const showPage = ({ url = '/github', ctx = {} } = {}) => {
  const value = {
    selectedGroupId: 'G1',
    setSelectedGroupId: jest.fn(),
    selectedGroupName: 'Equipo Web',
    setSelectedGroupName: jest.fn(),
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

const mockGroups = (adminId = 'U1') =>
  apiFetch.mockResolvedValue({ groups: [{ gid: 'G1', name: 'Equipo Web', adminId }] });

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('userId', 'U1');
  mockGroups();
  github.getRepository.mockResolvedValue(null);
  github.getCommits.mockResolvedValue([]);
});

describe('GitHubPage', () => {
  it('asks to pick a group when none is selected', async () => {
    showPage({ ctx: { selectedGroupId: null, selectedGroupName: '' } });
    expect(screen.getByText('Selecciona un grupo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir a Grupos' })).toHaveAttribute('href', '/groups');
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(github.getRepository).not.toHaveBeenCalled();
  });

  it('restores the group from localStorage when the context is empty', async () => {
    localStorage.setItem('selectedGroupId', 'G1');
    localStorage.setItem('selectedGroupName', 'Equipo Web');
    const ctx = showPage({ ctx: { selectedGroupId: null, selectedGroupName: '' } });
    await waitFor(() => expect(github.getRepository).toHaveBeenCalledWith('G1', expect.any(Object)));
    expect(ctx.setSelectedGroupId).toHaveBeenCalledWith('G1');
    expect(ctx.setSelectedGroupName).toHaveBeenCalledWith('Equipo Web');
  });

  it('lets the admin connect a repository', async () => {
    showPage();
    expect(await screen.findByRole('button', { name: /Conectar repositorio/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ya instalé la App/ })).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/api/groups/user-groups?uid=U1', expect.any(Object));
    expect(screen.getByRole('tab', { name: 'Archivos' })).toBeDisabled();
  });

  it('tells non-admins that only the admin can connect', async () => {
    mockGroups('U2');
    showPage();
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
    const consent = screen.getByText(/Groq/);
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
    github.syncGroup.mockResolvedValueOnce({ checked: 3, updated: 1 });
    showPage();
    fireEvent.click(await screen.findByRole('button', { name: /Sincronizar PRs/ }));
    expect(await screen.findByText('Sincronización completa: 3 PR revisados, 1 actualizados.')).toBeInTheDocument();

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
});

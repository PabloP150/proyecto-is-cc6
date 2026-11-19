import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  getPipeline: jest.fn(),
  listRuns: jest.fn(),
  listWorkflows: jest.fn(),
  getRun: jest.fn(),
  proposePipeline: jest.fn(),
  previewPipeline: jest.fn(),
  applyPipeline: jest.fn(),
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
    expect(screen.getByText('Select a group')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Groups' })).toHaveAttribute('href', '/groups');
    await waitFor(() => expect(ctx.refreshGroups).toHaveBeenCalled());
    expect(github.getRepository).not.toHaveBeenCalled();
  });

  it('uses the GroupContext groups (refreshed once) instead of its own request', async () => {
    const ctx = showPage();
    expect(await screen.findByRole('button', { name: /Connect repository/ })).toBeInTheDocument();
    expect(ctx.refreshGroups).toHaveBeenCalledTimes(1);
    expect(github.getRepository).toHaveBeenCalledWith('G1', expect.any(Object));
  });

  it('lets the admin connect a repository', async () => {
    showPage();
    expect(await screen.findByRole('button', { name: /Connect repository/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /I already installed the App/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Files' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'CI/CD' })).toBeDisabled();
  });

  it('opens the CI/CD tab of a connected repository', async () => {
    github.getRepository.mockResolvedValue(REPO);
    github.getPipeline.mockResolvedValue({ pipeline: null, workflowPath: '.github/workflows/taskmate-ci.yml', pages: null });
    github.listRuns.mockResolvedValue({ runs: [], totalCount: 0, page: 1 });
    github.listWorkflows.mockResolvedValue([]);
    showPage();
    await screen.findByRole('link', { name: 'acme/app' });
    fireEvent.click(screen.getByRole('tab', { name: 'CI/CD' }));
    expect(await screen.findByRole('button', { name: 'Set up pipeline' })).toBeInTheDocument();
    expect(github.getPipeline).toHaveBeenCalledWith('G1', expect.any(Object));
    expect(await screen.findByText(/has no GitHub Actions runs yet/)).toBeInTheDocument();
  });

  it('?tab=cicd (from a CI/CD notification) opens the CI/CD tab once the repository loads', async () => {
    github.getRepository.mockResolvedValue(REPO);
    github.getPipeline.mockResolvedValue({ pipeline: null, workflowPath: '.github/workflows/taskmate-ci.yml', pages: null });
    github.listRuns.mockResolvedValue({ runs: [], totalCount: 0, page: 1 });
    github.listWorkflows.mockResolvedValue([]);
    showPage({ url: '/github?tab=cicd' });
    expect(await screen.findByRole('button', { name: 'Set up pipeline' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'CI/CD' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/github$/);
  });

  it('after the owner gives the App access on GitHub, an admin goes straight to the repository selection', async () => {
    github.install.mockResolvedValue({
      installUrl: 'https://github.com/apps/taskmate/installations/new?state=abc',
      authorizeUrl: 'https://github.com/login/oauth/authorize?client_id=1&state=def',
    });
    showPage({ url: '/github?status=updated' });
    expect(await screen.findByText(/Opening the repository list/)).toBeInTheDocument();
    await waitFor(() => expect(assignLocation).toHaveBeenCalledWith('https://github.com/login/oauth/authorize?client_id=1&state=def'));
    expect(github.install).toHaveBeenCalledTimes(1);
    expect(github.install).toHaveBeenCalledWith('G1');
  });

  it('after an update on GitHub, a member is told that only the admin can connect', async () => {
    showPage({ url: '/github?status=updated', adminId: 'U2' });
    expect(await screen.findByText(/Only the group admin can connect the repository/)).toBeInTheDocument();
    expect(github.install).not.toHaveBeenCalled();
    expect(assignLocation).not.toHaveBeenCalled();
  });

  it('after an update on GitHub, a non-GitHub authorize URL is never followed', async () => {
    github.install.mockResolvedValue({ installUrl: 'https://evil.example/x', authorizeUrl: 'https://evil.example/y' });
    showPage({ url: '/github?status=updated' });
    expect(await screen.findByText(/Could not open the repository selection/)).toBeInTheDocument();
    expect(assignLocation).not.toHaveBeenCalled();
  });

  it('tells non-admins that only the admin can connect', async () => {
    showPage({ adminId: 'U2' });
    expect(await screen.findByText('Only the group admin can connect a repository.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect repository/ })).not.toBeInTheDocument();
  });

  it('redirects to installUrl and authorizeUrl only on github.com', async () => {
    github.install.mockResolvedValue({
      installUrl: 'https://github.com/apps/taskmate/installations/new?state=abc',
      authorizeUrl: 'https://github.com/login/oauth/authorize?client_id=1&state=def',
    });
    showPage();
    fireEvent.click(await screen.findByRole('button', { name: /Connect repository/ }));
    await waitFor(() => expect(assignLocation).toHaveBeenCalledWith('https://github.com/apps/taskmate/installations/new?state=abc'));
    expect(github.install).toHaveBeenCalledWith('G1');
  });

  it('uses authorizeUrl for "I already installed the App"', async () => {
    github.install.mockResolvedValue({
      installUrl: 'https://github.com/apps/taskmate/installations/new?state=abc',
      authorizeUrl: 'https://github.com/login/oauth/authorize?client_id=1&state=def',
    });
    showPage();
    fireEvent.click(await screen.findByRole('button', { name: /I already installed the App/ }));
    await waitFor(() => expect(assignLocation).toHaveBeenCalledWith('https://github.com/login/oauth/authorize?client_id=1&state=def'));
  });

  it.each(['https://evil.example/install', ['javascript', 'alert(1)'].join(':'), 'https://github.com.evil.io/x'])(
    'refuses to redirect to %s',
    async (url) => {
      github.install.mockResolvedValue({ installUrl: url, authorizeUrl: url });
      showPage();
      fireEvent.click(await screen.findByRole('button', { name: /Connect repository/ }));
      expect(await screen.findByText(/invalid GitHub address/)).toBeInTheDocument();
      expect(assignLocation).not.toHaveBeenCalled();
    }
  );

  it('shows a connected repository with sync, analysis and the consent notice', async () => {
    github.getRepository.mockResolvedValue(REPO);
    showPage();
    expect(await screen.findByRole('link', { name: 'acme/app' })).toHaveAttribute('href', 'https://github.com/acme/app');
    expect(screen.getByText('Private')).toBeInTheDocument();
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByText('acme-org')).toBeInTheDocument();
    expect(screen.getByText(/pablo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sync PRs/ })).toBeEnabled();
    const consent = screen.getAllByText(/NEVER read/).find((el) => el.id === 'gh-ai-consent');
    expect(consent).toHaveTextContent('The source code is NEVER read');
    expect(screen.getByRole('button', { name: /Analyze with AI/ })).toHaveAttribute('aria-describedby', consent.id);
    expect(screen.getByRole('tab', { name: 'Files' })).toBeEnabled();
  });

  it('warns about a suspended installation and disables GitHub actions', async () => {
    github.getRepository.mockResolvedValue({ ...REPO, installation: { accountLogin: 'acme-org', suspended: true } });
    showPage();
    expect(await screen.findByText(/The GitHub App installation is suspended/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Analyze with AI/ })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Commits' })).toBeDisabled();
  });

  it('opens the chat with the group to analyze', async () => {
    github.getRepository.mockResolvedValue(REPO);
    const ctx = showPage();
    fireEvent.click(await screen.findByRole('button', { name: /Analyze with AI/ }));
    expect(await screen.findByTestId('chat')).toHaveTextContent('G1');
    expect(ctx.setSelectedGroupId).toHaveBeenCalledWith('G1');
    expect(ctx.setSelectedGroupName).toHaveBeenCalledWith('Equipo Web');
  });

  it('syncs pull requests and explains the rate limit', async () => {
    github.getRepository.mockResolvedValue(REPO);
    github.syncGroup.mockResolvedValueOnce({ branchesChecked: 4, pullRequestsFound: 3, updated: 1 });
    showPage();
    fireEvent.click(await screen.findByRole('button', { name: /Sync PRs/ }));
    expect(await screen.findByText('Sync complete: 4 branches checked, 3 PRs found, 1 updated.')).toBeInTheDocument();

    github.syncGroup.mockRejectedValueOnce(Object.assign(new Error('429'), { code: 'RATE_LIMITED', status: 429 }));
    fireEvent.click(screen.getByRole('button', { name: /Sync PRs/ }));
    expect(await screen.findByText(/Wait about 30 seconds/)).toBeInTheDocument();
  });

  it('gives a toast that replaces an open one its full display time', async () => {
    github.getRepository.mockResolvedValue(REPO);
    github.syncGroup
      .mockResolvedValueOnce({ branchesChecked: 1, pullRequestsFound: 0, updated: 0 })
      .mockRejectedValueOnce(Object.assign(new Error('429'), { code: 'RATE_LIMITED', status: 429 }));
    showPage();
    const sync = await screen.findByRole('button', { name: /Sync PRs/ });

    jest.useFakeTimers();
    try {
      fireEvent.click(sync);
      expect(await screen.findByText(/Sync complete/)).toBeInTheDocument();

      act(() => jest.advanceTimersByTime(3000));
      fireEvent.click(screen.getByRole('button', { name: /Sync PRs/ }));
      expect(await screen.findByText(/It was synced a moment ago/)).toBeInTheDocument();
      expect(screen.queryByText(/Sync complete/)).not.toBeInTheDocument();

      // Past the first toast's 4 s (plus its exit transition), well within the second one's.
      act(() => jest.advanceTimersByTime(1500));
      act(() => jest.advanceTimersByTime(300));
      expect(screen.getByText(/It was synced a moment ago/)).toBeVisible();

      act(() => jest.advanceTimersByTime(2500));
      await waitFor(() => expect(screen.queryByText(/It was synced a moment ago/)).not.toBeInTheDocument());
    } finally {
      jest.useRealTimers();
    }
  });

  it('disconnects after confirming, explaining the App stays installed', async () => {
    github.getRepository.mockResolvedValueOnce(REPO).mockResolvedValue(null);
    github.unlinkRepository.mockResolvedValue(null);
    showPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('This does not uninstall the GitHub App');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(github.unlinkRepository).toHaveBeenCalledWith('G1'));
    expect(await screen.findByRole('button', { name: /Connect repository/ })).toBeInTheDocument();
  });

  describe('callback query params', () => {
    it('status=select shows the repository selection and cleans the URL', async () => {
      github.getSelection.mockResolvedValue({ gid: 'G1', repos: [{ repoId: 1, fullName: 'acme/web', isPrivate: false }] });
      showPage({ url: '/github?status=select&selection=sel-9' });
      expect(await screen.findByText('Choose the repository')).toBeInTheDocument();
      expect(github.getSelection).toHaveBeenCalledWith('sel-9', expect.any(Object));
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/github$/));
      expect(await screen.findByText('acme/web')).toBeInTheDocument();
    });

    it('status=connected shows a success message', async () => {
      showPage({ url: '/github?status=connected' });
      expect(await screen.findByText('Repository connected.')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/github$/));
    });

    it('status=pending explains that an org owner must approve', async () => {
      showPage({ url: '/github?status=pending' });
      expect(await screen.findByText(/an organization owner must approve it/)).toBeInTheDocument();
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/github$/));
    });

    it.each([
      ['INVALID_STATE', /The connection link expired or was already used/],
      ['NOT_GROUP_ADMIN', /You are no longer an admin of this group/],
      ['SOMETHING_NEW', /The repository could not be connected \(code SOMETHING_NEW\)/],
      ['<b>x</b>', /^The repository could not be connected\.$/],
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
    expect(await screen.findByText('Connecting as @octo')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/github$/));
  });

  describe('AI analysis permission', () => {
    it('lets the admin enable it and then allows the analysis', async () => {
      github.getRepository.mockResolvedValue({ ...REPO, aiAnalysisEnabled: false });
      github.setAiAnalysis.mockResolvedValue({ aiAnalysisEnabled: true });
      showPage();
      const analyze = await screen.findByRole('button', { name: /Analyze with AI/ });
      expect(analyze).toBeDisabled();
      expect(screen.getByText(/Turn it on with “Allow AI analysis”/)).toBeInTheDocument();

      const toggle = screen.getByRole('checkbox', { name: 'Allow AI analysis' });
      expect(toggle).not.toBeChecked();
      fireEvent.click(toggle);

      await waitFor(() => expect(github.setAiAnalysis).toHaveBeenCalledWith('G1', true));
      await waitFor(() => expect(screen.getByRole('button', { name: /Analyze with AI/ })).toBeEnabled());
      expect(screen.getByRole('checkbox', { name: 'Allow AI analysis' })).toBeChecked();
    });

    it('explains what the AI reads next to the toggle', async () => {
      github.getRepository.mockResolvedValue(REPO);
      showPage();
      await screen.findByRole('checkbox', { name: 'Allow AI analysis' });
      expect(screen.getAllByText(/NEVER read/).length).toBeGreaterThanOrEqual(2);
    });

    it('shows the state to non-admins without a toggle', async () => {
      github.getRepository.mockResolvedValue({ ...REPO, aiAnalysisEnabled: false });
      showPage({ adminId: 'U2' });
      expect(await screen.findByText('AI analysis: off')).toBeInTheDocument();
      expect(screen.queryByRole('checkbox', { name: 'Allow AI analysis' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Analyze with AI/ })).toBeDisabled();
      expect(screen.getByText(/Ask the group admin to turn it on/)).toBeInTheDocument();
    });

    it('keeps the toggle state when saving fails', async () => {
      github.getRepository.mockResolvedValue({ ...REPO, aiAnalysisEnabled: false });
      github.setAiAnalysis.mockRejectedValue(Object.assign(new Error('403'), { code: 'NOT_GROUP_ADMIN', status: 403 }));
      showPage();
      fireEvent.click(await screen.findByRole('checkbox', { name: 'Allow AI analysis' }));
      expect(await screen.findByText('Only the group admin can do this.')).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'Allow AI analysis' })).not.toBeChecked();
    });
  });
});

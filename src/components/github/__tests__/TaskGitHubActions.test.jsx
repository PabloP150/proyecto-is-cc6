import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createTaskBranch } from '../../../api/github';
import theme from '../../../theme/theme';
import TaskGitHubActions from '../TaskGitHubActions';

jest.mock('../../../api/github', () => ({ createTaskBranch: jest.fn() }));

const renderActions = (props) =>
  render(
    <ThemeProvider theme={theme}>
      <TaskGitHubActions tid="T-1" repoConnected {...props} />
    </ThemeProvider>
  );

const SCRIPT_URL = ['javascript', 'alert(1)'].join(':');

const BRANCH_LINK = {
  tid: 'T-1',
  branchName: 'tm/login-page-1234abcd',
  branchUrl: 'https://github.com/acme/app/tree/tm/login-page-1234abcd',
  pr: null,
};

beforeEach(() => {
  createTaskBranch.mockReset();
});

describe('TaskGitHubActions', () => {
  it('renders nothing when the repository is not connected', () => {
    const { container } = renderActions({ repoConnected: false, link: BRANCH_LINK });
    expect(container).toBeEmptyDOMElement();
  });

  it('creates a branch and reports it through onChange', async () => {
    const result = { tid: 'T-1', branchName: 'tm/new-task-1234abcd', branchUrl: 'https://github.com/acme/app/tree/tm/new-task-1234abcd', created: true };
    createTaskBranch.mockResolvedValue(result);
    const onChange = jest.fn();
    renderActions({ link: null, onChange });

    fireEvent.click(screen.getByRole('button', { name: 'Crear rama en GitHub' }));
    expect(createTaskBranch).toHaveBeenCalledWith('T-1');

    expect(await screen.findByText('tm/new-task-1234abcd')).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith(result);
    expect(screen.queryByRole('button', { name: 'Crear rama en GitHub' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver rama en GitHub' })).toHaveAttribute('href', result.branchUrl);
  });

  it('shows a readable error when the branch cannot be created', async () => {
    createTaskBranch.mockRejectedValue(Object.assign(new Error('409'), { code: 'REPO_EMPTY', status: 409 }));
    const onChange = jest.fn();
    renderActions({ link: null, onChange });

    fireEvent.click(screen.getByRole('button', { name: 'Crear rama en GitHub' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('El repositorio está vacío');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Crear rama en GitHub' })).toBeEnabled();
  });

  it('copies the checkout command when the branch chip is clicked', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderActions({ link: BRANCH_LINK });

    fireEvent.click(screen.getByRole('button', { name: /Copiar comando git checkout/ }));

    expect(await screen.findByText('Comando copiado: git checkout tm/login-page-1234abcd')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith('git checkout tm/login-page-1234abcd');
    delete navigator.clipboard;
  });

  it('falls back to showing the command when the clipboard is unavailable', async () => {
    renderActions({ link: BRANCH_LINK });
    fireEvent.click(screen.getByRole('button', { name: /Copiar comando git checkout/ }));
    expect(await screen.findByText(/No se pudo copiar\. Ejecuta: git checkout tm\/login-page-1234abcd/)).toBeInTheDocument();
  });

  it.each([
    [{ number: 7, state: 'open', isDraft: false }, 'PR #7 abierto', 'open'],
    [{ number: 8, state: 'open', isDraft: true }, 'PR #8 borrador', 'draft'],
    [{ number: 9, state: 'closed', isDraft: false }, 'PR #9 cerrado', 'closed'],
    [{ number: 10, state: 'merged', isDraft: false, mergedAt: '2026-09-01T00:00:00Z' }, 'PR #10 fusionado', 'merged'],
    [{ number: 11, state: 'merged', isDraft: false, baseBranch: 'main', mergedAt: '2026-09-01T00:00:00Z' }, 'PR #11 fusionado', 'merged'],
    [{ number: 12, state: 'closed', isDraft: false, baseBranch: 'develop' }, 'PR #12 cerrado', 'closed'],
  ])('shows the PR chip %#', (pr, label, status) => {
    renderActions({
      link: { ...BRANCH_LINK, defaultBranch: 'main', pr: { ...pr, htmlUrl: `https://github.com/acme/app/pull/${pr.number}` } },
    });
    const chip = screen.getByRole('link', { name: label });
    expect(chip).toHaveTextContent(label);
    expect(chip).toHaveAttribute('data-status', status);
    expect(chip).toHaveAttribute('href', `https://github.com/acme/app/pull/${pr.number}`);
  });

  it('says where a PR was merged when it is not the default branch', async () => {
    const pr = {
      number: 4,
      title: 'Página de login',
      state: 'merged',
      isDraft: false,
      baseBranch: 'develop',
      mergedAt: '2026-10-01T00:00:00Z',
      htmlUrl: 'https://github.com/acme/app/pull/4',
    };
    renderActions({ link: { ...BRANCH_LINK, defaultBranch: 'main', pr } });
    const note = 'develop no es la rama principal (main); la tarea no se completa sola.';

    const chip = screen.getByRole('link', { name: `PR #4 fusionado en develop: Página de login — ${note}` });
    expect(chip).toHaveTextContent(/^PR #4 fusionado en develop$/);
    expect(chip).toHaveAttribute('data-status', 'merged');

    fireEvent.mouseOver(chip);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(`Página de login — ${note}`);
  });

  it('keeps the plain merged label when the default branch is unknown', () => {
    const pr = { number: 5, state: 'merged', baseBranch: 'develop', mergedAt: '2026-10-01T00:00:00Z' };
    renderActions({ link: { ...BRANCH_LINK, pr } });
    expect(screen.getByText('PR #5 fusionado')).toBeInTheDocument();
  });

  it('never links to non-GitHub URLs', () => {
    renderActions({
      link: { ...BRANCH_LINK, branchUrl: SCRIPT_URL, pr: { number: 3, state: 'open', htmlUrl: 'https://evil.example/pr' } },
    });
    expect(screen.queryByRole('link', { name: 'Ver rama en GitHub' })).not.toBeInTheDocument();
    expect(screen.getByText('PR #3 abierto')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'PR #3 abierto' })).not.toBeInTheDocument();
  });

  it('renders its toast outside the task card so the card cannot clip it', async () => {
    createTaskBranch.mockResolvedValue({ tid: 'T-1', branchName: 'tm/x-1', branchUrl: null });
    render(
      <ThemeProvider theme={theme}>
        <div data-testid="card" style={{ transform: 'scale(1.05)', backdropFilter: 'blur(10px)' }}>
          <TaskGitHubActions tid="T-1" repoConnected link={null} />
        </div>
      </ThemeProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Crear rama en GitHub' }));

    const toast = await screen.findByRole('alert');
    expect(toast).toHaveTextContent('Rama tm/x-1 lista en GitHub.');
    expect(screen.getByTestId('card')).not.toContainElement(toast);
    expect(within(screen.getByTestId('card')).getByText('tm/x-1')).toBeInTheDocument();
  });

  it('gives a message that replaces an open one its full display time', async () => {
    jest.useFakeTimers();
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      createTaskBranch.mockResolvedValue({ tid: 'T-1', branchName: 'tm/x-1', branchUrl: null });
      renderActions({ link: null });
      fireEvent.click(screen.getByRole('button', { name: 'Crear rama en GitHub' }));
      expect(await screen.findByText('Rama tm/x-1 lista en GitHub.')).toBeInTheDocument();

      act(() => jest.advanceTimersByTime(3000));
      fireEvent.click(screen.getByRole('button', { name: /Copiar comando git checkout/ }));
      expect(await screen.findByText('Comando copiado: git checkout tm/x-1')).toBeInTheDocument();

      // Past the first message's 3.5 s (plus its exit transition), well within the second one's.
      act(() => jest.advanceTimersByTime(1500));
      act(() => jest.advanceTimersByTime(300));
      expect(screen.getByText('Comando copiado: git checkout tm/x-1')).toBeVisible();

      act(() => jest.advanceTimersByTime(2500));
      await waitFor(() => expect(screen.queryByText('Comando copiado: git checkout tm/x-1')).not.toBeInTheDocument());
    } finally {
      jest.useRealTimers();
      delete navigator.clipboard;
    }
  });

  it('hands its messages to onNotify instead of showing a toast of its own', async () => {
    createTaskBranch.mockResolvedValue({ tid: 'T-1', branchName: 'tm/x-1', branchUrl: null });
    const onNotify = jest.fn();
    renderActions({ link: null, onNotify });
    fireEvent.click(screen.getByRole('button', { name: 'Crear rama en GitHub' }));

    expect(await screen.findByText('tm/x-1')).toBeInTheDocument();
    expect(onNotify).toHaveBeenCalledWith('success', 'Rama tm/x-1 lista en GitHub.', 3500);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the chips within the card as well as within their own maximum', () => {
    const pr = { number: 4, state: 'merged', baseBranch: 'release/2026-10-hotfix-login', mergedAt: '2026-10-01T00:00:00Z', htmlUrl: 'https://github.com/acme/app/pull/4' };
    renderActions({ link: { ...BRANCH_LINK, defaultBranch: 'main', pr } });
    expect(getComputedStyle(screen.getByRole('link', { name: /^PR #4 fusionado en release/ })).maxWidth).toBe('min(100%, 280px)');
    expect(getComputedStyle(screen.getByRole('button', { name: /Copiar comando git checkout/ })).maxWidth).toBe('min(100%, 240px)');
  });

  it('does not bubble clicks to the task row', async () => {
    createTaskBranch.mockResolvedValue({ tid: 'T-1', branchName: 'tm/x-1', branchUrl: null });
    const onRowClick = jest.fn();
    render(
      <ThemeProvider theme={theme}>
        <div onClick={onRowClick}>
          <TaskGitHubActions tid="T-1" repoConnected link={null} />
        </div>
      </ThemeProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Crear rama en GitHub' }));
    expect(await screen.findByText('tm/x-1')).toBeInTheDocument();
    // The portaled toast still bubbles through the React tree.
    fireEvent.click(within(await screen.findByRole('alert')).getByRole('button'));
    expect(onRowClick).not.toHaveBeenCalled();
  });
});

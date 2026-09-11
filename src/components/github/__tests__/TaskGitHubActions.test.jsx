import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen } from '@testing-library/react';
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
  ])('shows the PR chip %#', (pr, label, status) => {
    renderActions({ link: { ...BRANCH_LINK, pr: { ...pr, htmlUrl: `https://github.com/acme/app/pull/${pr.number}` } } });
    const chip = screen.getByRole('link', { name: label });
    expect(chip).toHaveAttribute('data-status', status);
    expect(chip).toHaveAttribute('href', `https://github.com/acme/app/pull/${pr.number}`);
  });

  it('never links to non-GitHub URLs', () => {
    renderActions({
      link: { ...BRANCH_LINK, branchUrl: SCRIPT_URL, pr: { number: 3, state: 'open', htmlUrl: 'https://evil.example/pr' } },
    });
    expect(screen.queryByRole('link', { name: 'Ver rama en GitHub' })).not.toBeInTheDocument();
    expect(screen.getByText('PR #3 abierto')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'PR #3 abierto' })).not.toBeInTheDocument();
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
    expect(onRowClick).not.toHaveBeenCalled();
  });
});

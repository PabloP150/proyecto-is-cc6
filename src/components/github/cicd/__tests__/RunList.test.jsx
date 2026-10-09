import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { getRun, listRuns, listWorkflows } from '../../../../api/github';
import theme from '../../../../theme/theme';
import RunList from '../RunList';

jest.mock('../../../../api/github', () => ({ listRuns: jest.fn(), listWorkflows: jest.fn(), getRun: jest.fn() }));

const run = (id, extra = {}) => ({
  id,
  name: 'TaskMate CI/CD',
  title: `Commit ${id}`,
  workflowId: 55,
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  branch: 'main',
  headSha: 'a'.repeat(40),
  shortSha: 'aaaaaaa',
  runNumber: id,
  actor: { login: 'ana' },
  triggeringActor: { login: 'ana' },
  createdAt: '2026-10-09T10:00:00Z',
  durationMs: 125000,
  htmlUrl: `https://github.com/acme/app/actions/runs/${id}`,
  ...extra,
});

const DETAIL = {
  run: run(1),
  jobs: [
    {
      id: 11,
      name: 'CI (Node.js)',
      status: 'completed',
      conclusion: 'failure',
      durationMs: 60000,
      htmlUrl: 'https://github.com/acme/app/actions/runs/1/job/11',
      steps: [
        { number: 1, name: 'Checkout', status: 'completed', conclusion: 'success', durationMs: 2000 },
        { number: 2, name: 'Pruebas', status: 'completed', conclusion: 'failure', durationMs: 30000 },
        { number: 3, name: 'Build', status: 'completed', conclusion: 'skipped', durationMs: null },
      ],
    },
  ],
};

const renderList = () =>
  render(
    <ThemeProvider theme={theme}>
      <RunList gid="G1" />
    </ThemeProvider>
  );

beforeEach(() => {
  listWorkflows.mockReset().mockResolvedValue([{ id: 55, name: 'TaskMate CI/CD', isTaskmate: true }]);
  listRuns.mockReset().mockResolvedValue({ runs: [run(1), run(2, { conclusion: 'failure', title: 'Rompe pruebas' })], totalCount: 2, page: 1 });
  getRun.mockReset().mockResolvedValue(DETAIL);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('RunList', () => {
  test('lists runs with their state, branch, commit and duration', async () => {
    renderList();
    const list = await screen.findByRole('list');
    expect(within(list).getByText('Commit 1')).toBeInTheDocument();
    expect(within(list).getByText('Rompe pruebas')).toBeInTheDocument();
    expect(within(list).getAllByText('2 min 5 s')).toHaveLength(2);
    expect(within(list).getAllByTitle('Falló')).toHaveLength(1);
    expect(listRuns).toHaveBeenCalledWith('G1', expect.objectContaining({ workflow: undefined, status: undefined, page: 1 }));
  });

  test('filters by workflow and status', async () => {
    renderList();
    await screen.findByText('Commit 1');
    fireEvent.mouseDown(screen.getByLabelText('Estado'));
    fireEvent.click(await screen.findByRole('option', { name: 'Fallidos' }));
    await waitFor(() => expect(listRuns).toHaveBeenLastCalledWith('G1', expect.objectContaining({ status: 'failure', page: 1 })));
    fireEvent.mouseDown(screen.getByLabelText('Workflow'));
    fireEvent.click(await screen.findByRole('option', { name: 'TaskMate CI/CD' }));
    await waitFor(() => expect(listRuns).toHaveBeenLastCalledWith('G1', expect.objectContaining({ status: 'failure', workflow: '55' })));
  });

  test('expanding a run shows its jobs and steps and a safe GitHub link', async () => {
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: /Commit 1/ }));
    const steps = await screen.findByRole('list', { name: 'Pasos de CI (Node.js)' });
    expect(getRun).toHaveBeenCalledWith('G1', 1, expect.anything());
    expect(within(steps).getByText('Pruebas')).toBeInTheDocument();
    expect(within(steps).getAllByText('Omitido').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Ver la ejecución en GitHub' })).toHaveAttribute('href', 'https://github.com/acme/app/actions/runs/1');
    fireEvent.click(screen.getByRole('button', { name: /Commit 1/ }));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Pasos de CI (Node.js)' })).not.toBeInTheDocument());
  });

  test('"Ver más" appends the next page without duplicates', async () => {
    listRuns
      .mockResolvedValueOnce({ runs: [run(1), run(2)], totalCount: 3, page: 1 })
      .mockResolvedValueOnce({ runs: [run(2), run(3)], totalCount: 3, page: 2 });
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: 'Ver más' }));
    expect(await screen.findByText('Commit 3')).toBeInTheDocument();
    expect(screen.getAllByText('Commit 2')).toHaveLength(1);
    expect(listRuns).toHaveBeenLastCalledWith('G1', expect.objectContaining({ page: 2 }));
    expect(screen.queryByRole('button', { name: 'Ver más' })).not.toBeInTheDocument();
  });

  test('missing App permissions are explained', async () => {
    listRuns.mockRejectedValue(Object.assign(new Error('x'), { code: 'APP_PERMISSIONS_MISSING' }));
    renderList();
    expect(await screen.findByText(/todavía no tiene los permisos de CI\/CD/)).toBeInTheDocument();
  });

  test('empty repository', async () => {
    listRuns.mockResolvedValue({ runs: [], totalCount: 0, page: 1 });
    renderList();
    expect(await screen.findByText(/todavía no tiene ejecuciones/)).toBeInTheDocument();
  });

  test('refreshes by itself only while a run is active', async () => {
    jest.useFakeTimers();
    listRuns.mockResolvedValue({ runs: [run(1, { status: 'in_progress', conclusion: null })], totalCount: 1, page: 1 });
    renderList();
    await screen.findByText('Commit 1');
    expect(listRuns).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(15000);
    });
    await waitFor(() => expect(listRuns).toHaveBeenCalledTimes(2));

    listRuns.mockResolvedValue({ runs: [run(1)], totalCount: 1, page: 1 });
    await act(async () => {
      jest.advanceTimersByTime(15000);
    });
    await waitFor(() => expect(listRuns).toHaveBeenCalledTimes(3));
    await act(async () => {
      jest.advanceTimersByTime(60000);
    });
    expect(listRuns).toHaveBeenCalledTimes(3);
  });
});

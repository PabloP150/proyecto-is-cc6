import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { cancelRun, dispatchPipeline, getJobAnnotations, getJobLog, getRun, listRuns, listWorkflows, rerunFailed } from '../../../../api/github';
import theme from '../../../../theme/theme';
import { RealtimeContext } from '../../../realtime/RealtimeContext';
import RunList from '../RunList';

jest.mock('../../../../api/github', () => ({
  listRuns: jest.fn(),
  listWorkflows: jest.fn(),
  getRun: jest.fn(),
  getJobLog: jest.fn(),
  getJobAnnotations: jest.fn(),
  dispatchPipeline: jest.fn(),
  rerunFailed: jest.fn(),
  cancelRun: jest.fn(),
}));

const run = (id, extra = {}) => ({
  id,
  name: 'TaskMate CI/CD',
  title: `Commit ${id}`,
  isTaskmate: true,
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  branch: 'main',
  shortSha: 'aaaaaaa',
  runNumber: id,
  createdAt: '2026-10-09T10:00:00Z',
  durationMs: 60000,
  htmlUrl: `https://github.com/acme/app/actions/runs/${id}`,
  ...extra,
});

const failedJob = {
  id: 11,
  name: 'CI (Node.js)',
  status: 'completed',
  conclusion: 'failure',
  durationMs: 30000,
  steps: [{ number: 1, name: 'Análisis estático', status: 'completed', conclusion: 'failure', durationMs: 4000 }],
};

const listeners = new Set();
const realtime = (connected) => ({
  connected,
  subscribe: (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
});
const emit = (message) => act(() => listeners.forEach((fn) => fn(message)));

const renderList = ({ isAdmin = false, connected = true, canRun = true } = {}) =>
  render(
    <ThemeProvider theme={theme}>
      <RealtimeContext.Provider value={realtime(connected)}>
        <RunList gid="G1" isAdmin={isAdmin} canRun={canRun} defaultBranch="main" />
      </RealtimeContext.Provider>
    </ThemeProvider>
  );

beforeEach(() => {
  listeners.clear();
  listWorkflows.mockReset().mockResolvedValue([]);
  listRuns.mockReset().mockResolvedValue({ runs: [run(1, { conclusion: 'failure' })], totalCount: 1, page: 1 });
  getRun.mockReset().mockResolvedValue({ run: run(1, { conclusion: 'failure' }), jobs: [failedJob] });
  getJobAnnotations.mockReset().mockResolvedValue([
    { path: 'src/a.js', startLine: 3, endLine: 3, level: 'failure', title: 'no-undef', message: "'x' is not defined" },
  ]);
  getJobLog.mockReset().mockResolvedValue({
    jobId: 11,
    lines: ['##[group]Run npm run lint', '/src/a.js', '  3:7  error  x is not defined', '##[endgroup]', 'otra línea', '##[error]Process completed with exit code 1.'],
    errors: ['Process completed with exit code 1.'],
    truncated: true,
  });
  dispatchPipeline.mockReset().mockResolvedValue({ dispatched: true, ref: 'main' });
  rerunFailed.mockReset().mockResolvedValue({ rerun: true });
  cancelRun.mockReset().mockResolvedValue({ cancelled: true });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('run controls', () => {
  test('a failed run shows its annotations and can be re-run', async () => {
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: /Commit 1/ }));
    const annotations = await screen.findByRole('list', { name: 'Errores y advertencias' });
    expect(within(annotations).getByText('src/a.js:3')).toBeInTheDocument();
    expect(within(annotations).getByText(/no-undef: 'x' is not defined/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Re-ejecutar fallidos' }));
    expect(await screen.findByText('Se re-ejecutan los jobs fallidos.')).toBeInTheDocument();
    expect(rerunFailed).toHaveBeenCalledWith('G1', 1);
  });

  test('a running run can be cancelled; GitHub errors are explained', async () => {
    listRuns.mockResolvedValue({ runs: [run(2, { status: 'in_progress', conclusion: null })], totalCount: 1, page: 1 });
    getRun.mockResolvedValue({ run: run(2, { status: 'in_progress', conclusion: null }), jobs: [] });
    cancelRun.mockRejectedValue(Object.assign(new Error('x'), { code: 'RUN_NOT_CANCELLABLE' }));
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: /Commit 2/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByText('La ejecución ya terminó.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Re-ejecutar fallidos' })).not.toBeInTheDocument();
  });

  test('deploy runs: members see why they cannot act, admins get the buttons', async () => {
    const deploy = run(3, { event: 'workflow_dispatch', title: 'Deploy a production desde TaskMate', conclusion: 'failure' });
    listRuns.mockResolvedValue({ runs: [deploy], totalCount: 1, page: 1 });
    getRun.mockResolvedValue({ run: deploy, jobs: [] });
    const { unmount } = renderList({ isAdmin: false });
    fireEvent.click(await screen.findByRole('button', { name: /Deploy a production/ }));
    expect(await screen.findByText(/Solo el administrador del grupo puede re-ejecutar o cancelar un deploy/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Re-ejecutar fallidos' })).not.toBeInTheDocument();
    unmount();

    renderList({ isAdmin: true });
    fireEvent.click(await screen.findByRole('button', { name: /Deploy a production/ }));
    expect(await screen.findByRole('button', { name: 'Re-ejecutar fallidos' })).toBeInTheDocument();
  });

  test('the log of a finished job: groups, errors and the "only errors" filter', async () => {
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: /Commit 1/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ver log' }));
    const log = await screen.findByLabelText('Log del job 11');
    expect(getJobLog).toHaveBeenCalledWith('G1', 11, expect.anything());
    expect(within(log).getByText('▸ Run npm run lint')).toBeInTheDocument();
    expect(within(log).getByText('✖ Process completed with exit code 1.')).toBeInTheDocument();
    expect(within(log).getByText('otra línea')).toBeInTheDocument();
    expect(screen.getByText('Se muestra el final del log.')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Solo errores'));
    expect(within(log).queryByText('otra línea')).not.toBeInTheDocument();
    expect(within(log).getByText('3:7 error x is not defined', { normalizer: (t) => t.replace(/\s+/g, ' ').trim() })).toBeInTheDocument();
  });

  test('a log that is not available yet', async () => {
    getJobLog.mockRejectedValue(Object.assign(new Error('x'), { code: 'LOG_NOT_AVAILABLE' }));
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: /Commit 1/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ver log' }));
    expect(await screen.findByText(/El log todavía no está disponible/)).toBeInTheDocument();
  });
});

describe('run the pipeline', () => {
  test('runs the CI on the chosen branch', async () => {
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: 'Ejecutar pipeline' }));
    const dialog = screen.getByRole('dialog', { name: 'Ejecutar pipeline' });
    const branch = within(dialog).getByLabelText('Rama');
    expect(branch).toHaveValue('main');
    fireEvent.change(branch, { target: { value: 'feature/login' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ejecutar' }));
    expect(await screen.findByText(/se ejecutará en «feature\/login»/)).toBeInTheDocument();
    expect(dispatchPipeline).toHaveBeenCalledWith('G1', 'feature/login');
  });

  test('errors stay in the dialog; without a TaskMate pipeline there is no button', async () => {
    dispatchPipeline.mockRejectedValue(Object.assign(new Error('x'), { code: 'BRANCH_NOT_FOUND' }));
    const { unmount } = renderList();
    fireEvent.click(await screen.findByRole('button', { name: 'Ejecutar pipeline' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ejecutar' }));
    expect(await screen.findByText('Esa rama no existe en el repositorio.')).toBeInTheDocument();
    unmount();
    renderList({ canRun: false });
    await screen.findByText('Commit 1');
    expect(screen.queryByRole('button', { name: 'Ejecutar pipeline' })).not.toBeInTheDocument();
  });
});

describe('live updates', () => {
  test('a ci_run event of the group reloads the list (debounced); other groups are ignored', async () => {
    jest.useFakeTimers();
    renderList({ connected: true });
    await screen.findByText('Commit 1');
    expect(listRuns).toHaveBeenCalledTimes(1);
    emit({ type: 'event', event: 'ci_run', gid: 'g2', data: { runId: 5 } });
    emit({ type: 'event', event: 'ci_run', gid: 'g1', data: { runId: 5 } });
    emit({ type: 'event', event: 'ci_run', gid: 'G1', data: { runId: 6 } });
    await act(async () => {
      jest.advanceTimersByTime(1100);
    });
    await waitFor(() => expect(listRuns).toHaveBeenCalledTimes(2));
  });

  test('with the live connection there is no polling', async () => {
    jest.useFakeTimers();
    listRuns.mockResolvedValue({ runs: [run(1, { status: 'in_progress', conclusion: null })], totalCount: 1, page: 1 });
    renderList({ connected: true });
    await screen.findByText('Commit 1');
    await act(async () => {
      jest.advanceTimersByTime(60000);
    });
    expect(listRuns).toHaveBeenCalledTimes(1);
  });
});

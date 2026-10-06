import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { api, apiFetch } from '../../api/client';
import { GroupContext } from '../GroupContext';
import ListaRecordatorios from '../ListaRecordatorios';
import Recordatorios from '../Recordatorios';
import useTaskLinks from '../github/useTaskLinks';

jest.mock('../../api/client', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), del: jest.fn() },
  apiFetch: jest.fn(),
  errorMessage: (err, fallback) => err?.message || fallback,
}));
jest.mock('../github/useTaskLinks', () => ({ __esModule: true, default: jest.fn() }));

const TASK = {
  tid: 't1',
  gid: 'g1',
  name: 'Escribir informe',
  description: 'Resumen semanal',
  list: 'Trabajo',
  datetime: '2026-09-20T10:00',
  percentage: 40,
};

const mockLinks = ({ repoConnected = true, link = null } = {}) => {
  const refresh = jest.fn();
  useTaskLinks.mockReturnValue({
    links: new Map(),
    getLink: (tid) => (link && tid === link.tid ? link : null),
    repo: repoConnected ? { fullName: 'acme/app' } : null,
    repoConnected,
    loading: false,
    error: null,
    refresh,
  });
  return refresh;
};

const renderTasks = async () => {
  render(
    <GroupContext.Provider value={{ selectedGroupId: 'g1', selectedGroupName: 'Grupo' }}>
      <Recordatorios />
    </GroupContext.Provider>
  );
  await screen.findByText('Escribir informe');
};

beforeEach(() => {
  localStorage.clear();
  api.get.mockReset().mockImplementation((path) => {
    if (path.startsWith('/api/tasks?gid=')) return Promise.resolve({ data: [TASK] });
    if (path.startsWith('/api/groups/')) return Promise.resolve({ members: [] });
    return Promise.resolve({ data: [] });
  });
  api.post.mockReset();
});

describe('Recordatorios — GitHub actions', () => {
  it('loads task links once for the selected group', async () => {
    mockLinks();
    await renderTasks();
    expect(useTaskLinks).toHaveBeenCalledWith('g1');
  });

  it('shows "Crear rama" only when the group has a repository', async () => {
    mockLinks({ repoConnected: false });
    await renderTasks();
    expect(screen.queryByRole('button', { name: 'Crear rama en GitHub' })).not.toBeInTheDocument();
  });

  it('renders the branch actions when the repository is connected', async () => {
    mockLinks({ repoConnected: true });
    await renderTasks();
    expect(screen.getByRole('button', { name: 'Crear rama en GitHub' })).toBeInTheDocument();
  });

  it('shows the linked branch and PR of a task', async () => {
    mockLinks({
      link: { tid: 't1', branchName: 'tm/escribir-informe-t1', branchUrl: 'https://github.com/acme/app/tree/tm/escribir-informe-t1', pr: { number: 3, state: 'open', isDraft: false } },
    });
    await renderTasks();
    expect(screen.getByText('tm/escribir-informe-t1')).toBeInTheDocument();
    expect(screen.getByText('PR #3 abierto')).toBeInTheDocument();
  });

  it('refreshes the task links after completing a task', async () => {
    const refresh = mockLinks();
    api.post.mockResolvedValue({ data: { tid: 't1', status: 'completed' } });
    await renderTasks();
    fireEvent.click(screen.getByRole('button', { name: 'complete' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('refreshes the task links after deleting a task', async () => {
    const refresh = mockLinks();
    api.post.mockResolvedValue({ data: { tid: 't1', status: 'deleted' } });
    await renderTasks();
    fireEvent.click(screen.getByRole('button', { name: 'delete' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/api/tasks/t1/trash');
  });
});

describe('ListaRecordatorios — GitHub actions per filter', () => {
  const renderList = (filtro) =>
    render(
      <GroupContext.Provider value={{ selectedGroupId: 'g1', selectedGroupName: 'Grupo' }}>
      <ListaRecordatorios
        listas={[{ nombre: 'Trabajo', recordatorios: [TASK] }]}
        handleEliminar={jest.fn()}
        handleCompletar={jest.fn()}
        handleEditar={jest.fn()}
        filtro={filtro}
        handleEliminarLista={jest.fn()}
        orden="CreationDate"
        setOrden={jest.fn()}
        handleVaciarCompletados={jest.fn()}
        handleVaciarEliminados={jest.fn()}
        getTaskLink={() => null}
        repoConnected
        onTaskLinkChange={jest.fn()}
      />
      </GroupContext.Provider>
    );

  it.each(['completed', 'deleted'])('hides the GitHub actions in the %s filter', (filtro) => {
    renderList(filtro);
    expect(screen.queryByRole('button', { name: 'Crear rama en GitHub' })).not.toBeInTheDocument();
  });

  it('shows them for active tasks', () => {
    renderList('todos');
    expect(screen.getByRole('button', { name: 'Crear rama en GitHub' })).toBeInTheDocument();
  });
});

describe('ListaRecordatorios — one toast for every task card', () => {
  const TASK_2 = { ...TASK, tid: 't2', name: 'Revisar PR' };
  const renderTwoTasks = () =>
    render(
      <GroupContext.Provider value={{ selectedGroupId: 'g1', selectedGroupName: 'Grupo' }}>
        <ListaRecordatorios
          listas={[{ nombre: 'Trabajo', recordatorios: [TASK, TASK_2] }]}
          handleEliminar={jest.fn()}
          handleCompletar={jest.fn()}
          handleEditar={jest.fn()}
          filtro="todos"
          handleEliminarLista={jest.fn()}
          orden="CreationDate"
          setOrden={jest.fn()}
          handleVaciarCompletados={jest.fn()}
          handleVaciarEliminados={jest.fn()}
          getTaskLink={() => null}
          repoConnected
          onTaskLinkChange={jest.fn()}
        />
      </GroupContext.Provider>
    );

  beforeEach(() => {
    // POST /api/github/tasks/:tid/branch
    apiFetch.mockReset().mockImplementation((path) => {
      const tid = path.split('/')[4];
      return Promise.resolve({ data: { tid, branchName: `tm/${tid}`, branchUrl: null } });
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('a message from another card, or about a task, replaces the open one instead of stacking on it', async () => {
    renderTwoTasks();
    const [createFirst, createSecond] = screen.getAllByRole('button', { name: 'Crear rama en GitHub' });

    fireEvent.click(createFirst);
    expect(await screen.findByText('Rama tm/t1 lista en GitHub.')).toBeInTheDocument();
    fireEvent.click(createSecond);
    expect(await screen.findByText('Rama tm/t2 lista en GitHub.')).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);

    fireEvent.click(screen.getAllByRole('button', { name: 'complete' })[0]);
    expect(await screen.findByText('Task completed')).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('gives a message that replaces an open one its full display time', async () => {
    jest.useFakeTimers();
    renderTwoTasks();
    const [createFirst, createSecond] = screen.getAllByRole('button', { name: 'Crear rama en GitHub' });
    fireEvent.click(createFirst);
    expect(await screen.findByText('Rama tm/t1 lista en GitHub.')).toBeInTheDocument();

    act(() => jest.advanceTimersByTime(3000));
    fireEvent.click(createSecond);
    expect(await screen.findByText('Rama tm/t2 lista en GitHub.')).toBeInTheDocument();

    // Past the first message's 3.5 s (plus its exit transition), within the second one's.
    act(() => jest.advanceTimersByTime(1500));
    act(() => jest.advanceTimersByTime(300));
    expect(screen.getByText('Rama tm/t2 lista en GitHub.')).toBeVisible();

    act(() => jest.advanceTimersByTime(2000));
    await waitFor(() => expect(screen.queryByText('Rama tm/t2 lista en GitHub.')).not.toBeInTheDocument());
  });
});

describe('Recordatorios — what happened to the GitHub branch of a task that left the board', () => {
  const BRANCH = 'tm/escribir-informe-t1';
  const BRANCH_URL = `https://github.com/acme/app/tree/${BRANCH}`;
  const urlFor = (outcome) => (outcome === 'deleted' || outcome === 'missing' ? null : BRANCH_URL);
  const withBranch = (status, outcome) => ({ data: { tid: 't1', status, branch: { name: BRANCH, outcome, url: urlFor(outcome) } } });
  const severityClass = (severity) => `MuiAlert-color${severity[0].toUpperCase()}${severity.slice(1)}`;

  const expectBranchLink = (container, url) => {
    if (url) {
      const link = within(container).getByRole('link', { name: 'Ver rama' });
      expect(link).toHaveAttribute('href', url);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    } else {
      expect(within(container).queryByRole('link')).not.toBeInTheDocument();
    }
  };

  beforeEach(() => {
    api.put.mockReset();
    api.del.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('completing a task', () => {
    it.each([
      ['deleted', 'success', `Task completed. Rama ${BRANCH} eliminada en GitHub.`],
      ['kept_unmerged', 'info', `Task completed. La rama ${BRANCH} sigue en GitHub: tiene commits sin fusionar.`],
      ['kept_open_pr', 'info', `Task completed. La rama ${BRANCH} sigue en GitHub: tiene un PR abierto.`],
      ['error', 'warning', `Task completed. No se pudo confirmar qué pasó con la rama ${BRANCH} en GitHub; puede que siga ahí.`],
    ])('%s: %s toast "%s"', async (outcome, severity, text) => {
      mockLinks();
      api.post.mockResolvedValue(withBranch('completed', outcome));
      await renderTasks();

      fireEvent.click(screen.getByRole('button', { name: 'complete' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(text);
      expect(alert).toHaveClass(severityClass(severity));
      expectBranchLink(alert, urlFor(outcome));
    });

    it.each(['missing', 'skipped'])('%s keeps the old toast exactly', async (outcome) => {
      mockLinks();
      api.post.mockResolvedValue(withBranch('completed', outcome));
      await renderTasks();

      fireEvent.click(screen.getByRole('button', { name: 'complete' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/^Task completed$/);
      expect(alert).toHaveClass(severityClass('success'));
      expectBranchLink(alert, null);
    });

    it('without a branch keeps the old toast exactly', async () => {
      mockLinks();
      api.post.mockResolvedValue({ data: { tid: 't1', status: 'completed' } });
      await renderTasks();

      fireEvent.click(screen.getByRole('button', { name: 'complete' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/^Task completed$/);
      expect(alert).toHaveClass(severityClass('success'));
      expectBranchLink(alert, null);
    });

    it('leaves a toast about the branch up long enough to read it and open the link', async () => {
      jest.useFakeTimers();
      mockLinks();
      api.post.mockResolvedValue(withBranch('completed', 'kept_unmerged'));
      await renderTasks();

      fireEvent.click(screen.getByRole('button', { name: 'complete' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('commits sin fusionar');

      // The plain toast is gone after 2.2 s; this one is still there at 5 s.
      act(() => jest.advanceTimersByTime(5000));
      expect(screen.getByRole('alert')).toBeVisible();

      act(() => jest.advanceTimersByTime(1500));
      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    });

    it('editing to 100% appends the branch outcome to its own toast', async () => {
      mockLinks();
      api.put.mockResolvedValue({ data: { rowCount: 1, tid: 't1' } });
      api.post.mockResolvedValue(withBranch('completed', 'kept_open_pr'));
      await renderTasks();

      fireEvent.click(screen.getByRole('button', { name: 'edit' }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByRole('slider'), { target: { value: 100 } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'UPDATE' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(`Task completed. La rama ${BRANCH} sigue en GitHub: tiene un PR abierto.`);
      expect(alert).toHaveClass(severityClass('info'));
      expectBranchLink(alert, BRANCH_URL);
    });

    it('editing to 100% without a branch keeps the old toast exactly', async () => {
      mockLinks();
      api.put.mockResolvedValue({ data: { rowCount: 1, tid: 't1' } });
      api.post.mockResolvedValue({ data: { tid: 't1', status: 'completed' } });
      await renderTasks();

      fireEvent.click(screen.getByRole('button', { name: 'edit' }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByRole('slider'), { target: { value: 100 } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'UPDATE' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/^Task completed$/);
      expect(alert).toHaveClass(severityClass('success'));
      expectBranchLink(alert, null);
    });
  });

  describe('deleting a task', () => {
    it.each([
      ['deleted', 'success', `Task deleted. Rama ${BRANCH} eliminada en GitHub.`],
      ['kept_unmerged', 'info', `Task deleted. La rama ${BRANCH} sigue en GitHub: tiene commits sin fusionar.`],
      ['kept_open_pr', 'info', `Task deleted. La rama ${BRANCH} sigue en GitHub: tiene un PR abierto.`],
      ['error', 'warning', `Task deleted. No se pudo confirmar qué pasó con la rama ${BRANCH} en GitHub; puede que siga ahí.`],
    ])('%s: %s toast "%s"', async (outcome, severity, text) => {
      mockLinks();
      api.post.mockResolvedValue(withBranch('deleted', outcome));
      await renderTasks();

      fireEvent.click(screen.getByRole('button', { name: 'delete' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(text);
      expect(alert).toHaveClass(severityClass(severity));
      expectBranchLink(alert, urlFor(outcome));
    });

    it.each([
      ['a missing branch', withBranch('deleted', 'missing')],
      ['a skipped branch', withBranch('deleted', 'skipped')],
      ['no branch', { data: { tid: 't1', status: 'deleted' } }],
    ])('with %s keeps the old toast exactly', async (label, response) => {
      mockLinks();
      api.post.mockResolvedValue(response);
      await renderTasks();

      fireEvent.click(screen.getByRole('button', { name: 'delete' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/^Task deleted$/);
      expect(alert).toHaveClass(severityClass('info'));
      expectBranchLink(alert, null);
    });
  });

  describe('deleting a list', () => {
    const named = (name, outcome) => ({ name, outcome, url: outcome === 'deleted' ? null : `https://github.com/acme/app/tree/${name}` });

    it('summarizes its branches, links the one still on GitHub and refreshes the task links', async () => {
      const refresh = mockLinks();
      api.del.mockResolvedValue({
        message: 'Lista eliminada exitosamente',
        branches: [named('tm/a-1', 'deleted'), named('tm/b-2', 'deleted'), named('tm/c-3', 'kept_unmerged')],
      });
      await renderTasks();

      fireEvent.click(screen.getByRole('button', { name: 'Delete list Trabajo' }));

      const pill = await screen.findByRole('status');
      expect(pill).toHaveTextContent('List deleted. 2 ramas eliminadas en GitHub; 1 sigue (commits sin fusionar).');
      expect(pill).toHaveAttribute('data-severity', 'info');
      expectBranchLink(pill, 'https://github.com/acme/app/tree/tm/c-3');
      expect(api.del).toHaveBeenCalledWith('/api/tasks/list/g1/Trabajo');
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('is a warning when a branch could not be checked', async () => {
      mockLinks();
      api.del.mockResolvedValue({
        message: 'Lista eliminada exitosamente',
        branches: [named('tm/a-1', 'deleted'), named('tm/b-2', 'error')],
      });
      await renderTasks();

      fireEvent.click(screen.getByRole('button', { name: 'Delete list Trabajo' }));

      const pill = await screen.findByRole('status');
      expect(pill).toHaveTextContent('List deleted. 1 rama eliminada en GitHub; 1 sin confirmar.');
      expect(pill).toHaveAttribute('data-severity', 'warning');
    });

    it('while the server cleans up the branches the list looks busy, cannot be deleted twice and its tasks take no actions', async () => {
      mockLinks();
      let answer;
      api.del.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
      await renderTasks();

      const deleteList = screen.getByRole('button', { name: 'Delete list Trabajo' });
      fireEvent.click(deleteList);
      expect(deleteList).toBeDisabled();
      expect(within(deleteList).getByRole('progressbar')).toBeInTheDocument();
      fireEvent.click(deleteList);
      // Already gone on the server: these would only answer "This task no longer exists".
      fireEvent.click(screen.getByRole('button', { name: 'complete' }));
      fireEvent.click(screen.getByRole('button', { name: 'delete' }));
      fireEvent.click(screen.getByRole('button', { name: 'edit' }));
      expect(api.del).toHaveBeenCalledTimes(1);
      expect(api.post).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      api.get.mockImplementation((path) => Promise.resolve(path.startsWith('/api/groups/') ? { members: [] } : { data: [] }));
      await act(async () => answer({ message: 'Lista eliminada exitosamente', branches: [named('tm/a-1', 'deleted')] }));

      expect(await screen.findByRole('status')).toHaveTextContent('List deleted. Rama tm/a-1 eliminada en GitHub.');
      await waitFor(() => expect(screen.queryByText('Escribir informe')).not.toBeInTheDocument());
    });

    it('a failed deletion gives the list back its actions', async () => {
      mockLinks();
      api.del.mockRejectedValue(Object.assign(new Error('Base de datos ocupada'), { code: 'DB_BUSY' }));
      api.post.mockResolvedValue({ data: { tid: 't1', status: 'completed' } });
      await renderTasks();

      fireEvent.click(screen.getByRole('button', { name: 'Delete list Trabajo' }));
      expect(await screen.findByRole('status')).toHaveTextContent(/^Delete failed$/);

      expect(screen.getByRole('button', { name: 'Delete list Trabajo' })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'complete' }));
      expect(await screen.findByText('Task completed')).toBeInTheDocument();
      expect(api.post).toHaveBeenCalledWith('/api/tasks/t1/complete');
    });

    it('the pill stays while hovered or while its link has focus, then hides after half its time', async () => {
      jest.useFakeTimers();
      mockLinks();
      api.del.mockResolvedValue({
        message: 'Lista eliminada exitosamente',
        branches: [named('tm/a-1', 'deleted'), named('tm/c-3', 'kept_unmerged')],
      });
      await renderTasks();

      fireEvent.click(screen.getByRole('button', { name: 'Delete list Trabajo' }));
      const pill = await screen.findByRole('status');

      fireEvent.mouseEnter(pill);
      act(() => jest.advanceTimersByTime(20000));
      expect(screen.getByRole('status')).toBeInTheDocument();
      fireEvent.mouseLeave(pill);
      act(() => jest.advanceTimersByTime(2900));
      expect(screen.getByRole('status')).toBeInTheDocument();

      // Focus on «Ver rama» holds it again, even after the pointer has left.
      const link = within(pill).getByRole('link', { name: 'Ver rama' });
      fireEvent.focus(link);
      act(() => jest.advanceTimersByTime(20000));
      expect(screen.getByRole('status')).toBeInTheDocument();
      fireEvent.blur(link);
      act(() => jest.advanceTimersByTime(2900));
      expect(screen.getByRole('status')).toBeInTheDocument();
      act(() => jest.advanceTimersByTime(200));
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('without hover or focus the pill still hides on its own time', async () => {
      jest.useFakeTimers();
      mockLinks();
      api.del.mockResolvedValue({ message: 'Lista eliminada exitosamente', branches: [named('tm/c-3', 'kept_unmerged')] });
      await renderTasks();

      fireEvent.click(screen.getByRole('button', { name: 'Delete list Trabajo' }));
      await screen.findByRole('status');
      act(() => jest.advanceTimersByTime(5900));
      expect(screen.getByRole('status')).toBeInTheDocument();
      act(() => jest.advanceTimersByTime(200));
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it.each([
      ['an empty branches list', { message: 'Lista eliminada exitosamente', branches: [] }],
      ['only missing/skipped branches', { message: 'Lista eliminada exitosamente', branches: [named('tm/a-1', 'missing'), named('tm/b-2', 'skipped')] }],
      ['no branches field', { message: 'Lista eliminada exitosamente' }],
    ])('with %s keeps the old "List deleted" pill exactly', async (label, response) => {
      mockLinks();
      api.del.mockResolvedValue(response);
      await renderTasks();

      fireEvent.click(screen.getByRole('button', { name: 'Delete list Trabajo' }));

      const pill = await screen.findByRole('status');
      expect(pill).toHaveTextContent(/^List deleted$/);
      expect(pill).toHaveAttribute('data-severity', 'success');
      expectBranchLink(pill, null);
    });

    it('still shows "Delete failed" when the server rejects the deletion', async () => {
      const refresh = mockLinks();
      api.del.mockRejectedValue(Object.assign(new Error('Base de datos ocupada'), { code: 'DB_BUSY' }));
      await renderTasks();

      fireEvent.click(screen.getByRole('button', { name: 'Delete list Trabajo' }));

      const pill = await screen.findByRole('status');
      expect(pill).toHaveTextContent(/^Delete failed$/);
      expect(pill).toHaveAttribute('data-severity', 'error');
      expect(refresh).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Delete list Trabajo' })).toBeEnabled();
    });
  });

  it.each([
    ['completing', 'complete'],
    ['deleting', 'delete'],
  ])('refreshes the task links when %s finds the task already gone (e.g. a merged PR completed it)', async (label, button) => {
    const refresh = mockLinks();
    api.post.mockRejectedValue(Object.assign(new Error('Task not found'), { code: 'TASK_NOT_FOUND' }));
    await renderTasks();
    api.get.mockImplementation((path) => Promise.resolve(path.startsWith('/api/groups/') ? { members: [] } : { data: [] }));

    fireEvent.click(screen.getByRole('button', { name: button }));

    expect(await screen.findByText(/no longer exists/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Escribir informe')).not.toBeInTheDocument());
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

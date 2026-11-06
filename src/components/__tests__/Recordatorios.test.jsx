import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { api, ApiError } from '../../api/client';
import { GroupContext } from '../GroupContext';
import Recordatorios from '../Recordatorios';

jest.mock('../../api/client', () => {
  class MockApiError extends Error {
    constructor(message, { status = 0, code = 'HTTP_ERROR' } = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  }
  return {
    ApiError: MockApiError,
    api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), del: jest.fn() },
    errorMessage: (err, fallback) => err?.message || fallback,
  };
});

const TASK = {
  tid: 't1',
  gid: 'g1',
  name: 'Escribir informe',
  description: 'Resumen semanal',
  list: 'Trabajo',
  datetime: '2026-09-20T10:00',
  percentage: 40,
};

const mockGets = () => {
  api.get.mockImplementation((path) => {
    if (path.startsWith('/api/tasks?gid=')) return Promise.resolve({ data: [TASK] });
    if (path.startsWith('/api/completados/')) return Promise.resolve({ data: [] });
    if (path.startsWith('/api/groups/')) return Promise.resolve({ members: [] });
    return Promise.resolve({ data: [] });
  });
};

const renderTasks = async () => {
  render(
    <GroupContext.Provider value={{ selectedGroupId: 'g1', selectedGroupName: 'Grupo' }}>
      <Recordatorios />
    </GroupContext.Provider>
  );
  await screen.findByText('Escribir informe');
};

const completedListFetches = () => api.get.mock.calls.filter(([path]) => path === '/api/completados/g1').length;

describe('Recordatorios — completing a task', () => {
  beforeEach(() => {
    localStorage.clear();
    mockGets();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('completes with a single atomic call and re-fetches the completed list', async () => {
    api.post.mockResolvedValue({ data: { tid: 't1', status: 'completed' } });
    await renderTasks();
    expect(completedListFetches()).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'complete' }));

    expect(await screen.findByText('Task completed')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/api/tasks/t1/complete');
    expect(api.del).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
    await waitFor(() => expect(completedListFetches()).toBe(2));
  });

  it('rolls the card back and shows the error when the server rejects the completion', async () => {
    api.post.mockRejectedValue(new ApiError('Base de datos ocupada', { status: 503, code: 'DB_BUSY' }));
    await renderTasks();

    fireEvent.click(screen.getByRole('button', { name: 'complete' }));

    expect(await screen.findByText('Base de datos ocupada')).toBeInTheDocument();
    expect(screen.getByText('Escribir informe')).toBeInTheDocument();
    expect(screen.getByText('Percent Completed: 40%')).toBeInTheDocument();
    expect(screen.queryByText('Task completed')).not.toBeInTheDocument();
    expect(completedListFetches()).toBe(1);
  });

  it('treats already_completed as success and removes the card after the animation', async () => {
    jest.useFakeTimers();
    api.post.mockResolvedValue({ data: { tid: 't1', status: 'already_completed' } });
    await renderTasks();

    fireEvent.click(screen.getByRole('button', { name: 'complete' }));
    expect(await screen.findByText('Task completed')).toBeInTheDocument();

    act(() => { jest.advanceTimersByTime(3000); });

    expect(screen.queryByText('Escribir informe')).not.toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('removes a task that no longer exists (TASK_NOT_FOUND) instead of restoring it', async () => {
    api.post.mockRejectedValue(new ApiError('Task not found', { status: 404, code: 'TASK_NOT_FOUND' }));
    await renderTasks();
    api.get.mockImplementation((path) => Promise.resolve(path.startsWith('/api/groups/') ? { members: [] } : { data: [] }));

    fireEvent.click(screen.getByRole('button', { name: 'complete' }));

    expect(await screen.findByText(/no longer exists/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Escribir informe')).not.toBeInTheDocument());
  });

  it('editing to 100% saves the edit first and then completes atomically', async () => {
    api.put.mockResolvedValue({ data: { rowCount: 1 } });
    api.post.mockResolvedValue({ data: { tid: 't1', status: 'completed' } });
    await renderTasks();

    fireEvent.click(screen.getByRole('button', { name: 'edit' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('slider'), { target: { value: 100 } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'UPDATE' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/tasks/t1/complete'));
    expect(api.put).toHaveBeenCalledWith('/api/tasks/t1', expect.objectContaining({ gid: 'g1', percentage: 100 }));
    expect(api.put.mock.invocationCallOrder[0]).toBeLessThan(api.post.mock.invocationCallOrder[0]);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.del).not.toHaveBeenCalled();
  });

  it('keeps the edit dialog open and reports the error when saving fails', async () => {
    api.put.mockRejectedValue(new ApiError('Not a member of this group', { status: 403, code: 'NOT_GROUP_MEMBER' }));
    await renderTasks();

    fireEvent.click(screen.getByRole('button', { name: 'edit' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('slider'), { target: { value: 100 } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'UPDATE' }));

    expect(await screen.findByText('Not a member of this group')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('Recordatorios — deleting a task', () => {
  const deletedListFetches = () => api.get.mock.calls.filter(([path]) => path === '/api/delete/g1').length;
  const taskListFetches = () => api.get.mock.calls.filter(([path]) => path === '/api/tasks?gid=g1').length;

  beforeEach(() => {
    localStorage.clear();
    api.post.mockReset();
    api.del.mockReset();
    mockGets();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('deletes with a single atomic call, removes the card and re-fetches the deleted list', async () => {
    jest.useFakeTimers();
    api.post.mockResolvedValue({ data: { tid: 't1', status: 'deleted' } });
    await renderTasks();

    fireEvent.click(screen.getByRole('button', { name: 'delete' }));

    expect(await screen.findByText('Task deleted')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/api/tasks/t1/trash');
    expect(api.del).not.toHaveBeenCalled();
    expect(deletedListFetches()).toBe(1);

    act(() => { jest.advanceTimersByTime(3000); });
    expect(screen.queryByText('Escribir informe')).not.toBeInTheDocument();
  });

  it('restores the card and shows the error when the server rejects the delete', async () => {
    api.post.mockRejectedValue(new ApiError('Base de datos ocupada', { status: 503, code: 'DB_BUSY' }));
    await renderTasks();

    fireEvent.click(screen.getByRole('button', { name: 'delete' }));

    expect(await screen.findByText('Base de datos ocupada')).toBeInTheDocument();
    expect(screen.getByText('Escribir informe')).toBeInTheDocument();
    expect(screen.queryByText('Task deleted')).not.toBeInTheDocument();
    expect(deletedListFetches()).toBe(0);
  });

  it('drops a task that no longer exists (TASK_NOT_FOUND) and reloads the list', async () => {
    api.post.mockRejectedValue(new ApiError('Task not found', { status: 404, code: 'TASK_NOT_FOUND' }));
    await renderTasks();
    const before = taskListFetches();
    api.get.mockImplementation((path) => Promise.resolve(path.startsWith('/api/groups/') ? { members: [] } : { data: [] }));

    fireEvent.click(screen.getByRole('button', { name: 'delete' }));

    expect(await screen.findByText(/no longer exists/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Escribir informe')).not.toBeInTheDocument());
    expect(taskListFetches()).toBe(before + 1);
    expect(screen.queryByText('Task deleted')).not.toBeInTheDocument();
  });
});

describe('Recordatorios — members and validation', () => {
  const TASKS = [TASK, { ...TASK, tid: 't2', name: 'Revisar PR' }, { ...TASK, tid: 't3', name: 'Diseñar API' }];

  beforeEach(() => {
    localStorage.clear();
    api.post.mockReset();
    api.get.mockReset().mockImplementation((path) => {
      if (path.startsWith('/api/tasks?gid=')) return Promise.resolve({ data: TASKS });
      if (path === '/api/groups/g1/members') return Promise.resolve({ members: [{ uid: 'U1', username: 'ana' }] });
      if (path.startsWith('/api/usertask?tid=')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });
  });

  it('loads the group members once for every task card', async () => {
    await renderTasks();
    await screen.findByText('Diseñar API');
    const memberFetches = api.get.mock.calls.filter(([path]) => path.includes('/members'));
    expect(memberFetches).toHaveLength(1);

    fireEvent.click(screen.getAllByRole('button', { name: 'Assign user' })[1]);
    expect(await screen.findByText('ana')).toBeInTheDocument();
    expect(api.get.mock.calls.filter(([path]) => path.includes('/members'))).toHaveLength(1);
  });

  it('shows the server validation message when creating a task fails', async () => {
    api.post.mockRejectedValue(new ApiError('name must be at most 25 characters', { status: 400, code: 'VALIDATION_ERROR' }));
    await renderTasks();

    fireEvent.click(screen.getByRole('button', { name: /add task/i }));
    fireEvent.change(screen.getByLabelText(/Task Name/, { selector: 'input' }), { target: { value: 'Tarea nueva' } });
    fireEvent.change(screen.getByLabelText(/Deadline/, { selector: 'input' }), { target: { value: '2026-10-01' } });
    fireEvent.mouseDown(screen.getByLabelText(/Select List/));
    fireEvent.click(await screen.findByRole('option', { name: 'Trabajo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Task' }));

    expect(await screen.findByText('name must be at most 25 characters')).toBeInTheDocument();
  });
});

describe('Recordatorios — filters drawer and completed tasks', () => {
  const ACTIVE = { ...TASK, datetime: '2026-10-21T00:00' };
  // Same shape GET /api/completados sends: the stored wall-clock time, without a zone.
  const DONE = { tid: 'c1', gid: 'g1', name: 'Tests unitarios', description: 'Cobertura', percentage: 100, datetime: '2026-10-21T00:00' };

  beforeEach(() => {
    localStorage.clear();
    api.get.mockReset().mockImplementation((path) => {
      if (path.startsWith('/api/tasks?gid=')) return Promise.resolve({ data: [ACTIVE] });
      if (path.startsWith('/api/completados/')) return Promise.resolve({ data: [DONE] });
      if (path.startsWith('/api/groups/')) return Promise.resolve({ members: [] });
      return Promise.resolve({ data: [] });
    });
  });

  it('labels the drawer toggle "Filters" so the only add buttons are Add List and Add Task', async () => {
    await renderTasks();

    const toggle = screen.getByRole('button', { name: 'Filters' });
    fireEvent.mouseOver(toggle);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Filters');
    expect(screen.getAllByRole('button', { name: /add/i }).map((b) => b.textContent)).toEqual(['Add List', 'Add Task']);

    fireEvent.click(toggle);
    for (const option of ['Today', 'This Week', 'This Month', 'All Tasks', 'Completed', 'Deleted']) {
      expect(await screen.findByRole('button', { name: option })).toBeInTheDocument();
    }
  });

  it('names the sort and delete-list icon buttons', async () => {
    await renderTasks();
    expect(screen.getByRole('button', { name: 'Sort tasks' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete list Trabajo' })).toBeInTheDocument();
  });

  it('shows a completed task with the same date and time it had while active', async () => {
    await renderTasks();
    expect(screen.getByText('Resumen semanal - 21/10/2026 00:00')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Completed' }));

    expect(await screen.findByText('Tests unitarios')).toBeInTheDocument();
    expect(screen.getByText('Cobertura - 21/10/2026 00:00')).toBeInTheDocument();
  });
});

describe('Recordatorios — sort order', () => {
  // Out of order on every key, as the API could send them. createdAt is the server's creation
  // instant (ISO UTC); a task created since the last load has none yet.
  const SORTABLE = [
    { ...TASK, tid: 'n1', name: 'Nueva 1', datetime: '2026-09-22T09:00', percentage: 0 },
    { ...TASK, tid: 'c', name: 'Tarea C', createdAt: '2026-09-03T10:00:00.000Z', datetime: '2026-09-21T09:00', percentage: 50 },
    { ...TASK, tid: 'a', name: 'Tarea A', createdAt: '2026-09-01T10:00:00.000Z', datetime: '2026-09-30T09:00', percentage: 10 },
    { ...TASK, tid: 'n2', name: 'Nueva 2', datetime: null, percentage: 50 },
    { ...TASK, tid: 'b', name: 'Tarea B', createdAt: '2026-09-02T10:00:00.000Z', datetime: '2026-09-25T09:00', percentage: 50 },
  ];
  const cardOrder = () => screen.getAllByText(/^(Tarea|Nueva) /).map((el) => el.textContent);
  // The label next to the sort button (the closed menu can stay mounted with the same texts).
  const sortLabel = (label) => screen.getByText(label, { selector: 'p' });
  const sortBy = async (label) => {
    fireEvent.click(screen.getByRole('button', { name: 'Sort tasks' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: label }));
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  };

  beforeEach(() => {
    localStorage.clear();
    api.get.mockReset().mockImplementation((path) => {
      if (path.startsWith('/api/tasks?gid=')) return Promise.resolve({ data: SORTABLE });
      if (path.startsWith('/api/groups/')) return Promise.resolve({ members: [] });
      return Promise.resolve({ data: [] });
    });
  });

  const renderSortable = async () => {
    render(
      <GroupContext.Provider value={{ selectedGroupId: 'g1', selectedGroupName: 'Grupo' }}>
        <Recordatorios />
      </GroupContext.Provider>
    );
    await screen.findByText('Tarea A');
  };

  it('opens on «Creation Date»: oldest createdAt first, tasks without one last in their order', async () => {
    await renderSortable();
    expect(sortLabel('Creation Date')).toBeInTheDocument();
    expect(screen.queryByText('Priority', { selector: 'p' })).not.toBeInTheDocument();
    expect(cardOrder()).toEqual(['Tarea A', 'Tarea B', 'Tarea C', 'Nueva 1', 'Nueva 2']);
  });

  it('Priority: lower percentage first, then the closer deadline; no deadline goes last', async () => {
    await renderSortable();
    await sortBy('Priority');
    expect(sortLabel('Priority')).toBeInTheDocument();
    expect(cardOrder()).toEqual(['Nueva 1', 'Tarea A', 'Tarea C', 'Tarea B', 'Nueva 2']);
  });

  it('Deadline: soonest first, a task without a deadline last; and back to Creation Date', async () => {
    await renderSortable();
    await sortBy('Deadline');
    expect(sortLabel('Deadline')).toBeInTheDocument();
    expect(cardOrder()).toEqual(['Tarea C', 'Nueva 1', 'Tarea B', 'Tarea A', 'Nueva 2']);

    await sortBy('Creation Date');
    expect(sortLabel('Creation Date')).toBeInTheDocument();
    expect(cardOrder()).toEqual(['Tarea A', 'Tarea B', 'Tarea C', 'Nueva 1', 'Nueva 2']);
  });

  it('a task added from the form goes last in Creation Date order', async () => {
    api.post.mockReset().mockResolvedValue({ data: { rowCount: 1, tid: 'new' } });
    await renderSortable();

    fireEvent.click(screen.getByRole('button', { name: /add task/i }));
    fireEvent.change(screen.getByLabelText(/Task Name/, { selector: 'input' }), { target: { value: 'Tarea recién creada' } });
    fireEvent.change(screen.getByLabelText(/Deadline/, { selector: 'input' }), { target: { value: '2026-09-01' } });
    fireEvent.mouseDown(screen.getByLabelText(/Select List/));
    fireEvent.click(await screen.findByRole('option', { name: 'Trabajo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Task' }));

    await screen.findByText('Tarea recién creada');
    expect(cardOrder()).toEqual(['Tarea A', 'Tarea B', 'Tarea C', 'Nueva 1', 'Nueva 2', 'Tarea recién creada']);
  });

  // GET /api/completados and GET /api/delete send createdAt too (the task's, kept when it moved).
  it.each([
    ['Completed', '/api/completados/'],
    ['Deleted', '/api/delete/'],
  ])('the %s view also opens on «Creation Date» in createdAt order, and Deadline still sorts it', async (view, archivePath) => {
    const ARCHIVED = [
      { tid: 'x3', gid: 'g1', name: 'Tarea hecha 3', description: 'd', percentage: 100, datetime: '2026-09-10T09:00', createdAt: '2026-09-03T10:00:00.000Z' },
      { tid: 'x1', gid: 'g1', name: 'Tarea hecha 1', description: 'd', percentage: 100, datetime: '2026-09-30T09:00', createdAt: '2026-09-01T10:00:00.000Z' },
      { tid: 'x2', gid: 'g1', name: 'Tarea hecha 2', description: 'd', percentage: 100, datetime: '2026-09-20T09:00', createdAt: '2026-09-02T10:00:00.000Z' },
    ];
    api.get.mockImplementation((path) => {
      if (path.startsWith('/api/tasks?gid=')) return Promise.resolve({ data: SORTABLE });
      if (path.startsWith(archivePath)) return Promise.resolve({ data: ARCHIVED });
      if (path.startsWith('/api/groups/')) return Promise.resolve({ members: [] });
      return Promise.resolve({ data: [] });
    });
    await renderSortable();

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const option = await screen.findByRole('button', { name: view });
    fireEvent.click(option);
    await screen.findByText('Tarea hecha 1');
    // The drawer stays open after a choice; close it so the sort button is reachable again.
    fireEvent.keyDown(option, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('button', { name: view })).not.toBeInTheDocument());

    expect(sortLabel('Creation Date')).toBeInTheDocument();
    expect(cardOrder()).toEqual(['Tarea hecha 1', 'Tarea hecha 2', 'Tarea hecha 3']);

    await sortBy('Deadline');
    expect(sortLabel('Deadline')).toBeInTheDocument();
    expect(cardOrder()).toEqual(['Tarea hecha 3', 'Tarea hecha 2', 'Tarea hecha 1']);
  });
});

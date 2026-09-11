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

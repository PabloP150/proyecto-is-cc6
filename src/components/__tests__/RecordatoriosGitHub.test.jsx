import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '../../api/client';
import { GroupContext } from '../GroupContext';
import ListaRecordatorios from '../ListaRecordatorios';
import Recordatorios from '../Recordatorios';
import { TASKS_CHANGED_EVENT } from '../github/githubUtils';
import useTaskLinks from '../github/useTaskLinks';

jest.mock('../../api/client', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), del: jest.fn() },
  apiFetch: jest.fn(),
  errorMessage: (err, fallback) => err?.message || fallback,
}));
jest.mock('../github/useTaskLinks', () => ({ __esModule: true, default: jest.fn() }));
// Its own member fetch is irrelevant here.
jest.mock('../SeleccionarPersona', () => ({ __esModule: true, default: () => null }));

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

const taskFetches = () => api.get.mock.calls.filter(([path]) => path.startsWith('/api/tasks?gid=')).length;

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

  it('reloads tasks and links when an AI plan is saved for this group', async () => {
    const refresh = mockLinks();
    await renderTasks();
    const before = taskFetches();

    act(() => {
      window.dispatchEvent(new CustomEvent(TASKS_CHANGED_EVENT, { detail: { groupId: 'other' } }));
    });
    expect(taskFetches()).toBe(before);

    act(() => {
      window.dispatchEvent(new CustomEvent(TASKS_CHANGED_EVENT, { detail: { groupId: 'G1' } }));
    });
    await waitFor(() => expect(taskFetches()).toBe(before + 1));
    expect(refresh).toHaveBeenCalled();
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

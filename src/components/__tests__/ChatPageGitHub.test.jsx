import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import ChatPage from '../ChatPage';
import { GroupContext } from '../GroupContext';
import { TASKS_CHANGED_EVENT } from '../github/githubUtils';

jest.mock('react-markdown', () => ({ __esModule: true, default: (props) => <div>{props.children}</div> }));
jest.mock('rehype-raw', () => ({ __esModule: true, default: function rehypeRaw() {} }));
jest.mock('rehype-sanitize', () => ({ __esModule: true, default: function rehypeSanitize() {} }));
jest.mock('remark-gfm', () => ({ __esModule: true, default: function remarkGfm() {} }));

let mockWsOptions = null;
const mockSend = jest.fn(() => true);
jest.mock('../../hooks/useWebSocket', () => ({
  __esModule: true,
  default: (url, token, options) => {
    mockWsOptions = options;
    return { sendMessage: mockSend, isConnected: true, error: null, connect: () => {} };
  },
}));

const GROUPS = [
  { gid: 'G1', name: 'Equipo Web' },
  { gid: 'G2', name: 'Equipo Móvil' },
];

const PLAN_MESSAGE = {
  type: 'repo_plan',
  planId: 'plan-1',
  groupId: 'G1',
  groupName: 'Equipo Web',
  expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  content: 'Plan: 1 tarea',
  plan: {
    summary: 'Siguientes pasos',
    milestones: [],
    tasks: [{ name: 'Agregar pruebas', description: 'Cubrir la API', milestone_key: null, due_date: '2026-10-01', category: 'testing' }],
  },
};

function StateProbe() {
  const location = useLocation();
  return <div data-testid="nav-state">{JSON.stringify(location.state)}</div>;
}

const renderChat = ({ state, groups = GROUPS, refreshGroups = jest.fn().mockResolvedValue(GROUPS) } = {}) => {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/chat', state }]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <GroupContext.Provider value={{ refreshGroups, groups }}>
        <Routes>
          <Route
            path="/chat"
            element={
              <>
                <ChatPage />
                <StateProbe />
              </>
            }
          />
        </Routes>
      </GroupContext.Provider>
    </MemoryRouter>
  );
  return { refreshGroups };
};

const receive = (data) => act(() => { mockWsOptions.onMessage(data); });
const sentOfType = (type) => mockSend.mock.calls.map(([msg]) => msg).filter((msg) => msg.type === type);

const selectProject = (name) => {
  fireEvent.mouseDown(screen.getByRole('combobox'));
  fireEvent.click(within(screen.getByRole('listbox')).getByText(name));
};

describe('ChatPage — GitHub project analysis', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = () => {};
  });

  beforeEach(() => {
    mockSend.mockClear();
    mockSend.mockImplementation(() => true);
    mockWsOptions = null;
    localStorage.clear();
    localStorage.setItem('token', 'jwt');
    localStorage.setItem('user', JSON.stringify({ uid: 'u1', name: 'ana', token: 'jwt' }));
  });

  it('keeps the plain chat flow without a project', () => {
    renderChat();
    expect(screen.getByRole('combobox')).toHaveTextContent('Nuevo proyecto (sin contexto)');
    fireEvent.change(screen.getByRole('textbox', { name: 'Mensaje' }), { target: { value: 'hola' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    expect(sentOfType('user')).toEqual([expect.objectContaining({ type: 'user', content: 'hola' })]);
    expect(sentOfType('repo_analysis')).toHaveLength(0);
  });

  it('loads the groups on mount when the context has none', () => {
    const { refreshGroups } = renderChat({ groups: [] });
    expect(refreshGroups).toHaveBeenCalledTimes(1);
  });

  it('sends set_context on change and shows the repository from the context reply', () => {
    renderChat();
    selectProject('Equipo Web');
    expect(sentOfType('set_context')).toEqual([{ type: 'set_context', groupId: 'G1' }]);

    receive({ type: 'context', groupId: 'G1', groupName: 'Equipo Web', repo: { fullName: 'acme/web', defaultBranch: 'main' } });
    expect(screen.getByText('acme/web')).toBeInTheDocument();

    selectProject('Nuevo proyecto (sin contexto)');
    expect(sentOfType('set_context')[1]).toEqual({ type: 'set_context', groupId: null });
  });

  it('disables the analysis when the project has no repository', () => {
    renderChat();
    selectProject('Equipo Móvil');
    receive({ type: 'context', groupId: 'G2', groupName: 'Equipo Móvil', repo: null });
    expect(screen.getByText('Sin repositorio')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analizar repositorio' })).toBeDisabled();
  });

  it('runs an analysis, shows progress and confirms the plan once', () => {
    const listener = jest.fn();
    window.addEventListener(TASKS_CHANGED_EVENT, listener);
    renderChat();
    selectProject('Equipo Web');
    receive({ type: 'context', groupId: 'G1', groupName: 'Equipo Web', repo: { fullName: 'acme/web', defaultBranch: 'main' } });

    fireEvent.change(screen.getByRole('textbox', { name: 'Instrucciones para el análisis' }), { target: { value: 'prioriza las pruebas' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analizar repositorio' }));

    const [request] = sentOfType('repo_analysis');
    expect(request).toEqual({ type: 'repo_analysis', requestId: expect.any(String), groupId: 'G1', instructions: 'prioriza las pruebas' });
    expect(sentOfType('user')).toHaveLength(0);
    expect(screen.getByText('Preparando el análisis del repositorio…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analizar repositorio' })).toBeDisabled();

    receive({ type: 'repo_analysis_status', requestId: request.requestId, stage: 'analyzing' });
    expect(screen.getByText(/La IA está analizando el repositorio/)).toBeInTheDocument();

    receive({ ...PLAN_MESSAGE, requestId: request.requestId });
    expect(screen.queryByText(/La IA está analizando el repositorio/)).not.toBeInTheDocument();
    expect(screen.getByText('Agregar pruebas')).toBeInTheDocument();

    const confirm = screen.getByRole('button', { name: 'Confirmar' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(sentOfType('repo_plan_confirm')).toEqual([{ type: 'repo_plan_confirm', planId: 'plan-1' }]);
    expect(screen.getByRole('button', { name: /Confirmar/ })).toBeDisabled();

    receive({ type: 'repo_plan_saved', planId: 'plan-1', groupId: 'G1', created: { tasks: 1, milestones: 0 }, content: 'Plan guardado' });
    expect(screen.getByTestId('repo-plan-compact')).toHaveTextContent('Plan guardado en «Equipo Web»: 1 tarea creada y 0 hitos.');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail).toEqual({ groupId: 'G1' });
    window.removeEventListener(TASKS_CHANGED_EVENT, listener);
  });

  it('discards a plan and marks it discarded', () => {
    renderChat();
    receive(PLAN_MESSAGE);
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(sentOfType('repo_plan_discard')).toEqual([{ type: 'repo_plan_discard', planId: 'plan-1' }]);
    receive({ type: 'repo_plan_discarded', planId: 'plan-1', content: 'Plan descartado.' });
    expect(screen.getByTestId('repo-plan-compact')).toHaveTextContent('Plan descartado');
  });

  it('marks the plan expired and clears busy on REPO_PLAN_EXPIRED', () => {
    renderChat();
    receive(PLAN_MESSAGE);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    receive({ type: 'error', code: 'REPO_PLAN_EXPIRED', planId: 'plan-1', message: 'El plan expiró; vuelve a analizar el repositorio.' });
    expect(screen.getByTestId('repo-plan-compact')).toHaveTextContent('Plan expirado');
    expect(screen.getByRole('alert')).toHaveTextContent('El plan expiró');
  });

  it('re-enables the plan after SAVE_FAILED', () => {
    renderChat();
    receive(PLAN_MESSAGE);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(screen.getByRole('button', { name: /Confirmar/ })).toBeDisabled();
    receive({ type: 'error', code: 'SAVE_FAILED', planId: 'plan-1', message: 'No se pudo guardar el plan.' });
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeEnabled();
  });

  it('stops the progress indicator when the analysis fails', () => {
    renderChat();
    selectProject('Equipo Web');
    fireEvent.click(screen.getByRole('button', { name: 'Analizar repositorio' }));
    const [request] = sentOfType('repo_analysis');
    expect(request.instructions).toBe('');
    receive({ type: 'error', code: 'LLM_TIMEOUT', requestId: request.requestId, message: 'El análisis tardó demasiado.' });
    expect(screen.queryByText('Preparando el análisis del repositorio…')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('El análisis tardó demasiado.');
    expect(screen.getByRole('button', { name: 'Analizar repositorio' })).toBeEnabled();
  });

  it('starts the analysis requested from /github once and clears the navigation state', () => {
    renderChat({ state: { analyzeGroupId: 'G1' } });
    expect(sentOfType('set_context')[0]).toEqual({ type: 'set_context', groupId: 'G1' });
    expect(sentOfType('repo_analysis')).toEqual([
      { type: 'repo_analysis', requestId: expect.any(String), groupId: 'G1', instructions: '' },
    ]);
    expect(screen.getByRole('combobox')).toHaveTextContent('Equipo Web');
    expect(screen.getByTestId('nav-state')).toHaveTextContent('null');
  });

  it('restores plan cards from history with their final status', () => {
    renderChat();
    receive({
      type: 'history_restore',
      messages: [
        PLAN_MESSAGE,
        { type: 'repo_plan_saved', planId: 'plan-1', groupId: 'G1', created: { tasks: 1, milestones: 0 }, content: 'Plan guardado: 1 tareas y 0 hitos.' },
      ],
    });
    expect(screen.getByTestId('repo-plan-compact')).toHaveTextContent('Plan guardado');
    expect(screen.queryByText('Plan guardado: 1 tareas y 0 hitos.')).not.toBeInTheDocument();
  });
});

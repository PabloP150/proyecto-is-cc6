import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import ChatPage from '../ChatPage';
import { GroupContext } from '../GroupContext';

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
    expect(screen.getByRole('alert')).toHaveTextContent('La IA tardó demasiado en responder.');
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
    // Same request bubble as from the selector (and as the server restores it).
    expect(screen.getAllByText('Analiza el repositorio de «Equipo Web» y propón las siguientes tareas.')).toHaveLength(1);
  });

  it('keeps the /github request bubble when the restore sent as the socket opened arrives after it', () => {
    renderChat({ state: { analyzeGroupId: 'G1' } });
    const [request] = sentOfType('repo_analysis');
    receive({ type: 'history_restore', messages: [{ type: 'user', content: 'hola' }] });

    expect(screen.getByText('hola')).toBeInTheDocument();
    expect(screen.getAllByText('Analiza el repositorio de «Equipo Web» y propón las siguientes tareas.')).toHaveLength(1);
    receive({ ...PLAN_MESSAGE, requestId: request.requestId });
    expect(screen.getByText('Agregar pruebas')).toBeInTheDocument();
  });

  it('does not repeat the request bubble when the restore already holds that request', () => {
    renderChat({ state: { analyzeGroupId: 'G1' } });
    const [request] = sentOfType('repo_analysis');
    receive({
      type: 'history_restore',
      messages: [{ type: 'user', content: 'Analiza el repositorio de «Equipo Web» y propón las siguientes tareas.', requestId: request.requestId }],
    });
    expect(screen.getAllByText('Analiza el repositorio de «Equipo Web» y propón las siguientes tareas.')).toHaveLength(1);
  });

  it('drops the bubble of a finished analysis on the next restore (the server history decides)', () => {
    renderChat();
    selectProject('Equipo Web');
    fireEvent.change(screen.getByRole('textbox', { name: 'Instrucciones para el análisis' }), { target: { value: 'prioriza las pruebas' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analizar repositorio' }));
    const [request] = sentOfType('repo_analysis');
    receive({ type: 'error', code: 'RATE_LIMITED', requestId: request.requestId, retryAfterSec: 41, message: 'Solo se puede pedir un análisis por minuto.' });

    receive({ type: 'history_restore', messages: [{ type: 'user', content: 'hola' }] });
    expect(screen.queryByText('prioriza las pruebas')).not.toBeInTheDocument();
  });

  it('shows the analysis cooldown as an analysis message with the wait, next to its request', () => {
    renderChat();
    selectProject('Equipo Web');
    receive({ type: 'context', groupId: 'G1', groupName: 'Equipo Web', repo: { fullName: 'acme/web', defaultBranch: 'main' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Instrucciones para el análisis' }), { target: { value: 'prioriza las pruebas' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analizar repositorio' }));
    const [request] = sentOfType('repo_analysis');

    receive({ type: 'error', code: 'RATE_LIMITED', requestId: request.requestId, retryAfterSec: 41, message: 'Solo se puede pedir un análisis por minuto.' });
    expect(screen.getByText('prioriza las pruebas')).toBeInTheDocument();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Solo se puede pedir un análisis por minuto. Podrás reintentar en 41 s.');
    expect(alert).not.toHaveTextContent('Vas muy rápido');
    expect(screen.getByRole('button', { name: 'Analizar repositorio' })).toBeEnabled();
  });

  it('restores errors with the live wording but without a stale countdown', () => {
    renderChat();
    receive({
      type: 'history_restore',
      messages: [
        { type: 'user', content: 'hola' },
        { type: 'error', code: 'AI_ANALYSIS_DISABLED', requestId: 'r1', message: 'El análisis con IA está desactivado para este proyecto; un administrador puede activarlo.' },
        { type: 'error', code: 'LLM_TIMEOUT', requestId: 'r2', retryAfterSec: 41, message: 'La IA tardó demasiado en responder. Intenta de nuevo.' },
      ],
    });
    const [disabled, timeout] = screen.getAllByRole('alert');
    expect(disabled).toHaveTextContent('Un administrador del grupo puede activarlo en la página GitHub');
    expect(timeout).toHaveTextContent('La IA tardó demasiado en responder. Inténtalo de nuevo.');
    expect(timeout).not.toHaveTextContent('Podrás reintentar');
  });

  // An API from before the refusals stopped being stored still restores them; only its text says which limit it was.
  it('restores a RATE_LIMITED error with the server text, which tells the analysis cooldown from the chat limit', () => {
    renderChat();
    receive({
      type: 'history_restore',
      messages: [
        { type: 'error', code: 'RATE_LIMITED', requestId: 'r1', retryAfterSec: 41, message: 'Espera un minuto antes de pedir otro análisis.' },
        { type: 'error', code: 'RATE_LIMITED', requestId: 'r2', retryAfterSec: 5, message: 'Estás enviando mensajes muy rápido; espera un momento.' },
      ],
    });
    const [analysisLimit, chatLimit] = screen.getAllByRole('alert');
    expect(analysisLimit).toHaveTextContent('Espera un minuto antes de pedir otro análisis.');
    expect(analysisLimit).not.toHaveTextContent('Vas muy rápido');
    expect(chatLimit).toHaveTextContent('Estás enviando mensajes muy rápido; espera un momento.');
    [analysisLimit, chatLimit].forEach(alert => expect(alert).not.toHaveTextContent('Podrás reintentar'));
  });

  it('restores a plan card as expired from a REPO_PLAN_EXPIRED error in history', () => {
    renderChat();
    receive({
      type: 'history_restore',
      messages: [
        PLAN_MESSAGE,
        { type: 'error', code: 'REPO_PLAN_EXPIRED', planId: 'plan-1', message: 'El plan expiró; vuelve a analizar el repositorio.' },
      ],
    });
    expect(screen.getByTestId('repo-plan-compact')).toHaveTextContent('Plan expirado');
    expect(screen.getByRole('alert')).toHaveTextContent('El plan expiró');
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

  describe('limits, errors and timeouts', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('caps chat messages at 4000 characters with a counter', () => {
      renderChat();
      const input = screen.getByRole('textbox', { name: 'Mensaje' });
      expect(input).toHaveAttribute('maxLength', '4000');
      fireEvent.change(input, { target: { value: 'hola' } });
      expect(screen.getByText('4/4000')).toBeInTheDocument();
    });

    it('caps analysis instructions at 500 characters', () => {
      renderChat();
      selectProject('Equipo Web');
      expect(screen.getByRole('textbox', { name: 'Instrucciones para el análisis' })).toHaveAttribute('maxLength', '500');
      expect(screen.getByText('0/500')).toBeInTheDocument();
    });

    it.each([
      [{ code: 'MESSAGE_TOO_LONG', message: 'too long' }, 'El mensaje es demasiado largo: el máximo es 4000 caracteres.'],
      [{ code: 'RATE_LIMITED', message: 'slow down', retryAfterSec: 12 }, 'Vas muy rápido: espera un momento antes de volver a intentarlo. Podrás reintentar en 12 s.'],
      // A chat message (its requestId is not an analysis one) keeps the chat wording.
      [{ code: 'RATE_LIMITED', requestId: 'chat-1', message: 'Estás enviando mensajes muy rápido; espera un momento.', retryAfterSec: 5 }, 'Vas muy rápido: espera un momento antes de volver a intentarlo. Podrás reintentar en 5 s.'],
      [{ code: 'LLM_TIMEOUT', message: 'timeout' }, 'La IA tardó demasiado en responder. Inténtalo de nuevo.'],
    ])('shows a friendly message for %o', (error, text) => {
      renderChat();
      receive({ type: 'error', ...error });
      expect(screen.getByRole('alert')).toHaveTextContent(text);
    });

    it('stops the typing indicator after ~100 s without any reply', () => {
      jest.useFakeTimers();
      renderChat();
      fireEvent.change(screen.getByRole('textbox', { name: 'Mensaje' }), { target: { value: 'hola' } });
      fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
      expect(screen.getByText('AI is typing...')).toBeInTheDocument();

      act(() => { jest.advanceTimersByTime(99000); });
      expect(screen.getByText('AI is typing...')).toBeInTheDocument();

      act(() => { jest.advanceTimersByTime(2000); });
      expect(screen.queryByText('AI is typing...')).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('No llegó respuesta a tiempo');
    });

    it('restarts the wait on analysis progress updates', () => {
      jest.useFakeTimers();
      renderChat();
      selectProject('Equipo Web');
      fireEvent.click(screen.getByRole('button', { name: 'Analizar repositorio' }));
      const [request] = sentOfType('repo_analysis');

      act(() => { jest.advanceTimersByTime(90000); });
      receive({ type: 'repo_analysis_status', requestId: request.requestId, stage: 'analyzing' });
      act(() => { jest.advanceTimersByTime(90000); });
      expect(screen.getByText(/La IA está analizando el repositorio/)).toBeInTheDocument();
    });

    it('disables the analysis when the repository does not allow AI analysis', () => {
      renderChat();
      selectProject('Equipo Web');
      receive({ type: 'context', groupId: 'G1', groupName: 'Equipo Web', repo: { fullName: 'acme/web', defaultBranch: 'main', aiAnalysisEnabled: false } });
      expect(screen.getByRole('button', { name: 'Analizar repositorio' })).toBeDisabled();
      expect(screen.getByText(/El análisis con IA está desactivado para este proyecto/)).toBeInTheDocument();
    });

    it('explains AI_ANALYSIS_DISABLED and blocks further analyses', () => {
      renderChat();
      selectProject('Equipo Web');
      receive({ type: 'context', groupId: 'G1', groupName: 'Equipo Web', repo: { fullName: 'acme/web', defaultBranch: 'main' } });
      fireEvent.click(screen.getByRole('button', { name: 'Analizar repositorio' }));
      const [request] = sentOfType('repo_analysis');

      receive({ type: 'error', code: 'AI_ANALYSIS_DISABLED', requestId: request.requestId, message: 'disabled' });
      expect(screen.getByRole('alert')).toHaveTextContent('El análisis con IA está desactivado para este proyecto');
      expect(screen.getByRole('button', { name: 'Analizar repositorio' })).toBeDisabled();
    });

    it('explains a connection closed for an oversized message (1009)', () => {
      renderChat();
      act(() => { mockWsOptions.onClose({ code: 1009 }); });
      expect(screen.getByRole('alert')).toHaveTextContent('El mensaje es demasiado grande');
    });
  });
});

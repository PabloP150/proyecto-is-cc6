import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
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

// The chat follows the group chosen in the navbar; tests switch it through this setter.
let mockSetGroup = null;
function GroupState({ groups, refreshGroups, initialGroupId, children }) {
  const [selectedGroupId, setSelectedGroupId] = useState(initialGroupId);
  mockSetGroup = setSelectedGroupId;
  return (
    <GroupContext.Provider value={{ refreshGroups, groups, selectedGroupId }}>
      {children}
    </GroupContext.Provider>
  );
}

const renderChat = ({ state, groups = GROUPS, refreshGroups = jest.fn().mockResolvedValue(GROUPS), selectedGroupId = null } = {}) => {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/chat', state }]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <GroupState refreshGroups={refreshGroups} groups={groups} initialGroupId={selectedGroupId}>
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
      </GroupState>
    </MemoryRouter>
  );
  return { refreshGroups };
};

const receive = (data) => act(() => { mockWsOptions.onMessage(data); });
const sentOfType = (type) => mockSend.mock.calls.map(([msg]) => msg).filter((msg) => msg.type === type);

const selectProject = (name) => {
  const group = GROUPS.find((g) => g.name === name);
  act(() => { mockSetGroup(group ? group.gid : null); });
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
    expect(screen.getByTestId('chat-project')).toHaveTextContent('select a group in the navbar');
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'hola' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(sentOfType('user')).toEqual([expect.objectContaining({ type: 'user', content: 'hola' })]);
    expect(sentOfType('repo_analysis')).toHaveLength(0);
  });

  it('loads the groups on mount when the context has none', () => {
    const { refreshGroups } = renderChat({ groups: [] });
    expect(refreshGroups).toHaveBeenCalledTimes(1);
  });

  it('sends set_context when the navbar group changes and shows the repository from the context reply', () => {
    renderChat();
    selectProject('Equipo Web');
    expect(sentOfType('set_context')).toEqual([{ type: 'set_context', groupId: 'G1' }]);

    receive({ type: 'context', groupId: 'G1', groupName: 'Equipo Web', repo: { fullName: 'acme/web', defaultBranch: 'main' } });
    expect(screen.getByText('acme/web')).toBeInTheDocument();

    selectProject(null);
    expect(sentOfType('set_context')[1]).toEqual({ type: 'set_context', groupId: null });
  });

  it('disables the analysis when the project has no repository', () => {
    renderChat();
    selectProject('Equipo Móvil');
    receive({ type: 'context', groupId: 'G2', groupName: 'Equipo Móvil', repo: null });
    expect(screen.getByText('No repository')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Propose tasks' })).not.toBeInTheDocument();
    // Chat about the project still works without a repository.
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: '¿qué tareas hay?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(sentOfType('user')).toEqual([expect.objectContaining({ content: '¿qué tareas hay?' })]);
  });

  it('runs an analysis, shows progress and confirms the plan once', () => {
    renderChat();
    selectProject('Equipo Web');
    receive({ type: 'context', groupId: 'G1', groupName: 'Equipo Web', repo: { fullName: 'acme/web', defaultBranch: 'main' } });

    fireEvent.click(screen.getByRole('button', { name: 'Propose tasks' }));

    const [request] = sentOfType('repo_analysis');
    expect(request).toEqual({ type: 'repo_analysis', requestId: expect.any(String), groupId: 'G1', instructions: '' });
    expect(sentOfType('user')).toHaveLength(0);
    expect(screen.getByText('Preparing the repository analysis…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Propose tasks' })).toBeDisabled();

    receive({ type: 'repo_analysis_status', requestId: request.requestId, stage: 'analyzing' });
    expect(screen.getByText(/The AI is analyzing the repository/)).toBeInTheDocument();

    receive({ ...PLAN_MESSAGE, requestId: request.requestId });
    expect(screen.queryByText(/The AI is analyzing the repository/)).not.toBeInTheDocument();
    expect(screen.getByText('Agregar pruebas')).toBeInTheDocument();

    const confirm = screen.getByRole('button', { name: 'Confirm' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(sentOfType('repo_plan_confirm')).toEqual([{ type: 'repo_plan_confirm', planId: 'plan-1' }]);
    expect(screen.getByRole('button', { name: /Confirm/ })).toBeDisabled();

    receive({ type: 'repo_plan_saved', planId: 'plan-1', groupId: 'G1', created: { tasks: 1, milestones: 0 }, content: 'Plan guardado' });
    expect(screen.getByTestId('repo-plan-compact')).toHaveTextContent('Plan saved to “Equipo Web”: 1 task created and 0 milestones.');
  });

  it('with a project, typing sends a chat message; a plan asked in the chat shows the analysis progress', () => {
    renderChat();
    selectProject('Equipo Web');
    receive({ type: 'context', groupId: 'G1', groupName: 'Equipo Web', repo: { fullName: 'acme/web', defaultBranch: 'main' } });
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveAttribute('placeholder', 'Ask about “Equipo Web”…');

    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'crea un plan de pruebas' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(sentOfType('user')).toEqual([expect.objectContaining({ content: 'crea un plan de pruebas' })]);
    expect(sentOfType('repo_analysis')).toHaveLength(0);

    receive({ type: 'repo_analysis_status', requestId: 'srv-1', stage: 'fetching_repo' });
    expect(screen.getByText('Reading the repository on GitHub…')).toBeInTheDocument();
    expect(screen.queryByText('Thinking...')).not.toBeInTheDocument();
    receive({ ...PLAN_MESSAGE, requestId: 'srv-1' });
    expect(screen.getByText('Agregar pruebas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Propose tasks' })).toBeEnabled();
  });

  it('a plan cooldown refused for a chat message reads as the analysis limit', () => {
    renderChat();
    receive({ type: 'error', code: 'RATE_LIMITED', kind: 'analysis', requestId: 'srv-2', retryAfterSec: 30, message: 'You can only ask for one analysis per minute.' });
    expect(screen.getByRole('alert')).toHaveTextContent('You can only ask for one analysis per minute. You can retry in 30 s.');
  });

  it('discards a plan and marks it discarded', () => {
    renderChat();
    receive(PLAN_MESSAGE);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(sentOfType('repo_plan_discard')).toEqual([{ type: 'repo_plan_discard', planId: 'plan-1' }]);
    receive({ type: 'repo_plan_discarded', planId: 'plan-1', content: 'Plan descartado.' });
    expect(screen.getByTestId('repo-plan-compact')).toHaveTextContent('Plan discarded');
  });

  it('marks the plan expired and clears busy on REPO_PLAN_EXPIRED', () => {
    renderChat();
    receive(PLAN_MESSAGE);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    receive({ type: 'error', code: 'REPO_PLAN_EXPIRED', planId: 'plan-1', message: 'El plan expiró; vuelve a analizar el repositorio.' });
    expect(screen.getByTestId('repo-plan-compact')).toHaveTextContent('Plan expired');
    expect(screen.getByRole('alert')).toHaveTextContent('El plan expiró');
  });

  it('re-enables the plan after SAVE_FAILED', () => {
    renderChat();
    receive(PLAN_MESSAGE);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(screen.getByRole('button', { name: /Confirm/ })).toBeDisabled();
    receive({ type: 'error', code: 'SAVE_FAILED', planId: 'plan-1', message: 'No se pudo guardar el plan.' });
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  });

  it('stops the progress indicator when the analysis fails', () => {
    renderChat();
    selectProject('Equipo Web');
    fireEvent.click(screen.getByRole('button', { name: 'Propose tasks' }));
    const [request] = sentOfType('repo_analysis');
    expect(request.instructions).toBe('');
    receive({ type: 'error', code: 'LLM_TIMEOUT', requestId: request.requestId, message: 'El análisis tardó demasiado.' });
    expect(screen.queryByText('Preparing the repository analysis…')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('The AI took too long to answer.');
    expect(screen.getByRole('button', { name: 'Propose tasks' })).toBeEnabled();
  });

  it('starts the analysis requested from /github once and clears the navigation state', () => {
    renderChat({ state: { analyzeGroupId: 'G1' } });
    expect(sentOfType('set_context')[0]).toEqual({ type: 'set_context', groupId: 'G1' });
    expect(sentOfType('repo_analysis')).toEqual([
      { type: 'repo_analysis', requestId: expect.any(String), groupId: 'G1', instructions: '' },
    ]);
    expect(screen.getByTestId('chat-project')).toHaveTextContent('Equipo Web');
    expect(screen.getByTestId('nav-state')).toHaveTextContent('null');
    // Same request bubble as from the button (and as the server restores it).
    expect(screen.getAllByText('Analyze the repository of “Equipo Web” and propose the next tasks.')).toHaveLength(1);
  });

  it('keeps the /github request bubble when the restore sent as the socket opened arrives after it', () => {
    renderChat({ state: { analyzeGroupId: 'G1' } });
    const [request] = sentOfType('repo_analysis');
    receive({ type: 'history_restore', messages: [{ type: 'user', content: 'hola' }] });

    expect(screen.getByText('hola')).toBeInTheDocument();
    expect(screen.getAllByText('Analyze the repository of “Equipo Web” and propose the next tasks.')).toHaveLength(1);
    receive({ ...PLAN_MESSAGE, requestId: request.requestId });
    expect(screen.getByText('Agregar pruebas')).toBeInTheDocument();
  });

  it('does not repeat the request bubble when the restore already holds that request', () => {
    renderChat({ state: { analyzeGroupId: 'G1' } });
    const [request] = sentOfType('repo_analysis');
    receive({
      type: 'history_restore',
      messages: [{ type: 'user', content: 'Analyze the repository of “Equipo Web” and propose the next tasks.', requestId: request.requestId }],
    });
    expect(screen.getAllByText('Analyze the repository of “Equipo Web” and propose the next tasks.')).toHaveLength(1);
  });

  it('drops the bubble of a finished analysis on the next restore (the server history decides)', () => {
    renderChat();
    selectProject('Equipo Web');
    fireEvent.click(screen.getByRole('button', { name: 'Propose tasks' }));
    const [request] = sentOfType('repo_analysis');
    receive({ type: 'error', code: 'RATE_LIMITED', requestId: request.requestId, retryAfterSec: 41, message: 'You can only ask for one analysis per minute.' });

    receive({ type: 'history_restore', messages: [{ type: 'user', content: 'hola' }] });
    expect(screen.queryByText('Analyze the repository of “Equipo Web” and propose the next tasks.')).not.toBeInTheDocument();
  });

  it('shows the analysis cooldown as an analysis message with the wait, next to its request', () => {
    renderChat();
    selectProject('Equipo Web');
    receive({ type: 'context', groupId: 'G1', groupName: 'Equipo Web', repo: { fullName: 'acme/web', defaultBranch: 'main' } });
    fireEvent.click(screen.getByRole('button', { name: 'Propose tasks' }));
    const [request] = sentOfType('repo_analysis');

    receive({ type: 'error', code: 'RATE_LIMITED', requestId: request.requestId, retryAfterSec: 41, message: 'You can only ask for one analysis per minute.' });
    expect(screen.getByText('Analyze the repository of “Equipo Web” and propose the next tasks.')).toBeInTheDocument();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('You can only ask for one analysis per minute. You can retry in 41 s.');
    expect(alert).not.toHaveTextContent('You are going too fast');
    expect(screen.getByRole('button', { name: 'Propose tasks' })).toBeEnabled();
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
    expect(disabled).toHaveTextContent('A group admin can turn it on from the GitHub page');
    expect(timeout).toHaveTextContent('The AI took too long to answer. Please try again.');
    expect(timeout).not.toHaveTextContent('You can retry');
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
    expect(analysisLimit).not.toHaveTextContent('You are going too fast');
    expect(chatLimit).toHaveTextContent('Estás enviando mensajes muy rápido; espera un momento.');
    [analysisLimit, chatLimit].forEach(alert => expect(alert).not.toHaveTextContent('You can retry'));
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
    expect(screen.getByTestId('repo-plan-compact')).toHaveTextContent('Plan expired');
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
    expect(screen.getByTestId('repo-plan-compact')).toHaveTextContent('Plan saved');
    expect(screen.queryByText('Plan guardado: 1 tareas y 0 hitos.')).not.toBeInTheDocument();
  });

  describe('limits, errors and timeouts', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('caps chat messages at 4000 characters with a counter', () => {
      renderChat();
      const input = screen.getByRole('textbox', { name: 'Message' });
      expect(input).toHaveAttribute('maxLength', '4000');
      fireEvent.change(input, { target: { value: 'hola' } });
      expect(screen.getByText('4/4000')).toBeInTheDocument();
    });

    it('keeps the chat limit with a project selected', () => {
      renderChat();
      selectProject('Equipo Web');
      expect(screen.getByRole('textbox', { name: 'Message' })).toHaveAttribute('maxLength', '4000');
    });

    it.each([
      [{ code: 'MESSAGE_TOO_LONG', message: 'too long' }, 'The message is too long: the limit is 4000 characters.'],
      [{ code: 'RATE_LIMITED', message: 'slow down', retryAfterSec: 12 }, 'You are going too fast: wait a moment before trying again. You can retry in 12 s.'],
      // A chat message (its requestId is not an analysis one) keeps the chat wording.
      [{ code: 'RATE_LIMITED', requestId: 'chat-1', message: 'Estás enviando mensajes muy rápido; espera un momento.', retryAfterSec: 5 }, 'You are going too fast: wait a moment before trying again. You can retry in 5 s.'],
      [{ code: 'LLM_TIMEOUT', message: 'timeout' }, 'The AI took too long to answer. Please try again.'],
    ])('shows a friendly message for %o', (error, text) => {
      renderChat();
      receive({ type: 'error', ...error });
      expect(screen.getByRole('alert')).toHaveTextContent(text);
    });

    it('stops the typing indicator after ~100 s without any reply', () => {
      jest.useFakeTimers();
      renderChat();
      fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'hola' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
      expect(screen.getByText('Thinking...')).toBeInTheDocument();

      act(() => { jest.advanceTimersByTime(99000); });
      expect(screen.getByText('Thinking...')).toBeInTheDocument();

      act(() => { jest.advanceTimersByTime(2000); });
      expect(screen.queryByText('Thinking...')).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('No answer arrived in time');
    });

    it('restarts the wait on analysis progress updates', () => {
      jest.useFakeTimers();
      renderChat();
      selectProject('Equipo Web');
      fireEvent.click(screen.getByRole('button', { name: 'Propose tasks' }));
      const [request] = sentOfType('repo_analysis');

      act(() => { jest.advanceTimersByTime(90000); });
      receive({ type: 'repo_analysis_status', requestId: request.requestId, stage: 'analyzing' });
      act(() => { jest.advanceTimersByTime(90000); });
      expect(screen.getByText(/The AI is analyzing the repository/)).toBeInTheDocument();
    });

    it('disables the analysis when the repository does not allow AI analysis', () => {
      renderChat();
      selectProject('Equipo Web');
      receive({ type: 'context', groupId: 'G1', groupName: 'Equipo Web', repo: { fullName: 'acme/web', defaultBranch: 'main', aiAnalysisEnabled: false } });
      expect(screen.queryByRole('button', { name: 'Propose tasks' })).not.toBeInTheDocument();
      expect(screen.getByText(/AI analysis is turned off for this project/)).toBeInTheDocument();
    });

    it('explains AI_ANALYSIS_DISABLED and blocks further analyses', () => {
      renderChat();
      selectProject('Equipo Web');
      receive({ type: 'context', groupId: 'G1', groupName: 'Equipo Web', repo: { fullName: 'acme/web', defaultBranch: 'main' } });
      fireEvent.click(screen.getByRole('button', { name: 'Propose tasks' }));
      const [request] = sentOfType('repo_analysis');

      receive({ type: 'error', code: 'AI_ANALYSIS_DISABLED', requestId: request.requestId, message: 'disabled' });
      expect(screen.getByRole('alert')).toHaveTextContent('AI analysis is turned off for this project');
      expect(screen.queryByRole('button', { name: 'Propose tasks' })).not.toBeInTheDocument();
    });

    it('explains a connection closed for an oversized message (1009)', () => {
      renderChat();
      act(() => { mockWsOptions.onClose({ code: 1009 }); });
      expect(screen.getByRole('alert')).toHaveTextContent('The message is too large');
    });
  });
});

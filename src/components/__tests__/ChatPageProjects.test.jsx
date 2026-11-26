// The chat's project modes: a group with data, an empty group (a new account's personal group, where the
// plan is saved in that group) and "New project" (a plan saved as a new group). Each project keeps its
// own conversation: switching shows that project's chat, never the previous one.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import ChatPage from '../ChatPage';
import { GroupContext } from '../GroupContext';

jest.mock('react-markdown', () => ({ __esModule: true, default: (props) => <div>{props.children}</div> }));
jest.mock('rehype-raw', () => ({ __esModule: true, default: function rehypeRaw() {} }));
jest.mock('rehype-sanitize', () => ({ __esModule: true, default: function rehypeSanitize() {} }));
jest.mock('remark-gfm', () => ({ __esModule: true, default: function remarkGfm() {} }));

let mockWsOptions = null;
let mockConnected = true;
const mockSend = jest.fn(() => true);
jest.mock('../../hooks/useWebSocket', () => ({
  __esModule: true,
  default: (url, token, options) => {
    mockWsOptions = options;
    return { sendMessage: mockSend, isConnected: mockConnected, error: null, connect: () => {} };
  },
}));

const GROUPS = [
  { gid: 'G1', name: 'Equipo Web' },
  { gid: 'G2', name: "Test's Group" },
];

let mockSetGroup = null;
const setSelectedGroupName = jest.fn();
function GroupState({ initialGroupId, children }) {
  const [selectedGroupId, setSelectedGroupId] = useState(initialGroupId);
  mockSetGroup = setSelectedGroupId;
  const selectedGroupName = GROUPS.find((g) => g.gid === selectedGroupId)?.name || '';
  return (
    <GroupContext.Provider value={{ refreshGroups: jest.fn().mockResolvedValue(GROUPS), groups: GROUPS, selectedGroupId, selectedGroupName, setSelectedGroupName }}>
      {children}
    </GroupContext.Provider>
  );
}

const renderChat = (selectedGroupId = 'G1') => render(
  <MemoryRouter initialEntries={['/chat']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <GroupState initialGroupId={selectedGroupId}><ChatPage /></GroupState>
  </MemoryRouter>
);

const receive = (data) => act(() => { mockWsOptions.onMessage(data); });
const contextsSent = () => mockSend.mock.calls.map(([msg]) => msg).filter((msg) => msg.type === 'set_context');

describe('ChatPage — projects and their conversations', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = () => {};
  });

  beforeEach(() => {
    mockSend.mockClear();
    mockConnected = true;
    setSelectedGroupName.mockClear();
    localStorage.clear();
    localStorage.setItem('token', 'jwt');
    localStorage.setItem('user', JSON.stringify({ uid: 'u1', name: 'ana', token: 'jwt' }));
  });

  it('«New project» leaves the group for a new project and «Back to» returns to it', () => {
    renderChat('G1');
    act(() => { mockWsOptions.onOpen?.(); });
    receive({ type: 'context', groupId: 'G1', groupName: 'Equipo Web', repo: null, empty: false });
    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    expect(contextsSent().pop()).toEqual({ type: 'set_context', groupId: null });
    expect(screen.getByTestId('chat-project')).toHaveTextContent('Project: new project');
    expect(screen.getByText(/it will be saved as a new group/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to “Equipo Web”' }));
    expect(contextsSent().pop()).toEqual({ type: 'set_context', groupId: 'G1' });
    expect(screen.getByTestId('chat-project')).toHaveTextContent('Equipo Web');
  });

  it('an empty group says the plan is created in it, and offers no «New project»', () => {
    renderChat('G2');
    receive({ type: 'context', groupId: 'G2', groupName: "Test's Group", repo: null, empty: true, fillable: true });
    expect(screen.getByText(/This group is empty: .* it will be created in this group/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New project' })).not.toBeInTheDocument();
    expect(screen.queryByText(/This project has no repository connected/)).not.toBeInTheDocument();
  });

  it('an empty group the user does not administer says the plan becomes a new group', () => {
    renderChat('G2');
    receive({ type: 'context', groupId: 'G2', groupName: "Test's Group", repo: null, empty: true, fillable: false });
    expect(screen.getByText(/it will be saved as a new group \(only the group admin can create it here\)/)).toBeInTheDocument();
  });

  it('switching groups does not leave the previous conversation on screen; its own chat comes back', () => {
    renderChat('G1');
    receive({ type: 'history_restore', messages: [{ type: 'user', content: 'pregunta del grupo uno' }] });
    expect(screen.getByText('pregunta del grupo uno')).toBeInTheDocument();

    act(() => { mockSetGroup('G2'); });
    expect(screen.queryByText('pregunta del grupo uno')).not.toBeInTheDocument();
    receive({ type: 'history_restore', messages: [], chatOf: 'g2' });
    expect(screen.getByText(/I'm your AI assistant/)).toBeInTheDocument();

    act(() => { mockSetGroup('G1'); });
    receive({ type: 'history_restore', messages: [{ type: 'user', content: 'pregunta del grupo uno' }], chatOf: 'g1' });
    expect(screen.getByText('pregunta del grupo uno')).toBeInTheDocument();
  });

  it('a restore for a group already left again is ignored', () => {
    renderChat('G1');
    act(() => { mockSetGroup('G2'); });
    receive({ type: 'history_restore', messages: [{ type: 'user', content: 'mensaje de G1' }], chatOf: 'g1' });
    expect(screen.queryByText('mensaje de G1')).not.toBeInTheDocument();
  });

  // Before, a reconnect to a fresh server session left the conversation on screen; it still does.
  it('an empty restore for the chat already on screen (fresh server session) keeps the conversation', () => {
    renderChat('G1');
    receive({ type: 'history_restore', messages: [{ type: 'user', content: 'sigo aquí' }], chatOf: 'g1' });
    receive({ type: 'history_restore', messages: [], chatOf: 'g1' });
    expect(screen.getByText('sigo aquí')).toBeInTheDocument();
  });

  // Regression (second review): after a reload in «New project» mode (or coming back to /chat after switching
  // group elsewhere) the server's previous chat was shown under the navbar group.
  it('a restore of the chat the server was still on is not shown under another project', () => {
    renderChat('G1');
    receive({ type: 'history_restore', messages: [{ type: 'assistant', content: 'plan del proyecto nuevo' }], chatOf: '' });
    expect(screen.queryByText('plan del proyecto nuevo')).not.toBeInTheDocument();
    receive({ type: 'history_restore', messages: [], chatOf: 'g1' });
    expect(screen.getByText(/I'm your AI assistant/)).toBeInTheDocument();
  });

  it('«New project» is sent again on reconnect, and the buttons wait for the connection', () => {
    const view = renderChat('G1');
    receive({ type: 'context', groupId: 'G1', groupName: 'Equipo Web', repo: null, empty: false });
    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    mockSend.mockClear();
    mockConnected = false;
    view.rerender(
      <MemoryRouter initialEntries={['/chat']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <GroupState initialGroupId="G1"><ChatPage /></GroupState>
      </MemoryRouter>
    );
    expect(screen.getByRole('button', { name: 'Back to “Equipo Web”' })).toBeDisabled();
    mockConnected = true;
    view.rerender(
      <MemoryRouter initialEntries={['/chat']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <GroupState initialGroupId="G1"><ChatPage /></GroupState>
      </MemoryRouter>
    );
    expect(contextsSent()).toEqual([{ type: 'set_context', groupId: null }]);
  });

  it('a plan saved in the empty group renames it in the navbar and refreshes the context', () => {
    renderChat('G2');
    receive({ type: 'context', groupId: 'G2', groupName: "Test's Group", repo: null, empty: true });
    mockSend.mockClear();
    receive({ type: 'system', event: 'project_created', content: 'Proyecto "Tienda online" creado en este grupo', groupId: 'G2', groupName: 'Tienda online', filled: true });
    expect(setSelectedGroupName).toHaveBeenCalledWith('Tienda online');
    expect(contextsSent()).toEqual([{ type: 'set_context', groupId: 'G2' }]);
    expect(screen.queryByText(/This group is empty/)).not.toBeInTheDocument();
  });

  it('a plan saved as a new group leaves the selected group alone', () => {
    renderChat('G1');
    receive({ type: 'system', event: 'project_created', content: 'Proyecto "Tienda online" creado', groupId: 'G9', groupName: 'Tienda online', filled: false });
    expect(setSelectedGroupName).not.toHaveBeenCalled();
  });
});

import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import ChatPage from '../ChatPage';
import { GroupContext } from '../GroupContext';

// react-markdown and the unified plugins are ESM-only (CRA's Jest can't transform them): mock them
// and capture the props ChatPage passes so the plugin order can be asserted.
let mockMarkdownProps = [];
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: (props) => {
    mockMarkdownProps.push(props);
    return <div data-testid="markdown">{props.children}</div>;
  },
}));
jest.mock('rehype-raw', () => ({ __esModule: true, default: function rehypeRaw() {} }));
jest.mock('rehype-sanitize', () => ({ __esModule: true, default: function rehypeSanitize() {} }));
jest.mock('remark-gfm', () => ({ __esModule: true, default: function remarkGfm() {} }));

let mockWsOptions = null;
jest.mock('../../hooks/useWebSocket', () => ({
  __esModule: true,
  default: (url, token, options) => {
    mockWsOptions = options;
    return { sendMessage: () => true, isConnected: true, error: null, connect: () => {} };
  },
}));

// `groups` is non-empty so ChatPage does not refresh them on mount.
const renderChat = (refreshGroups = jest.fn().mockResolvedValue([])) => {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <GroupContext.Provider value={{ refreshGroups, groups: [{ gid: 'g0', name: 'Otro' }] }}>
        <ChatPage />
      </GroupContext.Provider>
    </MemoryRouter>
  );
  return { refreshGroups };
};

const receive = (data) => act(() => { mockWsOptions.onMessage(data); });

describe('ChatPage', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = () => {};
  });

  beforeEach(() => {
    mockMarkdownProps = [];
    mockWsOptions = null;
    localStorage.clear();
    localStorage.setItem('token', 'jwt');
    localStorage.setItem('user', JSON.stringify({ uid: 'u1', name: 'ana', token: 'jwt' }));
  });

  it('renders error messages with their code instead of dropping them', () => {
    renderChat();

    receive({ type: 'error', code: 'ANALYSIS_IN_PROGRESS', message: 'Ya hay un análisis en curso.' });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Ya hay un análisis en curso.');
    expect(alert).toHaveTextContent('Code: ANALYSIS_IN_PROGRESS');
  });

  it('runs rehype-sanitize after rehype-raw and enables remark-gfm for assistant markdown', () => {
    renderChat();

    receive({ type: 'assistant', content: '| a | b |\n|---|---|\n| 1 | 2 |<script>alert(1)</script>' });

    const props = mockMarkdownProps[mockMarkdownProps.length - 1];
    expect(props.rehypePlugins).toEqual([rehypeRaw, rehypeSanitize]);
    expect(props.remarkPlugins).toContain(remarkGfm);
  });

  it('refreshes the groups and shows the notice when a project is created', () => {
    const { refreshGroups } = renderChat();

    receive({
      type: 'system',
      event: 'project_created',
      content: 'Project "Mi App" created successfully!',
      groupId: 'g1',
      groupName: 'Mi App',
    });

    expect(refreshGroups).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Project "Mi App" created successfully!');
    // System notices are not rendered as assistant markdown bubbles
    expect(screen.queryByTestId('markdown')).not.toBeInTheDocument();
  });

  it('restores history including errors and skips entries without text', () => {
    renderChat();

    receive({
      type: 'history_restore',
      messages: [
        { type: 'user', content: 'hola', timestamp: '2026-09-10T10:00:00Z' },
        { type: 'assistant_chunk', content: { partial: true } },
        { type: 'error', code: 'LLM_TIMEOUT', message: 'La IA tardó demasiado' },
      ],
    });

    expect(screen.getByText('hola')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('La IA tardó demasiado');
  });
});

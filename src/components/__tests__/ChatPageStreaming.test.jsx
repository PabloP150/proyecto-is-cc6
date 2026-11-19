import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ChatPage, { appendStreamText, endStreams, settleStream } from '../ChatPage';
import { GroupContext } from '../GroupContext';

// Same mocks as ChatPage.test.jsx: the unified/markdown packages are ESM-only.
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: (props) => <div data-testid="md">{props.children}</div>,
}));
jest.mock('rehype-raw', () => ({ __esModule: true, default: function rehypeRaw() {} }));
jest.mock('rehype-sanitize', () => ({ __esModule: true, default: function rehypeSanitize() {} }));
jest.mock('remark-gfm', () => ({ __esModule: true, default: function remarkGfm() {} }));

let mockWsOptions = null;
jest.mock('../../hooks/useWebSocket', () => ({
  __esModule: true,
  default: (_url, _token, options) => {
    mockWsOptions = options;
    return { sendMessage: jest.fn(() => true), isConnected: true, error: null, connect: jest.fn() };
  },
}));

const renderChat = () => render(
  <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <GroupContext.Provider value={{ refreshGroups: jest.fn().mockResolvedValue([]), groups: [] }}>
      <ChatPage />
    </GroupContext.Provider>
  </MemoryRouter>
);

const receive = (data) => act(() => { mockWsOptions.onMessage(data); });
// Chunks are flushed on the next animation frame (setTimeout under jsdom's fake rAF).
const nextFrame = () => act(() => { jest.advanceTimersByTime(20); });
const bubbles = () => screen.queryAllByTestId('md').map((el) => el.textContent);

describe('streamed chat replies', () => {
  beforeAll(() => { Element.prototype.scrollIntoView = () => {}; });

  beforeEach(() => {
    jest.useFakeTimers();
    // Use the setTimeout fallback so fake timers control the flush.
    window.requestAnimationFrame = undefined;
    localStorage.clear();
    localStorage.setItem('token', 'jwt');
    localStorage.setItem('user', JSON.stringify({ uid: 'u1', name: 'ana', token: 'jwt' }));
  });

  afterEach(() => { jest.useRealTimers(); });

  it('grows one bubble from chunks, then replaces it with the final text', () => {
    renderChat();
    receive({ type: 'history_restore', messages: [] });
    const before = bubbles().length;

    receive({ type: 'assistant_chunk', requestId: 'r1', content: 'Hola' });
    receive({ type: 'assistant_chunk', requestId: 'r1', content: ', mun' });
    nextFrame();
    receive({ type: 'assistant_chunk', requestId: 'r1', content: 'do' });
    nextFrame();

    expect(bubbles().length).toBe(before + 1);
    expect(bubbles().at(-1)).toBe('Hola, mundo ▍');   // caret while live

    receive({ type: 'assistant', requestId: 'r1', content: 'Hola, mundo.' });
    expect(bubbles().length).toBe(before + 1);          // replaced, not duplicated
    expect(bubbles().at(-1)).toBe('Hola, mundo.');
  });

  it('batches many chunks into one render per frame', () => {
    renderChat();
    receive({ type: 'history_restore', messages: [] });
    for (let i = 0; i < 50; i += 1) receive({ type: 'assistant_chunk', requestId: 'r2', content: 'x' });
    expect(bubbles().some((t) => t.startsWith('x'))).toBe(false);   // nothing until the frame
    nextFrame();
    expect(bubbles().at(-1)).toBe(`${'x'.repeat(50)} ▍`);
  });

  it('a final message that was never streamed is simply appended', () => {
    renderChat();
    receive({ type: 'history_restore', messages: [] });
    const before = bubbles().length;
    receive({ type: 'assistant', requestId: 'r3', content: 'whole answer' });
    expect(bubbles().length).toBe(before + 1);
    expect(bubbles().at(-1)).toBe('whole answer');
  });
});

describe('stream helpers', () => {
  const live = (requestId, content) => ({ id: requestId, type: 'assistant', requestId, content, streaming: true });

  it('appendStreamText keeps separate requests in separate bubbles', () => {
    const list = appendStreamText([], new Map([['a', 'A1'], ['b', 'B1']]));
    const next = appendStreamText(list, new Map([['a', 'A2']]));
    expect(next.map((m) => [m.requestId, m.content])).toEqual([['a', 'A1A2'], ['b', 'B1']]);
  });

  it('settleStream keeps the bubble position and id', () => {
    const list = [live('a', 'par'), { id: 'u', type: 'user', content: 'next' }];
    const settled = settleStream(list, { id: 'new', type: 'assistant', requestId: 'a', content: 'partial' });
    expect(settled[0]).toMatchObject({ id: 'a', content: 'partial', streaming: false });
    expect(settled[1].id).toBe('u');
  });

  it('endStreams stops live bubbles without touching their text', () => {
    const list = [live('a', 'half'), live('b', 'other')];
    expect(endStreams(list, 'a').map((m) => [m.content, m.streaming])).toEqual([['half', false], ['other', true]]);
    expect(endStreams(list).every((m) => !m.streaming)).toBe(true);
  });
});

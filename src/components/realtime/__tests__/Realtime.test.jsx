import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import useWebSocket from '../../../hooks/useWebSocket';
import theme from '../../../theme/theme';
import { GroupContext } from '../../GroupContext';
import CicdNotifications, { toNotice } from '../CicdNotifications';
import { RealtimeContext, RealtimeProvider, useGroupEvents } from '../RealtimeContext';

jest.mock('../../../hooks/useWebSocket', () => ({ __esModule: true, default: jest.fn() }));

const GROUPS = [
  { gid: 'G1', name: 'Demo CI/CD', adminId: 'U-ADMIN' },
  { gid: 'G2', name: 'Otro', adminId: 'U-OTHER' },
];

describe('toNotice', () => {
  const ctx = { groups: GROUPS, uid: 'U-ADMIN' };

  test('failed runs, not successful or still running ones', () => {
    expect(toNotice({ event: 'ci_run', gid: 'g1', data: { action: 'completed', conclusion: 'failure', title: 'feat: login', branch: 'main' } }, ctx))
      .toEqual({ severity: 'error', gid: 'g1', message: '[Demo CI/CD] Falló «feat: login» en main.' });
    expect(toNotice({ event: 'ci_run', gid: 'G1', data: { action: 'completed', conclusion: 'success' } }, ctx)).toBeNull();
    expect(toNotice({ event: 'ci_run', gid: 'G1', data: { action: 'in_progress', conclusion: null } }, ctx)).toBeNull();
  });

  test('finished deploys, with the site link only when it is https', () => {
    expect(toNotice({ event: 'deployment', gid: 'G1', data: { state: 'success', environment: 'production', shortSha: 'bbbbbbb', url: 'https://acme.github.io/app/' } }, ctx))
      .toEqual({ severity: 'success', gid: 'G1', url: 'https://acme.github.io/app/', message: '[Demo CI/CD] Producción se actualizó con bbbbbbb.' });
    expect(toNotice({ event: 'deployment', gid: 'G1', data: { state: 'success', environment: 'staging', shortSha: 'b', url: 'http://x' } }, ctx).url).toBeNull();
    expect(toNotice({ event: 'deployment', gid: 'G1', data: { state: 'failure', environment: 'staging', shortSha: 'eeeeeee' } }, ctx).message)
      .toBe('[Demo CI/CD] Falló el deploy de eeeeeee a staging.');
    expect(toNotice({ event: 'deployment', gid: 'G1', data: { state: 'in_progress' } }, ctx)).toBeNull();
  });

  test('pending requests go to the admins (not the requester); decisions to the requester', () => {
    const pending = { event: 'deploy_request', gid: 'G1', data: { status: 'pending', requestedBy: 'U-MEMBER', requestedByUsername: 'beto', shortSha: 'bbbbbbb', environment: 'production' } };
    expect(toNotice(pending, ctx).message).toBe('[Demo CI/CD] beto pide publicar bbbbbbb en producción.');
    expect(toNotice(pending, { groups: GROUPS, uid: 'U-MEMBER' })).toBeNull();
    expect(toNotice({ ...pending, gid: 'G2' }, ctx)).toBeNull();

    const decided = (status, extra = {}) => ({ event: 'deploy_request', gid: 'G1', data: { ...pending.data, status, decidedByUsername: 'admin', ...extra } });
    expect(toNotice(decided('approved'), { groups: GROUPS, uid: 'U-MEMBER' }).severity).toBe('success');
    expect(toNotice(decided('rejected', { note: 'falta QA' }), { groups: GROUPS, uid: 'U-MEMBER' }).message).toMatch(/rechazó tu solicitud de bbbbbbb\. Motivo: falta QA/);
    expect(toNotice(decided('approved'), ctx)).toBeNull();
  });

  test('unknown groups get a generic prefix; garbage is ignored', () => {
    expect(toNotice({ event: 'ci_run', gid: 'G9', data: { action: 'completed', conclusion: 'failure', name: 'CI' } }, ctx).message).toBe('[Tu grupo] Falló «CI».');
    expect(toNotice(null, ctx)).toBeNull();
    expect(toNotice({ event: 'nope', gid: 'G1', data: {} }, ctx)).toBeNull();
  });
});

function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.pathname + location.search}</div>;
}

describe('CicdNotifications', () => {
  test('shows a toast and «Ver» opens the CI/CD tab of that group', async () => {
    const listeners = new Set();
    const realtime = { connected: true, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
    const groupCtx = { groups: GROUPS, setSelectedGroupId: jest.fn(), setSelectedGroupName: jest.fn() };
    localStorage.setItem('userId', 'U-ADMIN');
    render(
      <ThemeProvider theme={theme}>
        <GroupContext.Provider value={groupCtx}>
          <RealtimeContext.Provider value={realtime}>
            <MemoryRouter initialEntries={['/home']}>
              <CicdNotifications />
              <Routes>
                <Route path="*" element={<Where />} />
              </Routes>
            </MemoryRouter>
          </RealtimeContext.Provider>
        </GroupContext.Provider>
      </ThemeProvider>
    );
    act(() => listeners.forEach((fn) => fn({ type: 'event', event: 'ci_run', gid: 'g1', data: { action: 'completed', conclusion: 'failure', title: 'feat: login', branch: 'main' } })));
    expect(await screen.findByText('[Demo CI/CD] Falló «feat: login» en main.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }));
    expect(groupCtx.setSelectedGroupId).toHaveBeenCalledWith('G1');
    expect(groupCtx.setSelectedGroupName).toHaveBeenCalledWith('Demo CI/CD');
    expect(screen.getByTestId('where')).toHaveTextContent('/github?tab=cicd');
    localStorage.clear();
  });
});

describe('RealtimeProvider', () => {
  let socket;
  beforeEach(() => {
    socket = { isConnected: true, sendMessage: jest.fn(), disconnect: jest.fn(), options: null };
    useWebSocket.mockReset().mockImplementation((url, token, options) => {
      socket.url = url;
      socket.token = token;
      socket.options = options;
      return { isConnected: socket.isConnected, sendMessage: socket.sendMessage, disconnect: socket.disconnect };
    });
  });

  function Probe({ gid, onEvent }) {
    useGroupEvents(gid, ['ci_run'], onEvent);
    return null;
  }

  const renderProvider = (user, onEvent = jest.fn()) =>
    render(
      <GroupContext.Provider value={{ groups: GROUPS }}>
        <RealtimeProvider user={user}>
          <Probe gid="g1" onEvent={onEvent} />
        </RealtimeProvider>
      </GroupContext.Provider>
    );

  test('connects to /events with the user token and subscribes to all of their groups', () => {
    renderProvider({ uid: 'U-ADMIN', token: 'tok' });
    expect(socket.url).toMatch(/\/events$/);
    expect(socket.token).toBe('tok');
    expect(socket.sendMessage).toHaveBeenCalledWith({ type: 'subscribe', groups: ['G1', 'G2'] });
  });

  test('delivers events to listeners of that group and event only', () => {
    const onEvent = jest.fn();
    renderProvider({ uid: 'U-ADMIN', token: 'tok' }, onEvent);
    act(() => {
      socket.options.onMessage({ type: 'event', event: 'ci_run', gid: 'G1', data: { runId: 1 } });
      socket.options.onMessage({ type: 'event', event: 'ci_job', gid: 'G1', data: { runId: 1 } });
      socket.options.onMessage({ type: 'event', event: 'ci_run', gid: 'G2', data: { runId: 2 } });
      socket.options.onMessage({ type: 'subscribed', groups: [] });
    });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ runId: 1 }, expect.objectContaining({ gid: 'G1' }));
  });

  test('logged out: no connection', () => {
    localStorage.clear();
    renderProvider(null);
    expect(socket.url).toBeNull();
    expect(socket.options.autoConnect).toBe(false);
    expect(socket.disconnect).toHaveBeenCalled();
    expect(socket.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'subscribe', groups: ['G1', 'G2'] }), expect.anything());
  });
});

import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import useWebSocket from '../../../hooks/useWebSocket';
import theme from '../../../theme/theme';
import { GroupContext } from '../../GroupContext';
import CicdNotifications, { RUN_NOTICE_DELAY_MS, deploymentRunId, toNotice, trackDeployFailures } from '../CicdNotifications';
import { RealtimeContext, RealtimeProvider, useGroupEvents, useRealtime } from '../RealtimeContext';

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

  const deployRun = (conclusion, runId = 77) => ({
    event: 'ci_run',
    gid: 'G1',
    data: { action: 'completed', runId, conclusion, title: 'Deploy a producción desde TaskMate', branch: 'main', isTaskmate: true, isDeploy: true },
  });
  const deployFailed = (runId = 77, extra = {}) => ({
    event: 'deployment',
    gid: 'G1',
    data: { state: 'failure', environment: 'production', shortSha: 'bbbbbbb', logUrl: `https://github.com/acme/app/actions/runs/${runId}`, ...extra },
  });
  const member = { groups: GROUPS, uid: 'U-MEMBER' };

  test('deploy runs: a failure no deployment event reported is still a toast; a cancel before publishing goes to the admins', () => {
    // Failed before its Deployment existed (no 'deployment' event): the run is the only news.
    expect(toNotice(deployRun('failure'), ctx)).toEqual({
      severity: 'error',
      gid: 'G1',
      message: '[Demo CI/CD] Falló «Deploy a producción desde TaskMate» en main.',
    });
    expect(toNotice(deployRun('failure'), member).severity).toBe('error');
    expect(toNotice(deployRun('cancelled'), ctx)).toEqual({
      severity: 'warning',
      gid: 'G1',
      message: '[Demo CI/CD] Se canceló «Deploy a producción desde TaskMate» antes de publicar.',
    });
    expect(toNotice(deployRun('cancelled'), member)).toBeNull();
    expect(toNotice({ ...deployRun('cancelled'), data: { ...deployRun('cancelled').data, action: 'in_progress' } }, ctx)).toBeNull();
    expect(toNotice(deployRun('success'), ctx)).toBeNull();
    // Plain CI runs: failures for everyone, cancellations for nobody.
    const ciRun = (conclusion) => ({ event: 'ci_run', gid: 'G1', data: { action: 'completed', runId: 5, conclusion, title: 'feat: x', isDeploy: false } });
    expect(toNotice(ciRun('failure'), member).severity).toBe('error');
    expect(toNotice(ciRun('cancelled'), ctx)).toBeNull();
  });

  test('a run whose deploy failure was already reported gives no second toast, whatever its conclusion', () => {
    const reportedRuns = new Map();
    trackDeployFailures(reportedRuns, deployFailed(77));
    const seen = { ...ctx, reportedRuns };
    expect(toNotice(deployRun('failure'), seen)).toBeNull();
    expect(toNotice(deployRun('timed_out'), seen)).toBeNull();
    // Cancelled after its Deployment existed: the workflow reports that deployment as failed.
    expect(toNotice(deployRun('cancelled'), seen)).toBeNull();
    // A push run on the default branch deploys staging too (isDeploy false).
    expect(toNotice({ event: 'ci_run', gid: 'G1', data: { action: 'completed', runId: '77', conclusion: 'failure', title: 'feat: x', isDeploy: false } }, seen)).toBeNull();
    // Other runs are not affected.
    expect(toNotice(deployRun('failure', 78), seen).severity).toBe('error');
  });

  test('trackDeployFailures: failed deployments by run id, a re-run forgets it, bounded in size and age', () => {
    const runs = new Map();
    trackDeployFailures(runs, deployFailed(10, { state: 'in_progress' }));
    trackDeployFailures(runs, deployFailed(11, { state: 'success' }));
    trackDeployFailures(runs, deployFailed(12, { logUrl: null }));
    trackDeployFailures(runs, deployFailed(13, { logUrl: 'https://github.com/acme/app/actions/runs/13x' }));
    expect([...runs.keys()]).toEqual([]);

    trackDeployFailures(runs, deployFailed(20), 1000);
    trackDeployFailures(runs, deployFailed(21, { state: 'error', logUrl: 'https://github.com/acme/app/actions/runs/21/attempts/2' }), 1000);
    expect([...runs.keys()]).toEqual(['20', '21']);
    expect(deploymentRunId({ logUrl: 'https://github.com/acme/app/actions/runs/21' })).toBe('21');

    // A new attempt of run 20 (re-run) may fail before creating its Deployment: that one is news again.
    trackDeployFailures(runs, { event: 'ci_run', gid: 'G1', data: { action: 'requested', runId: 20 } });
    expect(runs.has('20')).toBe(false);

    // Old entries expire; at most 50 are kept (the oldest go first).
    trackDeployFailures(runs, deployFailed(22), 1000 + 16 * 60 * 1000);
    expect([...runs.keys()]).toEqual(['22']);
    for (let i = 100; i < 160; i += 1) trackDeployFailures(runs, deployFailed(i), 2000000);
    expect(runs.size).toBe(50);
    expect(runs.has('109')).toBe(false);
    expect(runs.has('110')).toBe(true);
    expect(runs.has('159')).toBe(true);
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
  let listeners;
  let groupCtx;
  beforeEach(() => {
    listeners = new Set();
    groupCtx = { groups: GROUPS, setSelectedGroupId: jest.fn(), setSelectedGroupName: jest.fn() };
    localStorage.setItem('userId', 'U-ADMIN');
  });
  afterEach(() => {
    jest.useRealTimers();
    localStorage.clear();
  });

  const renderToasts = () => {
    const realtime = { connected: true, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
    return render(
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
  };
  const emit = (message) => act(() => listeners.forEach((fn) => fn({ type: 'event', ...message })));
  const advance = (ms) => act(() => {
    jest.advanceTimersByTime(ms);
  });

  test('shows a toast (a finished run after a short wait) and «Ver» opens the CI/CD tab of that group', () => {
    jest.useFakeTimers();
    renderToasts();
    emit({ event: 'ci_run', gid: 'g1', data: { action: 'completed', runId: 5, conclusion: 'failure', title: 'feat: login', branch: 'main' } });
    advance(RUN_NOTICE_DELAY_MS - 100);
    expect(screen.queryByText('[Demo CI/CD] Falló «feat: login» en main.')).not.toBeInTheDocument();
    advance(100);
    expect(screen.getByText('[Demo CI/CD] Falló «feat: login» en main.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }));
    expect(groupCtx.setSelectedGroupId).toHaveBeenCalledWith('G1');
    expect(groupCtx.setSelectedGroupName).toHaveBeenCalledWith('Demo CI/CD');
    expect(screen.getByTestId('where')).toHaveTextContent('/github?tab=cicd');
  });

  const deployRun = (conclusion) => ({
    event: 'ci_run',
    gid: 'G1',
    data: { action: 'completed', runId: 77, conclusion, title: 'Deploy a producción desde TaskMate', branch: 'main', isTaskmate: true, isDeploy: true },
  });
  const deployFailed = { event: 'deployment', gid: 'G1', data: { state: 'failure', environment: 'production', shortSha: 'bbbbbbb', logUrl: 'https://github.com/acme/app/actions/runs/77' } };
  const toasts = () => screen.queryAllByRole('alert').map((alert) => alert.textContent);

  test.each([
    ['the deployment failure first', [deployFailed, deployRun('failure')]],
    ['the run first (out of order)', [deployRun('failure'), deployFailed]],
    ['a cancel after the Deployment existed', [deployRun('cancelled'), deployFailed]],
  ])('a failed deploy is one toast: %s', (_, messages) => {
    jest.useFakeTimers();
    renderToasts();
    messages.forEach(emit);
    advance(RUN_NOTICE_DELAY_MS + 100);
    expect(toasts()).toEqual([expect.stringContaining('[Demo CI/CD] Falló el deploy de bbbbbbb a producción.')]);
    // Nothing queued behind it.
    advance(9500);
    expect(toasts()).toEqual([]);
  });

  test('a deploy run that failed before creating its Deployment is still reported', () => {
    jest.useFakeTimers();
    renderToasts();
    emit(deployRun('failure'));
    advance(RUN_NOTICE_DELAY_MS + 100);
    expect(toasts()).toEqual([expect.stringContaining('[Demo CI/CD] Falló «Deploy a producción desde TaskMate» en main.')]);
  });
});

describe('RealtimeProvider', () => {
  let socket;
  beforeEach(() => {
    socket = {
      isConnected: true,
      connectionStatus: 'Connected',
      sendMessage: jest.fn(() => true),
      disconnect: jest.fn(),
      reconnect: jest.fn(),
      options: null,
    };
    useWebSocket.mockReset().mockImplementation((url, token, options) => {
      socket.url = url;
      socket.token = token;
      socket.options = options;
      return {
        isConnected: socket.isConnected,
        connectionStatus: socket.connectionStatus,
        sendMessage: socket.sendMessage,
        disconnect: socket.disconnect,
        reconnect: socket.reconnect,
      };
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const server = (message) => act(() => socket.options.onMessage(message));
  const subscribes = () => socket.sendMessage.mock.calls.map(([message]) => message).filter((message) => message.type === 'subscribe');

  function Probe({ gid, onEvent, options }) {
    useGroupEvents(gid, ['ci_run'], onEvent, options);
    const { connected, epoch } = useRealtime();
    return <div data-testid="live">{`${connected ? 'live' : 'off'}:${epoch}`}</div>;
  }

  const tree = (user, onEvent, options, groupValue = { groups: GROUPS }) => (
    <GroupContext.Provider value={groupValue}>
      <RealtimeProvider user={user}>
        <Probe gid="g1" onEvent={onEvent} options={options} />
      </RealtimeProvider>
    </GroupContext.Provider>
  );

  const renderProvider = (user, onEvent = jest.fn(), options) => render(tree(user, onEvent, options));

  test('connects to /events with the user token, reconnects forever and subscribes to all of their groups', () => {
    renderProvider({ uid: 'U-ADMIN', token: 'tok' });
    expect(socket.url).toMatch(/\/events$/);
    expect(socket.token).toBe('tok');
    expect(socket.options.maxReconnectAttempts).toBe(Infinity);
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
    socket.isConnected = false;
    socket.connectionStatus = 'Disconnected';
    renderProvider(null);
    expect(socket.url).toBeNull();
    expect(socket.options.autoConnect).toBe(false);
    expect(socket.disconnect).toHaveBeenCalled();
    expect(subscribes()).toEqual([]);
  });

  test('live only once the server confirms the subscription; the epoch counts every confirmation', () => {
    renderProvider({ uid: 'U-ADMIN', token: 'tok' });
    expect(screen.getByTestId('live')).toHaveTextContent('off:0');
    server({ type: 'subscribed', groups: ['g1', 'g2'] });
    expect(screen.getByTestId('live')).toHaveTextContent('live:1');
    server({ type: 'subscribed', groups: ['g1', 'g2'] });
    expect(screen.getByTestId('live')).toHaveTextContent('live:2');
  });

  test('a socket that drops is not live any more, even before the next confirmation', () => {
    const { rerender } = renderProvider({ uid: 'U-ADMIN', token: 'tok' });
    server({ type: 'subscribed', groups: ['g1'] });
    expect(screen.getByTestId('live')).toHaveTextContent('live:1');
    socket.isConnected = false;
    socket.connectionStatus = 'Reconnecting (1/Infinity)';
    rerender(tree({ uid: 'U-ADMIN', token: 'tok' }, jest.fn()));
    expect(screen.getByTestId('live')).toHaveTextContent('off:1');
    socket.isConnected = true;
    socket.connectionStatus = 'Connected';
    rerender(tree({ uid: 'U-ADMIN', token: 'tok' }, jest.fn()));
    expect(screen.getByTestId('live')).toHaveTextContent('off:1');
    expect(subscribes()).toHaveLength(2);
  });

  test('useGroupEvents reloads after a reconnection, not after the first subscription', () => {
    const onEvent = jest.fn();
    renderProvider({ uid: 'U-ADMIN', token: 'tok' }, onEvent);
    server({ type: 'subscribed', groups: ['g1'] });
    expect(onEvent).not.toHaveBeenCalled();
    server({ type: 'subscribed', groups: ['g1'] });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(null, { type: 'resync', epoch: 2 });
    server({ type: 'subscribed', groups: ['g1'] });
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  test('useGroupEvents filters before the debounce: another run right after does not drop this one', () => {
    jest.useFakeTimers();
    const onEvent = jest.fn();
    const filter = (data) => data.runId === 1;
    renderProvider({ uid: 'U-ADMIN', token: 'tok' }, onEvent, { debounceMs: 500, filter });
    server({ type: 'event', event: 'ci_run', gid: 'G1', data: { runId: 1, status: 'completed' } });
    server({ type: 'event', event: 'ci_run', gid: 'G1', data: { runId: 2 } });
    act(() => {
      jest.advanceTimersByTime(600);
    });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ runId: 1, status: 'completed' }, expect.objectContaining({ gid: 'G1' }));

    // Without a filter the debounce keeps only the last event (RunList, DeployPanel).
    onEvent.mockClear();
    const { unmount } = render(
      <RealtimeContext.Provider value={{ connected: true, epoch: 0, subscribe: (fn) => { socket.listener = fn; return () => {}; } }}>
        <Probe gid="G1" onEvent={onEvent} options={{ debounceMs: 500 }} />
      </RealtimeContext.Provider>
    );
    act(() => {
      socket.listener({ type: 'event', event: 'ci_run', gid: 'G1', data: { runId: 1 } });
      socket.listener({ type: 'event', event: 'ci_run', gid: 'G1', data: { runId: 2 } });
      jest.advanceTimersByTime(600);
    });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ runId: 2 }, expect.anything());
    unmount();
  });

  test('back online it reconnects; back on the tab only when the socket is down', () => {
    renderProvider({ uid: 'U-ADMIN', token: 'tok' });
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(socket.reconnect).toHaveBeenCalledTimes(1);

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(socket.reconnect).toHaveBeenCalledTimes(1);
  });

  test.each(['Failed', 'Disconnected', 'Reconnecting (7/Infinity)'])('back on the tab with the socket %s: reconnects at once', (status) => {
    socket.isConnected = false;
    socket.connectionStatus = status;
    renderProvider({ uid: 'U-ADMIN', token: 'tok' });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(socket.reconnect).toHaveBeenCalledTimes(1);
  });

  test('logged out it does not reconnect on online/visibility', () => {
    localStorage.clear();
    socket.isConnected = false;
    socket.connectionStatus = 'Disconnected';
    renderProvider(null);
    act(() => {
      window.dispatchEvent(new Event('online'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(socket.reconnect).not.toHaveBeenCalled();
  });

  test('a refused subscribe is sent again after retryAfterMs; a failed one after a while, and it is not live', () => {
    jest.useFakeTimers();
    renderProvider({ uid: 'U-ADMIN', token: 'tok' });
    expect(subscribes()).toHaveLength(1);
    server({ type: 'error', code: 'RATE_LIMITED', retryAfterMs: 5000 });
    act(() => {
      jest.advanceTimersByTime(4900);
    });
    expect(subscribes()).toHaveLength(1);
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(subscribes()).toHaveLength(2);
    expect(subscribes()[1]).toEqual({ type: 'subscribe', groups: ['G1', 'G2'] });

    server({ type: 'subscribed', groups: ['g1', 'g2'] });
    expect(screen.getByTestId('live')).toHaveTextContent('live:1');
    server({ type: 'error', code: 'SUBSCRIBE_FAILED' });
    expect(screen.getByTestId('live')).toHaveTextContent('off:1');
    act(() => {
      jest.advanceTimersByTime(10000);
    });
    expect(subscribes()).toHaveLength(3);
  });

  test('after a reload it loads the groups once (abortable) and subscribes only when it has them', async () => {
    const refreshGroups = jest.fn();
    function Groups({ children, answer }) {
      const [groups, setGroups] = useState([]);
      refreshGroups.mockImplementation(async () => {
        setGroups(answer);
        return answer;
      });
      return <GroupContext.Provider value={{ groups, refreshGroups }}>{children}</GroupContext.Provider>;
    }
    const app = (answer) => (
      <Groups answer={answer}>
        <RealtimeProvider user={{ uid: 'U-ADMIN', token: 'tok' }}>
          <Probe gid="g1" onEvent={jest.fn()} />
        </RealtimeProvider>
      </Groups>
    );

    const { unmount } = render(app(GROUPS));
    await waitFor(() => expect(socket.sendMessage).toHaveBeenCalledWith({ type: 'subscribe', groups: ['G1', 'G2'] }));
    expect(refreshGroups).toHaveBeenCalledTimes(1);
    expect(refreshGroups.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
    expect(subscribes()).toEqual([{ type: 'subscribe', groups: ['G1', 'G2'] }]);
    unmount();

    // A user without groups: one load, no subscribe with an empty list, no loop.
    refreshGroups.mockClear();
    socket.sendMessage.mockClear();
    const { rerender } = render(app([]));
    await waitFor(() => expect(refreshGroups).toHaveBeenCalledTimes(1));
    rerender(app([]));
    expect(refreshGroups).toHaveBeenCalledTimes(1);
    expect(subscribes()).toEqual([]);
  });

  test('when the user has no groups left the subscription is cleared once; a new socket with no groups sends nothing', () => {
    const user = { uid: 'U-ADMIN', token: 'tok' };
    const refreshGroups = jest.fn().mockResolvedValue([]);
    const { rerender } = render(tree(user, jest.fn(), undefined, { groups: GROUPS, refreshGroups }));
    expect(subscribes()).toEqual([{ type: 'subscribe', groups: ['G1', 'G2'] }]);

    // They left (or deleted) their last group.
    rerender(tree(user, jest.fn(), undefined, { groups: [], refreshGroups }));
    expect(subscribes()).toEqual([
      { type: 'subscribe', groups: ['G1', 'G2'] },
      { type: 'subscribe', groups: [] },
    ]);
    rerender(tree(user, jest.fn(), undefined, { groups: [], refreshGroups }));
    expect(subscribes()).toHaveLength(2);

    // A reconnection starts with no subscription: nothing to clear.
    socket.isConnected = false;
    socket.connectionStatus = 'Reconnecting (1/Infinity)';
    rerender(tree(user, jest.fn(), undefined, { groups: [], refreshGroups }));
    socket.isConnected = true;
    socket.connectionStatus = 'Connected';
    rerender(tree(user, jest.fn(), undefined, { groups: [], refreshGroups }));
    expect(subscribes()).toHaveLength(2);
  });

  test('the groups are not loaded while the socket is down, and a failed load is tried again on the next connection', async () => {
    socket.isConnected = false;
    socket.connectionStatus = 'Reconnecting (1/Infinity)';
    const refreshGroups = jest.fn().mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'NETWORK_ERROR' })).mockResolvedValue([]);
    const groupValue = { groups: [], refreshGroups };
    const user = { uid: 'U-ADMIN', token: 'tok' };
    const { rerender } = render(tree(user, jest.fn(), undefined, groupValue));
    expect(refreshGroups).not.toHaveBeenCalled();

    socket.isConnected = true;
    socket.connectionStatus = 'Connected';
    rerender(tree(user, jest.fn(), undefined, groupValue));
    await waitFor(() => expect(refreshGroups).toHaveBeenCalledTimes(1));

    socket.isConnected = false;
    socket.connectionStatus = 'Reconnecting (1/Infinity)';
    rerender(tree(user, jest.fn(), undefined, groupValue));
    socket.isConnected = true;
    socket.connectionStatus = 'Connected';
    rerender(tree(user, jest.fn(), undefined, groupValue));
    await waitFor(() => expect(refreshGroups).toHaveBeenCalledTimes(2));
  });

  test('the load is aborted on logout', async () => {
    let signal;
    const refreshGroups = jest.fn(({ signal: s }) => {
      signal = s;
      return new Promise(() => {});
    });
    const groupValue = { groups: [], refreshGroups };
    const { rerender } = render(tree({ uid: 'U-ADMIN', token: 'tok' }, jest.fn(), undefined, groupValue));
    expect(refreshGroups).toHaveBeenCalledTimes(1);
    expect(signal.aborted).toBe(false);
    rerender(tree(null, jest.fn(), undefined, groupValue));
    expect(signal.aborted).toBe(true);
  });
});

import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  approveDeployRequest,
  cancelDeployRequest,
  deployNow,
  getDeployments,
  rejectDeployRequest,
  requestDeploy,
} from '../../../../api/github';
import theme from '../../../../theme/theme';
import { RealtimeContext } from '../../../realtime/RealtimeContext';
import DeployPanel from '../DeployPanel';

jest.mock('../../../../api/github', () => ({
  getDeployments: jest.fn(),
  deployNow: jest.fn(),
  requestDeploy: jest.fn(),
  approveDeployRequest: jest.fn(),
  rejectDeployRequest: jest.fn(),
  cancelDeployRequest: jest.fn(),
}));

const sha = (c) => c.repeat(40);
const REPO = { fullName: 'acme/app', htmlUrl: 'https://github.com/acme/app', defaultBranch: 'main' };
const ADMIN = 'U-ADMIN';
const MEMBER = 'U-MEMBER';
const deploy = (environment, c, extra = {}) => ({
  id: Math.random(),
  environment,
  sha: sha(c),
  shortSha: c.repeat(7),
  state: 'success',
  createdAt: '2026-10-09T10:00:00Z',
  finishedAt: '2026-10-09T10:01:00Z',
  url: environment === 'staging' ? 'https://acme.github.io/app/staging/' : 'https://acme.github.io/app/',
  logUrl: 'https://github.com/acme/app/actions/runs/1',
  requestedBy: environment === 'staging' ? null : 'ana',
  automatic: environment === 'staging',
  ...extra,
});
const DATA = {
  deploys: true,
  environments: {
    staging: { live: deploy('staging', 'b'), inProgress: null, lastFailed: null },
    production: { live: deploy('production', 'a'), inProgress: null, lastFailed: null },
  },
  history: [deploy('staging', 'b'), deploy('production', 'a'), deploy('production', 'c')],
  rollbackCandidates: [deploy('production', 'c')],
  requests: [],
};
const pendingRequest = (extra = {}) => ({
  requestId: 'R1',
  environment: 'production',
  versionSha: sha('b'),
  status: 'pending',
  requestedBy: MEMBER,
  requestedByUsername: 'beto',
  requestedAt: '2026-10-09T11:00:00Z',
  ...extra,
});

const listeners = new Set();
const realtime = { connected: true, epoch: 0, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };

const panel = ({ isAdmin = true, uid = ADMIN, connected = true, epoch = 0 } = {}) => (
  <ThemeProvider theme={theme}>
    <RealtimeContext.Provider value={{ ...realtime, connected, epoch }}>
      <DeployPanel gid="G1" repo={REPO} isAdmin={isAdmin} uid={uid} />
    </RealtimeContext.Provider>
  </ThemeProvider>
);
const renderPanel = (options) => render(panel(options));
const emit = (message) => act(() => listeners.forEach((fn) => fn(message)));
const apiError = (code) => Object.assign(new Error(code), { code });
// Staging moved to a newer version (what a live reload brings while a dialog is open).
const STAGING_MOVED = { ...DATA, environments: { ...DATA.environments, staging: { live: deploy('staging', 'd'), inProgress: null, lastFailed: null } } };

beforeEach(() => {
  listeners.clear();
  getDeployments.mockReset().mockResolvedValue(DATA);
  deployNow.mockReset().mockResolvedValue({ dispatched: true });
  requestDeploy.mockReset().mockResolvedValue(pendingRequest());
  approveDeployRequest.mockReset().mockResolvedValue(pendingRequest({ status: 'approved' }));
  rejectDeployRequest.mockReset().mockResolvedValue(pendingRequest({ status: 'rejected' }));
  cancelDeployRequest.mockReset().mockResolvedValue(pendingRequest({ status: 'cancelled' }));
});

describe('DeployPanel', () => {
  test('both environments with their live version, site and who deployed it', async () => {
    renderPanel();
    const staging = await screen.findByRole('region', { name: 'Entorno Staging' });
    expect(within(staging).getByText('En línea')).toBeInTheDocument();
    expect(within(staging).getByRole('link', { name: 'bbbbbbb' })).toHaveAttribute('href', `https://github.com/acme/app/commit/${sha('b')}`);
    expect(within(staging).getByText(/Automático al pasar el CI/)).toBeInTheDocument();
    expect(within(staging).getByRole('link', { name: 'https://acme.github.io/app/staging/' })).toBeInTheDocument();
    const production = screen.getByRole('region', { name: 'Entorno Producción' });
    expect(within(production).getByText('Pedido por ana')).toBeInTheDocument();
  });

  test('admin publishes the staging version in production', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Publicar en producción' }));
    const dialog = screen.getByRole('dialog', { name: 'Publicar en producción' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publicar' }));
    expect(await screen.findByText('Se está publicando bbbbbbb en producción.')).toBeInTheDocument();
    expect(deployNow).toHaveBeenCalledWith('G1', { environment: 'production', version: sha('b') });
  });

  test('a member asks for production instead; a pending request blocks a second one', async () => {
    const { unmount } = renderPanel({ isAdmin: false, uid: MEMBER });
    fireEvent.click(await screen.findByRole('button', { name: 'Solicitar producción' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Enviar solicitud' }));
    expect(await screen.findByText('Solicitud enviada a los administradores del grupo.')).toBeInTheDocument();
    expect(requestDeploy).toHaveBeenCalledWith('G1', { environment: 'production', version: sha('b') });
    expect(deployNow).not.toHaveBeenCalled();
    unmount();

    getDeployments.mockResolvedValue({ ...DATA, requests: [pendingRequest()] });
    renderPanel({ isAdmin: false, uid: 'U-OTHER' });
    expect(await screen.findByText('Hay una solicitud de producción pendiente.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Solicitar producción' })).not.toBeInTheDocument();
  });

  test('nothing to promote when production already runs the staging version', async () => {
    getDeployments.mockResolvedValue({ ...DATA, environments: { ...DATA.environments, production: { live: deploy('production', 'b') } } });
    renderPanel();
    expect(await screen.findByText('Producción ya tiene esta versión.')).toBeInTheDocument();
  });

  test('admins approve and reject requests (with a note)', async () => {
    getDeployments.mockResolvedValue({ ...DATA, requests: [pendingRequest()] });
    renderPanel();
    expect(await screen.findByText(/beto pidió publicar/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Aprobar y publicar' })).getByRole('button', { name: 'Aprobar' }));
    await waitFor(() => expect(approveDeployRequest).toHaveBeenCalledWith('G1', 'R1'));

    fireEvent.click(await screen.findByRole('button', { name: 'Rechazar' }));
    const dialog = screen.getByRole('dialog', { name: 'Rechazar solicitud' });
    fireEvent.change(within(dialog).getByLabelText('Motivo (opcional)'), { target: { value: '  falta QA ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rechazar' }));
    await waitFor(() => expect(rejectDeployRequest).toHaveBeenCalledWith('G1', 'R1', 'falta QA'));
    // The action finishes (notice, reload) before the test ends.
    expect(await screen.findByText('Solicitud rechazada.')).toBeInTheDocument();
  });

  test('the requester cancels their own request; others only see it', async () => {
    getDeployments.mockResolvedValue({ ...DATA, requests: [pendingRequest()] });
    const { unmount } = renderPanel({ isAdmin: false, uid: MEMBER });
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar solicitud' }));
    await waitFor(() => expect(cancelDeployRequest).toHaveBeenCalledWith('G1', 'R1'));
    unmount();
    renderPanel({ isAdmin: false, uid: 'U-OTHER' });
    await screen.findByText(/beto pidió publicar/);
    expect(screen.queryByRole('button', { name: 'Cancelar solicitud' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
  });

  test('admin rolls production back to a previous version', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Rollback…' }));
    const dialog = screen.getByRole('dialog', { name: 'Rollback de producción' });
    expect(within(dialog).getByRole('radio', { name: /ccccccc/ })).toBeChecked();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Volver a esta versión' }));
    expect(await screen.findByText('Producción vuelve a ccccccc.')).toBeInTheDocument();
    expect(deployNow).toHaveBeenCalledWith('G1', { environment: 'production', version: sha('c') });
  });

  test('members get no rollback; errors stay in the dialog', async () => {
    const { unmount } = renderPanel({ isAdmin: false, uid: MEMBER });
    await screen.findByRole('region', { name: 'Entorno Producción' });
    expect(screen.queryByRole('button', { name: 'Rollback…' })).not.toBeInTheDocument();
    unmount();

    deployNow.mockRejectedValue(Object.assign(new Error('x'), { code: 'VERSION_NOT_VERIFIED' }));
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Publicar en producción' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Publicar' }));
    expect(await within(screen.getByRole('dialog')).findByText(/no pasó el CI de TaskMate/)).toBeInTheDocument();
  });

  test('deploys in progress and failures are shown; the history opens on demand', async () => {
    getDeployments.mockResolvedValue({
      ...DATA,
      environments: {
        staging: { live: deploy('staging', 'b'), inProgress: null, lastFailed: deploy('staging', 'e', { state: 'failure' }) },
        production: { live: deploy('production', 'a'), inProgress: deploy('production', 'b', { state: 'in_progress' }), lastFailed: null },
      },
    });
    renderPanel();
    expect(await screen.findByText('Desplegando…')).toBeInTheDocument();
    expect(screen.getByText('Falló el último deploy')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Historial de deploys' }));
    expect(within(screen.getByRole('list', { name: 'Historial de deploys' })).getAllByRole('listitem')).toHaveLength(3);
  });

  test('admin: a live reload while the dialog is open does not change the version that gets published', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Publicar en producción' }));
    const dialog = screen.getByRole('dialog', { name: 'Publicar en producción' });
    expect(within(dialog).getByRole('link', { name: 'bbbbbbb' })).toBeInTheDocument();

    getDeployments.mockResolvedValue(STAGING_MOVED);
    emit({ type: 'event', event: 'deployment', gid: 'G1', data: { state: 'success', environment: 'staging' } });
    expect(await within(dialog).findByText(/Staging cambió a/)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'ddddddd' })).toBeInTheDocument();
    expect(within(dialog).getByText(/Esta acción usa bbbbbbb/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Publicar' }));
    expect(await screen.findByText('Se está publicando bbbbbbb en producción.')).toBeInTheDocument();
    expect(deployNow).toHaveBeenCalledWith('G1', { environment: 'production', version: sha('b') });
  });

  test('member: the request is for the version shown; if staging moved, the API refusal is explained and the panel reloads', async () => {
    requestDeploy.mockRejectedValue(apiError('VERSION_NOT_STAGING'));
    renderPanel({ isAdmin: false, uid: MEMBER });
    fireEvent.click(await screen.findByRole('button', { name: 'Solicitar producción' }));
    const dialog = screen.getByRole('dialog', { name: 'Solicitar producción' });
    getDeployments.mockResolvedValue(STAGING_MOVED);
    emit({ type: 'event', event: 'deployment', gid: 'G1', data: { state: 'success', environment: 'staging' } });
    await within(dialog).findByText(/Staging cambió a/);
    const calls = getDeployments.mock.calls.length;

    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar solicitud' }));
    expect(await within(dialog).findByText('Solo se puede pedir publicar en producción la versión que está en staging.')).toBeInTheDocument();
    expect(requestDeploy).toHaveBeenCalledWith('G1', { environment: 'production', version: sha('b') });
    await waitFor(() => expect(getDeployments.mock.calls.length).toBeGreaterThan(calls));
  });

  test('approving a request that went stale: the reason stays in the dialog and the list reloads', async () => {
    getDeployments.mockResolvedValue({ ...DATA, requests: [pendingRequest()] });
    approveDeployRequest.mockRejectedValue(apiError('DEPLOY_REQUEST_STALE'));
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Aprobar' }));
    const dialog = screen.getByRole('dialog', { name: 'Aprobar y publicar' });
    expect(within(dialog).getByText(/en producción\. Al aprobar/)).toBeInTheDocument();
    getDeployments.mockResolvedValue({ ...DATA, requests: [pendingRequest({ status: 'cancelled' })] });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Aprobar' }));
    expect(await within(dialog).findByText(/La solicitud quedó desactualizada/)).toBeInTheDocument();
    expect(await screen.findByText('Cancelada')).toBeInTheDocument();
  });

  test('request labels follow request.environment', async () => {
    getDeployments.mockResolvedValue({ ...DATA, requests: [pendingRequest({ environment: 'staging' })] });
    renderPanel();
    expect(await screen.findByText(/beto pidió publicar/)).toHaveTextContent('beto pidió publicar bbbbbbb en staging');
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Aprobar' }));
    expect(await screen.findByText('Solicitud aprobada: se está publicando en staging.')).toBeInTheDocument();
  });

  test('a deploy in progress is checked every 15 s without the live connection and every minute with it', async () => {
    jest.useFakeTimers();
    const deploying = {
      ...DATA,
      environments: { ...DATA.environments, production: { live: deploy('production', 'a'), inProgress: deploy('production', 'b', { state: 'in_progress' }), lastFailed: null } },
    };
    getDeployments.mockResolvedValue(deploying);
    const { unmount } = renderPanel({ connected: false });
    await screen.findByText('Desplegando…');
    await act(async () => {
      jest.advanceTimersByTime(15000);
    });
    await waitFor(() => expect(getDeployments).toHaveBeenCalledTimes(2));
    unmount();

    getDeployments.mockClear();
    renderPanel({ connected: true });
    await screen.findByText('Desplegando…');
    await act(async () => {
      jest.advanceTimersByTime(59000);
    });
    expect(getDeployments).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    await waitFor(() => expect(getDeployments).toHaveBeenCalledTimes(2));
    jest.useRealTimers();
  });

  test('a deploy started here is checked until its Deployment shows up, even if no event ever arrives', async () => {
    jest.useFakeTimers();
    renderPanel({ connected: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Publicar en producción' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Publicar' }));
    expect(await screen.findByText('Se está publicando bbbbbbb en producción.')).toBeInTheDocument();
    // The reload right after the action: the run is still queued, nothing in progress yet.
    await waitFor(() => expect(getDeployments).toHaveBeenCalledTimes(2));
    await screen.findByRole('button', { name: 'Publicar en producción' });

    await act(async () => {
      jest.advanceTimersByTime(60000);
    });
    await waitFor(() => expect(getDeployments).toHaveBeenCalledTimes(3));

    // Its Deployment appears (already finished here): the extra checks stop.
    const done = deploy('production', 'b', { id: 'new' });
    getDeployments.mockResolvedValue({
      ...DATA,
      environments: { ...DATA.environments, production: { live: done, inProgress: null, lastFailed: null } },
      history: [done, ...DATA.history],
    });
    await act(async () => {
      jest.advanceTimersByTime(60000);
    });
    await waitFor(() => expect(getDeployments).toHaveBeenCalledTimes(4));
    await screen.findByText('Producción ya tiene esta versión.');
    await act(async () => {
      jest.advanceTimersByTime(5 * 60000);
    });
    expect(getDeployments).toHaveBeenCalledTimes(4);
    jest.useRealTimers();
  });

  test('a deploy that never shows up is checked for 10 minutes at most (every 15 s without the live connection)', async () => {
    jest.useFakeTimers();
    getDeployments.mockResolvedValue({ ...DATA, requests: [pendingRequest()] });
    renderPanel({ connected: false });
    fireEvent.click(await screen.findByRole('button', { name: 'Aprobar' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Aprobar y publicar' })).getByRole('button', { name: 'Aprobar' }));
    await screen.findByText('Solicitud aprobada: se está publicando en producción.');
    await waitFor(() => expect(getDeployments).toHaveBeenCalledTimes(2));
    await act(async () => {
      jest.advanceTimersByTime(15000);
    });
    await waitFor(() => expect(getDeployments).toHaveBeenCalledTimes(3));

    await act(async () => {
      jest.advanceTimersByTime(10 * 60000);
    });
    const calls = getDeployments.mock.calls.length;
    await act(async () => {
      jest.advanceTimersByTime(60000);
    });
    expect(getDeployments).toHaveBeenCalledTimes(calls);
    jest.useRealTimers();
  });

  test('a member request starts no deploy: no extra checks', async () => {
    jest.useFakeTimers();
    renderPanel({ isAdmin: false, uid: MEMBER, connected: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Solicitar producción' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Enviar solicitud' }));
    await screen.findByText('Solicitud enviada a los administradores del grupo.');
    await waitFor(() => expect(getDeployments).toHaveBeenCalledTimes(2));
    await act(async () => {
      jest.advanceTimersByTime(2 * 60000);
    });
    expect(getDeployments).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  test('after a reconnection (not the first subscription) the environments reload to catch up', async () => {
    const { rerender } = render(panel({ epoch: 0 }));
    await screen.findByRole('region', { name: 'Entorno Staging' });
    // rerender runs the effects: a reload would already have called the API.
    rerender(panel({ epoch: 1 }));
    expect(getDeployments).toHaveBeenCalledTimes(1);
    rerender(panel({ epoch: 2 }));
    await waitFor(() => expect(getDeployments).toHaveBeenCalledTimes(2));
  });

  test('a deployment event reloads the environments; a pipeline without deploy renders nothing', async () => {
    jest.useFakeTimers();
    const { unmount } = renderPanel();
    await screen.findByRole('region', { name: 'Entorno Staging' });
    expect(getDeployments).toHaveBeenCalledTimes(1);
    act(() => listeners.forEach((fn) => fn({ type: 'event', event: 'deployment', gid: 'g1', data: { state: 'success' } })));
    await act(async () => {
      jest.advanceTimersByTime(900);
    });
    await waitFor(() => expect(getDeployments).toHaveBeenCalledTimes(2));
    jest.useRealTimers();
    unmount();

    getDeployments.mockResolvedValue({ deploys: false, environments: null, history: [], rollbackCandidates: [], requests: [] });
    const { container } = renderPanel();
    await waitFor(() => expect(getDeployments).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

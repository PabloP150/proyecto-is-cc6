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
const realtime = { connected: true, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };

const renderPanel = ({ isAdmin = true, uid = ADMIN } = {}) =>
  render(
    <ThemeProvider theme={theme}>
      <RealtimeContext.Provider value={realtime}>
        <DeployPanel gid="G1" repo={REPO} isAdmin={isAdmin} uid={uid} />
      </RealtimeContext.Provider>
    </ThemeProvider>
  );

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

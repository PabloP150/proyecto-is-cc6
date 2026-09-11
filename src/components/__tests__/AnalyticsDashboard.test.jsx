import { render, screen } from '@testing-library/react';
import { api } from '../../api/client';
import AnalyticsDashboard from '../AnalyticsDashboard';
import { GroupContext } from '../GroupContext';

jest.mock('../../api/client', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), del: jest.fn() },
  errorMessage: (err, fallback) => err?.message || fallback,
  getAuthToken: () => 'jwt',
}));
jest.mock('../../hooks/useWebSocket', () => ({
  __esModule: true,
  default: () => ({ sendMessage: () => true, isConnected: false, error: null, connect: () => {} }),
}));

const renderDashboard = () =>
  render(
    <GroupContext.Provider value={{ selectedGroupId: 'g1', selectedGroupName: 'Grupo' }}>
      <AnalyticsDashboard />
    </GroupContext.Provider>
  );

describe('AnalyticsDashboard — leader-only access', () => {
  it('shows a friendly "solo líderes" state instead of an error for non-leaders', async () => {
    api.get.mockRejectedValue(Object.assign(new Error('Only group leaders can view analytics'), { status: 403, code: 'NOT_GROUP_ADMIN' }));
    renderDashboard();
    expect(await screen.findByText('Solo líderes del equipo')).toBeInTheDocument();
    expect(screen.queryByText('Only group leaders can view analytics')).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/api/analytics/dashboard/g1', expect.any(Object));
  });

  it('still reports other errors', async () => {
    api.get.mockRejectedValue(Object.assign(new Error('Servidor ocupado'), { status: 503, code: 'DB_BUSY' }));
    renderDashboard();
    expect(await screen.findByText(/Servidor ocupado/)).toBeInTheDocument();
    expect(screen.queryByText('Solo líderes del equipo')).not.toBeInTheDocument();
  });
});

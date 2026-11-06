import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const member = (username, roles) => ({
  username, roles, role: roles.length ? roles.join(', ') : 'N/A',
  current_workload: 1, capacity: 3, utilization: 33.33, status: 'light',
});
const dashboard = (members) => ({
  success: true,
  data: {
    team_analytics: { team_members: [] },
    workload_distribution: { workload_distribution: members },
    expertise_rankings: { expertise_rankings: {} },
  },
});
const TEAM = [member('ana', ['Backend', 'QA']), member('beto', ['Frontend']), member('caro', [])];

const roleFilter = () => screen.getByRole('combobox', { name: 'Filter by role' });
const optionLabels = () => within(roleFilter()).getAllByRole('option').map(option => option.textContent);
const chooseRole = (label) =>
  fireEvent.change(roleFilter(), { target: { value: within(roleFilter()).getByRole('option', { name: label }).value } });
const shownMembers = () => ['ana', 'beto', 'caro', 'dani'].filter(name => screen.queryByText(name));

describe('AnalyticsDashboard — role filter', () => {
  it('offers the roles the members really hold, plus "No role", instead of a fixed list', async () => {
    api.get.mockResolvedValue(dashboard(TEAM));
    renderDashboard();
    await screen.findByText('ana');
    expect(optionLabels()).toEqual(['All Roles', 'Backend', 'Frontend', 'QA', 'No role']);
    expect(screen.queryByRole('option', { name: 'Product Manager' })).not.toBeInTheDocument();
  });

  it('leaves "No role" out when every member has a role', async () => {
    api.get.mockResolvedValue(dashboard([member('ana', ['QA']), member('beto', ['Frontend'])]));
    renderDashboard();
    await screen.findByText('ana');
    expect(optionLabels()).toEqual(['All Roles', 'Frontend', 'QA']);
  });

  it('selecting a role shows the members holding it, also when they hold several', async () => {
    api.get.mockResolvedValue(dashboard(TEAM));
    renderDashboard();
    await screen.findByText('ana');
    expect(shownMembers()).toEqual(['ana', 'beto', 'caro']);
    expect(screen.getByText('Backend, QA')).toBeInTheDocument();

    chooseRole('QA');
    expect(shownMembers()).toEqual(['ana']);
    chooseRole('Frontend');
    expect(shownMembers()).toEqual(['beto']);
    chooseRole('All Roles');
    expect(shownMembers()).toEqual(['ana', 'beto', 'caro']);
  });

  it('"No role" shows the members without a role', async () => {
    api.get.mockResolvedValue(dashboard(TEAM));
    renderDashboard();
    await screen.findByText('ana');

    chooseRole('No role');
    expect(shownMembers()).toEqual(['caro']);
    // caro's own label in the chart, next to the option
    expect(screen.getAllByText('No role')).toHaveLength(2);
  });

  it('a role named like a special option does not clash with it', async () => {
    api.get.mockResolvedValue(dashboard([member('ana', ['all']), member('beto', ['none']), member('caro', [])]));
    renderDashboard();
    await screen.findByText('ana');

    chooseRole('none');
    expect(shownMembers()).toEqual(['beto']);
    chooseRole('all');
    expect(shownMembers()).toEqual(['ana']);
  });

  it('resets the selection when the group changes', async () => {
    api.get.mockResolvedValueOnce(dashboard(TEAM)).mockResolvedValueOnce(dashboard([...TEAM, member('dani', ['QA'])]));
    const { rerender } = renderDashboard();
    await screen.findByText('ana');
    chooseRole('QA');
    expect(shownMembers()).toEqual(['ana']);

    rerender(
      <GroupContext.Provider value={{ selectedGroupId: 'g2', selectedGroupName: 'Otro' }}>
        <AnalyticsDashboard />
      </GroupContext.Provider>
    );
    await screen.findByText('dani');
    expect(api.get).toHaveBeenLastCalledWith('/api/analytics/dashboard/g2', expect.any(Object));
    expect(roleFilter()).toHaveDisplayValue('All Roles');
    expect(shownMembers()).toEqual(['ana', 'beto', 'caro', 'dani']);
  });

  it('resets the selection when the selected role is gone after a refresh', async () => {
    api.get.mockResolvedValueOnce(dashboard(TEAM)).mockResolvedValueOnce(dashboard([member('ana', ['Backend']), member('beto', ['Frontend'])]));
    renderDashboard();
    await screen.findByText('ana');
    chooseRole('QA');

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(optionLabels()).toEqual(['All Roles', 'Backend', 'Frontend']));
    expect(roleFilter()).toHaveDisplayValue('All Roles');
    expect(shownMembers()).toEqual(['ana', 'beto']);
  });
});

describe('AnalyticsDashboard — local fallback recommendations', () => {
  it('a member without a role gets no "No role expertise" copy (the socket is down)', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    api.get.mockResolvedValue(dashboard([
      member('ana', ['Backend', 'QA']),
      { ...member('caro', []), current_workload: 0, utilization: 0, status: 'available' },
    ]));
    renderDashboard();
    await screen.findByText('ana');

    fireEvent.change(screen.getByPlaceholderText('Describe the task you need to assign...'), { target: { value: 'Fix login' } });
    fireEvent.click(screen.getByRole('button', { name: 'Get Recommendations' }));

    const reasons = await screen.findAllByText(/is currently at/);
    // The freest member comes first: caro (0 %), then ana
    expect(reasons.map(reason => reason.textContent)).toEqual([
      'caro is currently at 0% capacity (0/3 tasks) with strong availability for new assignments.',
      'ana is currently at 33.33% capacity (1/3 tasks) with strong availability for new assignments. Their Backend, QA expertise aligns well with project requirements.',
    ]);
    // Only ana's card has an expertise line («Expertise: Backend, QA»); "Backend, QA" is also her bar label
    expect(screen.getAllByText('Expertise:')).toHaveLength(1);
    expect(screen.getAllByText('Backend, QA')).toHaveLength(2);
    console.error.mockRestore();
  });
});

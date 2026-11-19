import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../../api/client';
import { GroupContext } from '../GroupContext';
import GroupsView from '../GroupsView';

jest.mock('../../api/client', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), del: jest.fn() },
  errorMessage: (err, fallback) => err?.message || fallback,
}));

// SQL Server returns uppercase GUIDs; a group created in this session is stored lowercase.
const GROUP = { gid: 'ABCD-1234', name: 'Equipo Web', adminId: 'USER-1' };

const mountGroups = (overrides = {}) => {
  const value = {
    selectedGroupId: 'abcd-1234',
    setSelectedGroupId: jest.fn(),
    setSelectedGroupName: jest.fn(),
    groups: [GROUP],
    setGroups: jest.fn(),
    refreshGroups: jest.fn().mockResolvedValue([GROUP]),
    ...overrides,
  };
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <GroupContext.Provider value={value}>
        <GroupsView />
      </GroupContext.Provider>
    </MemoryRouter>
  );
  return value;
};

describe('GroupsView — ids compared case-insensitively', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('userId', 'user-1');
    localStorage.setItem('selectedGroupId', 'abcd-1234');
    localStorage.setItem('showGroupDetails', '1');
    api.get.mockImplementation((path) => {
      if (path.endsWith('/members')) return Promise.resolve({ members: [{ uid: 'USER-1', username: 'ana' }] });
      return Promise.resolve({ roles: [], data: [] });
    });
  });

  it('keeps a lowercase stored selection that matches an uppercase group', async () => {
    const ctx = mountGroups();
    await waitFor(() => expect(ctx.setSelectedGroupId).toHaveBeenCalledWith('ABCD-1234'));
    expect(ctx.setSelectedGroupId).not.toHaveBeenCalledWith(null);
    expect(localStorage.getItem('showGroupDetails')).toBe('1');
    expect(await screen.findByRole('heading', { name: 'Equipo Web' })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/api/groups/ABCD-1234/members');
  });

  it('recognises the admin when the stored uid has a different case', async () => {
    mountGroups();
    expect(await screen.findByText('ana')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'New Role' })).toBeInTheDocument();
  });
});

describe('GroupsView — clicking a group', () => {
  const OTHER = { gid: 'EFGH-5678', name: 'Equipo Móvil', adminId: 'USER-2' };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('userId', 'user-1');
    api.get.mockImplementation((path) => {
      if (path.endsWith('/members')) return Promise.resolve({ members: [{ uid: 'USER-2', username: 'beto' }] });
      return Promise.resolve({ roles: [], data: [] });
    });
  });

  it('has no USE button: a click makes it the current group and shows its members', async () => {
    const ctx = mountGroups({
      selectedGroupId: null,
      groups: [GROUP, OTHER],
      refreshGroups: jest.fn().mockResolvedValue([GROUP, OTHER]),
    });
    expect(screen.queryByRole('button', { name: 'Use' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Equipo Móvil' }));
    expect(ctx.setSelectedGroupId).toHaveBeenCalledWith('EFGH-5678');
    expect(ctx.setSelectedGroupName).toHaveBeenCalledWith('Equipo Móvil');
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/groups/EFGH-5678/members'));
  });
});

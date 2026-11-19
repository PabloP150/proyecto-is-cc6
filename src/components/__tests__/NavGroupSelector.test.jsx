import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GroupContext } from '../GroupContext';
import NavGroupSelector from '../NavGroupSelector';

const GROUPS = [{ gid: 'G1', name: 'Equipo Web' }, { gid: 'G2', name: 'Equipo Móvil' }];

const renderSelector = (overrides = {}) => {
  const ctx = {
    selectedGroupId: 'G1',
    selectedGroupName: 'Equipo Web',
    groups: GROUPS,
    setSelectedGroupId: jest.fn(),
    setSelectedGroupName: jest.fn(),
    refreshGroups: jest.fn().mockResolvedValue(GROUPS),
    ...overrides,
  };
  render(
    <MemoryRouter>
      <GroupContext.Provider value={ctx}>
        <NavGroupSelector />
      </GroupContext.Provider>
    </MemoryRouter>
  );
  return ctx;
};

describe('NavGroupSelector', () => {
  it('shows the current group and switches to another one', () => {
    const ctx = renderSelector();
    const button = screen.getByRole('button', { name: /Current group: Equipo Web/ });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Equipo Móvil' }));
    expect(ctx.setSelectedGroupId).toHaveBeenCalledWith('G2');
    expect(ctx.setSelectedGroupName).toHaveBeenCalledWith('Equipo Móvil');
  });

  it('asks to pick a group when none is selected', () => {
    renderSelector({ selectedGroupId: null, selectedGroupName: '' });
    expect(screen.getByRole('button', { name: /Select a group/ })).toBeInTheDocument();
  });
});

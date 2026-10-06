import { act, render, screen } from '@testing-library/react';
import { useContext } from 'react';
import { api } from '../../api/client';
import { GroupContext, GroupProvider } from '../GroupContext';

jest.mock('../../api/client', () => ({
  api: { get: jest.fn() },
}));

let ctx;
const Probe = () => {
  ctx = useContext(GroupContext);
  return <div data-testid="group">{`${ctx.selectedGroupId ?? 'none'}|${ctx.selectedGroupName}`}</div>;
};

const renderProvider = () => render(<GroupProvider><Probe /></GroupProvider>);

describe('GroupContext', () => {
  beforeEach(() => {
    localStorage.clear();
    ctx = null;
  });

  it('restores the selected group from localStorage on the first render', () => {
    localStorage.setItem('selectedGroupId', 'g-42');
    localStorage.setItem('selectedGroupName', 'Proyecto X');

    renderProvider();

    expect(screen.getByTestId('group')).toHaveTextContent('g-42|Proyecto X');
  });

  it('starts empty when nothing is stored', () => {
    renderProvider();
    expect(screen.getByTestId('group')).toHaveTextContent('none|');
  });

  it('keeps localStorage in sync with the selection and clears it', () => {
    renderProvider();

    act(() => {
      ctx.setSelectedGroupId('g-7');
      ctx.setSelectedGroupName('Equipo');
    });
    expect(localStorage.getItem('selectedGroupId')).toBe('g-7');
    expect(localStorage.getItem('selectedGroupName')).toBe('Equipo');

    act(() => ctx.clearGroupState());
    expect(localStorage.getItem('selectedGroupId')).toBeNull();
    expect(localStorage.getItem('selectedGroupName')).toBeNull();
    expect(screen.getByTestId('group')).toHaveTextContent('none|');
  });

  it('refreshGroups loads the current user groups into the context', async () => {
    localStorage.setItem('userId', 'u-1');
    api.get.mockResolvedValue({ groups: [{ gid: 'g1', name: 'Uno' }] });
    renderProvider();

    let list;
    await act(async () => { list = await ctx.refreshGroups(); });

    expect(api.get).toHaveBeenCalledWith('/api/groups/user-groups?uid=u-1', { signal: undefined });
    expect(list).toEqual([{ gid: 'g1', name: 'Uno' }]);
    expect(ctx.groups).toEqual([{ gid: 'g1', name: 'Uno' }]);
  });
});

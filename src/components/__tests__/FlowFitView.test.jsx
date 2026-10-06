import { render, waitFor } from '@testing-library/react';
import { api } from '../../api/client';
import Flow from '../flow/Flow';
import { GroupContext } from '../GroupContext';

jest.mock('../../api/client', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), del: jest.fn() },
  errorMessage: (err, fallback) => err?.message || fallback,
}));

// Records the props and mounts of the canvas; React Flow itself needs layout APIs jsdom lacks.
const mockCanvas = { mounts: 0, props: null };
jest.mock('@xyflow/react', () => {
  const React = require('react');
  const ReactFlow = (props) => {
    mockCanvas.props = props;
    React.useEffect(() => { mockCanvas.mounts += 1; }, []);
    return React.createElement('div', { 'data-testid': 'canvas' }, props.children);
  };
  return {
    __esModule: true,
    ReactFlow,
    Background: () => null,
    Controls: () => null,
    Handle: () => null,
    ConnectionMode: { Loose: 'loose' },
    MarkerType: { ArrowClosed: 'arrowclosed' },
    Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
    addEdge: (edge, edges) => [...edges, edge],
    applyEdgeChanges: (changes, edges) => edges,
    applyNodeChanges: (changes, nodes) => nodes,
  };
});

const node = (nid, y) => ({ nid, name: nid, description: '', date: '2026-10-20', completed: 0, percentage: 0, x_pos: 0, y_pos: y });

const renderFlow = (gid) => (
  <GroupContext.Provider value={{ selectedGroupId: gid, selectedGroupName: gid }}>
    <Flow handleNodeEdit={jest.fn()} setSelectedNode={jest.fn()} />
  </GroupContext.Provider>
);

describe('Milestone Planner viewport', () => {
  beforeEach(() => {
    mockCanvas.mounts = 0;
    mockCanvas.props = null;
    api.get.mockImplementation((url) => {
      if (url.startsWith('/api/nodes/group/')) return Promise.resolve({ data: [node('n1', 0), node('n2', 997)] });
      return Promise.resolve({ data: [] });
    });
  });

  it('fits the loaded milestones without zooming past 100 %', async () => {
    render(renderFlow('g1'));

    await waitFor(() => expect(mockCanvas.props.nodes).toHaveLength(2));
    expect(mockCanvas.props.fitView).toBe(true);
    expect(mockCanvas.props.fitViewOptions).toEqual(expect.objectContaining({ maxZoom: 1 }));
  });

  it('starts a fresh canvas for another group so it fits again', async () => {
    const { rerender } = render(renderFlow('g1'));
    await waitFor(() => expect(mockCanvas.props.nodes).toHaveLength(2));
    expect(mockCanvas.mounts).toBe(1);

    rerender(renderFlow('g2'));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/nodes/group/g2', expect.anything()));
    expect(mockCanvas.mounts).toBe(2);
  });
});

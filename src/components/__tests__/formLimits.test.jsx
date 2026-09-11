import { fireEvent, render, screen } from '@testing-library/react';
import { api } from '../../api/client';
import { LIMITS } from '../../constants/limits';
import Dialogos from '../Dialogos';
import Flow from '../flow/Flow';
import { GroupContext } from '../GroupContext';
import GroupRolesPanel from '../GroupRolesPanel';
import RoleForm from '../RoleForm';

jest.mock('../../api/client', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), del: jest.fn() },
  errorMessage: (err, fallback) => err?.message || fallback,
}));

// React Flow needs layout APIs jsdom lacks; a pass-through mock is enough to reach the form.
jest.mock('@xyflow/react', () => {
  const React = require('react');
  const Pass = ({ children }) => React.createElement('div', null, children);
  return {
    __esModule: true,
    ReactFlow: Pass,
    Background: () => null,
    Controls: () => null,
    Handle: () => null,
    EdgeLabelRenderer: Pass,
    ConnectionMode: { Loose: 'loose' },
    MarkerType: { ArrowClosed: 'arrowclosed' },
    Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
    addEdge: (edge, edges) => [...edges, edge],
    applyEdgeChanges: (changes, edges) => edges,
    applyNodeChanges: (changes, nodes) => nodes,
    getStraightPath: () => [''],
    getBezierPath: () => ['', 0, 0],
    useInternalNode: () => null,
  };
});

const baseDialogProps = {
  openRecordatorio: true,
  handleCloseRecordatorio: jest.fn(),
  openLista: false,
  handleCloseLista: jest.fn(),
  handleSubmitRecordatorio: jest.fn(),
  handleCreateList: jest.fn(),
  nombre: '',
  setNombre: jest.fn(),
  descripcion: '',
  setDescripcion: jest.fn(),
  fecha: '',
  setFecha: jest.fn(),
  hora: '',
  setHora: jest.fn(),
  nombreLista: '',
  setNombreLista: jest.fn(),
  listaSeleccionada: '',
  setListaSeleccionada: jest.fn(),
  listas: [{ nombre: 'Trabajo', recordatorios: [] }],
  recordatorioEditar: null,
  setRecordatorioEditar: jest.fn(),
  openEditar: false,
  setOpenEditar: jest.fn(),
  handleSubmitEditar: jest.fn(),
  handleCloseEditar: jest.fn(),
};

describe('form length limits (mirror the server validation)', () => {
  it('caps task name (25) and description (1000) with a counter', () => {
    render(<Dialogos {...baseDialogProps} nombre="Informe" />);
    expect(screen.getByLabelText(/Task Name/)).toHaveAttribute('maxLength', String(LIMITS.taskName));
    expect(screen.getByLabelText(/Description/)).toHaveAttribute('maxLength', String(LIMITS.taskDescription));
    expect(screen.getByText('7/25')).toBeInTheDocument();
    expect(screen.getByText('0/1000')).toBeInTheDocument();
  });

  it('caps the list name (25) and the edited task fields', () => {
    render(
      <Dialogos
        {...baseDialogProps}
        openRecordatorio={false}
        openLista
        openEditar
        recordatorioEditar={{ tid: 't1', name: 'abc', description: '', list: 'Trabajo', percentage: 0, datetime: '2026-09-20T10:00' }}
      />
    );
    expect(screen.getByLabelText('List Name')).toHaveAttribute('maxLength', String(LIMITS.listName));
    const editName = screen.getAllByLabelText(/Task Name/).find((el) => el.id === 'nombreEditar');
    expect(editName).toHaveAttribute('maxLength', String(LIMITS.taskName));
    expect(screen.getByText('3/25')).toBeInTheDocument();
  });

  it('caps the role name at 40 characters', () => {
    render(<RoleForm onSubmit={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByLabelText(/Name/)).toHaveAttribute('maxLength', String(LIMITS.roleName));
    expect(screen.getByText('0/40')).toBeInTheDocument();
  });

  it('shows the server validation message when saving a role fails', async () => {
    api.get.mockResolvedValue({ roles: [] });
    const createRole = jest.fn().mockRejectedValue(Object.assign(new Error('gr_name must be at most 40 characters'), { code: 'VALIDATION_ERROR' }));
    render(<GroupRolesPanel groupId="g1" isLeader roles={[]} createRole={createRole} loading={false} error={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'New Role' }));
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'Líder' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('gr_name must be at most 40 characters')).toBeInTheDocument();
  });

  it('caps the milestone name at 25 characters in the flow editor', async () => {
    // Loads stay pending: only the form matters here.
    api.get.mockReturnValue(new Promise(() => {}));
    render(
      <GroupContext.Provider value={{ selectedGroupId: 'g1', selectedGroupName: 'Grupo' }}>
        <Flow handleNodeEdit={jest.fn()} setSelectedNode={jest.fn()} />
      </GroupContext.Provider>
    );
    expect(await screen.findByLabelText('Milestone name')).toHaveAttribute('maxLength', String(LIMITS.nodeName));
  });
});

import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen } from '@testing-library/react';
import theme from '../../../theme/theme';
import RepoPlanCard from '../RepoPlanCard';

const XSS = '<img src=x onerror=alert(1)>';

const makeMessage = (overrides = {}) => ({
  type: 'repo_plan',
  requestId: 'r1',
  planId: 'plan-1',
  groupId: 'G1',
  groupName: 'Equipo Web',
  expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  content: 'Plan en texto plano',
  plan: {
    summary: 'Resumen **sin** markdown',
    milestones: [{ key: 'm1', name: 'MVP', description: 'Primera entrega', target_date: '2026-10-15' }],
    tasks: [
      { name: XSS, description: 'desc 1', milestone_key: 'm1', due_date: '2026-10-01', category: 'frontend' },
      { name: 'Configurar CI', description: 'desc 2', milestone_key: null, due_date: '2026-10-05', category: 'testing' },
    ],
  },
  ...overrides,
});

const renderCard = (props) =>
  render(
    <ThemeProvider theme={theme}>
      <RepoPlanCard message={makeMessage()} onConfirm={jest.fn()} onDiscard={jest.fn()} {...props} />
    </ThemeProvider>
  );

afterEach(() => {
  jest.useRealTimers();
});

describe('RepoPlanCard', () => {
  it('renders the plan as plain text, grouped by milestone, with counts', () => {
    renderCard();
    expect(screen.getByText(XSS)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Sobre el repositorio')).toBeInTheDocument();
    expect(screen.getByText('Resumen **sin** markdown')).toBeInTheDocument();
    expect(screen.queryByText('sin', { selector: 'strong' })).not.toBeInTheDocument();
    expect(screen.getByText('MVP')).toBeInTheDocument();
    expect(screen.getByText('Sin hito')).toBeInTheDocument();
    expect(screen.getByText('Frontend')).toBeInTheDocument();
    expect(screen.getByText('Pruebas')).toBeInTheDocument();
    expect(screen.getByText('2 tareas · 1 hito')).toBeInTheDocument();
    expect(screen.getByText(/Plan propuesto para «Equipo Web»/)).toBeInTheDocument();
  });

  it('fires onConfirm once with the planId even on double click', () => {
    const onConfirm = jest.fn();
    renderCard({ onConfirm });
    const button = screen.getByRole('button', { name: 'Confirmar' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('plan-1', expect.objectContaining({ planId: 'plan-1' }));
    expect(screen.getByRole('button', { name: /Confirmar/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Descartar/ })).toBeDisabled();
  });

  it('re-enables the buttons when the send fails (handler returns false)', () => {
    const onDiscard = jest.fn(() => false);
    renderCard({ onDiscard });
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeEnabled();
  });

  it('is disabled while busy and unlocks after busy ends', () => {
    const onConfirm = jest.fn();
    const { rerender } = renderCard({ busy: true, onConfirm });
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeDisabled();

    rerender(
      <ThemeProvider theme={theme}>
        <RepoPlanCard message={makeMessage()} onConfirm={onConfirm} onDiscard={jest.fn()} busy={false} />
      </ThemeProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('shows "Plan expirado" and disables actions for an expired plan', () => {
    const onConfirm = jest.fn();
    renderCard({ message: makeMessage({ expiresAt: new Date(Date.now() - 1000).toISOString() }), onConfirm });
    expect(screen.getByText('Plan expirado')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Confirmar' });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('expires while open', () => {
    jest.useFakeTimers();
    renderCard({ message: makeMessage({ expiresAt: new Date(Date.now() + 5000).toISOString() }) });
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeEnabled();
    act(() => {
      jest.advanceTimersByTime(6000);
    });
    expect(screen.getByText('Plan expirado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
  });

  it('renders a compact read-only summary once saved', () => {
    renderCard({ message: makeMessage({ status: 'saved', created: { tasks: 2, milestones: 1 } }) });
    expect(screen.getByTestId('repo-plan-compact')).toHaveTextContent('Plan guardado en «Equipo Web»: 2 tareas creadas y 1 hito.');
    expect(screen.queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
    expect(screen.getByText(XSS)).toBeInTheDocument();
  });

  it('renders the discarded variant via the status prop', () => {
    renderCard({ status: 'discarded' });
    expect(screen.getByTestId('repo-plan-compact')).toHaveTextContent('Plan descartado (2 tareas propuestas).');
  });

  it('falls back to the plain-text content when the plan is missing', () => {
    renderCard({ message: makeMessage({ plan: null, content: '# Título <b>x</b>' }) });
    expect(screen.getByText('# Título <b>x</b>')).toBeInTheDocument();
  });
});

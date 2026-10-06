import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, within } from '@testing-library/react';
import theme from '../../../theme/theme';
import ChatProjectSelector from '../ChatProjectSelector';

const GROUPS = [
  { gid: 'AAA-1', name: 'Equipo Web' },
  { gid: 'BBB-2', name: 'Equipo Móvil' },
];

const renderSelector = (props) =>
  render(
    <ThemeProvider theme={theme}>
      <ChatProjectSelector groups={GROUPS} value={null} onChange={jest.fn()} {...props} />
    </ThemeProvider>
  );

const openMenu = () => fireEvent.mouseDown(screen.getByRole('combobox'));

describe('ChatProjectSelector', () => {
  it('defaults to "Nuevo proyecto (sin contexto)" and shows no repo chip', () => {
    renderSelector();
    expect(screen.getByRole('combobox')).toHaveTextContent('Nuevo proyecto (sin contexto)');
    expect(screen.queryByText('Sin repositorio')).not.toBeInTheDocument();
  });

  it('calls onChange with the gid of the chosen group', () => {
    const onChange = jest.fn();
    renderSelector({ onChange });
    openMenu();
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Equipo Móvil'));
    expect(onChange).toHaveBeenCalledWith('BBB-2');
  });

  it('calls onChange(null) for a new project', () => {
    const onChange = jest.fn();
    renderSelector({ value: 'AAA-1', onChange });
    openMenu();
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Nuevo proyecto (sin contexto)'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('matches the value case-insensitively and shows the repository chip', () => {
    renderSelector({ value: 'aaa-1', repo: { fullName: 'acme/web', defaultBranch: 'main' } });
    expect(screen.getByRole('combobox')).toHaveTextContent('Equipo Web');
    expect(screen.getByText('acme/web')).toBeInTheDocument();
  });

  it('shows "Sin repositorio" when the selected group has none', () => {
    renderSelector({ value: 'BBB-2', repo: null });
    expect(screen.getByText('Sin repositorio')).toBeInTheDocument();
  });
});

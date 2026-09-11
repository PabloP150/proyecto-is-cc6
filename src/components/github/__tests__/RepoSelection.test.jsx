import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getSelection, linkRepository } from '../../../api/github';
import theme from '../../../theme/theme';
import RepoSelection from '../RepoSelection';

jest.mock('../../../api/github', () => ({ getSelection: jest.fn(), linkRepository: jest.fn() }));

const SELECTION = {
  gid: 'G1',
  repos: [
    { repoId: 11, fullName: 'acme/web', isPrivate: true },
    { repoId: 22, fullName: 'acme/api', isPrivate: false },
  ],
};

const renderSelection = (props) =>
  render(
    <ThemeProvider theme={theme}>
      <RepoSelection selectionId="sel-1" groups={[{ gid: 'g1', name: 'Equipo Web' }]} onLinked={jest.fn()} onCancel={jest.fn()} {...props} />
    </ThemeProvider>
  );

beforeEach(() => {
  getSelection.mockReset();
  linkRepository.mockReset();
});

describe('RepoSelection', () => {
  it('lists the repositories and links the chosen one', async () => {
    getSelection.mockResolvedValue(SELECTION);
    const linked = { repoId: 22, fullName: 'acme/api' };
    linkRepository.mockResolvedValue(linked);
    const onLinked = jest.fn();
    renderSelection({ onLinked });

    expect(await screen.findByText('acme/web')).toBeInTheDocument();
    expect(getSelection).toHaveBeenCalledWith('sel-1', expect.any(Object));
    expect(screen.getByText(/al grupo «Equipo Web»/)).toBeInTheDocument();
    expect(screen.getByText('Privado')).toBeInTheDocument();
    expect(screen.getByText('Público')).toBeInTheDocument();

    const submit = screen.getByRole('button', { name: 'Vincular repositorio' });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /acme\/api/ }));
    fireEvent.click(submit);

    await waitFor(() => expect(onLinked).toHaveBeenCalledWith(linked, 'G1'));
    expect(linkRepository).toHaveBeenCalledWith('G1', { selectionId: 'sel-1', repoId: 22 });
  });

  it('shows which GitHub account is connecting', async () => {
    getSelection.mockResolvedValue({ ...SELECTION, githubLogin: 'octocat' });
    renderSelection();
    expect(await screen.findByText('Conectando como @octocat')).toBeInTheDocument();
  });

  it('explains an expired selection', async () => {
    getSelection.mockRejectedValue(Object.assign(new Error('404'), { code: 'SELECTION_NOT_FOUND', status: 404 }));
    const onCancel = jest.fn();
    renderSelection({ onCancel });

    expect(await screen.findByText(/La selección de repositorios expiró/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Vincular repositorio' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('handles a selection that expires while choosing', async () => {
    getSelection.mockResolvedValue(SELECTION);
    linkRepository.mockRejectedValue(Object.assign(new Error('404'), { code: 'SELECTION_NOT_FOUND', status: 404 }));
    renderSelection();
    fireEvent.click(await screen.findByRole('radio', { name: /acme\/web/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Vincular repositorio' }));
    expect(await screen.findByText(/La selección de repositorios expiró/)).toBeInTheDocument();
  });

  it('shows other link errors inline', async () => {
    getSelection.mockResolvedValue(SELECTION);
    linkRepository.mockRejectedValue(Object.assign(new Error('403'), { code: 'NOT_GROUP_ADMIN', status: 403 }));
    renderSelection();
    fireEvent.click(await screen.findByRole('radio', { name: /acme\/web/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Vincular repositorio' }));
    expect(await screen.findByText('Solo el administrador del grupo puede hacer esto.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vincular repositorio' })).toBeEnabled();
  });
});

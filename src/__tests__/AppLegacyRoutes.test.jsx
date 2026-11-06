import { render, screen, waitFor } from '@testing-library/react';
import App from '../App';

jest.mock('../components/HomePage', () => ({ __esModule: true, default: () => <div>Inicio (mock)</div> }));
jest.mock('../components/Login', () => ({ __esModule: true, default: () => <div>Login (mock)</div> }));
jest.mock('../components/Register', () => ({ __esModule: true, default: () => <div>Registro (mock)</div> }));
jest.mock('../components/BlockDiagram', () => ({ __esModule: true, default: () => <div>Hitos (mock)</div> }));
jest.mock('../components/GroupsView', () => ({ __esModule: true, default: () => <div>Grupos (mock)</div> }));

const startAt = (path, { loggedIn }) => {
  sessionStorage.setItem('sessionStarted', 'true');
  localStorage.clear();
  if (loggedIn) {
    localStorage.setItem('user', JSON.stringify({ uid: 'u1', name: 'ana', token: 'jwt' }));
    localStorage.setItem('token', 'jwt');
    localStorage.setItem('userId', 'u1');
  }
  window.history.pushState({}, '', path);
};

describe('App — register and old addresses', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('a visitor without a session can open the sign-up page', async () => {
    startAt('/register', { loggedIn: false });
    render(<App />);
    expect(await screen.findByText('Registro (mock)')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/register');
  });

  it('a logged-in user who opens /register goes to /home', async () => {
    startAt('/register', { loggedIn: true });
    render(<App />);
    expect(await screen.findByText('Inicio (mock)')).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe('/home'));
    expect(screen.queryByText('Registro (mock)')).not.toBeInTheDocument();
  });

  it('/flow opens the milestones page, where the graph lives', async () => {
    startAt('/flow', { loggedIn: true });
    render(<App />);
    expect(await screen.findByText('Hitos (mock)')).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe('/block-diagram'));
  });

  it('/create-group opens Groups, where groups are created', async () => {
    startAt('/create-group', { loggedIn: true });
    render(<App />);
    expect(await screen.findByText('Grupos (mock)')).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe('/groups'));
  });

  it('the old addresses still send a visitor without a session to the login', async () => {
    for (const path of ['/flow', '/create-group']) {
      startAt(path, { loggedIn: false });
      const { unmount } = render(<App />);
      expect(await screen.findByText('Login (mock)')).toBeInTheDocument();
      expect(window.location.pathname).toBe('/');
      unmount();
    }
  });
});

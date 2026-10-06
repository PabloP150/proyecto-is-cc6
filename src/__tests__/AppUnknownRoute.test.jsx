import { render, screen, waitFor } from '@testing-library/react';
import App from '../App';

jest.mock('../components/HomePage', () => ({
  __esModule: true,
  default: () => <div>Inicio (mock)</div>,
}));
jest.mock('../components/Login', () => ({
  __esModule: true,
  default: () => <div>Login (mock)</div>,
}));

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

describe('App — unknown routes', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('sends a logged-in user to /home instead of an empty page', async () => {
    startAt('/milestones', { loggedIn: true });
    render(<App />);
    expect(await screen.findByText('Inicio (mock)')).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe('/home'));
  });

  it('sends a visitor without a session to the login', async () => {
    startAt('/milestones/2026', { loggedIn: false });
    render(<App />);
    expect(await screen.findByText('Login (mock)')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    expect(screen.queryByText('Inicio (mock)')).not.toBeInTheDocument();
  });

  it('replaces the unknown URL so Back does not return to it', async () => {
    startAt('/home', { loggedIn: true });
    window.history.pushState({}, '', '/nope');
    const lengthBefore = window.history.length;
    render(<App />);
    expect(await screen.findByText('Inicio (mock)')).toBeInTheDocument();
    expect(window.history.length).toBe(lengthBefore);
  });
});

import { render, screen } from '@testing-library/react';
import App from '../App';

jest.mock('../components/github/GitHubPage', () => ({
  __esModule: true,
  default: () => <div>Página GitHub (mock)</div>,
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

describe('App — /github route', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('lazily renders the GitHub page and shows the navbar item for a logged-in user', async () => {
    startAt('/github', { loggedIn: true });
    render(<App />);
    expect(await screen.findByText('Página GitHub (mock)')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'GitHub' })).toHaveAttribute('href', '/github');
  });

  it('redirects to the login when there is no session', async () => {
    startAt('/github', { loggedIn: false });
    render(<App />);
    expect(await screen.findByText('Login (mock)')).toBeInTheDocument();
    expect(screen.queryByText('Página GitHub (mock)')).not.toBeInTheDocument();
  });
});

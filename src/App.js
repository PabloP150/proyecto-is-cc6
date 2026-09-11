import { lazy, Suspense, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, Route, BrowserRouter as Router, Routes, useNavigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { UNAUTHORIZED_EVENT } from './api/client';
import { GroupContext, GroupProvider } from './components/GroupContext';
import { ThemeProvider } from './theme';

const AnalyticsDashboard = lazy(() => import('./components/AnalyticsDashboard'));
const BlockDiagram = lazy(() => import('./components/BlockDiagram'));
const CalendarView = lazy(() => import('./components/CalendarView'));
const ChatPage = lazy(() => import('./components/ChatPage'));
const CreateGroup = lazy(() => import('./components/CreateGroup'));
const Flow = lazy(() => import('./components/flow/Flow'));
const GitHubPage = lazy(() => import('./components/github/GitHubPage'));
const GroupsView = lazy(() => import('./components/GroupsView'));
const HomePage = lazy(() => import('./components/HomePage'));
const Login = lazy(() => import('./components/Login'));
const Navbar = lazy(() => import('./components/Navbar'));
const Recordatorios = lazy(() => import('./components/Recordatorios'));
const Register = lazy(() => import('./components/Register'));

const SESSION_KEYS = ['user', 'token', 'userId', 'selectedGroupId', 'selectedGroupName', 'showGroupDetails'];

const clearStoredSession = () => {
  try {
    SESSION_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Storage unavailable: nothing persisted to clear.
  }
};

// Runs before GroupProvider reads storage, so a brand-new browser session starts logged out
// and a reload in the same tab keeps both the user and the selected group.
const restoreSession = () => {
  try {
    if (!sessionStorage.getItem('sessionStarted')) {
      sessionStorage.setItem('sessionStarted', 'true');
      clearStoredSession();
      return null;
    }
    const storedUser = localStorage.getItem('user');
    return storedUser ? JSON.parse(storedUser) : null;
  } catch {
    return null;
  }
};

const PageLoader = () => (
  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
    <CircularProgress />
  </Box>
);

function AppRoutes({ user, setUser }) {
  const navigate = useNavigate();
  const { clearGroupState } = useContext(GroupContext);

  const handleLogin = useCallback((userData) => {
    setUser(userData);
    localStorage.setItem('user', JSON.stringify(userData));
  }, [setUser]);

  const handleLogout = useCallback(() => {
    setUser(null);
    clearStoredSession();
    clearGroupState();
  }, [setUser, clearGroupState]);

  useEffect(() => {
    const onUnauthorized = () => {
      handleLogout();
      navigate('/', { replace: true });
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [handleLogout, navigate]);

  return (
    <Suspense fallback={<PageLoader />}>
      {user && <Navbar user={user} onLogout={handleLogout} />}
      <Routes>
        <Route path="/" element={user ? <Navigate to="/home" /> : <Login onLogin={handleLogin} />} />
        <Route path="/register" element={<Register />} />
        <Route path="/home" element={user ? <HomePage /> : <Navigate to="/" />} />
        <Route path="/calendar" element={user ? <CalendarView /> : <Navigate to="/" />} />
        <Route path="/block-diagram" element={user ? <BlockDiagram className='block-diagram' /> : <Navigate to="/" />} />
        <Route path="/flow" element={user ? <Flow /> : <Navigate to="/" />} />
        <Route path="/tasks" element={user ? <Recordatorios /> : <Navigate to="/" />} />
        <Route path="/create-group" element={user ? <CreateGroup /> : <Navigate to="/" />} />
        <Route path="/groups" element={user ? <GroupsView /> : <Navigate to="/" />} />
        <Route path="/chat" element={user ? <ChatPage /> : <Navigate to="/" />} />
        <Route path="/analytics" element={user ? <AnalyticsDashboard /> : <Navigate to="/" />} />
        <Route path="/github" element={user ? <GitHubPage /> : <Navigate to="/" />} />
      </Routes>
    </Suspense>
  );
}

function App() {
  const [user, setUser] = useState(restoreSession);

  return (
    <ThemeProvider>
      <GroupProvider>
        <Router>
            {/* Animated Background Layer */}
            <Box
              sx={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: -2,
                background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)',
              }}
            />

            {/* Simple Radial Gradient Overlays */}
            <Box
              sx={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: -1,
                background: `
                  radial-gradient(circle at 20% 80%, rgba(59, 130, 246, 0.2) 0%, transparent 50%),
                  radial-gradient(circle at 80% 20%, rgba(245, 158, 11, 0.15) 0%, transparent 50%)
                `,
              }}
            />
            <AppRoutes user={user} setUser={setUser} />
        </Router>
      </GroupProvider>
    </ThemeProvider>
  );
}

export default App;

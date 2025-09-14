import { useEffect, useState } from 'react';
import { Navigate, Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import { ReactFlowProvider } from 'reactflow';
import BlockDiagram from './components/BlockDiagram';
import CalendarView from './components/CalendarView';
import ChatPage from './components/ChatPage';
import CreateGroup from './components/CreateGroup';
import Flow from './components/flow/Flow';
import { GroupProvider } from './components/GroupContext';
import GroupsView from './components/GroupsView';
import HomePage from './components/HomePage';
import Login from './components/Login';
import Navbar from './components/Navbar'; // Asegúrate de tener este componente
import Recordatorios from './components/Recordatorios';
import Register from './components/Register';
import WebSocketTest from './components/WebSocketTest';
import { ThemeProvider } from './theme';
import ThemeTest from './theme/ThemeTest';

function App() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    // Queremos: mostrar login al abrir la app desde cero (nuevo proceso),
    // pero SI el usuario ya inició sesión y solo recarga (F5 / navegación interna), conservarla.
    // Usamos sessionStorage como bandera de proceso vivo.

    const sessionFlag = sessionStorage.getItem('sessionStarted');

    if (!sessionFlag) {
      // Nuevo arranque del proceso: no conservar sesión previa.
      localStorage.removeItem('user');
      localStorage.removeItem('selectedGroupId');
      sessionStorage.setItem('sessionStarted', 'true');
      setUser(null);
      return;
    }

    // En recarga (sessionFlag ya existe) intentamos restaurar usuario.
    try {
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        setUser(JSON.parse(storedUser));
      }
    } catch (e) {
      console.warn('No se pudo restaurar la sesión:', e);
    }
  }, []);

  const handleLogin = (userData) => {
    setUser(userData);
    localStorage.setItem('user', JSON.stringify(userData));
  };


  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('user');
    localStorage.removeItem('selectedGroupId');
    // Al hacer logout dejamos la bandera para que el usuario pueda volver a loguearse sin reiniciar el proceso.
  };

  return (
    <ThemeProvider>
      <GroupProvider>
        <ReactFlowProvider>
          <Router>
            {user && <Navbar user={user} onLogout={handleLogout} />}
            <Routes>
              <Route path="/" element={user ? <Navigate to="/home" /> : <Login onLogin={handleLogin} />} />
              <Route path="/register" element={<Register />} />
              <Route
                path="/home"
                element={user ? <HomePage /> : <Navigate to="/" />}
              />
              <Route
                path="/calendar"
                element={user ? <CalendarView /> : <Navigate to="/" />}
              />
              <Route
                path="/block-diagram"
                element={user ? <BlockDiagram className='block-diagram' /> : <Navigate to="/" />}
              />
              <Route
                path="/flow"
                element={user ? <Flow /> : <Navigate to="/" />}
              />
              <Route
                path="/tasks"
                element={user ? <Recordatorios /> : <Navigate to="/" />}
              />
              <Route
                path="/create-group"
                element={user ? <CreateGroup /> : <Navigate to="/" />}
              />
              <Route
                path="/groups"
                element={user ? <GroupsView /> : <Navigate to="/" />}
              />
              <Route
                path="/chat"
                element={user ? <ChatPage /> : <Navigate to="/" />}
              />
              <Route
                path="/websocket-test"
                element={<WebSocketTest />}
              />
              <Route
                path="/theme-test"
                element={<ThemeTest />}
              />
            </Routes>
          </Router>
        </ReactFlowProvider>
      </GroupProvider>
    </ThemeProvider>
  );
}

export default App;

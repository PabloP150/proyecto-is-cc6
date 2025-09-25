import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import { ReactFlowProvider } from 'reactflow';
import { ThemeProvider } from './theme';
import { Box } from '@mui/material';
import Login from './components/Login';
import CalendarView from './components/CalendarView';
import BlockDiagram from './components/BlockDiagram';
import HomePage from './components/HomePage';
import Flow from './components/flow/Flow';
import Recordatorios from './components/Recordatorios';
import Register from './components/Register';
import CreateGroup from './components/CreateGroup';
import Navbar from './components/Navbar'; // Asegúrate de tener este componente
import GroupsView from './components/GroupsView';
import ChatPage from './components/ChatPage';
import WebSocketTest from './components/WebSocketTest';
import ThemeTest from './theme/ThemeTest';
import { GroupProvider } from './components/GroupContext';

function App() {
  const [user, setUser] = useState(null);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [selectedGroupName, setSelectedGroupName] = useState('');

  useEffect(() => {
    const isFirstVisit = localStorage.getItem('isFirstVisit');

    if (!isFirstVisit) {
      // Si es la primera visita, elimina el usuario y establece la bandera
      localStorage.removeItem('user');
      localStorage.setItem('isFirstVisit', 'true');
    } else {
      // Si no es la primera visita, carga el usuario almacenado
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        setUser(JSON.parse(storedUser));
      }
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
    setSelectedGroupId(null);
    setSelectedGroupName('');
  };

  return (
    <ThemeProvider>
      <GroupProvider>
        <ReactFlowProvider>
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

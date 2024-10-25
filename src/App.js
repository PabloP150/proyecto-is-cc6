import React from 'react';
import Login from './components/Login';
import Recordatorios from './components/Recordatorios';
import Register from './components/Register';
import CreateGroup from './components/CreateGroup';
import Home from './components/Home'; // Importa el nuevo componente
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/home" element={<Home />} />
        <Route path="/recordatorios" element={<Recordatorios />} />
        <Route path="/register" element={<Register />} />
        <Route path="/create-group" element={<CreateGroup />} />
      </Routes>
    </Router>
  );
}

export default App;

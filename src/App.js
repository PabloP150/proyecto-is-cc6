import React from 'react';
import Login from './components/Login';
import Recordatorios from './components/Recordatorios';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';

function App() {
  return (
    <Router>
      <>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/recordatorios" element={<Recordatorios />} />
        </Routes>
      </>
    </Router>
  );
}

export default App;

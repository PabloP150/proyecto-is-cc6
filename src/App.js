import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { ReactFlowProvider } from 'reactflow';
import './App.css';
import Login from './components/Login';
import TaskList from './components/TaskList';
import CalendarView from './components/CalendarView';
import BlockDiagram from './components/BlockDiagram';
import HomePage from './components/HomePage';
import Flow from './components/flow/Flow';
import Recordatorios from './components/Recordatorios';
import Register from './components/Register';
import CreateGroup from './components/CreateGroup';

function App() {
  return (
    <ReactFlowProvider>
      <Router>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<Login />} />
          <Route path="/tasks" element={<TaskList />} />
          <Route path="/calendar" element={<CalendarView />} />
          <Route path="/block-diagram" element={<BlockDiagram className='block-diagram' />} />
          <Route path="/flow" element={<Flow />} />
          <Route path="/recordatorios" element={<Recordatorios />} />
          <Route path="/register" element={<Register />} />
          <Route path="/create-group" element={<CreateGroup />} />
        </Routes>
      </Router>
    </ReactFlowProvider>
  );
}

export default App;

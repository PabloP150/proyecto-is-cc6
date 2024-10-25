import React, { useState, useCallback } from "react";
import './Flow.css'
import { ReactFlow, Controls, Background, applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import CustomNode from './CustomNode';

const Flow = () => {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [nodeData, setNodeData] = useState({
    name: '',
    description: '',
    datetime: '',
    completed: false
  });

  const onNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );

  const onEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  const onConnect = useCallback(
    (params) => setEdges((eds) => [...eds, { ...params, id: `e${eds.length + 1}` }]),
    []
  );

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setNodeData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const toggleCompletion = useCallback((nodeId) => {
    setNodes((prevNodes) =>
      prevNodes.map((node) => {
        if (node.id === nodeId) {
          const updatedNode = {
            ...node,
            data: {
              ...node.data,
              completed: !node.data.completed,
              toggleCompletion // Make sure to keep the function reference
            }
          };
          return updatedNode;
        }
        return node;
      })
    );
  }, []);

  const addNode = () => {
    const newNode = {
      id: `${nodes.length + 1}`,
      type: 'custom',
      data: { 
        ...nodeData,
        id: `${nodes.length + 1}`, // Add the ID to the data object
        completed: false, // Explicitly set initial completed state
        toggleCompletion
      },
      position: { x: Math.random() * 400, y: Math.random() * 400 },
    };
    setNodes((prevNodes) => [...prevNodes, newNode]);
    // Reset form
    setNodeData({
      name: '',
      description: '',
      assignee: '',
      priority: '',
      completed: false
    });
  };

  const nodeTypes = {
    custom: CustomNode,  // Change this from 'textUpdater' to 'custom'
  };

  return (
    <div className='flow'>
      <div style={{ 
        marginBottom: '10px', 
        display: 'flex', 
        gap: '10px', 
        alignItems: 'center',
        flexWrap: 'wrap'
      }}>
        <input
          type="text"
          name="name"
          value={nodeData.name}
          onChange={handleInputChange}
          placeholder="Enter task name"
          style={{
            padding: '5px',
            borderRadius: '4px',
            border: '1px solid #ccc',
            backgroundColor: '#333',
            color: 'white'
          }}
        />
        <input
          type="text"
          name="description"
          value={nodeData.description}
          onChange={handleInputChange}
          placeholder="Enter description"
          style={{
            padding: '5px',
            borderRadius: '4px',
            border: '1px solid #ccc',
            backgroundColor: '#333',
            color: 'white'
          }}
        />
        <input
          type="datetime-local"
          name="datetime"
          value={nodeData.datetime}
          onChange={handleInputChange}
          style={{
            padding: '5px',
            borderRadius: '4px',
            border: '1px solid #ccc',
            backgroundColor: '#333',
            color: 'white'
          }}
        />
        <button onClick={addNode}>
          Add Task
        </button>
      </div>
      <ReactFlow 
        nodes={nodes} 
        edges={edges} 
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        colorMode="dark"
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
};

export default Flow;

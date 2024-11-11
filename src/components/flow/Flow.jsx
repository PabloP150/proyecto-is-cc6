import React, { useState, useCallback, useEffect } from "react";
import './Flow.css'
import {
  ReactFlow,
  Controls,
  Background,
  applyNodeChanges,
  addEdge,
  applyEdgeChanges,
  MarkerType,
  ConnectionMode
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import CustomNode from './CustomNode';
import CustomConnectionLine from './CustomConnectionLine';
import FloatingEdge from './FloatingEdge';

const Flow = ({ handleNodeEdit, setSelectedNode }) => {
  const [tasks, setTasks] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [nodeData, setNodeData] = useState({
    name: '',
    description: '',
    date: '',
    completed: false,
    setSelectedNode
  });

  const gid = "00000000-0000-0000-0000-000000000001";   // Cambiar a localStorage cuando funcionen grupos

  function formatDateTimeToDate(datetime) {
    const date = new Date(datetime);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  useEffect(() => {
    const loadNodesAndEdges = async () => {
      try {
        const nodesResponse = await fetch(`http://localhost:9000/api/nodes/group/${gid}`);
        const edgesResponse = await fetch(`http://localhost:9000/api/edges/group/${gid}`);

        if (nodesResponse.ok && edgesResponse.ok) {
          const nodesData = await nodesResponse.json();
          const edgesData = await edgesResponse.json();

          const formattedNodes = nodesData.data.map(node => ({
            id: node.nid,
            type: 'custom',
            data: {
              name: node.name,
              description: node.description,
              date: node.date,
              completed: node.completed == 1,
              toggleCompletion,
              onClick: () => handleNodeEdit(node),
              setSelectedNode
            },
            position: { x: node.x_pos, y: node.y_pos },
          }));
          console.log(formattedNodes);
          const formattedEdges = edgesData.data.map(edge => ({
            id: edge.eid,
            source: edge.sourceId,
            target: edge.targetId
          }));

          setNodes(formattedNodes);
          setEdges(formattedEdges);
        }
      } catch (error) {
        console.error('Error loading nodes and edges:', error);
      }
    };

    loadNodesAndEdges();
  }, []);

  useEffect(() => {
    const getTasks = async () => {
      try {
        const response = await fetch('http://localhost:9000/api/tasks');
        if (response.ok) {
          const data = await response.json();
          setTasks(data.data);
        }
      } catch (error) {
        console.error(error);
      }
    };
    getTasks();
  }, []);

  const handleImportTask = async (task) => {
    // Import task data into a new node
    try {
      const response = await fetch('http://localhost:9000/api/nodes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nid: task.tid,
          gid: task.gid,
          name: task.name,
          description: task.description,
          date: formatDateTimeToDate(task.datetime),
          completed: 0,
          x_pos: 10,
          y_pos: 10
        }),
      });
      if (response.ok) {
        const data = await response.json();
        const newNode = {
          id: data.data.nid,
          type: 'custom',
          data: {
            id: data.data.nid,
            name: data.data.name,
            description: data.data.description,
            date: data.data.date,
            completed: false,
            toggleCompletion,
            onClick: () => handleNodeEdit(data.data),
          },
          position: { x: data.data.x_pos, y: data.data.y_pos },
        };
        
        setNodes((prevNodes) => [...prevNodes, newNode]);

      } else {
        const errorData = await response.json();
        console.error('Error creating node:', errorData.error);
      }
    } catch (error) {
      console.error('Error in the request:', error);
    }
  };

  const addNode = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch('http://localhost:9000/api/nodes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          gid: gid,
          name: nodeData.name,
          description: nodeData.description,
          date: nodeData.date,
          completed: 0,
          x_pos: 10,
          y_pos: 10
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const newNode = {
          id: data.data.nid,
          type: 'custom',
          data: {
            ...nodeData,
            id: data.data.nid,
            completed: false,
            toggleCompletion,
          },
          position: { x: data.data.x_pos, y: data.data.y_pos },
        };
        setNodes((prevNodes) => [...prevNodes, newNode]);

        // Reset form
        setNodeData({
          name: '',
          description: '',
          date: '',
          completed: 0,
          x_pos: 10,
          y_pos: 10
        });
      } else {
        const errorData = await response.json();
        console.error('Error creating node:', errorData.error);
      }
    } catch (error) {
      console.error('Error in the request:', error);
    }
  };

  const onNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );

  //node change in db
  const onNodeDragStop = async (event, node) => {
    try {
      await fetch(`http://localhost:9000/api/nodes/${node.id}/coords`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nid: node.id,
          x_pos: node.position.x,
          y_pos: node.position.y
        }),
      });
    } catch (error) {
      console.error('Error updating node:', error);
    }
  }

  const onEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []);

  const onConnect = useCallback(async (params) => {
    try {
      const response = await fetch('http://localhost:9000/api/edges', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          gid: gid,
          sourceId: params.source,
          targetId: params.target
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setEdges((eds) =>
          addEdge(
            {
              ...params,
              id: data.data.eid,
              type: 'floating',
              markerEnd: { type: MarkerType.ArrowClosed },
            },
            eds,
          ),
        );
      }
    } catch (error) {
      console.error('Error saving edge:', error);
    }
  }, []);

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

  const onNodesDelete = async (event) => {
    try {
      const response1 = await fetch(`http://localhost:9000/api/edges/source/${event[0].id}`, {
        method: 'DELETE',
      });

      if (response1.ok) {
        const response2 = await fetch(`http://localhost:9000/api/nodes/${event[0].id}`, {
          method: 'DELETE',
        });
        if (response2.ok) {
          console.log('Node deleted successfully');
        }
      }
    } catch (error) {
      console.error('Error deleting node:', error);
    }
  };

  const onEdgesDelete = async (event) => {
    try {
      const response = await fetch(`http://localhost:9000/api/edges/${event[0].id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        console.log('Edge deleted successfully');
      } else {
        console.error('Error deleting edge:', response.status);
      }
    } catch (error) {
      console.error('Error deleting edge:', error);
    }
  };

  const nodeTypes = {
    custom: CustomNode,
  };

  const edgeTypes = {
    floating: FloatingEdge,
  };

  const defaultEdgeOptions = {
    style: { strokeWidth: 3, stroke: 'darkgray' },
    type: 'floating',
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: 'darkgray',
    },
  };

  const connectionLineStyle = {
    strokeWidth: 3,
    stroke: 'darkgray',
  };

  return (
    <div className='flow'>
      <div style={{
        display: 'flex',
        flexDirection: 'row',
        width: '100%',
        gap: '10px',
        alignItems: 'center',
        flexWrap: 'wrap',
        marginTop: '-0.3em',
        marginBottom: '0.3em'
      }}>
        <input
          type="text"
          name="name"
          value={nodeData.name}
          onChange={handleInputChange}
          placeholder="Enter milestone name"
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
          type="date"
          name="date"
          value={nodeData.date}
          onChange={handleInputChange}
          style={{
            padding: '5px',
            borderRadius: '4px',
            border: '1px solid #ccc',
            backgroundColor: '#333',
            color: 'white'
          }}
        />
        <button
          className="add-milestone-button"
          onClick={addNode}
        >
          Add Milestone
        </button>
        <div className="dropdown">
          <button
            className="dropdown-button"
            onClick={() => setShowDropdown(!showDropdown)}
          >
            Import Task
          </button>
          {showDropdown && tasks.length > 0 && (
            <ul className="dropdown-menu">
              {(tasks).map((task) => (
                <li key={task.id}>
                  <button
                    className="dropdown-item"
                    onClick={() => {
                      handleImportTask(task);
                      setShowDropdown(false);
                    }}
                  >
                    {task.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        connectionLineComponent={CustomConnectionLine}
        connectionLineStyle={connectionLineStyle}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onNodesDelete={onNodesDelete}
        onEdgesChange={onEdgesChange}
        onEdgesDelete={onEdgesDelete}
        onConnect={onConnect}
        connectionMode={ConnectionMode.Loose}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
};

export default Flow;

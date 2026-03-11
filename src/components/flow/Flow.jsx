import {
    addEdge,
    applyEdgeChanges,
    applyNodeChanges,
    Background,
    ConnectionMode,
    Controls,
    MarkerType,
    ReactFlow
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useContext, useEffect, useState } from "react";
import { API_BASE } from '../../config';
import { GroupContext } from '../GroupContext';
import CustomConnectionLine from './CustomConnectionLine';
import CustomNode from './CustomNode';
import FloatingEdge from './FloatingEdge';
import './Flow.css';

const NODE_TYPES = { custom: CustomNode };
const EDGE_TYPES = { floating: FloatingEdge };
const DEFAULT_EDGE_OPTIONS = {
  style: { strokeWidth: 3, stroke: 'darkgray' },
  type: 'floating',
  markerEnd: { type: MarkerType.ArrowClosed, color: 'darkgray' },
};
const CONNECTION_LINE_STYLE = { strokeWidth: 3, stroke: 'darkgray' };

const formatDateTimeToDate = (datetime) => {
  const date = new Date(datetime);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
};

const Flow = ({ handleNodeEdit, setSelectedNode }) => {
  const { selectedGroupId } = useContext(GroupContext);
  const [refresh, setRefresh] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [nodeData, setNodeData] = useState({
    name: '',
    description: '',
    date: '',
    completed: false,
    percentage: 0,
    setSelectedNode,
    refresh: refresh,
    setRefresh
  });   // Cambiar a localStorage cuando funcionen grupos

  // Declarar toggleCompletion antes de los efectos que lo referencian
  const toggleCompletion = useCallback((nodeId) => {
    setNodes((prevNodes) =>
      prevNodes.map((node) => {
        if (node.id === nodeId) {
          return {
            ...node,
            data: {
              ...node.data,
              completed: !node.data.completed,
              toggleCompletion
            }
          };
        }
        return node;
      })
    );
  }, []); // setNodes es estable

  const refreshNodes = useCallback(() => setRefresh(prev => !prev), []);

  useEffect(() => {
    if (!selectedGroupId) {
      // limpiar si se des-selecciona
      setNodes([]);
      setEdges([]);
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    const loadNodesAndEdges = async () => {
      try {
        const [nodesResponse, edgesResponse] = await Promise.all([
          fetch(`${API_BASE}/api/nodes/group/${selectedGroupId}`, { signal }),
          fetch(`${API_BASE}/api/edges/group/${selectedGroupId}`, { signal }),
        ]);

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
              completed: node.completed === 1,
              percentage: node.percentage,
              toggleCompletion,
              onClick: () => handleNodeEdit(node),
              setSelectedNode,
              refresh: refresh,
              setRefresh
            },
            position: { x: node.x_pos, y: node.y_pos },
          }));
          const formattedEdges = edgesData.data.map(edge => ({
            id: edge.eid,
            type: 'floating',
            source: edge.sourceId,
            target: edge.targetId,
            markerEnd: { type: MarkerType.ArrowClosed, color: 'darkgray' },
            data: {
              prerequisite: edge.prerequisite,
              refreshNodes,
            }
          }));

          setNodes(formattedNodes);
          setEdges(formattedEdges);
        }
      } catch (error) {
        if (error.name !== 'AbortError') console.error('Error loading nodes and edges:', error);
      }
    };
    loadNodesAndEdges();
    return () => controller.abort();
  }, [refresh, selectedGroupId, handleNodeEdit, setSelectedNode, toggleCompletion, refreshNodes]);

  useEffect(() => {
    if (!selectedGroupId) {
      setTasks([]);
      return;
    }
    const controller = new AbortController();
    fetch(`${API_BASE}/api/tasks?gid=${selectedGroupId}`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => setTasks(data.data))
      .catch(err => { if (err?.name !== 'AbortError') console.error(err); });
    return () => controller.abort();
  }, [selectedGroupId]);

  const handleImportTask = async (task) => {
    try {
      const response = await fetch(`${API_BASE}/api/nodes`, {
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
          percentage: task.percentage,
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
            percentage: data.data.percentage,
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
      const response = await fetch(`${API_BASE}/api/nodes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          gid: selectedGroupId,
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
            onClick: () => handleNodeEdit(data.data)
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
  const onNodeDragStop = useCallback(async (event, node) => {
    try {
      await fetch(`${API_BASE}/api/nodes/${node.id}/coords`, {
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
  }, []);

  const onEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []);

  const onConnect = useCallback(async (params) => {
    try {
      const response = await fetch(`${API_BASE}/api/edges`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          gid: selectedGroupId,
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
              data: { prerequisite: true, refreshNodes: () => setRefresh(prev => !prev) },
            },
            eds,
          ),
        );
      }
    } catch (error) {
      console.error('Error saving edge:', error);
    }
  }, [selectedGroupId]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setNodeData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // toggleCompletion ya declarado arriba

  const onNodesDelete = async (event) => {
    try {
      const response1 = await fetch(`${API_BASE}/api/edges/source/${event[0].id}`, {
        method: 'DELETE',
      });

      if (response1.ok) {
        await fetch(`${API_BASE}/api/nodes/${event[0].id}`, {
          method: 'DELETE',
        });
        // Node deleted successfully (log eliminado)
      }
    } catch (error) {
      console.error('Error deleting node:', error);
    }
  };

  const onEdgesDelete = async (event) => {
    try {
      const response = await fetch(`${API_BASE}/api/edges/${event[0].id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        // Edge deleted successfully (log eliminado)
      } else {
        console.error('Error deleting edge:', response.status);
      }
    } catch (error) {
      console.error('Error deleting edge:', error);
    }
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
        {(() => {
          const missingGroup = !selectedGroupId;
          const missingName = !nodeData.name?.trim();
          const missingDate = !nodeData.date;
          const disabled = missingGroup || missingName || missingDate;
          let label = 'Add Milestone';
          if (missingGroup) label = 'Select a group first';
          else if (missingName) label = 'Name required';
          else if (missingDate) label = 'Date required';
          return (
            <button
              className="add-milestone-button"
              onClick={addNode}
              disabled={disabled}
              title={disabled ? 'Complete group, name and date to enable' : 'Create milestone'}
              style={disabled ? {
                opacity: 0.45,
                cursor: 'not-allowed',
                filter: 'grayscale(40%)',
                transition: 'opacity .2s'
              } : { transition: 'opacity .2s' }}
            >
              {label}
            </button>
          );
        })()}
        <div className="dropdown">
          <button
            className="dropdown-button"
            onClick={() => setShowDropdown(prev => !prev)}
          >
            Import Task
          </button>
          {showDropdown && tasks.length > 0 && (
            <ul className="dropdown-menu">
              {(tasks).map((task) => (
                <li key={task.tid}>
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
      {!selectedGroupId && (
        <div style={{color: 'white', padding: '1rem'}}>Selecciona un grupo para ver y crear milestones.</div>
      )}
      {selectedGroupId && <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
        connectionLineComponent={CustomConnectionLine}
        connectionLineStyle={CONNECTION_LINE_STYLE}
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
      </ReactFlow>}
    </div>
  );
};

export default Flow;

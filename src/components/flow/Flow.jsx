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
import { Alert, Snackbar } from '@mui/material';
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, errorMessage } from '../../api/client';
import { LIMITS } from '../../constants/limits';
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
// React Flow fits once, when the loaded nodes are first measured; the canvas is keyed by group so
// switching groups fits again. maxZoom 1 keeps a lone milestone from being blown up.
const FIT_VIEW_OPTIONS = { padding: 0.2, maxZoom: 1 };

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
  const [errorMsg, setErrorMsg] = useState('');
  const notifyError = useCallback((err, fallback) => setErrorMsg(errorMessage(err, fallback)), []);
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
        const [nodesData, edgesData] = await Promise.all([
          api.get(`/api/nodes/group/${selectedGroupId}`, { signal }),
          api.get(`/api/edges/group/${selectedGroupId}`, { signal }),
        ]);

        const formattedNodes = (nodesData?.data || []).map(node => ({
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
            onError: notifyError,
            setSelectedNode,
            refresh: refresh,
            setRefresh
          },
          position: { x: node.x_pos, y: node.y_pos },
        }));
        const formattedEdges = (edgesData?.data || []).map(edge => ({
          id: edge.eid,
          type: 'floating',
          source: edge.sourceId,
          target: edge.targetId,
          markerEnd: { type: MarkerType.ArrowClosed, color: 'darkgray' },
          data: {
            prerequisite: edge.prerequisite,
            refreshNodes,
            onError: notifyError,
          }
        }));

        setNodes(formattedNodes);
        setEdges(formattedEdges);
      } catch (error) {
        if (error.name !== 'AbortError') notifyError(error, 'Could not load the milestones');
      }
    };
    loadNodesAndEdges();
    return () => controller.abort();
  }, [refresh, selectedGroupId, handleNodeEdit, setSelectedNode, toggleCompletion, refreshNodes, notifyError]);

  useEffect(() => {
    if (!selectedGroupId) {
      setTasks([]);
      return;
    }
    const controller = new AbortController();
    api.get(`/api/tasks?gid=${selectedGroupId}`, { signal: controller.signal })
      .then(data => setTasks(data?.data || []))
      .catch(err => { if (err?.name !== 'AbortError') notifyError(err, 'Could not load the tasks to import'); });
    return () => controller.abort();
  }, [selectedGroupId, notifyError]);

  const handleImportTask = async (task) => {
    try {
      const data = await api.post('/api/nodes', {
        nid: task.tid,
        gid: task.gid,
        name: task.name,
        description: task.description,
        date: formatDateTimeToDate(task.datetime),
        completed: 0,
        percentage: task.percentage,
        x_pos: 10,
        y_pos: 10
      });
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
          onError: notifyError,
        },
        position: { x: data.data.x_pos, y: data.data.y_pos },
      };

      setNodes((prevNodes) => [...prevNodes, newNode]);
    } catch (error) {
      notifyError(error, 'Could not import the task');
    }
  };

  const addNode = async (e) => {
    e.preventDefault();
    try {
      const data = await api.post('/api/nodes', {
        gid: selectedGroupId,
        name: nodeData.name,
        description: nodeData.description,
        date: nodeData.date,
        completed: 0,
        x_pos: 10,
        y_pos: 10
      });
      const newNode = {
        id: data.data.nid,
        type: 'custom',
        data: {
          ...nodeData,
          id: data.data.nid,
          completed: false,
          toggleCompletion,
          onClick: () => handleNodeEdit(data.data),
          onError: notifyError,
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
    } catch (error) {
      notifyError(error, 'Could not create the milestone');
    }
  };

  const onNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );

  //node change in db
  const onNodeDragStop = useCallback(async (event, node) => {
    try {
      await api.put(`/api/nodes/${node.id}/coords`, {
        nid: node.id,
        x_pos: node.position.x,
        y_pos: node.position.y
      });
    } catch (error) {
      notifyError(error, 'Could not save the milestone position');
    }
  }, [notifyError]);

  const onEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []);

  const onConnect = useCallback(async (params) => {
    try {
      const data = await api.post('/api/edges', {
        gid: selectedGroupId,
        sourceId: params.source,
        targetId: params.target
      });
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            id: data.data.eid,
            type: 'floating',
            markerEnd: { type: MarkerType.ArrowClosed },
            data: { prerequisite: true, refreshNodes: () => setRefresh(prev => !prev), onError: notifyError },
          },
          eds,
        ),
      );
    } catch (error) {
      notifyError(error, 'Could not save the connection');
    }
  }, [selectedGroupId, notifyError]);

  // Tasks available for import — exclude tasks already imported as nodes
  const availableTasks = useMemo(() => {
    const nodeIds = new Set(nodes.map(n => n.id));
    return tasks.filter(t => !nodeIds.has(t.tid));
  }, [tasks, nodes]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setNodeData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // toggleCompletion ya declarado arriba

  // ReactFlow already removed the element locally; on failure reload so the canvas matches the DB.
  const onNodesDelete = async (event) => {
    try {
      await api.del(`/api/edges/source/${event[0].id}`);
      await api.del(`/api/nodes/${event[0].id}`);
    } catch (error) {
      notifyError(error, 'Could not delete the milestone');
      refreshNodes();
    }
  };

  const onEdgesDelete = async (event) => {
    try {
      await api.del(`/api/edges/${event[0].id}`);
    } catch (error) {
      notifyError(error, 'Could not delete the connection');
      refreshNodes();
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
          maxLength={LIMITS.nodeName}
          aria-label="Milestone name"
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
          {showDropdown && (
            <ul className="dropdown-menu">
              {availableTasks.length > 0 ? availableTasks.map((task) => (
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
              )) : (
                <li style={{ padding: '8px 10px', color: '#666', fontStyle: 'italic' }}>
                  No tasks available
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
      {!selectedGroupId && (
        <div style={{color: 'white', padding: '1rem'}}>Selecciona un grupo para ver y crear milestones.</div>
      )}
      {selectedGroupId && <ReactFlow
        key={selectedGroupId}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
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
      <Snackbar
        open={Boolean(errorMsg)}
        autoHideDuration={4000}
        onClose={(event, reason) => { if (reason !== 'clickaway') setErrorMsg(''); }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setErrorMsg('')} severity="error" sx={{ width: '100%' }}>
          {errorMsg}
        </Alert>
      </Snackbar>
    </div>
  );
};

export default Flow;

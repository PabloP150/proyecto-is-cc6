import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Divider } from '@mui/material';

export default function CustomNode({ data, id }) {

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric'
    });
  };

  const handleComplete = async () => {
    if (data.toggleCompletion) {
      try {
        data.toggleCompletion(id);
        await fetch(`http://localhost:9000/api/nodes/${id}/complete`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            nid: id
          }),
        });
      } catch (error) {
        console.error('Error updating node:', error);
      }
    }
  };

  return (
    <div className={`customNode ${data.completed ? 'completed' : ''}`}
      style={{
        width: '11em',
        backgroundColor: '#F5F5F5',
        margin: '-1px',
      }}>
      <div
        className="customNodeBody"
        style={{
          padding: '10px',
          flexDirection: 'column',
        }}
      >
        {/* Display the label for connection */}
        <div><strong>{data.name}</strong></div>
        <Divider style={{ width: '110%', height: '1px', backgroundColor: 'black' }} />

        {data.description && (
          <div style={{ fontSize: '0.9em' }}>{data.description}</div>
        )}
        {data.date && (
          <div style={{ fontSize: '0.8em' }}>{formatDate(data.date)}</div>
        )}
        <button
          className="nodrag edit-button"
          onClick={data.onClick}
          style={{
            backgroundColor: '#333',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            zIndex: '1000',
          }}
        >
          Edit
        </button>
        <button
          onClick={handleComplete}
          className="nodrag completion-button"
          style={{
            marginTop: '3px',
            padding: '8px',
            backgroundColor: data.completed ? '#4CAF50' : '#666',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            zIndex: '1000',
          }}
        >
          {data.completed ? '✓ Completed' : 'Mark Complete'}
        </button>

        {/* Connection handles */}
        <Handle type="source" position={Position.Top} id="a" />
        <Handle type="source" position={Position.Right} id="b" />
        <Handle type="source" position={Position.Bottom} id="c" />
        <Handle type="source" position={Position.Left} id="d" />
      </div>
    </div>
  );
}

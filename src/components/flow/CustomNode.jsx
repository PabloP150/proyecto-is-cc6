import { Handle, Position } from '@xyflow/react';
import { Divider } from '@mui/material';

function CustomNode({ data, isConnectable }) {
  const handleComplete = () => {
    if (data.toggleCompletion) { 
      data.toggleCompletion(data.id);
    }
  };

  const formatDateTime = (dateTimeStr) => {
    if (!dateTimeStr) return '';
    const date = new Date(dateTimeStr);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className={`custom-node ${data.completed ? 'completed' : ''}`}>
      {/* Top Handles */}
      <Handle
        type="target"
        position={Position.Top}
        id="top-target"
        isConnectable={isConnectable}
      />
      <Handle
        type="source"
        position={Position.Top}
        id="top-source"
        isConnectable={isConnectable}
      />

      {/* Left Handles */}
      <Handle
        type="target"
        position={Position.Left}
        id="left-target"
        isConnectable={isConnectable}
      />
      <Handle
        type="source"
        position={Position.Left}
        id="left-source"
        isConnectable={isConnectable}
      />

      <div>
        <div><strong>{data.name}</strong></div>
        <Divider />
        {data.description && (
          <div style={{ fontSize: '0.9em' }}>{data.description}</div>
        )}
        {data.datetime && (
          <div style={{ fontSize: '0.8em' }}>{formatDateTime(data.datetime)}</div>
        )}
        <button 
          onClick={handleComplete}
          className="nodrag completion-button"
          style={{
            marginTop: '8px',
            padding: '4px 8px',
            backgroundColor: data.completed ? '#00aa00' : '#666',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          {data.completed ? '✓ Completed' : 'Mark Complete'}
        </button>
      </div>

      {/* Right Handles */}
      <Handle
        type="target"
        position={Position.Right}
        id="right-target"
        isConnectable={isConnectable}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right-source"
        isConnectable={isConnectable}
      />

      {/* Bottom Handles */}
      <Handle
        type="target"
        position={Position.Bottom}
        id="bottom-target"
        isConnectable={isConnectable}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom-source"
        isConnectable={isConnectable}
      />
    </div>
  );
}

export default CustomNode;

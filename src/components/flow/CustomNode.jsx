import React, { useState, useEffect } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Divider } from '@mui/material';

export default function CustomNode({ data, id }) {
  const [inputValue, setInputValue] = useState(`${data.percentage}`);
  const [isComplete, setIsComplete] = useState(data.completed);

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric'
    });
  };

  useEffect(() => {
    setInputValue(data.percentage);
  }, [data.percentage]);

  const handleToggleComplete = async () => {
    if (data.toggleCompletion) {
      try {
        data.toggleCompletion(id);
        await fetch(`http://localhost:9000/api/nodes/${id}/toggleComplete`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            nid: id,
            completed: data.completed ? 0 : 1
          }),
        });
      } catch (error) {
        console.error('Error updating node:', error);
      }
    }
  };

  const handleBlur = async (e) => {
    const percentageRegex = /^(0|[1-9][0-9]?|100)$/;
    let inputValue = e.target.value;
    if (percentageRegex.test(inputValue) && inputValue <= 100) {
      inputValue = parseInt(inputValue);
      if (inputValue === 100) {
        setIsComplete(true);
        await handleToggleComplete();
      }

      else if (isComplete && (inputValue !== 100)) {
        setIsComplete(false);
        await handleToggleComplete();
      }
      setInputValue(inputValue);
      try {
        await fetch(`http://localhost:9000/api/nodes/${id}/percentage`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            nid: id,
            percentage: inputValue
          }),
        });
        data.setRefresh(!data.refresh);
      } catch (error) {
        console.error('Error updating node percentage:', error);
      }
    } else {
      setInputValue(data.percentage);
    }
  }

  return (
    <div className={`customNode ${data.percentage==100 ? 'completed' : ''}`}
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
          <div style={{ fontSize: '0.8em' }}>Deadline: {formatDate(data.date)}</div>
        )}
        {(data.percentage != null) && (
          <div
            style={{
              fontSize: '0.8em',
              cursor: 'pointer',
              justifyContent: 'right',
              textAlign: 'center',
            }}
          >
            Progress:
            <input
              type="text"
              className="nodrag"
              value={inputValue}
              style={{
                fontWeight: 'bold',
                fontSize: '1em',
                border: 'none',
                width: '20%',
                textAlign: 'right',
                backgroundColor: 'transparent',
              }}
              onChange={(e) => {
                const percentageRegex = /^\d{0,3}$/;
                if (percentageRegex.test(e.target.value)) {
                  setInputValue(e.target.value);
                }
              }}
              onBlur={handleBlur}
            />
            %
          </div>
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
        <div
          style={{
            backgroundColor: 'transparent',
            color: '#333',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            zIndex: '1000',
          }}
        >
          {data.percentage==100 ? '✓ Completed' : ''}
        </div>

        {/* Connection handles */}
        <Handle type="source" position={Position.Top} id="a" />
        <Handle type="source" position={Position.Right} id="b" />
        <Handle type="source" position={Position.Bottom} id="c" />
        <Handle type="source" position={Position.Left} id="d" />
      </div>
    </div>
  );
}

import { getBezierPath, useInternalNode, EdgeLabelRenderer } from '@xyflow/react';
import { Button } from '@mui/material';

import { getEdgeParams } from './utils.js';
import { useEffect, useState } from 'react';

function FloatingEdge({ id, source, target, markerEnd, style }) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const [prerequisite, setPrerequisite] = useState(true);
  const [label, setLabel] = useState('Loading...');

  useEffect(() => {
    const fetchData = async () => {
      const response = await fetch(`http://localhost:9000/api/edges/${id}`);
      const data = await response.json();
      setPrerequisite(data.data[0].prerequisite ? 1 : 0);
      setLabel(data.data[0].prerequisite == 1 ? 'Prerequisite' : 'Progressor');
    }
    fetchData()
  }, []);

  if (!sourceNode || !targetNode) {
    return null;
  }

  const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(
    sourceNode,
    targetNode,
  );

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX: sx,
    sourceY: sy,
    sourcePosition: sourcePos,
    targetPosition: targetPos,
    targetX: tx,
    targetY: ty,
  });

  const onEdgeClick = async () => {
    setLabel(prerequisite ? 'Progressor' : 'Prerequisite');
    setPrerequisite(!prerequisite);
    try {
      await fetch(`http://localhost:9000/api/edges/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prerequisite: prerequisite ? 0 : 1 }),
      });
    } catch (error) {
      console.error('Error updating edge:', error);
    }
  };

  return (
    <>
      <path
        id={id}
        className="react-flow__edge-path"
        d={edgePath}
        strokeWidth={5}
        markerEnd={markerEnd}
        style={style}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            fontSize: 12,
            // everything inside EdgeLabelRenderer has no pointer events by default
            // if you have an interactive element, set pointer-events: all
            pointerEvents: 'all',
          }}
          className="nodrag nopan"
        >
          <Button
            sx={{
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              color: '#fff',
            }}
            onClick={onEdgeClick}
          >
            {label}
          </Button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export default FloatingEdge;

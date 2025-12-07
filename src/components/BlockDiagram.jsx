import React from 'react';
import './BlockDiagram.css';
import {
  Typography,
  Container,
  Box,
  CssBaseline,
  Paper
} from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import Flow from './flow/Flow';
import { useState } from 'react';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#4a90e2',
    },
    background: {
      default: 'transparent',
      paper: 'rgba(0, 0, 0, 0.6)',
    },
  },
});

function BlockDiagram() {
  const [showPopup, setShowPopup] = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [flowKey, setFlowKey] = useState(0);

  const formatDate = (dateStr) => {
    if (!dateStr) return '';

    const date = new Date(dateStr);

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;

  };

  const handleNodeEdit = (node) => {
    setSelectedNode(node);
    setShowPopup(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());
    try {
      setFlowKey(flowKey + 1);
      const response1 = await fetch(`http://localhost:9000/api/nodes/${selectedNode.nid}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: data.name,
          description: data.description,
          date: formatDate(data.date)
        }),
      });
      const response2 = await fetch(`http://localhost:9000/api/tasks/nodes/${selectedNode.nid}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: data.name,
          description: data.description,
          date: formatDate(data.date)
        }),
      });

      if (response1.ok && response2.ok) {
        setShowPopup(false);
        setSelectedNode(null);
      }
    } catch (error) {
      console.error('Error updating node:', error);
    }
  };

  const handleClosePopup = () => {
    setShowPopup(false);
    setSelectedNode(null);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setSelectedNode(prev => ({
      ...prev,
      [name]: value
    }));
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {/* Main Background Layer */}
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)',
          zIndex: -2,
        }}
      />

      {/* Radial Gradient Overlays */}
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: `
            radial-gradient(circle at 20% 80%, rgba(59, 130, 246, 0.2) 0%, transparent 50%),
            radial-gradient(circle at 80% 20%, rgba(245, 158, 11, 0.15) 0%, transparent 50%)
          `,
          zIndex: -1,
        }}
      />
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <Container component="main" maxWidth="90vw">
          <Paper elevation={6} sx={{
            backgroundColor: 'background.paper',
            borderRadius: 2,
          }}>
            {/* Title Section */}
            <Box sx={{ p: 2, borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
              <Typography component="h1" variant="h4" align="center">
                Milestone Planner
              </Typography>
            </Box>

            {/* Flow Section */}
            <Box sx={{ mb: 2, p: 2, height: '80vh' }}>
              <Flow key={flowKey} handleNodeEdit={handleNodeEdit} setSelectedNode={setSelectedNode} />
              {showPopup && (
                <div
                  className="popup-window">
                  <div className="popup-header">
                    <h2>Edit Milestone</h2>
                    <button className="close-button" onClick={handleClosePopup}>
                      &#x2715;
                    </button>
                  </div>
                  <form style={{ display: 'flex', flexDirection: 'column' }} onSubmit={handleSubmit}>
                    <label>
                      Milestone Name:
                      <input type="text" name="name" value={selectedNode.name} onChange={handleInputChange} />
                    </label>
                    <label>
                      Milestone Description:
                      <textarea name="description" value={selectedNode.description} onChange={handleInputChange} />
                    </label>
                    <label>
                      Milestone Date:
                      <input
                        type="date"
                        name="date"
                        value={new Date(selectedNode.date).toISOString().split('T')[0]}
                        onChange={handleInputChange}
                      />
                    </label>
                    <input
                      className="save-button"
                      type="submit"
                      value="Save"
                    />
                  </form>
                </div>
              )}
            </Box>
          </Paper>
        </Container>
      </Box>
    </ThemeProvider>
  );
}

export default BlockDiagram;

import React from 'react';
import './BlockDiagram.css';
import {
  AppBar,
  Toolbar,
  Typography,
  Container,
  Box,
  CssBaseline,
  Paper
} from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import Flow from './flow/Flow';

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
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundImage: 'url(/1.jpeg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
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
                Project Visualizer
              </Typography>
            </Box>
            
            {/* Flow Section */}
            <Box sx={{ mb: 2, p: 2, height: '80vh' }}>
              <Flow />
            </Box>
          </Paper>
        </Container>
      </Box>
    </ThemeProvider>
  );
}

export default BlockDiagram;

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
import Navbar from './Navbar';
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
      <Navbar />
      <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <Container component="main" maxWidth="100vw" sx={{ mt: 8 }}>
          <Paper elevation={6} sx={{ p: 2, backgroundColor: 'background.paper', borderRadius: 2 }}>
            <Typography component="h1" variant="h4" align="center" sx={{ mb: 1 }}>
              Project Visualizer
            </Typography>
            <Box sx={{ height: '75vh' }}>
              <Flow />
            </Box>
          </Paper>
        </Container>
      </Box>
    </ThemeProvider>
  );
}

export default BlockDiagram;

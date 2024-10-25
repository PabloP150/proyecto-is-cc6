import React from 'react';
import {
  Container,
  Typography,
  Button,
  Box,
  CssBaseline,
  Paper
} from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { Link as RouterLink } from 'react-router-dom';
import Navbar from './Navbar'; // Import Navbar

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

function HomePage() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Navbar /> {/* Call Navbar here */}
      <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <Container component="main" maxWidth="md" sx={{ mt: 8 }}>
          <Paper elevation={6} sx={{ p: 4, backgroundColor: 'background.paper', borderRadius: 2 }}>
            <Typography component="h1" variant="h3" align="center" sx={{ mb: 2 }}>
              Welcome to TaskMate
            </Typography>
            <Typography variant="body1" align="center" sx={{ mb: 4 }}>
              Your all-in-one task management solution. Organize your tasks, manage your time, and visualize your projects with ease.
            </Typography>
            <Box sx={{ display: 'flex', justifyContent: 'space-around', flexDirection: { xs: 'column', sm: 'row' }, mb: 2 }}>
              <Button component={RouterLink} to="/tasks" variant="contained" sx={{ mb: { xs: 2, sm: 0 }, backgroundColor: '#4a90e2' }}>
                View Tasks
              </Button>
              <Button component={RouterLink} to="/calendar" variant="contained" sx={{ mb: { xs: 2, sm: 0 }, backgroundColor: '#4a90e2' }}>
                Calendar View
              </Button>
              <Button component={RouterLink} to="/block-diagram" variant="contained" sx={{ backgroundColor: '#4a90e2' }}>
                Project Visuallizer
              </Button>
            </Box>
          </Paper>
        </Container>
      </Box>
    </ThemeProvider>
  );
}

export default HomePage;

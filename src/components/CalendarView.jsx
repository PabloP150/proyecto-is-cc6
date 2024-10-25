import React from 'react';
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

function CalendarView() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Navbar /> {/* Call Navbar here */}
      <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <Container component="main" maxWidth="md" sx={{ mt: 8 }}>
          <Paper elevation={6} sx={{ p: 4, backgroundColor: 'background.paper', borderRadius: 2 }}>
            <Typography component="h1" variant="h4" align="center" sx={{ mb: 1 }}>
              Your Calendar
            </Typography>
            {/* Calendar rendering logic goes here */}
          </Paper>
        </Container>
      </Box>
    </ThemeProvider>
  );
}

export default CalendarView;

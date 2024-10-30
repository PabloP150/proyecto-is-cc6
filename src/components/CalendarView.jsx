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
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
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
          <Container component="main" maxWidth="md">
            <Paper elevation={6} sx={{ p: 4, backgroundColor: 'background.paper', borderRadius: 2 }}>
              <Typography component="h1" variant="h4" align="center">
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

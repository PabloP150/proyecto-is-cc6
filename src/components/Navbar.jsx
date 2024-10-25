import React from 'react';
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  Box
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

function Navbar() {
  return (
    <AppBar position="sticky" color="transparent" elevation={0}>
      <Toolbar sx={{ justifyContent: 'space-between' }}>
        <Typography variant="h4" component="div" sx={{ fontWeight: 'bold', fontSize: '2.5rem', letterSpacing: '1px' }}>
          TaskMate
        </Typography>
        <Box>
          <Button component={RouterLink} to="/tasks" color="inherit">TASKS</Button>
          <Button component={RouterLink} to="/calendar" color="inherit">CALENDAR</Button>
          <Button component={RouterLink} to="/block-diagram" color="inherit">BLOCK DIAGRAM</Button>
          <Button component={RouterLink} to="/login" color="inherit">LOGIN</Button>
        </Box>
      </Toolbar>
    </AppBar>
  );
}

export default Navbar;

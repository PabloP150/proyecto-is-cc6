import React, { useState } from 'react';
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  Box,
  Menu,
  MenuItem
} from '@mui/material';
import { Link, useLocation } from 'react-router-dom';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';

const Navbar = ({ user, onLogout }) => {
  const [anchorEl, setAnchorEl] = useState(null);
  const location = useLocation();

  const handleClick = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  return (
    <AppBar position="static" sx={{
      backgroundColor: 'rgba(21, 71, 52, 0.8)', // Verde oscuro semi-transparente
      backdropFilter: 'blur(5px)',
      boxShadow: 'none',
    }}>
      <Toolbar sx={{ justifyContent: 'space-between' }}>
        <Typography variant="h6" component={Link} to="/home" sx={{ flexGrow: 0, textDecoration: 'none', color: 'white', fontWeight: 'bold' }}>
          TaskMate
        </Typography>
        <Box sx={{ display: 'flex', justifyContent: 'center', flexGrow: 1 }}>
          <Button color="inherit" component={Link} to="/home" sx={{ color: location.pathname === '/home' ? '#4caf50' : 'white' }}>HOME</Button>
          <Button color="inherit" component={Link} to="/recordatorios" sx={{ color: location.pathname === '/recordatorios' ? '#4caf50' : 'white' }}>TASKS</Button>
          <Button color="inherit" component={Link} to="/calendar" sx={{ color: location.pathname === '/calendar' ? '#4caf50' : 'white' }}>CALENDAR</Button>
          <Button color="inherit" component={Link} to="/block-diagram" sx={{ color: location.pathname === '/block-diagram' ? '#4caf50' : 'white' }}>BLOCK DIAGRAM</Button>
        </Box>
        {user && (
          <Box sx={{ flexGrow: 0 }}>
            <Button
              color="inherit"
              onClick={handleClick}
              endIcon={<ArrowDropDownIcon />}
            >
              {user.name}
            </Button>
            <Menu
              anchorEl={anchorEl}
              open={Boolean(anchorEl)}
              onClose={handleClose}
            >
              <MenuItem onClick={() => { handleClose(); onLogout(); }}>Logout</MenuItem>
            </Menu>
          </Box>
        )}
      </Toolbar>
    </AppBar>
  );
};

export default Navbar;

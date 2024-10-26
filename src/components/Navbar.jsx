import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import {
  AppBar,
  Box,
  Button,
  Menu,
  MenuItem,
  Toolbar,
  Typography
} from '@mui/material';
import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

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
      <AppBar position="sticky" sx={{ backgroundColor: '#181818' }} elevation={0}>
      <Toolbar sx={{ justifyContent: 'space-between' }}>
      <Typography variant="h4" component="div" sx={{ fontWeight: 'bold', fontSize: '2.5rem', letterSpacing: '1px' }}>
          TaskMate
        </Typography>
        <Box sx={{ display: 'flex', justifyContent: 'center', flexGrow: 1 }}>
          <Button  component={Link} to="/home">HOME</Button>
          <Button  component={Link} to="/recordatorios">TASKS</Button>
          <Button  component={Link} to="/calendar">CALENDAR</Button>
          <Button  component={Link} to="/block-diagram">BLOCK DIAGRAM</Button>
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

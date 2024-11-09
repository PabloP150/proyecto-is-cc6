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
import { Link } from 'react-router-dom';

const Navbar = ({ user, onLogout }) => {
  const [anchorEl, setAnchorEl] = useState(null);

  const handleClick = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  return (
    <AppBar
      position="sticky"
      sx={{
        backgroundColor: 'transparent',
        backdropFilter: 'blur(5px)',
        background: 'rgba(0, 0, 0, 0.3)',
        boxShadow: 'none',
        '& .MuiButton-root': {
          color: 'white',
          position: 'relative',
          '&::after': {
            content: '""',
            position: 'absolute',
            width: '100%',
            height: '2px',
            bottom: 0,
            left: 0,
            backgroundColor: 'white',
            transform: 'scaleX(0)',
            transition: 'transform 0.3s ease',
          },
          '&:hover::after': {
            transform: 'scaleX(1)',
          }
        }
      }}
      elevation={0}
    >
      <Toolbar sx={{ justifyContent: 'space-between' }}>
        <Typography 
          variant="h4" 
          component={Link}
          to="/home"
          sx={{ 
            fontWeight: 'bold', 
            fontSize: '2.5rem', 
            letterSpacing: '1px',
            color: 'white',
            textDecoration: 'none',
            '&:hover': {
              opacity: 0.9
            }
          }}
        >
          TaskMate
        </Typography>
        <Box sx={{ display: 'flex', justifyContent: 'right', flexGrow: 1 }}>
          <Button component={Link} to="/recordatorios">TASKS</Button>
          <Button component={Link} to="/calendar">CALENDAR</Button>
          <Button component={Link} to="/block-diagram">BLOCK DIAGRAM</Button>
          <Button component={Link} to="/groups">GROUPS</Button>
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

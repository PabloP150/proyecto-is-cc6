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

  const isActiveRoute = (path) => {
    return location.pathname === path;
  };

  return (
    <AppBar
      position="sticky"
      sx={{
        background: 'rgba(30, 58, 138, 0.1)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(59, 130, 246, 0.2)',
        boxShadow: '0 8px 32px 0 rgba(30, 58, 138, 0.3)',
        transition: 'all 0.3s ease',
        '&:hover': {
          background: 'rgba(30, 58, 138, 0.15)',
          borderBottomColor: 'rgba(59, 130, 246, 0.3)',
        }
      }}
      elevation={0}
    >
      <Toolbar sx={{ 
        justifyContent: 'space-between',
        padding: (theme) => theme.spacing(1, 3),
        minHeight: '72px',
      }}>
        <Typography 
          variant="h4" 
          component={Link}
          to="/home"
          sx={{ 
            fontWeight: 'bold', 
            fontSize: '2.5rem', 
            letterSpacing: '1px',
            color: 'text.primary',
            textDecoration: 'none',
            background: 'linear-gradient(135deg, #3b82f6 0%, #f59e0b 100%)',
            backgroundClip: 'text',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            transition: 'all 0.3s ease',
            '&:hover': {
              transform: 'scale(1.05)',
              filter: 'brightness(1.1)',
            }
          }}
        >
          TaskMate
        </Typography>
        <Box sx={{ 
          display: 'flex', 
          justifyContent: 'right', 
          flexGrow: 1,
          gap: 1,
        }}>
          {[
            { path: '/home', label: 'Home' },
            { path: '/tasks', label: 'Tasks' },
            { path: '/calendar', label: 'Calendar' },
            { path: '/block-diagram', label: 'Milestones' },
            { path: '/groups', label: 'Groups' },
            { path: '/analytics', label: 'Analytics' },
            { path: '/chat', label: 'AI Bot' }
          ].map(({ path, label }) => (
            <Button
              key={path}
              component={Link}
              to={path}
              sx={{
                color: 'text.primary',
                position: 'relative',
                padding: (theme) => theme.spacing(1, 2),
                borderRadius: (theme) => theme.shape.borderRadius,
                transition: 'all 0.3s ease',
                fontWeight: 600,
                fontSize: '0.875rem',
                letterSpacing: '0.5px',
                background: isActiveRoute(path) 
                  ? 'rgba(59, 130, 246, 0.2)' 
                  : 'transparent',
                border: isActiveRoute(path) 
                  ? '1px solid rgba(59, 130, 246, 0.4)' 
                  : '1px solid transparent',
                
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  width: '0',
                  height: '2px',
                  bottom: 0,
                  left: '50%',
                  background: 'linear-gradient(90deg, #3b82f6, #f59e0b)',
                  transition: 'all 0.3s ease',
                  borderRadius: '1px',
                },
                
                '&:hover': {
                  background: 'rgba(255, 255, 255, 0.1)',
                  backdropFilter: 'blur(10px)',
                  transform: 'translateY(-1px)',
                  boxShadow: '0 4px 12px 0 rgba(59, 130, 246, 0.3)',
                  
                  '&::after': {
                    width: '100%',
                    left: 0,
                  }
                },
                
                '&:active': {
                  transform: 'translateY(0)',
                }
              }}
            >
              {label}
            </Button>
          ))}
        </Box>

        {user && (
          <Box sx={{ flexGrow: 0 }}>
            <Button
              onClick={handleClick}
              endIcon={<ArrowDropDownIcon />}
              sx={{
                color: 'text.primary',
                background: 'rgba(59, 130, 246, 0.15)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                borderRadius: (theme) => theme.shape.borderRadius,
                padding: (theme) => theme.spacing(1, 2),
                transition: 'all 0.3s ease',
                fontWeight: 600,
                backdropFilter: 'blur(10px)',
                
                '&:hover': {
                  background: 'rgba(59, 130, 246, 0.25)',
                  borderColor: 'rgba(59, 130, 246, 0.5)',
                  transform: 'translateY(-1px)',
                  boxShadow: '0 4px 12px 0 rgba(59, 130, 246, 0.4)',
                },
                
                '&:active': {
                  transform: 'translateY(0)',
                }
              }}
            >
              {user.name}
            </Button>
            <Menu
              anchorEl={anchorEl}
              open={Boolean(anchorEl)}
              onClose={handleClose}
              sx={{
                '& .MuiPaper-root': {
                  background: 'rgba(30, 58, 138, 0.9)',
                  backdropFilter: 'blur(20px)',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                  borderRadius: (theme) => theme.shape.borderRadius,
                  boxShadow: '0 8px 32px 0 rgba(30, 58, 138, 0.5)',
                  mt: 1,
                },
                '& .MuiMenuItem-root': {
                  color: 'text.primary',
                  padding: (theme) => theme.spacing(1.5, 2),
                  borderRadius: (theme) => theme.shape.borderRadius - 2,
                  margin: (theme) => theme.spacing(0.5),
                  transition: 'all 0.2s ease',
                  
                  '&:hover': {
                    background: 'rgba(59, 130, 246, 0.2)',
                    transform: 'translateX(4px)',
                  }
                }
              }}
            >
              <MenuItem onClick={() => { handleClose(); onLogout(); }}>
                Logout
              </MenuItem>
            </Menu>
          </Box>
        )}
      </Toolbar>
    </AppBar>
  );
};

export default Navbar;

import React from 'react';
import { Drawer, Box, List as MUIList, ListItem as MUIListItem, ListItemIcon, ListItemButton, ListItemText } from '@mui/material';
import TodayIcon from '@mui/icons-material/Today';
import EventNoteIcon from '@mui/icons-material/EventNote';
import AssignmentIcon from '@mui/icons-material/Assignment';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteIcon from '@mui/icons-material/Delete';
import { alpha } from '@mui/material/styles';

export default function BarraLateral({ drawerOpen, setDrawerOpen, setFiltro }) {
  const toggleDrawer = (open) => (event) => {
    if (event.type === 'keydown' && (event.key === 'Tab' || event.key === 'Shift')) {
      return;
    }
    setDrawerOpen(open);
  };

  return (
    <Drawer anchor="right" open={drawerOpen} onClose={toggleDrawer(false)}>
      <Box 
        sx={{ 
          width: 250, 
          backgroundColor: alpha('#1e1e1e', 0.85), 
          height: '100%',
          color: 'white'
        }} 
        role="presentation"
      >
        <MUIList>
          <MUIListItem disablePadding>
            <ListItemButton onClick={() => setFiltro('today')} sx={listItemButtonStyle}>
              <ListItemIcon>
                <TodayIcon sx={{ color: 'white' }} />
              </ListItemIcon>
              <ListItemText primary="Today" />
            </ListItemButton>
          </MUIListItem>
          <MUIListItem disablePadding>
            <ListItemButton onClick={() => setFiltro('month')} sx={listItemButtonStyle}>
              <ListItemIcon>
                <EventNoteIcon sx={{ color: 'white' }} />
              </ListItemIcon>
              <ListItemText primary="This Month" />
            </ListItemButton>
          </MUIListItem>
          <MUIListItem disablePadding>
            <ListItemButton onClick={() => setFiltro('all')} sx={listItemButtonStyle}>
              <ListItemIcon>
                <AssignmentIcon sx={{ color: 'white' }} />
              </ListItemIcon>
              <ListItemText primary="All Tasks" />
            </ListItemButton>
          </MUIListItem>
          <MUIListItem disablePadding>
            <ListItemButton onClick={() => setFiltro('completed')} sx={listItemButtonStyle}>
              <ListItemIcon>
                <CheckCircleIcon sx={{ color: 'white' }} />
              </ListItemIcon>
              <ListItemText primary="Completed" />
            </ListItemButton>
          </MUIListItem>
          <MUIListItem disablePadding>
            <ListItemButton onClick={() => setFiltro('deleted')} sx={listItemButtonStyle}>
              <ListItemIcon>
                <DeleteIcon sx={{ color: 'white' }} />
              </ListItemIcon>
              <ListItemText primary="Deleted" />
            </ListItemButton>
          </MUIListItem>
        </MUIList>
      </Box>
    </Drawer>
  );
}

const listItemButtonStyle = {
  '&:hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  '&.Mui-selected': {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    '&:hover': {
      backgroundColor: 'rgba(255, 255, 255, 0.3)',
    },
  },
};

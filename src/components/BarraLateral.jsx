import React from 'react';
import { Drawer, Box, List as MUIList, ListItem as MUIListItem, ListItemIcon, ListItemButton, ListItemText } from '@mui/material';
import TodayIcon from '@mui/icons-material/Today';
import EventNoteIcon from '@mui/icons-material/EventNote';
import AssignmentIcon from '@mui/icons-material/Assignment';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteIcon from '@mui/icons-material/Delete';
import { blue } from '@mui/material/colors';

export default function BarraLateral({ drawerOpen, setDrawerOpen, setFiltro }) {
  const toggleDrawer = (open) => (event) => {
    if (event.type === 'keydown' && (event.key === 'Tab' || event.key === 'Shift')) {
      return;
    }
    setDrawerOpen(open);
  };

  return (
    <Drawer anchor="right" open={drawerOpen} onClose={toggleDrawer(false)}>
      <Box sx={{ width: 250, backgroundColor: blue[50], height: '100%' }} role="presentation">
        <MUIList>
          <MUIListItem>
            <ListItemButton onClick={() => setFiltro('hoy')}>
              <ListItemIcon>
                <TodayIcon sx={{ color: blue[500] }} />
              </ListItemIcon>
              <ListItemText primary="Hoy" />
            </ListItemButton>
          </MUIListItem>
          <MUIListItem>
            <ListItemButton onClick={() => setFiltro('mes')}>
              <ListItemIcon>
                <EventNoteIcon sx={{ color: blue[500] }} />
              </ListItemIcon>
              <ListItemText primary="Este mes" />
            </ListItemButton>
          </MUIListItem>
          <MUIListItem>
            <ListItemButton onClick={() => setFiltro('todos')}>
              <ListItemIcon>
                <AssignmentIcon sx={{ color: blue[500] }} />
              </ListItemIcon>
              <ListItemText primary="Todos los recordatorios" />
            </ListItemButton>
          </MUIListItem>
          <MUIListItem>
            <ListItemButton onClick={() => setFiltro('completados')}>
              <ListItemIcon>
                <CheckCircleIcon sx={{ color: blue[500] }} />
              </ListItemIcon>
              <ListItemText primary="Completados" />
            </ListItemButton>
          </MUIListItem>
          <MUIListItem>
            <ListItemButton onClick={() => setFiltro('eliminados')}>
              <ListItemIcon>
                <DeleteIcon sx={{ color: blue[500] }} />
              </ListItemIcon>
              <ListItemText primary="Eliminados" />
            </ListItemButton>
          </MUIListItem>
        </MUIList>
      </Box>
    </Drawer>
  );
}

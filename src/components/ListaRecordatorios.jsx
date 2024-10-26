import React, { useState } from 'react';
import { List, ListItem, ListItemText, IconButton, Box, Typography, Menu, MenuItem } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RestoreIcon from '@mui/icons-material/Restore';
import FilterListIcon from '@mui/icons-material/FilterList';
import { blue } from '@mui/material/colors';

export default function ListaRecordatorios({ listas, handleEliminar, handleCompletar, handleEditar, orden, setOrden, filtro, handleRestaurar }) {
  const [anchorEl, setAnchorEl] = useState(null);

  const handleClick = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleMenuItemClick = (ordenSeleccionado) => {
    setOrden(ordenSeleccionado);
    handleClose();
  };

  const ordenarRecordatorios = (recordatorios) => {
    switch (orden) {
      case 'fechaCreacion':
        return recordatorios.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
      case 'fechaLimite':
        return recordatorios.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
      case 'prioridad':
        // Asumiendo que la prioridad está en el campo 'description' por ahora
        return recordatorios.sort((a, b) => a.description.localeCompare(b.description));
      default:
        return recordatorios;
    }
  };

  const formatearFecha = (datetime) => {
    if (!datetime) return 'Fecha no disponible';
    const fecha = new Date(datetime);
    return `${fecha.toLocaleDateString()} ${fecha.toLocaleTimeString()}`;
  };

  return (
    <>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 3 }}>
        <IconButton onClick={handleClick} sx={{ color: 'white' }}>
          <FilterListIcon />
        </IconButton>
        <Menu
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={handleClose}
        >
          <MenuItem onClick={() => handleMenuItemClick('fechaCreacion')}>Fecha de Creación</MenuItem>
          <MenuItem onClick={() => handleMenuItemClick('fechaLimite')}>Fecha Límite</MenuItem>
          <MenuItem onClick={() => handleMenuItemClick('prioridad')}>Prioridad</MenuItem>
        </Menu>
      </Box>

      <List>
        {listas.map((lista, index) => (
          <Box key={index} sx={{ mb: 2 }}>
            <Typography variant="h6" sx={{ color: blue[300] }}>{lista.nombre}</Typography>
            <List>
              {lista.recordatorios && lista.recordatorios.length > 0 ? (
                ordenarRecordatorios(lista.recordatorios).map((recordatorio, idx) => (
                  <ListItem 
                    key={recordatorio.id || idx} 
                    button 
                    onClick={() => handleEditar(lista.nombre, idx)}
                    sx={{ 
                      backgroundColor: 'rgba(255, 255, 255, 0.1)', 
                      mb: 1, 
                      borderRadius: 1,
                      '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.2)' }
                    }}
                  >
                    <ListItemText
                      primary={
                        <Typography sx={{ color: 'white', fontWeight: 'bold' }}>
                          {recordatorio.name || 'Sin nombre'}
                        </Typography>
                      }
                      secondary={
                        <Typography sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                          {`${recordatorio.description || 'Sin descripción'} - ${formatearFecha(recordatorio.datetime)}`}
                        </Typography>
                      }
                    />
                    {filtro === 'eliminados' || filtro === 'completados' ? (
                      <IconButton edge="end" aria-label="restore" onClick={(e) => { e.stopPropagation(); handleRestaurar(lista.nombre, idx); }} sx={{ color: 'white' }}>
                        <RestoreIcon />
                      </IconButton>
                    ) : (
                      <>
                        <IconButton edge="end" aria-label="complete" onClick={(e) => { e.stopPropagation(); handleCompletar(lista.nombre, idx); }} sx={{ color: 'white' }}>
                          <CheckCircleIcon />
                        </IconButton>
                        <IconButton edge="end" aria-label="delete" onClick={(e) => { e.stopPropagation(); handleEliminar(lista.nombre, idx); }} sx={{ color: 'white' }}>
                          <DeleteIcon />
                        </IconButton>
                      </>
                    )}
                  </ListItem>
                ))
              ) : (
                <ListItem>
                  <ListItemText primary={<Typography sx={{ color: 'white' }}>No hay recordatorios en esta lista</Typography>} />
                </ListItem>
              )}
            </List>
          </Box>
        ))}
      </List>
    </>
  );
}

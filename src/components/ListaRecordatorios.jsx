import React, { useState } from 'react';
import { List, ListItem, ListItemText, IconButton, Box, Typography, Menu, MenuItem, Button } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import FilterListIcon from '@mui/icons-material/FilterList';
import EditIcon from '@mui/icons-material/Edit';
import { blue } from '@mui/material/colors';

export default function ListaRecordatorios({ listas, handleEliminar, handleCompletar, handleEditar, filtro, handleEliminarLista, orden, setOrden, handleVaciarCompletados, handleVaciarEliminados }) {
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
        return [...recordatorios].sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
      case 'fechaLimite':
        return [...recordatorios].sort((a, b) => new Date(a.fechaLimite) - new Date(b.fechaLimite));
      case 'prioridad':
        return [...recordatorios].sort((a, b) => a.prioridad - b.prioridad);
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
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
        {filtro === 'completados' && (
          <Box sx={{ marginLeft: 'auto' }}>
            <Button variant="contained" color="error" onClick={handleVaciarCompletados}>
              Empty Completed
            </Button>
          </Box>
        )}
        {filtro === 'eliminados' && (
          <Box sx={{ marginLeft: 'auto' }}>
            <Button variant="contained" color="error" onClick={handleVaciarEliminados}>
              Empty Deleted
            </Button>
          </Box>
        )}
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 3 }}>
        {filtro !== 'completados' && filtro !== 'eliminados' && (
          <IconButton onClick={handleClick} sx={{ color: 'white' }}>
            <FilterListIcon />
          </IconButton>
        )}
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
        {listas.length > 0 ? (
          listas.map((lista, index) => (
            <Box key={index} sx={{ mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <Typography variant="h6" sx={{ color: blue[300] }}>{lista.nombre}</Typography>
                {filtro !== 'completados' && filtro !== 'eliminados' && (
                  <IconButton 
                    onClick={() => handleEliminarLista(lista.nombre)}
                    sx={{ color: 'white', ml: 1 }}
                  >
                    <DeleteIcon />
                  </IconButton>
                )}
              </Box>
              <List>
                {lista.recordatorios && lista.recordatorios.length > 0 ? (
                  ordenarRecordatorios(lista.recordatorios).map((recordatorio, idx) => (
                    <ListItem 
                      key={recordatorio.id || idx} 
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
                        null
                      ) : (
                        <>
                          <IconButton edge="end" aria-label="edit" onClick={(e) => { e.stopPropagation(); handleEditar(lista.nombre, idx); }} sx={{ color: 'white' }}>
                            <EditIcon />
                          </IconButton>
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
                    <ListItemText primary={<Typography sx={{ color: 'white', textAlign: 'center', width: '100%' }}>There are no tasks yet</Typography>} />
                  </ListItem>
                )}
              </List>
            </Box>
          ))
        ) : (
          <ListItem>
            <ListItemText primary={<Typography sx={{ color: 'white', textAlign: 'center', width: '100%' }}>Add a list to start</Typography>} />
          </ListItem>
        )}
      </List>
    </>
  );
}

import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import FilterListIcon from '@mui/icons-material/FilterList';
import { Box, Button, IconButton, List, ListItem, ListItemText, Menu, MenuItem, Typography } from '@mui/material';
import { blue } from '@mui/material/colors';
import { useState } from 'react';
import SeleccionarPersona from './SeleccionarPersona';
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
      case 'CreationDate':
        return [...recordatorios].sort((a, b) => {
          const fechaA = new Date(a.datetime);
          const fechaB = new Date(b.datetime);
          return fechaA - fechaB;
        });
      case 'Deadline':
        return [...recordatorios].sort((a, b) => {
          const fechaA = new Date(a.fechaLimite);
          const fechaB = new Date(b.fechaLimite);
          return fechaA - fechaB;
        });
      case 'Priority':
        return [...recordatorios].sort((a, b) => {
          const fechaA = new Date(a.fechaLimite);
          const fechaB = new Date(b.fechaLimite);
          return fechaA - fechaB;
        });
      default:
        return recordatorios;
    }
  };

  const formatearFecha = (datetime) => {
    if (!datetime) return 'Date Not Available';
    // Mostrar exactamente la hora recibida, sin aplicar conversiones de zona horaria.
    // Soporta: 'YYYY-MM-DDTHH:mm', 'YYYY-MM-DD HH:mm', ISO con Z ('YYYY-MM-DDTHH:mm:ss.sssZ') y solo fecha.
    if (typeof datetime === 'string') {
      // ISO con hora (T o espacio) – tomar HH:mm literal
      const m1 = datetime.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
      if (m1) {
        const [, y, m, d, hh, mm] = m1;
        return `${Number(d)}/${Number(m)}/${y} ${hh}:${mm}`;
      }
      // Solo fecha
      const m2 = datetime.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m2) {
        const [, y, m, d] = m2;
        return `${Number(d)}/${Number(m)}/${y} 00:00`;
      }
      // ISO completo con Z – extraer partes sin convertir
      const m3 = datetime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):\d{2}(?:\.\d+)?Z$/);
      if (m3) {
        const [, y, m, d, hh, mm] = m3;
        return `${Number(d)}/${Number(m)}/${y} ${hh}:${mm}`;
      }
    }
    // Fallback: usar Date solo si no coincide ningún formato conocido
    try {
      const f = new Date(datetime);
      return `${f.toLocaleDateString()} ${f.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch {
      return String(datetime);
    }
  };

  return (
    <>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
        {filtro === 'completed' && (
          <Box sx={{ marginLeft: 'auto' }}>
            <Button variant="contained" color="error" onClick={handleVaciarCompletados}>
              Empty Completed
            </Button>
          </Box>
        )}
        {filtro === 'deleted' && (
          <Box sx={{ marginLeft: 'auto' }}>
            <Button variant="contained" color="error" onClick={handleVaciarEliminados}>
              Empty Deleted
            </Button>
          </Box>
        )}
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 3 }}>
        <Typography sx={{ color: 'white', alignSelf: 'center', mr: 1 }}>
          {orden === 'CreationDate' ? 'Creation Date' : orden === 'Deadline' ? 'Deadline' : 'Priority'}
        </Typography>
        <IconButton onClick={handleClick} sx={{ color: 'white' }}>
          <FilterListIcon />
        </IconButton>
        <Menu
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={handleClose}
        >
          <MenuItem onClick={() => handleMenuItemClick('CreationDate')}>Creation Date</MenuItem>
          <MenuItem onClick={() => handleMenuItemClick('Deadline')}>Deadline</MenuItem>
          <MenuItem onClick={() => handleMenuItemClick('Priority')}>Priority</MenuItem>
        </Menu>
      </Box>

      <List>
        {listas.length > 0 ? (
          listas.map((lista, index) => (
            <Box key={index} sx={{ mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <Typography variant="h6" sx={{ color: blue[300] }}>{lista.nombre}</Typography>
                {filtro !== 'completed' && filtro !== 'deleted' && (
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
                            {recordatorio.name || 'No name'}
                          </Typography>
                        }
                        secondary={
                          <Typography sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                            {`${recordatorio.description || 'No description'} - ${formatearFecha(recordatorio.datetime)}`}
                          </Typography>
                        }
                      />
                      <Box sx={{ display: 'flex', justifyContent: 'center', width: 'auto', minWidth: '50%' }}>
                        <Typography sx={{ color: 'white' }}>
                            Percent Completed: {recordatorio.percentage || 0}%
                        </Typography>
                      </Box>
                      {filtro === 'deleted' || filtro === 'completed' ? (
                        null
                      ) : (
                        <>
                          <SeleccionarPersona tid={recordatorio.tid}/>
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
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import FilterListIcon from '@mui/icons-material/FilterList';
import { Alert, Box, Button, Divider, IconButton, LinearProgress, List, ListItem, ListItemText, Menu, MenuItem, Snackbar, Typography } from '@mui/material';
import Tooltip from '@mui/material/Tooltip';
import { blue } from '@mui/material/colors';
import { useEffect, useRef, useState } from 'react';
import SeleccionarPersona from './SeleccionarPersona';
export default function ListaRecordatorios({ listas, handleEliminar, handleCompletar, handleEditar, filtro, handleEliminarLista, orden, setOrden, handleVaciarCompletados, handleVaciarEliminados }) {
  // Snackbar state
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  // Envoltorios para handlers que muestran el snackbar
  const handleCompletarConFeedback = (...args) => {
    handleCompletar(...args);
    setSnackbar({ open: true, message: '¡Tarea completada!', severity: 'success' });
  };
  const handleEliminarConFeedback = (...args) => {
    handleEliminar(...args);
    setSnackbar({ open: true, message: 'Tarea eliminada', severity: 'info' });
  };
  const handleEditarConFeedback = (...args) => {
    handleEditar(...args);
    setSnackbar({ open: true, message: 'Tarea editada', severity: 'success' });
  };
  const handleCloseSnackbar = (event, reason) => {
    if (reason === 'clickaway') return;
    setSnackbar(s => ({ ...s, open: false }));
  };
  const [anchorEl, setAnchorEl] = useState(null);
  // Para animación fade-in de tareas nuevas
  const [nuevosIds, setNuevosIds] = useState([]);
  const prevTareasRef = useRef({});

  // Detectar nuevas tareas por lista
  useEffect(() => {
    const nuevos = [];
    listas.forEach(lista => {
      const prev = prevTareasRef.current[lista.nombre] || [];
      const prevIds = prev.map(t => t.tid || t.id);
      lista.recordatorios?.forEach(t => {
        const id = t.tid || t.id;
        if (id && !prevIds.includes(id)) nuevos.push(id);
      });
    });
    if (nuevos.length > 0) {
      setNuevosIds(ids => [...ids, ...nuevos]);
      // Remover el fade-in después de 1.7s
      setTimeout(() => {
        setNuevosIds(ids => ids.filter(id => !nuevos.includes(id)));
      }, 1700);
    }
    // Guardar estado actual para próxima comparación
    const snap = {};
    listas.forEach(lista => {
      snap[lista.nombre] = lista.recordatorios ? [...lista.recordatorios] : [];
    });
    prevTareasRef.current = snap;
  }, [listas]);

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
    {/* Título y acciones */}
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
    <Divider sx={{ mb: 2, background: 'rgba(255,255,255,0.08)' }} />

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 3 }}>
    {/* Filtros y orden */}
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
          <MenuItem onClick={() => handleMenuItemClick('CreationDate')}>Creatioriorte</MenuItem>
          <MenuItem onClick={() => handleMenuItemClick('Deadline')}>Deadline</MenuItem>
          <MenuItem onClick={() => handleMenuItemClick('Priority')}>Priority</MenuItem>
        </Menu>
      </Box>
    <Divider sx={{ mb: 2, background: 'rgba(255,255,255,0.08)' }} />

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
              <Box sx={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '16px',
                justifyContent: 'flex-start',
              }}>
                {lista.recordatorios && lista.recordatorios.length > 0 ? (
                  ordenarRecordatorios(lista.recordatorios).map((recordatorio, idx) => (
                    <Box
                      key={recordatorio.id || recordatorio.tid || idx}
                      sx={{
                        flex: '1 1 calc(33.333% - 16px)',
                        maxWidth: 'calc(33.333% - 16px)',
                        minWidth: '220px',
                        background: 'linear-gradient(135deg, rgba(40,60,110,0.92) 0%, rgba(35,39,47,0.98) 100%)',
                        borderRadius: '14px',
                        boxShadow: '0 2px 12px 0 rgba(0,0,0,0.18)',
                        padding: '14px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        position: 'relative',
                        transition: 'box-shadow 0.35s cubic-bezier(.4,2,.3,1), background 0.35s cubic-bezier(.4,2,.3,1), opacity 1.7s, transform 0.25s cubic-bezier(.4,2,.3,1)',
                        opacity: nuevosIds.includes(recordatorio.tid || recordatorio.id) ? 0 : 1,
                        animation: nuevosIds.includes(recordatorio.tid || recordatorio.id)
                          ? 'fadeInTask 1.7s forwards'
                          : 'none',
                        '@keyframes fadeInTask': {
                          from: { opacity: 0 },
                          to: { opacity: 1 },
                        },
                        '&:hover': {
                          boxShadow: '0 12px 36px 0 rgba(40,60,110,0.45), 0 4px 24px 0 rgba(0,0,0,0.28)',
                          background: 'linear-gradient(135deg, rgba(60,90,180,0.98) 0%, rgba(38,43,52,1) 100%)',
                          cursor: 'pointer',
                          transform: 'scale(1.035)',
                        },
                      }}
                    >
                      {/* Animación de check al completar */}
                      {Number(recordatorio.percentage) >= 100 && (
                        <Box
                          sx={{
                            position: 'absolute',
                            top: 12,
                            right: 12,
                            zIndex: 2,
                            animation: 'popCheck 0.7s cubic-bezier(.4,2,.3,1)',
                            '@keyframes popCheck': {
                              '0%': { transform: 'scale(0.2)', opacity: 0 },
                              '60%': { transform: 'scale(1.2)', opacity: 1 },
                              '80%': { transform: 'scale(0.95)', opacity: 1 },
                              '100%': { transform: 'scale(1)', opacity: 1 },
                            },
                          }}
                        >
                          <CheckCircleIcon sx={{ color: '#4caf50', fontSize: 38, filter: 'drop-shadow(0 2px 8px #4caf5077)' }} />
                        </Box>
                      )}
                      <Typography sx={{ color: 'white', fontWeight: 'bold', textAlign: 'left', width: '100%' }}>
                        {recordatorio.name || 'No name'}
                      </Typography>
                      <Typography sx={{ color: 'rgba(255, 255, 255, 0.7)', textAlign: 'left', width: '100%' }}>
                        {`${recordatorio.description || 'No description'} - ${formatearFecha(recordatorio.datetime)}`}
                      </Typography>
                      <Typography sx={{ color: 'white', fontSize: '0.95em', textAlign: 'left', width: '100%' }}>
                        Percent Completed: {recordatorio.percentage || 0}%
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={Number(recordatorio.percentage) || 0}
                        sx={{
                          height: 8,
                          borderRadius: 5,
                          mt: 1,
                          backgroundColor: 'rgba(255,255,255,0.08)',
                          '& .MuiLinearProgress-bar': {
                            background: 'linear-gradient(90deg, #4fc3f7 0%, #1976d2 100%)',
                          },
                        }}
                      />
                       {filtro === 'deleted' || filtro === 'completed' ? null : (
                         <Box sx={{ display: 'flex', flexDirection: 'row', gap: 1.5, mt: 1 }}>
                           <Tooltip title="Asignar usuario" arrow>
                             <span>
                               <SeleccionarPersona tid={recordatorio.tid} />
                             </span>
                           </Tooltip>
                           <Tooltip title="Editar tarea" arrow>
                             <IconButton edge="end" aria-label="edit" size="large" onClick={(e) => { e.stopPropagation(); handleEditarConFeedback(lista.nombre, idx); }} sx={{ color: 'white' }}>
                               <EditIcon fontSize="inherit" />
                             </IconButton>
                           </Tooltip>
                           <Tooltip title="Completar tarea" arrow>
                             <IconButton edge="end" aria-label="complete" size="large" onClick={(e) => { e.stopPropagation(); handleCompletarConFeedback(lista.nombre, idx); }} sx={{ color: 'white' }}>
                               <CheckCircleIcon fontSize="inherit" />
                             </IconButton>
                           </Tooltip>
                           <Tooltip title="Eliminar tarea" arrow>
                             <IconButton edge="end" aria-label="delete" size="large" onClick={(e) => { e.stopPropagation(); handleEliminarConFeedback(lista.nombre, idx); }} sx={{ color: 'white' }}>
                               <DeleteIcon fontSize="inherit" />
                             </IconButton>
                           </Tooltip>
                         </Box>
                       )}
                    </Box>
                  ))
                ) : (
                  <Box sx={{ flex: '1 1 100%' }}>
                    <Typography sx={{ color: 'white', textAlign: 'center', width: '100%' }}>There are no tasks yet</Typography>
                  </Box>
                )}
              </Box>
            </Box>
          ))
        ) : (
          <ListItem>
            <ListItemText primary={<Typography sx={{ color: 'white', textAlign: 'center', width: '100%' }}>Add a list to start</Typography>} />
          </ListItem>
        )}
      </List>
      <Snackbar
        open={snackbar.open}
        autoHideDuration={2200}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
}
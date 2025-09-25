import AddIcon from '@mui/icons-material/Add';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import {
  Box,
  Container,
  CssBaseline,
  IconButton,
  Typography,
} from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { useCallback, useContext, useEffect, useState } from 'react';
import BarraLateral from './BarraLateral';
import Dialogos from './Dialogos';
import { GroupContext } from './GroupContext'; // Importa el contexto
import ListaRecordatorios from './ListaRecordatorios';
// Import new theme and UI components
import theme from '../theme/theme';
import Button from './ui/Button';
import Card from './ui/Card';



export default function Recordatorios() {
  const [openRecordatorio, setOpenRecordatorio] = useState(false);
  const [openLista, setOpenLista] = useState(false);
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [fecha, setFecha] = useState('');
  const [hora, setHora] = useState('');
  const [listas, setListas] = useState([]);
  const [nombreLista, setNombreLista] = useState('');
  const [listaSeleccionada, setListaSeleccionada] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [orden, setOrden] = useState('fechaCreacion');
  const [eliminados, setEliminados] = useState([]);
  const [completados, setCompletados] = useState([]);
  const [filtro, setFiltro] = useState('todos');
  const [recordatorioEditar, setRecordatorioEditar] = useState(null);
  const [openEditar, setOpenEditar] = useState(false); // Estado para el diálogo de edición
  const { selectedGroupId, selectedGroupName, setSelectedGroupId, setSelectedGroupName } = useContext(GroupContext); // Usa el contexto para obtener el gid y el nombre

  const cargarTareas = useCallback(async () => {
    if (!selectedGroupId) {
      setListas([]);
      return;
    }
    try {
      const response = await fetch(`http://localhost:9000/api/tasks?gid=${selectedGroupId}`);
      if (response.ok) {
        const data = await response.json();
        const listasOrganizadas = organizarTareasEnListas(data.data);
        // Persistencia de listas sin tareas: recuperamos listas guardadas localmente para este grupo
        try {
          const stored = localStorage.getItem('customLists');
          if (stored) {
            const parsed = JSON.parse(stored);
            const groupLists = parsed[selectedGroupId] || [];
            // Agregar las listas que no estén ya incluidas por las tareas existentes
            const nombresExistentes = new Set(listasOrganizadas.map(l => l.nombre));
            groupLists.forEach(nombre => {
              if (!nombresExistentes.has(nombre)) {
                listasOrganizadas.push({ nombre, recordatorios: [] });
              }
            });
          }
        } catch (e) {
          console.error('Error leyendo customLists de localStorage', e);
        }
        setListas(listasOrganizadas);
      } else {
        console.error('Error al cargar las tareas');
      }
    } catch (error) {
      console.error('Error en la solicitud:', error);
    }
  }, [selectedGroupId]);

  const cargarCompletados = useCallback(async () => {
    if (!selectedGroupId) { setCompletados([]); return; }

    try {
      const response = await fetch(`http://localhost:9000/api/completados/${selectedGroupId}`);
      if (response.ok) {
        const data = await response.json();
        setCompletados(data.data);
      } else {
        console.error('Error al cargar las tareas completadas:', response.status, response.statusText);
      }
    } catch (error) {
      console.error('Error en la solicitud:', error);
    }
  }, [selectedGroupId]);

  const cargarEliminados = useCallback(async () => {
    if (!selectedGroupId) { setEliminados([]); return; }

    try {
      const response = await fetch(`http://localhost:9000/api/delete/${selectedGroupId}`);
      if (response.ok) {
        const data = await response.json();
        setEliminados(data.data);
      } else {
        console.error('Error al cargar los eliminados:', response.status, response.statusText);
      }
    } catch (error) {
      console.error('Error en la solicitud:', error);
    }
  }, [selectedGroupId]);

  useEffect(() => {
    const storedGroupId = localStorage.getItem('selectedGroupId');
    const storedGroupName = localStorage.getItem('selectedGroupName');
    
    if (storedGroupId) {
      setSelectedGroupId(storedGroupId);
      setSelectedGroupName(storedGroupName);
    }

    cargarTareas();
    cargarCompletados(); // Asegúrate de cargar completados al iniciar

    if (filtro === 'deleted') {
      cargarEliminados(); // Cargar eliminados si el filtro es 'eliminados'
    }
  }, [setSelectedGroupId, setSelectedGroupName, cargarTareas, cargarCompletados, cargarEliminados, filtro]);

  const organizarTareasEnListas = (tareas) => {
    const listasTemp = {};
    tareas.forEach(tarea => {
      if (!listasTemp[tarea.list]) {
        listasTemp[tarea.list] = [];
      }
      listasTemp[tarea.list].push(tarea);
    });
    return Object.keys(listasTemp).map(nombreLista => ({
      nombre: nombreLista,
      recordatorios: listasTemp[nombreLista]
    }));
  };

  const handleOpenRecordatorio = () => {
  // Hora por defecto 00:00 si está vacía
  setHora(prev => (prev && /^\d{2}:\d{2}$/.test(prev) ? prev : '00:00'));
  setOpenRecordatorio(true);
  };

  const handleCloseRecordatorio = () => {
    setOpenRecordatorio(false);
  };

  const handleOpenLista = () => {
    setOpenLista(true);
  };

  const handleCloseLista = () => {
    setOpenLista(false);
  };

  const handleCreateList = () => {
    if (nombreLista.trim() === '') {
      alert('El nombre de la lista no puede estar vacío.');
      return;
    }
    const nuevaLista = { nombre: nombreLista, recordatorios: [] };
    // Evitar duplicados en estado
    setListas(prev => (prev.some(l => l.nombre === nombreLista) ? prev : [...prev, nuevaLista]));
    // Guardar en localStorage bajo la clave customLists por grupo
    try {
      const stored = localStorage.getItem('customLists');
      const parsed = stored ? JSON.parse(stored) : {};
      const groupLists = new Set(parsed[selectedGroupId] || []);
      groupLists.add(nombreLista);
      parsed[selectedGroupId] = Array.from(groupLists);
      localStorage.setItem('customLists', JSON.stringify(parsed));
    } catch (e) {
      console.error('Error guardando lista en localStorage', e);
    }
    setNombreLista('');
    setOpenLista(false);
  };

  const handleSubmitRecordatorio = async (e) => {
    e.preventDefault();
    if (!selectedGroupId) return; // protección
  // Combina fecha y hora; si no hay hora seleccionada, default a 00:00 para evitar fechas inválidas
  const safeTime = (typeof hora === 'string' && /^\d{2}:\d{2}$/.test(hora)) ? hora : '00:00';
  const fechaCompleta = `${fecha}T${safeTime}`;
    const nuevaTarea = { 
      gid: selectedGroupId, // Usa el gid del contexto
      name: nombre, 
      description: descripcion, 
      list: listaSeleccionada, 
      datetime: fechaCompleta,
      percentage: 0,
    };

    try {
      const response = await fetch('http://localhost:9000/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(nuevaTarea),
      });

      if (response.ok) {
        const data = await response.json();

        // Actualizar el estado local con la nueva tarea
        setListas(prevListas => {
          const nuevasListas = prevListas.map(lista => {
            if (lista.nombre === listaSeleccionada) {
              return {
                ...lista,
                recordatorios: [
                  ...lista.recordatorios,
                  {
                    ...nuevaTarea,
                    tid: data.data.tid // Asegúrate de que el ID se esté asignando correctamente
                  }
                ]
              };
            }
            return lista;
          });

          // Si la lista seleccionada no existe, créala
          if (!nuevasListas.some(lista => lista.nombre === listaSeleccionada)) {
            nuevasListas.push({
              nombre: listaSeleccionada,
              recordatorios: [{
                ...nuevaTarea,
                tid: data.data.tid
              }]
            });
          }

          return nuevasListas;
        });

        setOpenRecordatorio(false);
        setNombre('');
        setDescripcion('');
        setFecha('');
        setHora('');
      } else {
        console.error('Error al agregar la tarea');
      }
    } catch (error) {
      console.error('Error en la solicitud:', error);
    }
  };

  const handleEliminar = async (listaNombre, idx) => {
  const listaActual = listas.find(lista => lista.nombre === listaNombre);
    const task = listaActual?.recordatorios[idx];
    if (!task) return;

    // Marcar visualmente para animación (optimista)
    setListas(prev => prev.map(l => l.nombre === listaNombre ? {
      ...l,
      recordatorios: l.recordatorios.map((r,i) => i===idx ? { ...r, __justDeleted: true } : r)
    } : l));

    // Backend en paralelo (DELETE + POST a eliminados)
    (async () => {
      try {
        await fetch(`http://localhost:9000/api/tasks/${task.tid}`, { method: 'DELETE' });
      } catch (e) { console.error('Delete task error', e); }
      try {
        await fetch('http://localhost:9000/api/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(task),
        });
      } catch (e) { console.error('Add to deleted error', e); }
    })();

    // Remover tras animación (3s similar a completados)
    setTimeout(() => {
      setListas(prev => prev.map(l => l.nombre === listaNombre ? {
        ...l,
        recordatorios: l.recordatorios.filter((_,i) => i!==idx)
      } : l));
      // Opcional: recargar eliminados si existe lógica (no implementado aquí)
    }, 3000);
  };

  const handleCompletar = async (listaNombre, idx) => {
  const listaActual = listas.find(lista => lista.nombre === listaNombre);
    const task = listaActual?.recordatorios[idx];
    if (!task) return;

    // Marcar porcentaje 100 y bandera de completado para animación
    setListas(prev => prev.map(l => l.nombre === listaNombre ? {
      ...l,
      recordatorios: l.recordatorios.map((r,i) => i===idx ? { ...r, percentage: 100, __justCompleted: true } : r)
    } : l));

    // Backend paralelo
    (async () => {
      try { await fetch(`http://localhost:9000/api/tasks/${task.tid}`, { method: 'DELETE' }); } catch(e){ console.error('Delete task error', e); }
      try {
        await fetch('http://localhost:9000/api/completados', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...task, percentage: 100 }),
        });
        setCompletados(prev => [...prev, { ...task, percentage: 100 }]);
      } catch(e){ console.error('Add to completed error', e); }
      cargarCompletados();
    })();

    // Remover tras animación (3s)
    setTimeout(() => {
      setListas(prev => prev.map(l => l.nombre === listaNombre ? {
        ...l,
        recordatorios: l.recordatorios.filter((_,i) => i!==idx)
      } : l));
    }, 3000);
  };

  const handleEditar = (nombre, idx) => {
    const recordatorio = listas.find(lista => lista.nombre === nombre)?.recordatorios[idx];
    if (recordatorio) {
      // Normalizar datetime a 'YYYY-MM-DDTHH:mm' en hora local para edición estable
      const normalizeLocal = (dt) => {
        if (!dt) return '';
        if (typeof dt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dt)) return dt;
        const d = new Date(dt);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2,'0');
        const da = String(d.getDate()).padStart(2,'0');
        const hh = String(d.getHours()).padStart(2,'0');
        const mm = String(d.getMinutes()).padStart(2,'0');
        return `${y}-${m}-${da}T${hh}:${mm}`;
      };
      setRecordatorioEditar({ ...recordatorio, datetime: normalizeLocal(recordatorio.datetime) });
      setOpenEditar(true);
    }
  };

  const filtrarRecordatorios = () => {
    switch (filtro) {
      case 'today':
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        return listas.map(lista => ({
          ...lista,
          recordatorios: lista.recordatorios.filter(recordatorio => {
            const fechaRecordatorio = new Date(recordatorio.datetime);
            return fechaRecordatorio >= hoy && fechaRecordatorio < new Date(hoy.getTime() + 24 * 60 * 60 * 1000);
          })
        }));
      case 'week':
        const inicioSemana = new Date();
        inicioSemana.setHours(0, 0, 0, 0);
        inicioSemana.setDate(inicioSemana.getDate() - inicioSemana.getDay());
        const finSemana = new Date(inicioSemana);
        finSemana.setDate(finSemana.getDate() + 7);
        return listas.map(lista => ({
          ...lista,
          recordatorios: lista.recordatorios.filter(recordatorio => {
            const fechaRecordatorio = new Date(recordatorio.datetime);
            return fechaRecordatorio >= inicioSemana && fechaRecordatorio < finSemana;
          })
        }));
      case 'month':
        const inicioMes = new Date();
        inicioMes.setDate(1);
        inicioMes.setHours(0, 0, 0, 0);
        const finMes = new Date(inicioMes.getFullYear(), inicioMes.getMonth() + 1, 0, 23, 59, 59, 999);
        return listas.map(lista => ({
          ...lista,
          recordatorios: lista.recordatorios.filter(recordatorio => {
            const fechaRecordatorio = new Date(recordatorio.datetime);
            return fechaRecordatorio >= inicioMes && fechaRecordatorio <= finMes;
          })
        }));
      case 'all':
        return listas;
      case 'deleted':
        return [{ nombre: 'Deleted', recordatorios: eliminados }];
      case 'completed':
        return [{ nombre: 'Completed', recordatorios: completados }];
      default:
        return listas;
    }
  };

  const [deleteListSuccess, setDeleteListSuccess] = useState(false);
  const [deleteListError, setDeleteListError] = useState(false);

  const handleEliminarLista = async (nombreLista) => {
    const gid = localStorage.getItem('selectedGroupId');
    if (!gid) {
      console.error('No hay grupo seleccionado');
      return;
    }
    try {
      const response = await fetch(`http://localhost:9000/api/tasks/list/${gid}/${encodeURIComponent(nombreLista)}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setListas(prevListas => prevListas.filter(lista => lista.nombre !== nombreLista));
        // Actualizar localStorage quitando la lista
        try {
          const stored = localStorage.getItem('customLists');
          if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed[gid]) {
              parsed[gid] = parsed[gid].filter(n => n !== nombreLista);
              localStorage.setItem('customLists', JSON.stringify(parsed));
            }
          }
        } catch (e) {
          console.error('Error actualizando customLists tras eliminar lista', e);
        }
        cargarTareas();
        setDeleteListError(false);
        setDeleteListSuccess(true);
        setTimeout(() => setDeleteListSuccess(false), 3000);
      } else {
        console.error('Error al eliminar la lista');
        setDeleteListSuccess(false);
        setDeleteListError(true);
        setTimeout(() => setDeleteListError(false), 4000);
      }
    } catch (error) {
      console.error('Error en la solicitud:', error);
      setDeleteListSuccess(false);
      setDeleteListError(true);
      setTimeout(() => setDeleteListError(false), 4000);
    }
  };

  const handleSubmitEditar = async () => {
  if (!recordatorioEditar?.tid) {
        console.error('El TID es undefined. Asegúrate de que el recordatorio se haya seleccionado correctamente.');
        return; 
    }
  if (!selectedGroupId) return;
    try {
      const response = await fetch(`http://localhost:9000/api/tasks/${recordatorioEditar.tid}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          gid: selectedGroupId,
          name: recordatorioEditar.name,
          description: recordatorioEditar.description,
          list: recordatorioEditar.list,
          datetime: recordatorioEditar.datetime,
          percentage: recordatorioEditar.percentage,
        }),
      });

      if (response.ok) {
        // El PUT solo devuelve rowCount, no la tarea; usamos el estado editado como fuente confiable
        const updatedRecordatorio = { ...recordatorioEditar };
        const goingToCompleted = Number(updatedRecordatorio.percentage) >= 100;
        const unifiedId = updatedRecordatorio.tid;

        // Actualizar estado en listas (si no se completa aún quedará en su lista actual)
        setListas(prevListas => prevListas.map(lista => {
          if (lista.nombre === updatedRecordatorio.list) {
            return {
              ...lista,
              recordatorios: lista.recordatorios.map(r => {
                const rId = r.tid || r.id;
                return String(rId) === String(unifiedId) ? { ...updatedRecordatorio } : r;
              })
            };
          }
          return lista;
        }));

  // Si llega a 100%, mostrar animación check rápida y luego mover a completados
        if (goingToCompleted) {
          // Añadir flag temporal local para animación sin recargar todo
          setListas(prevListas => prevListas.map(lista => {
            if (lista.nombre === updatedRecordatorio.list) {
              return {
                ...lista,
                recordatorios: lista.recordatorios.map(r => {
                  const rId = r.tid || r.id;
                  return String(rId) === String(unifiedId) ? { ...r, __justCompleted: true } : r;
                })
              };
            }
            return lista;
          }));

          // Enviar a endpoint de completados (no elimina de Tasks, así que haremos delete explícito luego)
          try {
            const completarResponse = await fetch('http://localhost:9000/api/completados', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                gid: selectedGroupId,
                tid: updatedRecordatorio.tid,
                name: updatedRecordatorio.name,
                description: updatedRecordatorio.description,
                list: updatedRecordatorio.list,
                datetime: updatedRecordatorio.datetime,
                percentage: updatedRecordatorio.percentage,
              }),
            });
            if (completarResponse.ok) {
              const data = await completarResponse.json();
              const recordatorioCompletado = data.recordatorio || data.data || updatedRecordatorio;
              // Evitar duplicados por id/tid
              setCompletados(prev => {
                const exists = prev.some(r => (r.tid || r.id) === unifiedId);
                return exists ? prev : [...prev, recordatorioCompletado];
              });
            }
          } catch (e) {
            console.error('Error enviando a completados tras edición', e);
          }

          // Eliminar de Tasks explícitamente y luego quitar de la UI con delay para animación
          try {
            await fetch(`http://localhost:9000/api/tasks/${updatedRecordatorio.tid}`, {
              method: 'DELETE'
            });
          } catch (e) {
            console.error('Error eliminando task original tras completar', e);
          }

          setTimeout(() => {
            setListas(prevListas => prevListas.map(lista => {
              if (lista.nombre === updatedRecordatorio.list) {
                return {
                  ...lista,
                  recordatorios: lista.recordatorios.filter(r => {
                    const rId = r.tid || r.id;
                    return String(rId) !== String(unifiedId);
                  })
                };
              }
              return lista;
            }));
            cargarCompletados();
          }, 3000); // tiempo para animación (ajustado de 1.6s a 3s)
        } else {
          cargarTareas();
        }

        handleCloseEditar(); // cerramos inmediatamente; animación ocurre en la lista (si visible)
        setOpenEditar(false);
      } else {
        console.error('Error al actualizar el recordatorio');
      }
    } catch (error) {
      console.error('Error en la solicitud:', error);
    }
  };

  const handleCloseEditar = () => {
    setOpenEditar(false);
    setRecordatorioEditar(null);
  };

  const getSectionTitle = () => {
    switch (filtro) {
      case 'today':
        return 'Today';
      case 'month':
        return 'This Month';
      case 'all':
        return 'All Tasks';
      default:
        return 'Tasks';
    }
  };

  const handleVaciarEliminados = async () => {
    const gid = localStorage.getItem('selectedGroupId');
    if (!gid) {
      console.error('No hay grupo seleccionado');
      return;
    }

    try {
      await fetch(`http://localhost:9000/api/delete/${gid}`, {
        method: 'DELETE',
      });
      setEliminados([]); // Vaciar el estado de eliminados
    } catch (error) {
      console.error('Error al vaciar los eliminados:', error);
    }
  };

  const handleVaciarCompletados = async () => {
    const gid = localStorage.getItem('selectedGroupId');
    if (!gid) {
      console.error('No hay grupo seleccionado');
      return;
    }

    try {
      await fetch(`http://localhost:9000/api/completados/${gid}`, {
        method: 'DELETE',
      });
      setCompletados([]); // Vaciar el estado de completados
    } catch (error) {
      console.error('Error al vaciar los completados:', error);
    }
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: -2,
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)',
        }}
      />

      {/* Simple Radial Gradient Overlays */}
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: -1,
          background: `
            radial-gradient(circle at 20% 80%, rgba(59, 130, 246, 0.2) 0%, transparent 50%),
            radial-gradient(circle at 80% 20%, rgba(245, 158, 11, 0.15) 0%, transparent 50%)
          `,
        }}
      />
      <Container 
        component="main" 
        maxWidth="lg" 
        sx={{ 
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          pt: 12, // Match the Welcome to Taskmate card spacing
          pb: 4,
          overflow: 'hidden',
        }}
      >
        <Card 
          variant="gradient"
          sx={{ 
            p: 6, 
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            overflow: 'hidden',
            color: 'white',
            cursor: 'default',
            background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(245, 158, 11, 0.1) 50%, rgba(55, 65, 81, 0.95) 100%)',
            '&:hover': {
              transform: 'none',
              boxShadow: '0 2px 12px 0 rgba(0,0,0,0.18)', // Keep original shadow
              borderColor: 'rgba(59, 130, 246, 0.1)', // Keep original border color
              background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(245, 158, 11, 0.1) 50%, rgba(55, 65, 81, 0.95) 100%)', // Keep original background
            },
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography component="h1" variant="h4" sx={{ 
              color: 'primary.light', 
              fontWeight: 'bold',
              background: 'linear-gradient(90deg, #3b82f6 0%, #f59e0b 100%)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              Tasks {selectedGroupName && `- ${selectedGroupName}`}
            </Typography>
            <IconButton 
              onClick={() => setDrawerOpen(true)} 
              sx={{ 
                color: 'white',
                background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(245, 158, 11, 0.2) 100%)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                borderRadius: 2,
                transition: 'all 0.3s cubic-bezier(.4, 2, .3, 1)',
                '&:hover': {
                  background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.3) 0%, rgba(245, 158, 11, 0.3) 100%)',
                  transform: 'scale(1.05)',
                  boxShadow: '0 4px 16px 0 rgba(59, 130, 246, 0.4)',
                },
              }}
            >
              <AddIcon fontSize="large" />
            </IconButton>
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
            {filtro !== 'completed' && filtro !== 'deleted' && (
              <Button
                variant="primary"
                onClick={handleOpenLista}
                sx={{ 
                  borderRadius: '50px',
                  px: 3,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                }}
                disabled={!selectedGroupId}
              >
                <AddIcon />
                Add List
              </Button>
            )}
            <Typography variant="h6" sx={{ 
              color: 'white', 
              alignSelf: 'center',
              fontWeight: 600,
              textShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
            }}>
              {getSectionTitle()}
            </Typography>
            {filtro !== 'completed' && filtro !== 'deleted' && (
              <Button
                variant="secondary"
                onClick={handleOpenRecordatorio}
                sx={{ 
                  borderRadius: '50px',
                  px: 3,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                }}
                disabled={!selectedGroupId}
              >
                <AddIcon />
                Add Task
              </Button>
            )}
          </Box>

          <Box sx={{ flexGrow: 1, overflow: 'auto', position: 'relative' }}>
            {!selectedGroupId && (
              <Box sx={{color:'white', textAlign:'center', mt:4, opacity:0.85}}>
                Selecciona un grupo para gestionar tareas.
              </Box>
            )}
            {selectedGroupId && <ListaRecordatorios
              listas={filtrarRecordatorios()}
              handleEliminar={handleEliminar}
              handleCompletar={handleCompletar}
              handleEditar={handleEditar}
              orden={orden}
              setOrden={setOrden}
              filtro={filtro}
              handleEliminarLista={handleEliminarLista}
              sx={{ color: 'white' }}
              handleVaciarCompletados={handleVaciarCompletados}
              handleVaciarEliminados={handleVaciarEliminados}
            />}
            {(deleteListSuccess || deleteListError) && (
              <Box
                sx={{
                  position: 'fixed',
                  bottom: 24,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 2.5,
                  py: 1.25,
                  borderRadius: '999px',
                  background: deleteListSuccess
                    ? 'linear-gradient(135deg, rgba(16,185,129,0.15) 0%, rgba(5,150,105,0.4) 100%)'
                    : 'linear-gradient(135deg, rgba(239,68,68,0.15) 0%, rgba(220,38,38,0.4) 100%)',
                  border: `1px solid ${deleteListSuccess ? 'rgba(16,185,129,0.5)' : 'rgba(239,68,68,0.5)'}`,
                  boxShadow: deleteListSuccess
                    ? '0 4px 18px -2px rgba(16,185,129,0.4)'
                    : '0 4px 18px -2px rgba(239,68,68,0.4)',
                  backdropFilter: 'blur(12px)',
                  zIndex: 1500,
                  color: '#fff',
                  fontWeight: 500,
                  fontSize: '0.9rem'
                }}
              >
                {deleteListSuccess && <CheckCircleIcon sx={{ color: '#10b981' }} />}
                {deleteListError && <ErrorOutlineIcon sx={{ color: '#f87171' }} />}
                <span>{deleteListSuccess ? 'List deleted' : 'Delete failed'}</span>
              </Box>
            )}
          </Box>

          <BarraLateral
            drawerOpen={drawerOpen}
            setDrawerOpen={setDrawerOpen}
            setFiltro={setFiltro}
          />

          <Dialogos
            openRecordatorio={openRecordatorio}
            handleCloseRecordatorio={handleCloseRecordatorio}
            openLista={openLista}
            handleCloseLista={handleCloseLista}
            handleSubmitRecordatorio={handleSubmitRecordatorio}
            handleCreateList={handleCreateList}
            nombre={nombre}
            setNombre={setNombre}
            descripcion={descripcion}
            setDescripcion={setDescripcion}
            fecha={fecha}
            setFecha={setFecha}
            hora={hora}
            setHora={setHora}
            nombreLista={nombreLista}
            setNombreLista={setNombreLista}
            listaSeleccionada={listaSeleccionada}
            setListaSeleccionada={setListaSeleccionada}
            listas={listas}
            recordatorioEditar={recordatorioEditar}
            setRecordatorioEditar={setRecordatorioEditar}
            openEditar={openEditar}
            setOpenEditar={setOpenEditar}
            handleSubmitEditar={handleSubmitEditar}
            handleCloseEditar={handleCloseEditar}
          />
        </Card>
      </Container>
    </ThemeProvider>
  );
}
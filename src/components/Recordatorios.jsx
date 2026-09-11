import AddIcon from '@mui/icons-material/Add';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import {
  Alert,
  Box,
  Container,
  CssBaseline,
  IconButton,
  Snackbar,
  Typography,
} from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../api/client';
import BarraLateral from './BarraLateral';
import Dialogos from './Dialogos';
import { TASKS_CHANGED_EVENT } from './github/githubUtils';
import useTaskLinks from './github/useTaskLinks';
import { GroupContext } from './GroupContext'; // Importa el contexto
import ListaRecordatorios from './ListaRecordatorios';
// Import new theme and UI components
import theme from '../theme/theme';
import Button from './ui/Button';
import Card from './ui/Card';



const organizarTareasEnListas = (tareas) => {
  const listasTemp = {};
  tareas.forEach(tarea => {
    if (!listasTemp[tarea.list]) listasTemp[tarea.list] = [];
    listasTemp[tarea.list].push(tarea);
  });
  return Object.keys(listasTemp).map(nombre => ({ nombre, recordatorios: listasTemp[nombre] }));
};

// Duración de la animación de completar/eliminar antes de quitar la tarjeta de la lista.
const COMPLETE_ANIMATION_MS = 3000;

const sameTask = (r, tid) => String(r.tid || r.id) === String(tid);
const mapTask = (listas, tid, fn) => listas.map(l => (
  l.recordatorios.some(r => sameTask(r, tid))
    ? { ...l, recordatorios: l.recordatorios.map(r => (sameTask(r, tid) ? fn(r) : r)) }
    : l
));
const dropTask = (listas, tid) => listas.map(l => (
  l.recordatorios.some(r => sameTask(r, tid))
    ? { ...l, recordatorios: l.recordatorios.filter(r => !sameTask(r, tid)) }
    : l
));
const withoutUiFlags = ({ __justCompleted, __justDeleted, ...task }) => task;
const remainingAnimation = (startedAt) => Math.max(0, COMPLETE_ANIMATION_MS - (Date.now() - startedAt));

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
  const { selectedGroupId, selectedGroupName } = useContext(GroupContext); // Usa el contexto para obtener el gid y el nombre
  const [feedback, setFeedback] = useState({ open: false, message: '', severity: 'error' });
  // One request per group for every task's branch/PR (not one per task).
  const { getLink: getTaskLink, repoConnected, refresh: refreshTaskLinks } = useTaskLinks(selectedGroupId);

  const notify = useCallback((message, severity = 'error') => setFeedback({ open: true, message, severity }), []);
  const notifyError = useCallback((err, fallback) => {
    if (err?.name === 'AbortError') return;
    notify(errorMessage(err, fallback), 'error');
  }, [notify]);
  const handleCloseFeedback = useCallback((event, reason) => {
    if (reason === 'clickaway') return;
    setFeedback(f => ({ ...f, open: false }));
  }, []);

  const cargarTareas = useCallback(async (signal) => {
    if (!selectedGroupId) {
      setListas([]);
      return;
    }
    try {
      const data = await api.get(`/api/tasks?gid=${selectedGroupId}`, { signal });
      const listasOrganizadas = organizarTareasEnListas(data?.data || []);
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
    } catch (err) {
      notifyError(err, 'Could not load tasks');
    }
  }, [selectedGroupId, notifyError]);

  const cargarCompletados = useCallback(async (signal) => {
    if (!selectedGroupId) { setCompletados([]); return; }

    try {
      const data = await api.get(`/api/completados/${selectedGroupId}`, { signal });
      setCompletados(data?.data || []);
    } catch (err) {
      notifyError(err, 'Could not load completed tasks');
    }
  }, [selectedGroupId, notifyError]);

  const cargarEliminados = useCallback(async (signal) => {
    if (!selectedGroupId) { setEliminados([]); return; }

    try {
      const data = await api.get(`/api/delete/${selectedGroupId}`, { signal });
      setEliminados(data?.data || []);
    } catch (err) {
      notifyError(err, 'Could not load deleted tasks');
    }
  }, [selectedGroupId, notifyError]);

  // Recargar tareas y completados cuando cambia el grupo (GroupContext ya restaura el grupo guardado)
  useEffect(() => {
    const controller = new AbortController();
    cargarTareas(controller.signal);
    cargarCompletados(controller.signal);
    return () => controller.abort();
  }, [cargarTareas, cargarCompletados]);

  useEffect(() => {
    const onTasksChanged = (event) => {
      const gid = event?.detail?.groupId;
      if (gid && String(gid).toLowerCase() !== String(selectedGroupId || '').toLowerCase()) return;
      cargarTareas();
      refreshTaskLinks();
    };
    window.addEventListener(TASKS_CHANGED_EVENT, onTasksChanged);
    return () => window.removeEventListener(TASKS_CHANGED_EVENT, onTasksChanged);
  }, [selectedGroupId, cargarTareas, refreshTaskLinks]);

  // Cargar eliminados solo cuando el filtro sea 'deleted'
  useEffect(() => {
    if (filtro !== 'deleted') return undefined;
    const controller = new AbortController();
    cargarEliminados(controller.signal);
    return () => controller.abort();
  }, [filtro, cargarEliminados]);


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
      const data = await api.post('/api/tasks', nuevaTarea);
      const nueva = { ...nuevaTarea, tid: data?.data?.tid };

      // Actualizar el estado local con la nueva tarea (creando la lista si no existe)
      setListas(prevListas => {
        const existe = prevListas.some(lista => lista.nombre === listaSeleccionada);
        if (!existe) return [...prevListas, { nombre: listaSeleccionada, recordatorios: [nueva] }];
        return prevListas.map(lista => (
          lista.nombre === listaSeleccionada
            ? { ...lista, recordatorios: [...lista.recordatorios, nueva] }
            : lista
        ));
      });

      setOpenRecordatorio(false);
      setNombre('');
      setDescripcion('');
      setFecha('');
      setHora('');
    } catch (err) {
      notifyError(err, 'Could not create the task');
    }
  };

  // Atomic delete on the server (moves the task to the deleted list in one transaction).
  // Resolves true when deleted; on failure the card is restored (or dropped if it no longer exists).
  const handleEliminar = useCallback(async (listaNombre, task) => {
    if (!task?.tid) return false;
    const { tid } = task;
    const original = withoutUiFlags(task);
    const startedAt = Date.now();

    setListas(prev => mapTask(prev, tid, r => ({ ...r, __justDeleted: true })));
    try {
      await api.post(`/api/tasks/${tid}/trash`);
    } catch (err) {
      if (err?.code === 'TASK_NOT_FOUND') {
        setListas(prev => dropTask(prev, tid));
        notify('This task no longer exists. The list was refreshed.', 'warning');
        cargarTareas();
      } else {
        setListas(prev => mapTask(prev, tid, () => original));
        notifyError(err, 'Could not delete the task');
      }
      return false;
    }
    setTimeout(() => setListas(prev => dropTask(prev, tid)), remainingAnimation(startedAt));
    cargarEliminados();
    refreshTaskLinks();
    return true;
  }, [cargarTareas, cargarEliminados, notify, notifyError, refreshTaskLinks]);

  // Atomic completion on the server ('completed' and 'already_completed' are both success).
  // `restore` maps the card back when the request fails for any reason other than a missing task.
  const completarEnServidor = useCallback(async (tid, restore) => {
    const startedAt = Date.now();
    try {
      await api.post(`/api/tasks/${tid}/complete`);
    } catch (err) {
      if (err?.code === 'TASK_NOT_FOUND') {
        setListas(prev => dropTask(prev, tid));
        notify('This task no longer exists. The list was refreshed.', 'warning');
        cargarTareas();
      } else {
        setListas(prev => mapTask(prev, tid, restore));
        notifyError(err, 'Could not complete the task');
      }
      return false;
    }
    setTimeout(() => setListas(prev => dropTask(prev, tid)), remainingAnimation(startedAt));
    cargarCompletados();
    refreshTaskLinks();
    return true;
  }, [cargarTareas, cargarCompletados, notify, notifyError, refreshTaskLinks]);

  const handleCompletar = useCallback(async (listaNombre, task) => {
    if (!task?.tid) return false;
    const original = withoutUiFlags(task);
    setListas(prev => mapTask(prev, task.tid, r => ({ ...r, percentage: 100, __justCompleted: true })));
    return completarEnServidor(task.tid, () => original);
  }, [completarEnServidor]);

  const handleEditar = useCallback((listaNombre, recordatorio) => {
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
      setRecordatorioEditar({ ...withoutUiFlags(recordatorio), datetime: normalizeLocal(recordatorio.datetime) });
      setOpenEditar(true);
    }
  }, []);

  const listasFiltradas = useMemo(() => {
    switch (filtro) {
      case 'today': {
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        const mañana = new Date(hoy.getTime() + 24 * 60 * 60 * 1000);
        return listas.map(lista => ({
          ...lista,
          recordatorios: lista.recordatorios.filter(r => {
            const f = new Date(r.datetime);
            return f >= hoy && f < mañana;
          })
        }));
      }
      case 'week': {
        const inicio = new Date();
        inicio.setHours(0, 0, 0, 0);
        inicio.setDate(inicio.getDate() - inicio.getDay());
        const fin = new Date(inicio);
        fin.setDate(fin.getDate() + 7);
        return listas.map(lista => ({
          ...lista,
          recordatorios: lista.recordatorios.filter(r => {
            const f = new Date(r.datetime);
            return f >= inicio && f < fin;
          })
        }));
      }
      case 'month': {
        const inicio = new Date();
        inicio.setDate(1);
        inicio.setHours(0, 0, 0, 0);
        const fin = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 0, 23, 59, 59, 999);
        return listas.map(lista => ({
          ...lista,
          recordatorios: lista.recordatorios.filter(r => {
            const f = new Date(r.datetime);
            return f >= inicio && f <= fin;
          })
        }));
      }
      case 'deleted':
        return [{ nombre: 'Deleted', recordatorios: eliminados }];
      case 'completed':
        return [{ nombre: 'Completed', recordatorios: completados }];
      default:
        return listas;
    }
  }, [filtro, listas, eliminados, completados]);

  const [deleteListSuccess, setDeleteListSuccess] = useState(false);
  const [deleteListError, setDeleteListError] = useState(false);

  const handleEliminarLista = useCallback(async (nombreLista) => {
    const gid = selectedGroupId;
    if (!gid) return;
    try {
      await api.del(`/api/tasks/list/${gid}/${encodeURIComponent(nombreLista)}`);
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
      } catch {
        // customLists corrupto: se ignora, la lista ya se quitó del estado
      }
      cargarTareas();
      setDeleteListError(false);
      setDeleteListSuccess(true);
      setTimeout(() => setDeleteListSuccess(false), 3000);
    } catch (err) {
      notifyError(err, 'Could not delete the list');
      setDeleteListSuccess(false);
      setDeleteListError(true);
      setTimeout(() => setDeleteListError(false), 4000);
    }
  }, [cargarTareas, selectedGroupId, notifyError]);

  const handleSubmitEditar = async () => {
    if (!recordatorioEditar?.tid || !selectedGroupId) return;
    const editado = withoutUiFlags(recordatorioEditar);
    const { tid } = editado;

    try {
      await api.put(`/api/tasks/${tid}`, {
        gid: selectedGroupId,
        name: editado.name,
        description: editado.description,
        list: editado.list,
        datetime: editado.datetime,
        percentage: editado.percentage,
      });
    } catch (err) {
      // El diálogo queda abierto para que el usuario pueda reintentar sin perder la edición.
      notifyError(err, 'Could not update the task');
      return;
    }
    handleCloseEditar();

    if (Number(editado.percentage) < 100) {
      setListas(prev => mapTask(prev, tid, () => editado));
      notify('Task updated', 'success');
      cargarTareas();
      return;
    }

    // Llegó a 100%: animación y completado atómico. El PUT ya guardó la edición, así que si
    // completar falla se conserva lo editado y solo se quita la animación.
    setListas(prev => mapTask(prev, tid, () => ({ ...editado, __justCompleted: true })));
    const ok = await completarEnServidor(tid, r => ({ ...r, __justCompleted: false }));
    if (ok) notify('Task completed', 'success');
  };

  const handleCloseEditar = () => {
    setOpenEditar(false);
    setRecordatorioEditar(null);
  };

  const getSectionTitle = () => {
    switch (filtro) {
      case 'today':
        return 'Today';
      case 'week':
        return 'This Week';
      case 'month':
        return 'This Month';
      case 'completed':
        return 'Completed';
      case 'deleted':
        return 'Deleted';
      case 'all':
        return 'All Tasks';
      default:
        return 'All Tasks';
    }
  };

  const handleVaciarEliminados = useCallback(async () => {
    if (!selectedGroupId) return;
    try {
      await api.del(`/api/delete/${selectedGroupId}`);
      setEliminados([]);
    } catch (err) {
      notifyError(err, 'Could not empty the deleted tasks');
    }
  }, [selectedGroupId, notifyError]);

  const handleVaciarCompletados = useCallback(async () => {
    if (!selectedGroupId) return;
    try {
      await api.del(`/api/completados/${selectedGroupId}`);
      setCompletados([]);
    } catch (err) {
      notifyError(err, 'Could not empty the completed tasks');
    }
  }, [selectedGroupId, notifyError]);

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
              Tasks {selectedGroupId && `(${listasFiltradas.reduce((sum, l) => sum + (l.recordatorios?.length || 0), 0)})`} {selectedGroupName && `- ${selectedGroupName}`}
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
              listas={listasFiltradas}
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
              getTaskLink={getTaskLink}
              repoConnected={repoConnected}
              onTaskLinkChange={refreshTaskLinks}
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
        <Snackbar
          open={feedback.open}
          autoHideDuration={4000}
          onClose={handleCloseFeedback}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert onClose={handleCloseFeedback} severity={feedback.severity} sx={{ width: '100%' }}>
            {feedback.message}
          </Alert>
        </Snackbar>
      </Container>
    </ThemeProvider>
  );
}
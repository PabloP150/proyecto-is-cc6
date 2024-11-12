import AddIcon from '@mui/icons-material/Add';
import {
  Box,
  Button,
  Container,
  IconButton,
  Paper,
  Typography,
  CssBaseline,
} from '@mui/material';
import { blue } from '@mui/material/colors';
import React, { useState, useEffect, useContext, useCallback } from 'react';
import BarraLateral from './BarraLateral';
import Dialogos from './Dialogos';
import ListaRecordatorios from './ListaRecordatorios';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { GroupContext } from './GroupContext'; // Importa el contexto

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#4a90e2',
    },
    background: {
      default: 'transparent',
      paper: 'rgba(0, 0, 0, 0.6)',
    },
  },
});

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
  const [editando, setEditando] = useState(null);
  const [recordatorioEditar, setRecordatorioEditar] = useState(null);
  const [openEditar, setOpenEditar] = useState(false); // Estado para el diálogo de edición
  const { selectedGroupId, selectedGroupName, setSelectedGroupId, setSelectedGroupName } = useContext(GroupContext); // Usa el contexto para obtener el gid y el nombre

  const cargarTareas = useCallback(async () => {
    if (!selectedGroupId) {
      return;
    }
    try {
      const response = await fetch(`http://localhost:9000/api/tasks?gid=${selectedGroupId}`);
      if (response.ok) {
        const data = await response.json();
        const listasOrganizadas = organizarTareasEnListas(data.data);
        setListas(listasOrganizadas);
      } else {
        console.error('Error al cargar las tareas');
      }
    } catch (error) {
      console.error('Error en la solicitud:', error);
    }
  }, [selectedGroupId]);

  const cargarCompletados = useCallback(async () => {
    if (!selectedGroupId) return;

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
    if (!selectedGroupId) return;

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
    setOpenRecordatorio(true);
  };

  const handleCloseRecordatorio = () => {
    setOpenRecordatorio(false);
    setEditando(null);
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
    setListas([...listas, nuevaLista]);
    setNombreLista('');
    setOpenLista(false);
  };

  const handleSubmitRecordatorio = async (e) => {
    e.preventDefault();
    const fechaCompleta = `${fecha}T${hora}`; // Combina fecha y hora
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
        setEditando(null);
      } else {
        console.error('Error al agregar la tarea');
      }
    } catch (error) {
      console.error('Error en la solicitud:', error);
    }
  };

  const handleEliminar = async (listaNombre, idx) => {
    const listaActual = listas.find(lista => lista.nombre === listaNombre);
    const recordatorioEliminado = listaActual.recordatorios[idx];

    try {
      // Llamar a la API para eliminar la tarea
      const response = await fetch(`http://localhost:9000/api/tasks/${recordatorioEliminado.tid}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        // Llamar a la API para agregar a la lista de eliminados
        const eliminarResponse = await fetch('http://localhost:9000/api/delete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(recordatorioEliminado),
        });

        if (eliminarResponse.ok) {
          listaActual.recordatorios.splice(idx, 1);
          setListas([...listas]);
          cargarCompletados(); // Opcional: cargar completados si es necesario
        } else {
          console.error('Error al agregar a eliminados');
        }
      } else {
        console.error('Error al eliminar la tarea');
      }
    } catch (error) {
      console.error('Error en la solicitud:', error);
    }
  };

  const handleCompletar = async (listaNombre, idx) => {
    const listaActual = listas.find(lista => lista.nombre === listaNombre);
    const recordatorioCompletado = listaActual.recordatorios[idx];

    try {
      const response = await fetch(`http://localhost:9000/api/tasks/${recordatorioCompletado.tid}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        const completarResponse = await fetch('http://localhost:9000/api/completados', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(recordatorioCompletado),
        });

        if (completarResponse.ok) {
          setCompletados(prevCompletados => [...prevCompletados, recordatorioCompletado]);
          listaActual.recordatorios.splice(idx, 1);
          setListas([...listas]);
          cargarCompletados();
        } else {
          console.error('Error al agregar a completados');
        }
      } else {
        console.error('Error al eliminar la tarea');
      }
    } catch (error) {
      console.error('Error en la solicitud:', error);
    }
  };

  const handleEditar = (nombre, idx) => {
    const recordatorio = listas.find(lista => lista.nombre === nombre)?.recordatorios[idx];
    if (recordatorio) {
      setRecordatorioEditar(recordatorio);
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

  const handleEliminarLista = async (nombreLista) => {
    const gid = localStorage.getItem('selectedGroupId');
    if (!gid) {
      console.error('No hay grupo seleccionado');
      return;
    }

    if (window.confirm(`¿Estás seguro de que deseas eliminar la lista "${nombreLista}" y todas sus tareas?`)) {
      try {
        const response = await fetch(`http://localhost:9000/api/tasks/list/${gid}/${encodeURIComponent(nombreLista)}`, {
          method: 'DELETE',
        });

        if (response.ok) {
          setListas(prevListas => prevListas.filter(lista => lista.nombre !== nombreLista));
          cargarTareas();
        } else {
          console.error('Error al eliminar la lista');
        }
      } catch (error) {
        console.error('Error en la solicitud:', error);
      }
    }
  };

  const handleSubmitEditar = async () => {
    if (!recordatorioEditar?.tid) {
        console.error('El TID es undefined. Asegúrate de que el recordatorio se haya seleccionado correctamente.');
        return; 
    }
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
        const updatedRecordatorio = await response.json();

        // Actualizar el estado local
        setListas(prevListas => {
            return prevListas.map(lista => {
                if (lista.nombre === updatedRecordatorio.list) {
                    return {
                        ...lista,
                        recordatorios: lista.recordatorios.map(recordatorio => 
                            recordatorio.tid === updatedRecordatorio.tid ? updatedRecordatorio : recordatorio
                        ),
                    };
                }
                return lista;
            });
        });
        cargarTareas();

        handleCloseEditar();
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
          width: '100%',
          height: '100%',
          backgroundImage: 'url(/1.jpeg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          zIndex: -1,
        }}
      />
      <Container 
        component="main" 
        maxWidth="lg" 
        sx={{ 
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          pt: 12,
          pb: 4,
          overflow: 'hidden',
        }}
      >
        <Paper 
          elevation={6} 
          sx={{ 
            p: 4, 
            backgroundColor: 'background.paper',
            borderRadius: 2,
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            overflow: 'hidden',
            color: 'white',
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography component="h1" variant="h4" sx={{ color: blue[300], fontWeight: 'bold' }}>
              Tasks {selectedGroupName && `- ${selectedGroupName}`}
            </Typography>
            <IconButton onClick={() => setDrawerOpen(true)} sx={{ color: 'white' }}>
              <AddIcon fontSize="large" />
            </IconButton>
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
            {filtro !== 'completed' && filtro !== 'deleted' && (
              <Button
                variant="contained"
                onClick={handleOpenLista}
                sx={{ backgroundColor: blue[700], color: 'white', borderRadius: 50, '&:hover': { backgroundColor: blue[800] } }}
                startIcon={<AddIcon />}
              >
                Add List
              </Button>
            )}
            <Typography variant="h6" sx={{ color: 'white', alignSelf: 'center' }}>
              {getSectionTitle()}
            </Typography>
            {filtro !== 'completed' && filtro !== 'deleted' && (
              <Button
                variant="contained"
                onClick={handleOpenRecordatorio}
                sx={{ backgroundColor: blue[700], color: 'white', borderRadius: 50, '&:hover': { backgroundColor: blue[800] } }}
                startIcon={<AddIcon />}
              >
                Add Task
              </Button>
            )}
          </Box>

          <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
            <ListaRecordatorios
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
            />
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
        </Paper>
      </Container>
    </ThemeProvider>
  );
}

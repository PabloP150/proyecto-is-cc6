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
import { blue} from '@mui/material/colors';
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

  useEffect(() => {
    const storedGroupId = localStorage.getItem('selectedGroupId');
    const storedGroupName = localStorage.getItem('selectedGroupName');
    
    if (storedGroupId) {
      setSelectedGroupId(storedGroupId);
      setSelectedGroupName(storedGroupName);
    }

    cargarTareas();
  }, [setSelectedGroupId, setSelectedGroupName, cargarTareas]);

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

  const handleEliminar = (listaNombre, idx) => {
    const listaActual = listas.find(lista => lista.nombre === listaNombre);
    const recordatorioEliminado = listaActual.recordatorios.splice(idx, 1)[0];
    recordatorioEliminado.listaOriginal = listaNombre; // Agregar lista original
    setEliminados([...eliminados, recordatorioEliminado]);
    setListas([...listas]);
  };

  const handleCompletar = (listaNombre, idx) => {
    const listaActual = listas.find(lista => lista.nombre === listaNombre);
    const recordatorioCompletado = listaActual.recordatorios.splice(idx, 1)[0];
    recordatorioCompletado.listaOriginal = listaNombre; // Agregar lista original
    setCompletados([...completados, recordatorioCompletado]);
    setListas([...listas]);
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
      case 'hoy':
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        return listas.map(lista => ({
          ...lista,
          recordatorios: lista.recordatorios.filter(recordatorio => {
            const fechaRecordatorio = new Date(recordatorio.datetime);
            return fechaRecordatorio >= hoy && fechaRecordatorio < new Date(hoy.getTime() + 24 * 60 * 60 * 1000);
          })
        }));
      case 'semana':
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
      case 'mes':
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
      case 'todos':
        return listas;
      case 'eliminados':
        return [{ nombre: 'Eliminados', recordatorios: eliminados }];
      case 'completados':
        return [{ nombre: 'Completados', recordatorios: completados }];
      default:
        return listas;
    }
  };

  const handleRestaurar = (nombreLista, idx) => {
    const recordatorio = filtro === 'eliminados' ? eliminados[idx] : completados[idx];
    const listaOriginal = listas.find(lista => lista.nombre === recordatorio.listaOriginal);

    if (listaOriginal) {
      listaOriginal.recordatorios.push(recordatorio);
      setListas([...listas]);

      if (filtro === 'eliminados') {
        setEliminados(eliminados.filter((_, i) => i !== idx));
      } else {
        setCompletados(completados.filter((_, i) => i !== idx));
      }
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
            <Button
              variant="contained"
              onClick={handleOpenLista}
              sx={{ backgroundColor: blue[700], color: 'white', borderRadius: 50, '&:hover': { backgroundColor: blue[800] } }}
              startIcon={<AddIcon />}
            >
              Add List
            </Button>
            <Button
              variant="contained"
              onClick={handleOpenRecordatorio}
              sx={{ backgroundColor: blue[700], color: 'white', borderRadius: 50, '&:hover': { backgroundColor: blue[800] } }}
              startIcon={<AddIcon />}
            >
              Add Task
            </Button>
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
              handleRestaurar={handleRestaurar}
              handleEliminarLista={handleEliminarLista}
              sx={{ color: 'white' }}
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

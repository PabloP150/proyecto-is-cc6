import React, { useState } from 'react';
import {
  Container,
  Button,
  Typography,
  Box,
  Paper,
  IconButton,
} from '@mui/material';
import { blue, grey } from '@mui/material/colors';
import AddIcon from '@mui/icons-material/Add';
import ListaRecordatorios from './ListaRecordatorios';
import BarraLateral from './BarraLateral';
import Dialogos from './Dialogos';

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

  const handleSubmitRecordatorio = (e) => {
    e.preventDefault();
    const nuevoRecordatorio = { nombre, descripcion, fecha, hora, fechaCreacion: new Date() };

    if (editando !== null) {
      // Encuentra la lista original y el recordatorio que se está editando
      const listaOriginal = listas.find(lista => lista.recordatorios.includes(listas.find(lista => lista.nombre === listaSeleccionada).recordatorios[editando]));
      
      // Eliminar de la lista original
      if (listaOriginal) {
        listaOriginal.recordatorios.splice(editando, 1);
      }
    }

    // Agregar el recordatorio a la lista seleccionada
    const listaActual = listas.find(lista => lista.nombre === listaSeleccionada);
    if (listaActual) {
      listaActual.recordatorios.push(nuevoRecordatorio);
    }

    // Actualizar el estado
    setListas([...listas]);
    setOpenRecordatorio(false);
    setNombre('');
    setDescripcion('');
    setFecha('');
    setHora('');
    setEditando(null);
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

  const handleEditar = (listaNombre, idx) => {
    const listaActual = listas.find(lista => lista.nombre === listaNombre);
    const recordatorio = listaActual.recordatorios[idx];
    setNombre(recordatorio.nombre);
    setDescripcion(recordatorio.descripcion);
    setFecha(recordatorio.fecha);
    setHora(recordatorio.hora);
    setListaSeleccionada(listaNombre);
    setEditando(idx);
    setOpenRecordatorio(true);
  };

  const filtrarRecordatorios = () => {
    switch (filtro) {
      case 'hoy':
        return listas.map(lista => ({
          ...lista,
          recordatorios: lista.recordatorios.filter(recordatorio => {
              const hoy = new Date();
              const fechaRecordatorio = new Date(recordatorio.fecha);
              return fechaRecordatorio.toDateString() === hoy.toDateString();
            }),
        }));
      case 'mes':
        return listas.map(lista => ({
          ...lista,
          recordatorios: lista.recordatorios.filter(recordatorio => {
              const hoy = new Date();
              const fechaRecordatorio = new Date(recordatorio.fecha);
              return (
                fechaRecordatorio.getMonth() === hoy.getMonth() &&
                fechaRecordatorio.getFullYear() === hoy.getFullYear()
              );
            }),
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

  return (
    <Container component="main" maxWidth="lg" sx={{ mt: 8 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography component="h1" variant="h4" sx={{ color: blue[600], fontWeight: 'bold' }}>
          Recordatorios
        </Typography>
        <IconButton onClick={() => setDrawerOpen(true)} sx={{ color: grey[700] }}>
          <AddIcon fontSize="large" />
        </IconButton>
      </Box>

      <BarraLateral
        drawerOpen={drawerOpen}
        setDrawerOpen={setDrawerOpen}
        setFiltro={setFiltro}
      />

      <Paper elevation={6} sx={{ p: 4, backgroundColor: grey[50] }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
          <Button
            variant="contained"
            onClick={handleOpenRecordatorio}
            sx={{ backgroundColor: blue[600], color: 'white', borderRadius: 50 }}
            startIcon={<AddIcon />}
          >
            Agregar Recordatorio
          </Button>
          <Button
            variant="contained"
            onClick={handleOpenLista}
            sx={{ backgroundColor: blue[600], color: 'white', borderRadius: 50 }}
            startIcon={<AddIcon />}
          >
            Agregar Lista
          </Button>
        </Box>

        <ListaRecordatorios
          listas={filtrarRecordatorios()}
          handleEliminar={handleEliminar}
          handleCompletar={handleCompletar}
          handleEditar={handleEditar}
          orden={orden}
          setOrden={setOrden}
          filtro={filtro}
          handleRestaurar={handleRestaurar}
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
        />
      </Paper>
    </Container>
  );
}

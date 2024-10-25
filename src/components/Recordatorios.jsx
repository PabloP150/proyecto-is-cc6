import AddIcon from '@mui/icons-material/Add';
import {
  Box,
  Button,
  Container,
  IconButton,
  Paper,
  Typography,
} from '@mui/material';
import { blue, grey } from '@mui/material/colors';
import React, { useState } from 'react';
import BarraLateral from './BarraLateral';
import Dialogos from './Dialogos';
import ListaRecordatorios from './ListaRecordatorios';

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

  const handleSubmitRecordatorio = async (e) => {
    e.preventDefault();
    const fechaCompleta = `${fecha}T${hora}`; // Combina fecha y hora
    const nuevaTarea = { nombre, descripcion, fecha: fechaCompleta };

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
        console.log(data.message);

        // Actualizar el estado local
        if (editando !== null) {
          const listaOriginal = listas.find(lista => lista.recordatorios.some((_, i) => i === editando));
          if (listaOriginal) {
            listaOriginal.recordatorios.splice(editando, 1);
          }
        }

        const listaActual = listas.find(lista => lista.nombre === listaSeleccionada);
        if (listaActual) {
          listaActual.recordatorios.push(nuevaTarea);
        }

        setListas([...listas]);
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

            // Ajuste para comparar solo año, mes y día
            return (
              fechaRecordatorio.getUTCDate() === hoy.getUTCDate() &&
              fechaRecordatorio.getUTCMonth() === hoy.getUTCMonth() &&
              fechaRecordatorio.getUTCFullYear() === hoy.getUTCFullYear()
            );
          }),
        }));
      case 'mes':
        return listas.map(lista => ({
          ...lista,
          recordatorios: lista.recordatorios.filter(recordatorio => {
            const mes = new Date();
            const fechaRecordatorio = new Date(recordatorio.fecha);
            return (
              fechaRecordatorio.getUTCMonth() === mes.getUTCMonth() &&
              fechaRecordatorio.getUTCFullYear() === mes.getUTCFullYear()
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

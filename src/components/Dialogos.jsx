// src/components/Dialogos.jsx
import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, Box, MenuItem } from '@mui/material';
import { blue } from '@mui/material/colors';

export default function Dialogos({
  openRecordatorio,
  handleCloseRecordatorio,
  openLista,
  handleCloseLista,
  handleSubmitRecordatorio,
  handleCreateList,
  nombre,
  setNombre,
  descripcion,
  setDescripcion,
  fecha,
  setFecha,
  hora,
  setHora,
  nombreLista,
  setNombreLista,
  listaSeleccionada,
  setListaSeleccionada,
  listas,
}) {
  return (
    <>
      {/* Diálogo para agregar una nueva lista */}
      <Dialog open={openLista} onClose={handleCloseLista}>
        <DialogTitle>Agregar Nueva Lista</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="normal"
            id="nombreLista"
            label="Nombre de la Lista"
            type="text"
            fullWidth
            value={nombreLista}
            onChange={e => setNombreLista(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseLista}>Cancelar</Button>
          <Button onClick={handleCreateList} color="primary">
            Agregar
          </Button>
        </DialogActions>
      </Dialog>

      {/* Diálogo para agregar un nuevo recordatorio */}
      <Dialog open={openRecordatorio} onClose={handleCloseRecordatorio}>
        <DialogTitle>Agregar Recordatorio</DialogTitle>
        <DialogContent>
          <Box component="form" onSubmit={handleSubmitRecordatorio} noValidate>
            <TextField
              margin="normal"
              required
              fullWidth
              id="nombre"
              label="Nombre"
              name="nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              margin="normal"
              required
              fullWidth
              id="descripcion"
              label="Descripción"
              name="descripcion"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              margin="normal"
              required
              fullWidth
              id="fecha"
              label="Fecha Final"
              type="date"
              InputLabelProps={{
                shrink: true,
              }}
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
            <TextField
              margin="normal"
              fullWidth
              id="hora"
              label="Hora (opcional)"
              type="time"
              InputLabelProps={{
                shrink: true,
              }}
              value={hora}
              onChange={(e) => setHora(e.target.value)}
            />
            <TextField
              margin="normal"
              required
              fullWidth
              id="listaSeleccionada"
              label="Seleccionar Lista"
              select
              value={listaSeleccionada}
              onChange={(e) => setListaSeleccionada(e.target.value)}
            >
              {listas.map((lista, index) => (
                <MenuItem key={index} value={lista.nombre}>
                  {lista.nombre}
                </MenuItem>
              ))}
            </TextField>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseRecordatorio}>Cancelar</Button>
          <Button type="submit" onClick={handleSubmitRecordatorio} variant="contained" sx={{ backgroundColor: blue[600] }}>
            Agregar
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

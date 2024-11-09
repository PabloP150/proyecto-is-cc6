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
      <Dialog 
        open={openLista} 
        onClose={handleCloseLista}
        PaperProps={{
          style: {
            backgroundColor: '#333333', // Color gris oscuro
          },
        }}
      >
        <DialogTitle sx={{ color: 'white' }}>Agregar Nueva Lista</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            id="nombreLista"
            label="Nombre de la Lista"
            type="text"
            fullWidth
            value={nombreLista}
            onChange={(e) => setNombreLista(e.target.value)}
            sx={{
              '& .MuiOutlinedInput-root': {
                '& fieldset': {
                  borderColor: 'white',
                },
                '&:hover fieldset': {
                  borderColor: 'white',
                },
                '&.Mui-focused fieldset': {
                  borderColor: 'white',
                },
              },
              '& .MuiInputLabel-root': {
                color: 'white',
              },
              '& .MuiInputBase-input': {
                color: 'white',
              },
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseLista} sx={{ color: 'white' }}>CANCELAR</Button>
          <Button onClick={handleCreateList} sx={{ color: 'white' }}>AGREGAR</Button>
        </DialogActions>
      </Dialog>

      {/* Diálogo para agregar un nuevo recordatorio (tarea) */}
      <Dialog 
        open={openRecordatorio} 
        onClose={handleCloseRecordatorio}
        PaperProps={{
          style: {
            backgroundColor: '#333333', // Color gris oscuro
          },
        }}
      >
        <DialogTitle sx={{ color: 'white' }}>Agregar Recordatorio</DialogTitle>
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
              sx={textFieldStyle}
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
              sx={textFieldStyle}
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
              sx={textFieldStyle}
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
              sx={textFieldStyle}
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
              sx={textFieldStyle}
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
          <Button onClick={handleCloseRecordatorio} sx={{ color: 'white' }}>Cancelar</Button>
          <Button type="submit" onClick={handleSubmitRecordatorio} variant="contained" sx={{ backgroundColor: blue[600] }}>
            Agregar
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

const textFieldStyle = {
  '& .MuiOutlinedInput-root': {
    '& fieldset': {
      borderColor: 'white',
    },
    '&:hover fieldset': {
      borderColor: 'white',
    },
    '&.Mui-focused fieldset': {
      borderColor: 'white',
    },
  },
  '& .MuiInputLabel-root': {
    color: 'white',
  },
  '& .MuiInputBase-input': {
    color: 'white',
  },
  '& .MuiSelect-icon': {
    color: 'white',
  },
};

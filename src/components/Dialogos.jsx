// src/components/Dialogos.jsx
import React, { useState } from 'react';
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
  recordatorioEditar,
  setRecordatorioEditar,
  openEditar,
  setOpenEditar,
  handleSubmitEditar,
  handleCloseEditar,
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
        <DialogTitle sx={{ color: 'white' }}>Add New List</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            id="nombreLista"
            label="List Name"
            type="text"
            fullWidth
            value={nombreLista}
            onChange={(e) => setNombreLista(e.target.value)}
            sx={textFieldStyle}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseLista} sx={{ color: 'white' }}>CANCEL</Button>
          <Button onClick={handleCreateList} sx={{ color: 'white' }}>ADD</Button>
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
        <DialogTitle sx={{ color: 'white' }}>Add Task</DialogTitle>
        <DialogContent>
          <Box component="form" onSubmit={handleSubmitRecordatorio} noValidate>
            <TextField
              margin="normal"
              required
              fullWidth
              id="nombre"
              label="Task Name"
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
              label="Description"
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
              label="Deadline"
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
              label="Time"
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
              label="Select List"
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
          <Button onClick={handleCloseRecordatorio} sx={{ color: 'white' }}>CANCEL</Button>
          <Button type="submit" onClick={handleSubmitRecordatorio} variant="contained" sx={{ backgroundColor: blue[600] }}>
            ADD
          </Button>
        </DialogActions>
      </Dialog>

      {/* Diálogo para editar un recordatorio */}
      <Dialog open={openEditar} onClose={handleCloseEditar} PaperProps={{
          style: {
            backgroundColor: '#333333', // Color gris oscuro
          },
        }}>
        <DialogTitle sx={{ color: 'white' }}>Edit Task</DialogTitle>
        <DialogContent>
          <TextField
            margin="normal"
            required
            fullWidth
            id="nombreEditar"
            label="Task Name"
            type="text"
            value={recordatorioEditar?.name || ''}
            onChange={(e) => setRecordatorioEditar({ ...recordatorioEditar, name: e.target.value })}
            InputLabelProps={{ shrink: true }}
            sx={{ color: 'white' }}
          />
          <TextField
            margin="normal"
            required
            fullWidth
            id="descripcionEditar"
            label="Description"
            type="text"
            value={recordatorioEditar?.description || ''}
            onChange={(e) => setRecordatorioEditar({ ...recordatorioEditar, description: e.target.value })}
            InputLabelProps={{ shrink: true }}
            sx={{ color: 'white' }}
          />
          <TextField
            margin="normal"
            required
            fullWidth
            id="fechaEditar"
            label="Date"
            type="date"
            value={recordatorioEditar?.datetime.split('T')[0] || ''}
            onChange={(e) => setRecordatorioEditar({ ...recordatorioEditar, datetime: e.target.value })}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            margin="normal"
            required
            fullWidth
            id="horaEditar"
            label="Time"
            type="time"
            value={recordatorioEditar?.datetime ? new Date(recordatorioEditar.datetime).toLocaleTimeString('it-IT').substring(0, 5) : ''}
            onChange={(e) => {
              const newTime = e.target.value;
              setHora(newTime);
              setRecordatorioEditar({
                ...recordatorioEditar,
                datetime: `${recordatorioEditar?.datetime.split('T')[0]}T${newTime}`
              });
            }}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            margin="normal"
            required
            fullWidth
            id="porcentajeEditar"
            label="Percentage"
            select
            value={recordatorioEditar?.percentage || 0}
            onChange={(e) => {
              const selectedPercentage = Number(e.target.value);
                setRecordatorioEditar({ ...recordatorioEditar, percentage: selectedPercentage });
            }}
            sx={textFieldStyle}
          >
            {[0,10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((value) => (
              <MenuItem key={value} value={value}>
                {value}%
              </MenuItem>
            ))}
          </TextField>
          <TextField
            margin="normal"
            required
            fullWidth
            id="listaSeleccionadaEditar"
            label="Select List"
            select
            value={recordatorioEditar?.list || ''}
            onChange={(e) => {
              const selectedList = e.target.value;
              setRecordatorioEditar({ ...recordatorioEditar, list: selectedList });
            }}
            sx={textFieldStyle}
          >
            {listas.map((lista, index) => (
              <MenuItem key={index} value={lista.nombre}>
                {lista.nombre}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseEditar} sx={{ color: 'white' }}>CANCEL</Button>
          <Button onClick={handleSubmitEditar} sx={{ color: 'white' }}>UPDATE</Button>
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

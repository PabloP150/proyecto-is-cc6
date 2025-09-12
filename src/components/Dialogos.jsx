// src/components/Dialogos.jsx
import { Box, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem } from '@mui/material';
import TextField from './ui/TextField';
import Button from './ui/Button';

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
  const isAddDisabled = !nombre?.trim() || !descripcion?.trim() || !fecha || !listaSeleccionada;
  return (
    <>
      {/* Diálogo para agregar una nueva lista */}
      <Dialog 
        open={openLista} 
        onClose={handleCloseLista}
        PaperProps={{
          style: {
            background: 'linear-gradient(135deg, rgba(30, 58, 138, 0.95) 0%, rgba(55, 65, 81, 0.98) 100%)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(59, 130, 246, 0.2)',
            borderRadius: '14px',
          },
        }}
      >
        <DialogTitle sx={{ 
          color: 'white', 
          fontWeight: 600,
          background: 'linear-gradient(90deg, #3b82f6 0%, #f59e0b 100%)',
          backgroundClip: 'text',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}>
          Add New List
        </DialogTitle>
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
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions sx={{ p: 3, gap: 2 }}>
          <Button variant="ghost" onClick={handleCloseLista}>
            CANCEL
          </Button>
          <Button variant="primary" onClick={handleCreateList}>
            ADD
          </Button>
        </DialogActions>
      </Dialog>

      {/* Diálogo para agregar un nuevo recordatorio (tarea) */}
      <Dialog 
        open={openRecordatorio} 
        onClose={handleCloseRecordatorio}
        PaperProps={{
          style: {
            background: 'linear-gradient(135deg, rgba(30, 58, 138, 0.95) 0%, rgba(55, 65, 81, 0.98) 100%)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(59, 130, 246, 0.2)',
            borderRadius: '14px',
          },
        }}
      >
        <DialogTitle sx={{ 
          color: 'white', 
          fontWeight: 600,
          background: 'linear-gradient(90deg, #3b82f6 0%, #f59e0b 100%)',
          backgroundClip: 'text',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}>
          Add Task
        </DialogTitle>
        <DialogContent>
          <Box component="form" onSubmit={handleSubmitRecordatorio} noValidate sx={{ pt: 2 }}>
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
            >
              {listas.map((lista, index) => (
                <MenuItem key={index} value={lista.nombre} sx={{ color: 'white' }}>
                  {lista.nombre}
                </MenuItem>
              ))}
            </TextField>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 3, gap: 2 }}>
          <Button variant="ghost" onClick={handleCloseRecordatorio}>
            CANCEL
          </Button>
          <Button 
            variant="primary" 
            type="submit" 
            onClick={handleSubmitRecordatorio} 
            disabled={isAddDisabled}
          >
            ADD
          </Button>
        </DialogActions>
      </Dialog>

      {/* Diálogo para editar un recordatorio */}
      <Dialog open={openEditar} onClose={handleCloseEditar} PaperProps={{
          style: {
            background: 'linear-gradient(135deg, rgba(30, 58, 138, 0.95) 0%, rgba(55, 65, 81, 0.98) 100%)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(59, 130, 246, 0.2)',
            borderRadius: '14px',
          },
        }}>
        <DialogTitle sx={{ 
          color: 'white', 
          fontWeight: 600,
          background: 'linear-gradient(90deg, #3b82f6 0%, #f59e0b 100%)',
          backgroundClip: 'text',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}>
          Edit Task
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
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
          />
          <TextField
            margin="normal"
            required
            fullWidth
            id="fechaEditar"
            label="Date"
            type="date"
            value={recordatorioEditar?.datetime.split('T')[0] || ''}
            onChange={(e) => {
              const newDate = e.target.value;
              // Preservar la hora existente (HH:mm) o usar 00:00 si no hay
              const existingTime = (() => {
                const dt = recordatorioEditar?.datetime || '';
                const timePart = dt.includes('T') ? dt.split('T')[1] : '';
                if (timePart) {
                  return timePart.substring(0, 5);
                }
                // Si no hay hora previa, usar la del estado `hora` si existe
                if (typeof hora === 'string' && hora.length >= 4) return hora.substring(0,5);
                return '00:00';
              })();
              setRecordatorioEditar({ ...recordatorioEditar, datetime: `${newDate}T${existingTime}` });
            }}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            margin="normal"
            required
            fullWidth
            id="horaEditar"
            label="Time"
            type="time"
            value={(() => {
              if (!recordatorioEditar?.datetime) return '';
              // Obtener HH:mm de forma consistente en hora local
              const dtStr = recordatorioEditar.datetime;
              if (dtStr.includes('T')) {
                const t = dtStr.split('T')[1].substring(0,5);
                if (/^\d{2}:\d{2}$/.test(t)) return t;
              }
              const d = new Date(dtStr);
              const hh = String(d.getHours()).padStart(2,'0');
              const mm = String(d.getMinutes()).padStart(2,'0');
              return `${hh}:${mm}`;
            })()}
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
          >
            {[0,10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((value) => (
              <MenuItem key={value} value={value} sx={{ color: 'white' }}>
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
          >
            {listas.map((lista, index) => (
              <MenuItem key={index} value={lista.nombre} sx={{ color: 'white' }}>
                {lista.nombre}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions sx={{ p: 3, gap: 2 }}>
          <Button variant="ghost" onClick={handleCloseEditar}>
            CANCEL
          </Button>
          <Button variant="primary" onClick={handleSubmitEditar}>
            UPDATE
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}



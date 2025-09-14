import EmojiEmotionsIcon from '@mui/icons-material/EmojiEmotions';
import PaletteIcon from '@mui/icons-material/Palette';
import { Box, Button, InputAdornment, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';

// Lista de iconos sugeridos (puedes expandirla)
const ICON_OPTIONS = [
  'star', 'group', 'leaderboard', 'check_circle', 'assignment', 'emoji_events', 'person', 'admin_panel_settings', 'visibility', 'edit', 'delete'
];

const RoleForm = ({ initialData = {}, onSubmit, onCancel, loading }) => {
  const [name, setName] = useState(initialData.gr_name || '');
  const [desc, setDesc] = useState(initialData.gr_desc || '');
  const [color, setColor] = useState(initialData.gr_color || '#1976d2');
  const [icon, setIcon] = useState(initialData.gr_icon || 'star');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({ gr_name: name, gr_desc: desc, gr_color: color, gr_icon: icon });
  };

  return (
    <Box component="form" onSubmit={handleSubmit} p={2} minWidth={300}>
      <Stack spacing={2}>
        <Typography variant="h6">{initialData.gr_id ? 'Editar rol' : 'Nuevo rol'}</Typography>
        <TextField
          label="Nombre"
          value={name}
          onChange={e => setName(e.target.value)}
          required
          autoFocus
        />
        <TextField
          label="Descripción"
          value={desc}
          onChange={e => setDesc(e.target.value)}
          multiline
          minRows={2}
        />
        <TextField
          label="Color"
          type="color"
          value={color}
          onChange={e => setColor(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <PaletteIcon style={{ color }} />
              </InputAdornment>
            ),
          }}
        />
        <TextField
          label="Icono"
          select
          value={icon}
          onChange={e => setIcon(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <EmojiEmotionsIcon />
              </InputAdornment>
            ),
          }}
        >
          {ICON_OPTIONS.map(opt => (
            <MenuItem key={opt} value={opt} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <span className="material-icons" style={{ marginRight: 8 }}>{opt}</span>
              <span style={{ textTransform: 'capitalize' }}>{opt.replace(/_/g, ' ')}</span>
            </MenuItem>
          ))}
        </TextField>
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button onClick={onCancel} disabled={loading}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={loading || !name.trim()}>
            {initialData.gr_id ? 'Guardar' : 'Crear'}
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
};

export default RoleForm;

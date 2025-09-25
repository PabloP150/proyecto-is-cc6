import EmojiEmotionsIcon from '@mui/icons-material/EmojiEmotions';
import PaletteIcon from '@mui/icons-material/Palette';
import { Autocomplete, Box, Button, InputAdornment, Popper, Stack, styled, TextField, Typography } from '@mui/material';
import { useState } from 'react';

const ICON_OPTIONS = [
  // Productividad y gestión
  'dashboard',        // Dashboard principal
  'assignment',       // Tareas
  'check_circle',     // Completado
  'pending_actions',  // Pendiente
  'event',            // Calendario/eventos
  'group',            // Equipo
  'person',           // Usuario
  'supervisor_account', // Líder/manager
  'admin_panel_settings', // Admin
  'emoji_events',     // Logros
  'star',             // Destacado
  'leaderboard',      // Ranking
  'insights',         // Insights/analítica
  'timeline',         // Progreso
  'workspaces',       // Espacios de trabajo
  // Desarrollo
  'code',             // Código
  'terminal',         // Terminal
  'bug_report',       // Bug/QA
  'build',            // Build/CI
  'cloud',            // Cloud
  'storage',          // Almacenamiento
  'api',              // API
  'integration_instructions', // Integraciones
  'extension',        // Extensiones/plugins
  // Comunicación y colaboración
  'chat',             // Chat
  'forum',            // Foro
  'comment',          // Comentario
  'notifications',    // Notificaciones
  'visibility',       // Visibilidad
  // Otros útiles
  'edit',             // Editar
  'delete',           // Eliminar
  'settings',         // Configuración
  'lock',             // Privado
  'public',           // Público
  'favorite',         // Favorito
  'help',             // Ayuda
];

const RoleForm = ({ initialData = {}, onSubmit, onCancel, loading }) => {
  const [name, setName] = useState(initialData.gr_name || '');
  const [color, setColor] = useState(initialData.gr_color || '#1976d2');
  const [icon, setIcon] = useState(initialData.gr_icon || 'star');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
  onSubmit({ gr_name: name, gr_color: color, gr_icon: icon });
  };

  return (
    <Box component="form" onSubmit={handleSubmit} p={2} minWidth={300}>
      <Stack spacing={2}>
        <Typography variant="h6">{initialData.gr_id ? 'Edit Role' : 'New Role'}</Typography>
        <TextField
          label="Name"
          value={name}
          onChange={e => setName(e.target.value)}
          required
          autoFocus
        />
        {/* Description removed */}
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
        <Autocomplete
          options={ICON_OPTIONS}
          value={icon}
          onChange={(_, newValue) => setIcon(newValue || '')}
          disableClearable
          autoHighlight
          getOptionLabel={opt => opt.replace(/_/g, ' ')}
          renderOption={(props, opt) => {
            const { key, ...rest } = props;
            return (
              <li key={key} {...rest} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="material-icons" style={{ fontSize: 22 }}>{opt}</span>
                <span style={{ textTransform: 'capitalize' }}>{opt.replace(/_/g, ' ')}</span>
              </li>
            );
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Icon"
              InputProps={{
                ...params.InputProps,
                startAdornment: (
                  <InputAdornment position="start">
                    <EmojiEmotionsIcon />
                  </InputAdornment>
                ),
              }}
            />
          )}
          PopperComponent={styled(Popper)(({ theme }) => ({
            zIndex: 1302,
            '.MuiAutocomplete-paper': {
              background: '#222b45',
              color: '#fff',
              borderRadius: 8,
              boxShadow: '0 4px 24px 0 rgba(0,0,0,0.25)',
              marginTop: 4,
            },
            '.MuiAutocomplete-option': {
              minHeight: 36,
              '&[aria-selected="true"]': {
                background: '#19223a',
              },
            },
          }))}
        />
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button onClick={onCancel} disabled={loading}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={loading || !name.trim()}>
            {initialData.gr_id ? 'Save' : 'Create'}
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
};

export default RoleForm;

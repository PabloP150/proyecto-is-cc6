import {
    Alert,
    Box,
    Button,
    Container,
    CssBaseline,
    Paper,
    TextField,
    Typography,
} from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { useContext, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { GroupContext } from './GroupContext';

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

function CreateGroup() {
  const [groupName, setGroupName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const { setSelectedGroupId, setSelectedGroupName, refreshGroups } = useContext(GroupContext);

  const handleCreateGroup = async (e) => {
    e.preventDefault();
    const userId = localStorage.getItem('userId');
    if (!userId) {
      setError('No se encontró la sesión del usuario. Vuelve a iniciar sesión.');
      return;
    }
    const name = groupName.trim();
    if (!name) {
      setError('El nombre del grupo no puede estar vacío.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const data = await api.post('/api/groups/group', { adminId: userId, name });
      if (data?.gid) {
        setSelectedGroupId(data.gid);
        setSelectedGroupName(name);
      }
      refreshGroups().catch(() => {});
      navigate('/tasks');
    } catch (err) {
      setError(err.message || 'No se pudo crear el grupo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'background.default',
        }}
      >
        <Container component="main" maxWidth="xs" sx={{ mt: 8 }}>
          <Paper elevation={6} sx={{ p: 4, backgroundColor: 'background.paper', borderRadius: 2 }}>
            <Typography component="h1" variant="h4" align="center" sx={{ mb: 3 }}>
              Nombre De Tu Grupo De Trabajo
            </Typography>
            <Box component="form" onSubmit={handleCreateGroup} noValidate>
              <TextField
                margin="normal"
                required
                fullWidth
                id="groupName"
                label="Nombre del grupo"
                name="groupName"
                autoComplete="off"
                autoFocus
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
              />
              {error && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {error}
                </Alert>
              )}
              <Button
                type="submit"
                fullWidth
                variant="contained"
                disabled={saving}
                sx={{ mt: 3, mb: 2, backgroundColor: 'grey.600' }}
              >
                Crear Grupo
              </Button>
            </Box>
          </Paper>
        </Container>
      </Box>
    </ThemeProvider>
  );
}

export default CreateGroup;

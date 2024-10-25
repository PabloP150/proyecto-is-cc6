import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Container,
  CssBaseline,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';

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
  const navigate = useNavigate();
  const [userId, setUserId] = useState('');

  useEffect(() => {
    const storedUserId = localStorage.getItem('userId');
    if (storedUserId) {
      setUserId(storedUserId);
    }
  }, []);

  const handleCreateGroup = async (e) => {
    e.preventDefault();
    const userId = localStorage.getItem('userId'); // Obtén el userId del localStorage
    console.log('User ID:', userId); // Verifica el formato aquí
    if (!userId) {
      console.error('User ID is not available');
      return;
    }
    try {
      const response = await fetch('http://localhost:9000/api/groups/group', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ adminId: userId, name: groupName }),
      });

      if (response.ok) {
        const data = await response.json();
        console.log(data.message);
        navigate('/recordatorios');
      } else {
        const errorData = await response.json();
        console.error(errorData.error);
      }
    } catch (error) {
      console.error('Error en la solicitud:', error);
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
          backgroundImage: 'url(/1.jpeg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          backgroundAttachment: 'fixed',
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
              <Button
                type="submit"
                fullWidth
                variant="contained"
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

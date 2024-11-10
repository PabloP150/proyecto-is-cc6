import React, { useState } from 'react';
import {
  Box,
  Container,
  TextField,
  Button,
  Link,
  Typography,
  CssBaseline,
  Paper
} from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';

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

function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch('http://localhost:9000/api/users/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      if (response.ok) {
        const data = await response.json();
        const userId = data.uid;
        localStorage.setItem('userId', userId);
        onLogin({ uid: userId, name: username });

        // Obtener los grupos del usuario
        const groupsResponse = await fetch(`http://localhost:9000/api/groups/user-groups?uid=${userId}`);
        if (groupsResponse.ok) {
          const groupsData = await groupsResponse.json();
          if (groupsData.groups.length > 0) {
            const firstGroup = groupsData.groups[0];
            localStorage.setItem('selectedGroupId', firstGroup.gid);
          }
        }

        navigate('/home');
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
            <Typography component="h1" variant="h4" align="center" sx={{ mb: 1 }}>
              Login
            </Typography>
            <Typography variant="body1" align="center" sx={{ mb: 3 }}>
              Welcome to TaskMate
            </Typography>
            <Box component="form" onSubmit={handleSubmit} noValidate>
              <TextField
                margin="normal"
                required
                fullWidth
                id="username"
                label="Username"
                name="username"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <TextField
                margin="normal"
                required
                fullWidth
                name="password"
                label="Password"
                type="password"
                id="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button
                type="submit"
                fullWidth
                variant="contained"
                sx={{ mt: 3, mb: 2, backgroundColor: 'grey.600' }}
              >
                SIGN IN
              </Button>
              <Link href="#" variant="body2" align="center" display="block">
                Forgot password?
              </Link>
              <Link href="/register" variant="body2" align="center" display="block" sx={{ mt: 2 }}>
                Don't have an account? Register here.
              </Link>
            </Box>
          </Paper>
        </Container>
      </Box>
    </ThemeProvider>
  );
}

export default Login;

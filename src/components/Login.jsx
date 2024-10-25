import React, { useState } from 'react';
import {
  AppBar,
  Toolbar,
  Typography,
  Container,
  TextField,
  Button,
  Link,
  Box,
  CssBaseline,
  IconButton,
  Paper
} from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import TwitterIcon from '@mui/icons-material/Twitter';
import InstagramIcon from '@mui/icons-material/Instagram';
import YouTubeIcon from '@mui/icons-material/YouTube';
import LinkedInIcon from '@mui/icons-material/LinkedIn';
import { useNavigate } from 'react-router-dom'; // Importa useNavigate

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

function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate(); // Inicializa useNavigate

  const handleSubmit = (e) => {
    e.preventDefault();
    console.log('Iniciar sesión con:', username, password);
    navigate('/recordatorios'); // Redirige a Recordatorios
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundImage: 'url(/1.jpeg)', // Sin el ../
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          backgroundAttachment: 'fixed',
        }}
      >
        <AppBar position="static" color="transparent" elevation={0}>
          <Toolbar sx={{ justifyContent: 'space-between' }}>
            <Typography 
              variant="h4" 
              component="div" 
              sx={{ 
                fontWeight: 'bold',
                fontSize: '2.5rem', // Aumentamos el tamaño de la fuente
                letterSpacing: '1px' // Añadimos un poco de espaciado entre letras
              }}
            >
              TaskMate
            </Typography>
            <Box>
              <Button color="inherit">TASKS</Button>
              <Button color="inherit">CALENDAR</Button>
              <Button color="inherit">FLOW DIAGRAMS</Button>
              <Button color="inherit">GROUPS</Button>
              <Button color="inherit">PROFILE</Button>
            </Box>
          </Toolbar>
        </AppBar>
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
                type="button"
                fullWidth
                variant="contained"
                sx={{ mt: 3, mb: 2, backgroundColor: '#4a90e2' }}
              >
                REGISTER
              </Button>
              <Button
                type="submit"
                fullWidth
                variant="contained"
                sx={{ mb: 2, backgroundColor: 'grey.600' }}
              >
                SIGN IN
              </Button>
              <Link href="#" variant="body2" align="center" display="block">
                Forgot password?
              </Link>
            </Box>
          </Paper>
        </Container>
        <Box sx={{ mt: 'auto', textAlign: 'center', pb: 2 }}>
          <IconButton color="inherit"><TwitterIcon /></IconButton>
          <IconButton color="inherit"><InstagramIcon /></IconButton>
          <IconButton color="inherit"><YouTubeIcon /></IconButton>
          <IconButton color="inherit"><LinkedInIcon /></IconButton>
        </Box>
      </Box>
    </ThemeProvider>
  );
}

export default Login;

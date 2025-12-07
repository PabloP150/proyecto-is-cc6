import React, { useState, useContext } from 'react';
import {
  Box,
  Container,
  Link,
  Typography,
  CssBaseline,
  IconButton,
  Alert,
  Fade,
  Grow
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { GroupContext } from './GroupContext';
import { Visibility, VisibilityOff, Login as LoginIcon } from '@mui/icons-material';
import { ThemeProvider } from '../theme';
import Card from './ui/Card';
import TextField from './ui/TextField';
import Button from './ui/Button';

function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});
  const navigate = useNavigate();
  const { setSelectedGroupId, setSelectedGroupName } = useContext(GroupContext);

  // Form validation
  const validateForm = () => {
    const errors = {};

    if (!username.trim()) {
      errors.username = 'Username is required';
    }

    if (!password) {
      errors.password = 'Password is required';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setValidationErrors({});

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

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
        const token = data.token;
        localStorage.setItem('userId', userId);
        localStorage.setItem('token', token);
        onLogin({ uid: userId, name: username, token: token });

        // Obtener los grupos del usuario
        const groupsResponse = await fetch(`http://localhost:9000/api/groups/user-groups?uid=${userId}`);
        if (groupsResponse.ok) {
          const groupsData = await groupsResponse.json();
          if (groupsData.groups && groupsData.groups.length > 0) {
            const firstGroup = groupsData.groups[0];
            setSelectedGroupId(firstGroup.gid);
            setSelectedGroupName(firstGroup.name);
            localStorage.setItem('selectedGroupId', firstGroup.gid);
            localStorage.setItem('selectedGroupName', firstGroup.name);
          }
        }

        navigate('/home');
      } else {
        const errorData = await response.json();
        setError(errorData.message || 'Invalid credentials. Please try again.');
      }
    } catch (error) {
      console.error('Error en la solicitud:', error);
      setError('Network error. Please check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ThemeProvider>
      <CssBaseline />
      <>
        {/* Main Background Layer */}
        <Box
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: -2,
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)',
          }}
        />

        {/* Radial Gradient Overlays */}
        <Box
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: -1,
            background: `
              radial-gradient(circle at 20% 80%, rgba(59, 130, 246, 0.2) 0%, transparent 50%),
              radial-gradient(circle at 80% 20%, rgba(245, 158, 11, 0.15) 0%, transparent 50%)
            `,
          }}
        />

        <Box
          sx={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 2,
            position: 'relative',
            zIndex: 1,
          }}
        >
        <Container component="main" maxWidth="sm">
          <Grow in={true} timeout={800}>
            <Card
              variant="glass"
              sx={{
                p: 4,
                maxWidth: 480,
                mx: 'auto',
                '&:hover': {
                  transform: 'none',
                  boxShadow: 'none',
                  borderColor: 'rgba(255, 255, 255, 0.1)',
                  background: 'rgba(30, 58, 138, 0.1)',
                },
                cursor: 'default',
              }}
            >
              <Box sx={{ textAlign: 'center', mb: 4 }}>
                <Box
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 64,
                    height: 64,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #3b82f6 0%, #f59e0b 100%)',
                    mb: 2,
                  }}
                >
                  <LoginIcon sx={{ fontSize: 32, color: 'white' }} />
                </Box>
                <Typography component="h1" variant="h4" sx={{ mb: 1, fontWeight: 700 }}>
                  Welcome Back
                </Typography>
                <Typography variant="body1" color="text.secondary" sx={{ mb: 0 }}>
                  Sign in to your TaskMate account
                </Typography>
              </Box>

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
                  error={!!validationErrors.username}
                  helperText={validationErrors.username}
                  sx={{ mb: 2 }}
                />

                <TextField
                  margin="normal"
                  required
                  fullWidth
                  name="password"
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  error={!!validationErrors.password}
                  helperText={validationErrors.password}
                  endAdornment={
                    <IconButton
                      onClick={() => setShowPassword(!showPassword)}
                      edge="end"
                      sx={{ color: 'text.secondary' }}
                    >
                      {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  }
                  sx={{ mb: 3 }}
                />

                {error && (
                  <Fade in={!!error}>
                    <Alert
                      severity="error"
                      sx={{
                        mb: 2,
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        color: '#f87171',
                        '& .MuiAlert-icon': {
                          color: '#ef4444',
                        },
                      }}
                    >
                      {error}
                    </Alert>
                  </Fade>
                )}

                <Button
                  type="submit"
                  fullWidth
                  variant="primary"
                  disabled={isLoading}
                  sx={{
                    mb: 3,
                    py: 1.5,
                    fontSize: '1.1rem',
                    fontWeight: 600,
                  }}
                >
                  {isLoading ? 'Signing In...' : 'Sign In'}
                </Button>

                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Don't have an account?
                  </Typography>
                  <Link
                    href="/register"
                    sx={{
                      color: 'primary.main',
                      textDecoration: 'none',
                      fontWeight: 600,
                      fontSize: '1rem',
                      '&:hover': {
                        textDecoration: 'underline',
                        color: 'primary.light',
                      },
                    }}
                  >
                    Create Account
                  </Link>
                </Box>
              </Box>
            </Card>
          </Grow>
        </Container>
        </Box>
      </>
    </ThemeProvider>
  );
}

export default Login;

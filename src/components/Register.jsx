import { PersonAdd as RegisterIcon } from '@mui/icons-material';
import {
  Alert,
  Box,
  Container,
  CssBaseline,
  Fade,
  Grow,
  Link,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ThemeProvider } from '../theme';
import Button from './ui/Button';
import Card from './ui/Card';
import TextField from './ui/TextField';

function Register() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});
  const navigate = useNavigate();

  // Form validation
  const validateForm = () => {
    const errors = {};
    
    if (!username.trim()) {
      errors.username = 'Username is required';
    } else if (username.length < 3) {
      errors.username = 'Username must be at least 3 characters';
    } else if (username.length > 20) {
      errors.username = 'Username must be less than 20 characters';
    } else if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      errors.username = 'Username can only contain letters, numbers, and underscores';
    }
    
    if (!password) {
      errors.password = 'Password is required';
    } else if (password.length < 6) {
      errors.password = 'Password must be at least 6 characters';
    } else if (password.length > 50) {
      errors.password = 'Password must be less than 50 characters';
    }
    
    if (!confirmPassword) {
      errors.confirmPassword = 'Please confirm your password';
    } else if (password !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
    }
    
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setValidationErrors({});

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch('http://localhost:9000/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      if (response.ok) {
        await response.json(); // respuesta consumida, no se usa el contenido
        setSuccess('Account created successfully! Redirecting to login...');
        
        // Redirect to login after a short delay
        setTimeout(() => {
          navigate('/');
        }, 2000);
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Registration failed. Please try again.');
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
                    background: 'linear-gradient(135deg, #10b981 0%, #3b82f6 100%)',
                    mb: 2,
                  }}
                >
                  <RegisterIcon sx={{ fontSize: 32, color: 'white' }} />
                </Box>
                <Typography component="h1" variant="h4" sx={{ mb: 1, fontWeight: 700 }}>
                  Create Account
                </Typography>
                <Typography variant="body1" color="text.secondary" sx={{ mb: 0 }}>
                  Join TaskMate and start organizing your tasks
                </Typography>
              </Box>

              <Box component="form" onSubmit={handleRegister} noValidate>
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
                  type="password"
                  id="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  error={!!validationErrors.password}
                  helperText={validationErrors.password}
                  sx={{ mb: 2 }}
                />

                <TextField
                  margin="normal"
                  required
                  fullWidth
                  name="confirmPassword"
                  label="Confirm Password"
                  type="password"
                  id="confirmPassword"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  error={!!validationErrors.confirmPassword}
                  helperText={validationErrors.confirmPassword}
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

                {success && (
                  <Fade in={!!success}>
                    <Alert 
                      severity="success" 
                      sx={{ 
                        mb: 2,
                        background: 'rgba(16, 185, 129, 0.1)',
                        border: '1px solid rgba(16, 185, 129, 0.3)',
                        color: '#6ee7b7',
                        '& .MuiAlert-icon': {
                          color: '#10b981',
                        },
                      }}
                    >
                      {success}
                    </Alert>
                  </Fade>
                )}

                <Button
                  type="submit"
                  fullWidth
                  variant="secondary"
                  disabled={isLoading}
                  sx={{ 
                    mb: 3,
                    py: 1.5,
                    fontSize: '1.1rem',
                    fontWeight: 600,
                  }}
                >
                  {isLoading ? 'Creating Account...' : 'Create Account'}
                </Button>

                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Already have an account?
                  </Typography>
                  <Link 
                    href="/" 
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
                    Sign In
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

export default Register;
import { createTheme } from '@mui/material/styles';

// Theme configuration with deep blue and warm orange color palette
const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#3b82f6',      // Bright blue for primary actions
      dark: '#1e3a8a',      // Deep navy for hover states
      light: '#93c5fd',     // Light blue for accents
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#f59e0b',      // Warm orange for secondary actions
      dark: '#d97706',      // Deep orange
      light: '#fbbf24',     // Light orange/gold
      contrastText: '#ffffff',
    },
    success: {
      main: '#10b981',      // Emerald green for success states
      dark: '#065f46',      // Deep green
      light: '#6ee7b7',     // Light emerald
      contrastText: '#ffffff',
    },
    warning: {
      main: '#f59e0b',      // Orange for warnings
      dark: '#d97706',      // Deep orange
      light: '#fbbf24',     // Light orange
      contrastText: '#ffffff',
    },
    error: {
      main: '#ef4444',      // Red for errors
      dark: '#dc2626',      // Deep red
      light: '#f87171',     // Light red
      contrastText: '#ffffff',
    },
    background: {
      default: 'transparent',
      paper: 'rgba(30, 58, 138, 0.15)',
      // Custom background variants for the design system
    },
    text: {
      primary: '#f8fafc',
      secondary: 'rgba(248, 250, 252, 0.7)',
      disabled: 'rgba(248, 250, 252, 0.5)',
    },
    // Custom color variants for the design system
    custom: {
      card: 'linear-gradient(135deg, rgba(30, 58, 138, 0.2) 0%, rgba(55, 65, 81, 0.95) 100%)',
      cardHover: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(55, 65, 81, 1) 100%)',
      glass: 'rgba(30, 58, 138, 0.1)',
      surface: 'rgba(55, 65, 81, 0.8)',
      gradientPrimary: 'linear-gradient(135deg, #3b82f6 0%, #1e3a8a 100%)',
      gradientSecondary: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
      gradientAccent: 'linear-gradient(90deg, #3b82f6 0%, #f59e0b 100%)',
    }
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: { 
      fontWeight: 700, 
      fontSize: '2.5rem',
      lineHeight: 1.2,
      letterSpacing: '-0.02em',
    },
    h2: { 
      fontWeight: 600, 
      fontSize: '2rem',
      lineHeight: 1.3,
      letterSpacing: '-0.01em',
    },
    h3: { 
      fontWeight: 600, 
      fontSize: '1.75rem',
      lineHeight: 1.3,
      letterSpacing: '-0.01em',
    },
    h4: { 
      fontWeight: 600, 
      fontSize: '1.5rem',
      lineHeight: 1.4,
    },
    h5: { 
      fontWeight: 500, 
      fontSize: '1.25rem',
      lineHeight: 1.4,
    },
    h6: { 
      fontWeight: 500, 
      fontSize: '1.1rem',
      lineHeight: 1.5,
    },
    body1: { 
      fontSize: '1rem', 
      lineHeight: 1.6,
      letterSpacing: '0.01em',
    },
    body2: { 
      fontSize: '0.875rem', 
      lineHeight: 1.5,
      letterSpacing: '0.01em',
    },
    button: {
      fontWeight: 600,
      textTransform: 'none',
      letterSpacing: '0.02em',
    },
  },
  shape: {
    borderRadius: 14,
  },
  spacing: 8, // Base spacing unit (8px)
  shadows: [
    'none',
    '0 2px 12px 0 rgba(0,0,0,0.18)',
    '0 4px 16px 0 rgba(0,0,0,0.24)',
    '0 8px 24px 0 rgba(0,0,0,0.32)',
    '0 12px 36px 0 rgba(40,60,110,0.45), 0 4px 24px 0 rgba(0,0,0,0.28)',
    '0 16px 48px 0 rgba(40,60,110,0.5), 0 8px 32px 0 rgba(0,0,0,0.32)',
  ],
  transitions: {
    // Custom transition configurations
    duration: {
      shortest: 150,
      shorter: 200,
      short: 250,
      standard: 300,
      complex: 375,
      enteringScreen: 225,
      leavingScreen: 195,
    },
    easing: {
      easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
      easeOut: 'cubic-bezier(0.0, 0, 0.2, 1)',
      easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
      sharp: 'cubic-bezier(0.4, 0, 0.6, 1)',
      // Custom professional easing
      professional: 'cubic-bezier(.4,2,.3,1)',
    },
  },
  components: {
    // Global component overrides
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          // Set CSS custom properties for dynamic theming
          '--color-primary': '#3b82f6',
          '--color-primary-dark': '#1e3a8a',
          '--color-primary-light': '#93c5fd',
          '--color-secondary': '#f59e0b',
          '--color-secondary-dark': '#d97706',
          '--color-secondary-light': '#fbbf24',
          '--color-success': '#10b981',
          '--color-warning': '#f59e0b',
          '--color-error': '#ef4444',
          '--color-text-primary': '#f8fafc',
          '--color-text-secondary': 'rgba(248, 250, 252, 0.7)',
          '--background-card': 'linear-gradient(135deg, rgba(30, 58, 138, 0.2) 0%, rgba(55, 65, 81, 0.95) 100%)',
          '--background-card-hover': 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(55, 65, 81, 1) 100%)',
          '--background-glass': 'rgba(30, 58, 138, 0.1)',
          '--background-surface': 'rgba(55, 65, 81, 0.8)',
          '--gradient-primary': 'linear-gradient(135deg, #3b82f6 0%, #1e3a8a 100%)',
          '--gradient-secondary': 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
          '--gradient-accent': 'linear-gradient(90deg, #3b82f6 0%, #f59e0b 100%)',
          '--border-radius': '14px',
          '--spacing-unit': '8px',
          '--transition-professional': 'cubic-bezier(.4,2,.3,1)',
          '--shadow-card': '0 2px 12px 0 rgba(0,0,0,0.18)',
          '--shadow-card-hover': '0 12px 36px 0 rgba(40,60,110,0.45), 0 4px 24px 0 rgba(0,0,0,0.28)',
          
          // Global background
          background: 'transparent',
          minHeight: '100vh',
        },
        '*': {
          boxSizing: 'border-box',
        },
        '*::-webkit-scrollbar': {
          width: '8px',
        },
        '*::-webkit-scrollbar-track': {
          background: 'rgba(255, 255, 255, 0.1)',
          borderRadius: '4px',
        },
        '*::-webkit-scrollbar-thumb': {
          background: 'rgba(59, 130, 246, 0.6)',
          borderRadius: '4px',
          '&:hover': {
            background: 'rgba(59, 130, 246, 0.8)',
          },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 14,
          textTransform: 'none',
          fontWeight: 600,
          padding: '12px 24px',
          transition: 'all 0.3s cubic-bezier(.4,2,.3,1)',
        },
        contained: {
          boxShadow: '0 4px 12px 0 rgba(59, 130, 246, 0.4)',
          '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: '0 8px 24px 0 rgba(59, 130, 246, 0.6)',
          },
          '&:active': {
            transform: 'translateY(0)',
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 14,
          backgroundImage: 'none',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 14,
          transition: 'all 0.35s cubic-bezier(.4,2,.3,1)',
          border: '1px solid rgba(59, 130, 246, 0.1)',
          '&:hover': {
            transform: 'scale(1.02)',
            borderColor: 'rgba(59, 130, 246, 0.3)',
          },
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 14,
            transition: 'all 0.3s ease',
            '& fieldset': {
              borderColor: 'rgba(255, 255, 255, 0.2)',
              borderWidth: '2px',
            },
            '&:hover fieldset': {
              borderColor: '#3b82f6',
              boxShadow: '0 0 0 2px rgba(59, 130, 246, 0.2)',
            },
            '&.Mui-focused fieldset': {
              borderColor: '#3b82f6',
              boxShadow: '0 0 0 4px rgba(59, 130, 246, 0.3)',
            },
          },
        },
      },
    },
  },
});

export default theme;
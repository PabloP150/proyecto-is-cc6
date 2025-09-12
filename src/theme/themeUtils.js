/**
 * Theme Utilities
 * 
 * Helper functions and constants for working with the professional theme
 */

// CSS Custom Property Getters
export const getCSSVariable = (variableName) => {
  return `var(--${variableName})`;
};

// Theme Color Constants (for use in styled components)
export const THEME_COLORS = {
  primary: {
    main: '#3b82f6',
    dark: '#1e3a8a',
    light: '#93c5fd',
  },
  secondary: {
    main: '#f59e0b',
    dark: '#d97706',
    light: '#fbbf24',
  },
  success: {
    main: '#10b981',
    dark: '#065f46',
    light: '#6ee7b7',
  },
  warning: {
    main: '#f59e0b',
    dark: '#d97706',
    light: '#fbbf24',
  },
  error: {
    main: '#ef4444',
    dark: '#dc2626',
    light: '#f87171',
  },
  text: {
    primary: '#f8fafc',
    secondary: 'rgba(248, 250, 252, 0.7)',
    disabled: 'rgba(248, 250, 252, 0.5)',
  },
};

// Background Gradients
export const GRADIENTS = {
  card: 'linear-gradient(135deg, rgba(30, 58, 138, 0.2) 0%, rgba(55, 65, 81, 0.95) 100%)',
  cardHover: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(55, 65, 81, 1) 100%)',
  primary: 'linear-gradient(135deg, #3b82f6 0%, #1e3a8a 100%)',
  secondary: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
  accent: 'linear-gradient(90deg, #3b82f6 0%, #f59e0b 100%)',
  glass: 'rgba(30, 58, 138, 0.1)',
  surface: 'rgba(55, 65, 81, 0.8)',
};

// Animation Easings
export const EASINGS = {
  professional: 'cubic-bezier(.4,2,.3,1)',
  standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
  easeOut: 'cubic-bezier(0.0, 0, 0.2, 1)',
  easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
  sharp: 'cubic-bezier(0.4, 0, 0.6, 1)',
};

// Shadow Presets
export const SHADOWS = {
  card: '0 2px 12px 0 rgba(0,0,0,0.18)',
  cardHover: '0 12px 36px 0 rgba(40,60,110,0.45), 0 4px 24px 0 rgba(0,0,0,0.28)',
  button: '0 4px 12px 0 rgba(59, 130, 246, 0.4)',
  buttonHover: '0 8px 24px 0 rgba(59, 130, 246, 0.6)',
  glass: '0 8px 32px 0 rgba(30, 58, 138, 0.3)',
};

// Spacing Helpers (based on 8px grid)
export const spacing = (multiplier) => `${multiplier * 8}px`;

// Border Radius
export const BORDER_RADIUS = {
  small: '8px',
  medium: '14px',
  large: '20px',
  round: '50%',
};

// Breakpoint Helpers
export const BREAKPOINTS = {
  xs: '0px',
  sm: '600px',
  md: '900px',
  lg: '1200px',
  xl: '1536px',
};

// Media Query Helpers
export const mediaQuery = {
  up: (breakpoint) => `@media (min-width: ${BREAKPOINTS[breakpoint]})`,
  down: (breakpoint) => {
    const breakpointValues = Object.values(BREAKPOINTS);
    const currentIndex = Object.keys(BREAKPOINTS).indexOf(breakpoint);
    const nextValue = breakpointValues[currentIndex + 1];
    return nextValue ? `@media (max-width: ${parseInt(nextValue) - 1}px)` : '';
  },
  between: (start, end) => 
    `@media (min-width: ${BREAKPOINTS[start]}) and (max-width: ${parseInt(BREAKPOINTS[end]) - 1}px)`,
};

// Typography Helpers
export const TYPOGRAPHY = {
  fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
  weights: {
    regular: 400,
    medium: 500,
    semiBold: 600,
    bold: 700,
  },
  sizes: {
    xs: '0.75rem',
    sm: '0.875rem',
    base: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
    '3xl': '1.875rem',
    '4xl': '2.25rem',
    '5xl': '3rem',
  },
};

// Component Style Helpers
export const getCardStyles = (variant = 'default', hover = true) => ({
  background: variant === 'gradient' ? GRADIENTS.card : 'rgba(30, 58, 138, 0.15)',
  borderRadius: BORDER_RADIUS.medium,
  boxShadow: SHADOWS.card,
  padding: spacing(2),
  transition: `all 0.35s ${EASINGS.professional}`,
  position: 'relative',
  overflow: 'hidden',
  border: '1px solid rgba(59, 130, 246, 0.1)',
  
  ...(hover && {
    '&:hover': {
      boxShadow: SHADOWS.cardHover,
      transform: 'scale(1.02)',
      background: variant === 'gradient' ? GRADIENTS.cardHover : GRADIENTS.surface,
      borderColor: 'rgba(59, 130, 246, 0.3)',
    },
  }),
});

export const getButtonStyles = (variant = 'contained', color = 'primary') => ({
  borderRadius: BORDER_RADIUS.medium,
  textTransform: 'none',
  fontWeight: TYPOGRAPHY.weights.semiBold,
  padding: `${spacing(1.5)} ${spacing(3)}`,
  position: 'relative',
  overflow: 'hidden',
  transition: `all 0.3s ${EASINGS.professional}`,
  
  ...(variant === 'contained' && {
    background: GRADIENTS[color] || GRADIENTS.primary,
    boxShadow: SHADOWS.button,
    
    '&:hover': {
      transform: 'translateY(-2px)',
      boxShadow: SHADOWS.buttonHover,
    },
    
    '&:active': {
      transform: 'translateY(0)',
    },
  }),
});

// Utility function to create shimmer effect
export const getShimmerEffect = () => ({
  '&::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: '-100%',
    width: '100%',
    height: '100%',
    background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)',
    transition: 'left 0.5s',
  },
  
  '&:hover::before': {
    left: '100%',
  },
});

// Utility function to create glass morphism effect
export const getGlassMorphism = (blur = 20, opacity = 0.1) => ({
  background: `rgba(30, 58, 138, ${opacity})`,
  backdropFilter: `blur(${blur}px)`,
  border: '1px solid rgba(59, 130, 246, 0.2)',
  boxShadow: SHADOWS.glass,
});

const themeUtils = {
  getCSSVariable,
  THEME_COLORS,
  GRADIENTS,
  EASINGS,
  SHADOWS,
  spacing,
  BORDER_RADIUS,
  BREAKPOINTS,
  mediaQuery,
  TYPOGRAPHY,
  getCardStyles,
  getButtonStyles,
  getShimmerEffect,
  getGlassMorphism,
};

export default themeUtils;
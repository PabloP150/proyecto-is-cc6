import { useTheme as useMuiTheme } from '@mui/material/styles';
import { THEME_COLORS, GRADIENTS, EASINGS, SHADOWS, spacing, BORDER_RADIUS } from './themeUtils';

/**
 * Custom hook for accessing theme values
 * 
 * Provides easy access to both Material-UI theme and custom theme utilities
 */
export const useTheme = () => {
  const muiTheme = useMuiTheme();
  
  return {
    // Material-UI theme
    ...muiTheme,
    
    // Custom theme utilities
    colors: THEME_COLORS,
    gradients: GRADIENTS,
    easings: EASINGS,
    shadows: SHADOWS,
    spacing,
    borderRadius: BORDER_RADIUS,
    
    // Helper functions
    getCSSVar: (varName) => `var(--${varName})`,
    
    // Responsive helpers
    breakpoints: muiTheme.breakpoints,
    
    // Common style generators
    cardStyle: (variant = 'default', hover = true) => ({
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
    }),
    
    buttonStyle: (variant = 'contained', color = 'primary') => ({
      borderRadius: BORDER_RADIUS.medium,
      textTransform: 'none',
      fontWeight: 600,
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
    }),
    
    glassStyle: (blur = 20, opacity = 0.1) => ({
      background: `rgba(30, 58, 138, ${opacity})`,
      backdropFilter: `blur(${blur}px)`,
      border: '1px solid rgba(59, 130, 246, 0.2)',
      boxShadow: SHADOWS.glass,
    }),
  };
};

export default useTheme;
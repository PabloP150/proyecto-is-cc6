import React from 'react';
import { TextField as MuiTextField, InputAdornment } from '@mui/material';
import { styled } from '@mui/material/styles';

/**
 * Professional TextField Component
 * 
 * Enhanced form input component with glass morphism styling,
 * smooth focus states, border color transitions, and glow effects.
 * Includes proper validation styling with error states.
 * 
 * Features:
 * - Glass morphism background with backdrop blur
 * - Smooth border color transitions and glow effects
 * - Enhanced focus states with animated borders
 * - Validation styling with error states
 * - Support for different variants and sizes
 */

const StyledTextField = styled(MuiTextField)(({ theme, variant = 'outlined', error }) => {
  const baseStyles = {
    '& .MuiOutlinedInput-root': {
      background: 'rgba(30, 58, 138, 0.1)',
      backdropFilter: 'blur(20px)',
      borderRadius: theme.shape.borderRadius,
      transition: 'all 0.3s cubic-bezier(.4, 2, .3, 1)',
      
      '& fieldset': {
        borderColor: error ? '#ef4444' : 'rgba(248, 250, 252, 0.2)',
        borderWidth: '2px',
        transition: 'all 0.3s ease',
      },
      
      '&:hover': {
        background: 'rgba(59, 130, 246, 0.15)',
        
        '& fieldset': {
          borderColor: error ? '#f87171' : '#3b82f6',
          boxShadow: error 
            ? '0 0 0 2px rgba(239, 68, 68, 0.2)' 
            : '0 0 0 2px rgba(59, 130, 246, 0.2)',
        },
      },
      
      '&.Mui-focused': {
        background: 'rgba(59, 130, 246, 0.2)',
        
        '& fieldset': {
          borderColor: error ? '#ef4444' : '#3b82f6',
          boxShadow: error 
            ? '0 0 0 4px rgba(239, 68, 68, 0.3), 0 0 20px rgba(239, 68, 68, 0.2)' 
            : '0 0 0 4px rgba(59, 130, 246, 0.3), 0 0 20px rgba(59, 130, 246, 0.2)',
        },
      },
      
      '&.Mui-error': {
        '& fieldset': {
          borderColor: '#ef4444',
        },
        
        '&:hover fieldset': {
          borderColor: '#f87171',
          boxShadow: '0 0 0 2px rgba(239, 68, 68, 0.2)',
        },
        
        '&.Mui-focused fieldset': {
          borderColor: '#ef4444',
          boxShadow: '0 0 0 4px rgba(239, 68, 68, 0.3), 0 0 20px rgba(239, 68, 68, 0.2)',
        },
      },
      
      '&.Mui-disabled': {
        background: 'rgba(55, 65, 81, 0.3)',
        
        '& fieldset': {
          borderColor: 'rgba(248, 250, 252, 0.1)',
        },
      },
    },
    
    '& .MuiInputLabel-root': {
      color: 'rgba(248, 250, 252, 0.7)',
      fontWeight: 500,
      transition: 'all 0.3s ease',
      
      '&.Mui-focused': {
        color: error ? '#ef4444' : '#3b82f6',
        fontWeight: 600,
      },
      
      '&.Mui-error': {
        color: '#ef4444',
      },
      
      '&.Mui-disabled': {
        color: 'rgba(248, 250, 252, 0.3)',
      },
    },
    
    '& .MuiInputBase-input': {
      color: '#f8fafc',
      fontSize: '1rem',
      fontWeight: 400,
      
      '&::placeholder': {
        color: 'rgba(248, 250, 252, 0.5)',
        opacity: 1,
      },
      
      '&.Mui-disabled': {
        color: 'rgba(248, 250, 252, 0.3)',
        WebkitTextFillColor: 'rgba(248, 250, 252, 0.3)',
      },
    },
    
    '& .MuiFormHelperText-root': {
      marginTop: theme.spacing(1),
      fontSize: '0.875rem',
      fontWeight: 400,
      
      '&.Mui-error': {
        color: '#f87171',
        fontWeight: 500,
      },
    },
    
    // Success state (when validation passes)
    '&.success': {
      '& .MuiOutlinedInput-root': {
        '& fieldset': {
          borderColor: '#10b981',
        },
        
        '&:hover fieldset': {
          borderColor: '#34d399',
          boxShadow: '0 0 0 2px rgba(16, 185, 129, 0.2)',
        },
        
        '&.Mui-focused fieldset': {
          borderColor: '#10b981',
          boxShadow: '0 0 0 4px rgba(16, 185, 129, 0.3), 0 0 20px rgba(16, 185, 129, 0.2)',
        },
      },
      
      '& .MuiInputLabel-root.Mui-focused': {
        color: '#10b981',
      },
    },
  };

  return baseStyles;
});

const TextField = React.forwardRef(({ 
  variant = 'outlined',
  size = 'medium',
  fullWidth = true,
  error = false,
  success = false,
  helperText,
  startAdornment,
  endAdornment,
  sx = {},
  className = '',
  ...props 
}, ref) => {
  // Combine className with success state
  const combinedClassName = `${className} ${success ? 'success' : ''}`.trim();

  // Size-specific styling
  const sizeStyles = {
    small: {
      '& .MuiInputBase-input': {
        padding: '8px 12px',
        fontSize: '0.875rem',
      },
    },
    medium: {
      '& .MuiInputBase-input': {
        padding: '12px 16px',
        fontSize: '1rem',
      },
    },
    large: {
      '& .MuiInputBase-input': {
        padding: '16px 20px',
        fontSize: '1.125rem',
      },
    },
  };

  return (
    <StyledTextField
      ref={ref}
      variant={variant}
      size={size}
      fullWidth={fullWidth}
      error={error}
      helperText={helperText}
      className={combinedClassName}
      sx={{
        ...sizeStyles[size],
        ...sx,
      }}
      InputProps={{
        startAdornment: startAdornment && (
          <InputAdornment position="start">
            {startAdornment}
          </InputAdornment>
        ),
        endAdornment: endAdornment && (
          <InputAdornment position="end">
            {endAdornment}
          </InputAdornment>
        ),
      }}
      {...props}
    />
  );
});

TextField.displayName = 'TextField';

export default TextField;
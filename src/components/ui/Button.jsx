import React from 'react';
import { Button as MuiButton } from '@mui/material';
import { styled, keyframes } from '@mui/material/styles';

/**
 * Professional Button Component System
 * 
 * A styled Button component with gradient backgrounds, hover effects,
 * and shimmer animations using CSS pseudo-elements.
 * 
 * Variants:
 * - primary: Main action button with primary gradient
 * - secondary: Secondary action with orange gradient
 * - accent: Special accent button with dual-color gradient
 * - outline: Outlined button with gradient border
 * - ghost: Minimal button with subtle hover effects
 */

// Shimmer animation keyframes
const shimmer = keyframes`
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
`;

const StyledButton = styled(MuiButton)(({ theme, variant = 'primary' }) => {
  const variants = {
    primary: {
      background: 'linear-gradient(135deg, #3b82f6 0%, #1e3a8a 100%)',
      color: '#ffffff',
      border: 'none',
      '&:hover': {
        background: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
        boxShadow: '0 8px 24px 0 rgba(59, 130, 246, 0.6)',
      },
    },
    secondary: {
      background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
      color: '#ffffff',
      border: 'none',
      '&:hover': {
        background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
        boxShadow: '0 8px 24px 0 rgba(245, 158, 11, 0.6)',
      },
    },
    accent: {
      background: 'linear-gradient(90deg, #3b82f6 0%, #f59e0b 100%)',
      color: '#ffffff',
      border: 'none',
      '&:hover': {
        background: 'linear-gradient(90deg, #60a5fa 0%, #fbbf24 100%)',
        boxShadow: '0 8px 24px 0 rgba(59, 130, 246, 0.4), 0 8px 24px 0 rgba(245, 158, 11, 0.4)',
      },
    },
    outline: {
      background: 'transparent',
      color: '#3b82f6',
      border: '2px solid transparent',
      backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0), rgba(255, 255, 255, 0)), linear-gradient(135deg, #3b82f6, #f59e0b)',
      backgroundOrigin: 'border-box',
      backgroundClip: 'content-box, border-box',
      '&:hover': {
        color: '#ffffff',
        background: 'linear-gradient(135deg, #3b82f6 0%, #f59e0b 100%)',
        boxShadow: '0 4px 16px 0 rgba(59, 130, 246, 0.4)',
      },
    },
    ghost: {
      background: 'transparent',
      color: '#f8fafc',
      border: '1px solid rgba(248, 250, 252, 0.2)',
      '&:hover': {
        background: 'rgba(59, 130, 246, 0.1)',
        borderColor: 'rgba(59, 130, 246, 0.3)',
        boxShadow: '0 4px 12px 0 rgba(59, 130, 246, 0.2)',
      },
    },
  };

  const currentVariant = variants[variant] || variants.primary;

  return {
    borderRadius: theme.shape.borderRadius,
    padding: '12px 24px',
    fontWeight: 600,
    textTransform: 'none',
    fontSize: '1rem',
    lineHeight: 1.5,
    letterSpacing: '0.02em',
    position: 'relative',
    overflow: 'hidden',
    transition: 'all 0.3s cubic-bezier(.4, 2, .3, 1)',
    ...currentVariant,
    
    // Shimmer effect on hover
    '&::before': {
      content: '""',
      position: 'absolute',
      top: 0,
      left: '-100%',
      width: '100%',
      height: '100%',
      background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent)',
      transition: 'transform 0.6s',
      transform: 'translateX(-100%)',
    },
    
    '&:hover': {
      transform: 'translateY(-2px)',
      ...currentVariant['&:hover'],
      
      '&::before': {
        animation: `${shimmer} 0.6s ease-in-out`,
      },
    },
    
    '&:active': {
      transform: 'translateY(0)',
    },
    
    '&:disabled': {
      background: 'rgba(55, 65, 81, 0.5)',
      color: 'rgba(248, 250, 252, 0.5)',
      border: '1px solid rgba(55, 65, 81, 0.3)',
      cursor: 'not-allowed',
      transform: 'none',
      boxShadow: 'none',
      
      '&::before': {
        display: 'none',
      },
    },
    
    // Focus styles for accessibility
    '&:focus-visible': {
      outline: '2px solid #3b82f6',
      outlineOffset: '2px',
    },
  };
});

const Button = React.forwardRef(({ 
  children, 
  variant = 'primary',
  size = 'medium',
  disabled = false,
  onClick,
  sx = {},
  ...props 
}, ref) => {
  // Size variants
  const sizeStyles = {
    small: { padding: '8px 16px', fontSize: '0.875rem' },
    medium: { padding: '12px 24px', fontSize: '1rem' },
    large: { padding: '16px 32px', fontSize: '1.125rem' },
  };

  return (
    <StyledButton
      ref={ref}
      variant={variant}
      disabled={disabled}
      onClick={onClick}
      sx={{
        ...sizeStyles[size],
        ...sx,
      }}
      {...props}
    >
      {children}
    </StyledButton>
  );
});

Button.displayName = 'Button';

export default Button;
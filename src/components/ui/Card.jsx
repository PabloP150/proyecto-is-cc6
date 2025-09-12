import React from 'react';
import { Paper } from '@mui/material';
import { styled } from '@mui/material/styles';

/**
 * Professional Card Component with Gradient Backgrounds
 * 
 * A styled Paper component that provides different card variants with
 * gradient backgrounds, hover animations, and smooth transitions.
 * 
 * Variants:
 * - default: Standard card with subtle gradient
 * - gradient: Enhanced gradient with more vibrant colors
 * - glass: Glass morphism effect with backdrop blur
 * - elevated: Higher elevation with stronger shadows
 */

const StyledCard = styled(Paper)(({ theme, variant = 'default' }) => {
  const variants = {
    default: {
      background: 'linear-gradient(135deg, rgba(30, 58, 138, 0.2) 0%, rgba(55, 65, 81, 0.95) 100%)',
      border: '1px solid rgba(59, 130, 246, 0.1)',
      '&:hover': {
        background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(55, 65, 81, 1) 100%)',
        borderColor: 'rgba(59, 130, 246, 0.3)',
        boxShadow: '0 12px 36px 0 rgba(40, 60, 110, 0.45), 0 4px 24px 0 rgba(0, 0, 0, 0.28)',
      },
    },
    gradient: {
      background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.3) 0%, rgba(245, 158, 11, 0.2) 50%, rgba(55, 65, 81, 0.95) 100%)',
      border: '1px solid rgba(59, 130, 246, 0.2)',
      '&:hover': {
        background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.4) 0%, rgba(245, 158, 11, 0.3) 50%, rgba(55, 65, 81, 1) 100%)',
        borderColor: 'rgba(59, 130, 246, 0.4)',
        boxShadow: '0 16px 48px 0 rgba(40, 60, 110, 0.5), 0 8px 32px 0 rgba(0, 0, 0, 0.32)',
      },
    },
    glass: {
      background: 'rgba(30, 58, 138, 0.1)',
      backdropFilter: 'blur(20px)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      '&:hover': {
        background: 'rgba(59, 130, 246, 0.15)',
        borderColor: 'rgba(255, 255, 255, 0.2)',
        boxShadow: '0 8px 32px 0 rgba(59, 130, 246, 0.3)',
      },
    },
    elevated: {
      background: 'linear-gradient(135deg, rgba(30, 58, 138, 0.25) 0%, rgba(55, 65, 81, 0.98) 100%)',
      border: '1px solid rgba(59, 130, 246, 0.15)',
      boxShadow: '0 8px 24px 0 rgba(0, 0, 0, 0.32)',
      '&:hover': {
        background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(55, 65, 81, 1) 100%)',
        borderColor: 'rgba(59, 130, 246, 0.35)',
        boxShadow: '0 20px 60px 0 rgba(40, 60, 110, 0.6), 0 12px 40px 0 rgba(0, 0, 0, 0.4)',
      },
    },
  };

  const currentVariant = variants[variant] || variants.default;

  return {
    borderRadius: theme.shape.borderRadius,
    padding: theme.spacing(2),
    transition: 'all 0.35s cubic-bezier(.4, 2, .3, 1)',
    cursor: 'pointer',
    position: 'relative',
    overflow: 'hidden',
    ...currentVariant,
    '&:hover': {
      transform: 'scale(1.02)',
      ...currentVariant['&:hover'],
    },
    '&:active': {
      transform: 'scale(0.98)',
    },
  };
});

const Card = React.forwardRef(({ 
  children, 
  variant = 'default', 
  onClick,
  sx = {},
  ...props 
}, ref) => {
  return (
    <StyledCard
      ref={ref}
      variant={variant}
      onClick={onClick}
      sx={sx}
      {...props}
    >
      {children}
    </StyledCard>
  );
});

Card.displayName = 'Card';

export default Card;
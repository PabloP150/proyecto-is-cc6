import React from 'react';
import { Box, Typography, Grid } from '@mui/material';
import { Card } from './ui';

/**
 * Card Demo Component
 * 
 * Demonstrates the different Card variants with gradient backgrounds
 * and hover animations for testing purposes.
 */
const CardDemo = () => {
  const variants = [
    { name: 'Default', variant: 'default' },
    { name: 'Gradient', variant: 'gradient' },
    { name: 'Glass', variant: 'glass' },
    { name: 'Elevated', variant: 'elevated' },
  ];

  return (
    <Box sx={{ p: 4 }}>
      <Typography variant="h4" sx={{ mb: 4, color: 'white', textAlign: 'center' }}>
        Card Component Variants
      </Typography>
      
      <Grid container spacing={3}>
        {variants.map(({ name, variant }) => (
          <Grid item xs={12} sm={6} md={3} key={variant}>
            <Card variant={variant}>
              <Typography variant="h6" sx={{ color: 'white', mb: 2 }}>
                {name} Card
              </Typography>
              <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                This is a {name.toLowerCase()} card variant with gradient background 
                and smooth hover animations. Hover over this card to see the effect.
              </Typography>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

export default CardDemo;
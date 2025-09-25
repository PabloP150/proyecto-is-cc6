import { Box, Grid, Stack, Typography } from '@mui/material';
import { Button } from './ui';

/**
 * Button Demo Component
 * 
 * Demonstrates the different Button variants with gradient backgrounds,
 * shimmer effects, and hover animations for testing purposes.
 */
const ButtonDemo = () => {
  const variants = [
    { name: 'Primary', variant: 'primary' },
    { name: 'Secondary', variant: 'secondary' },
    { name: 'Accent', variant: 'accent' },
    { name: 'Outline', variant: 'outline' },
    { name: 'Ghost', variant: 'ghost' },
  ];

  const sizes = ['small', 'medium', 'large'];

  return (
    <Box sx={{ p: 4 }}>
      <Typography variant="h4" sx={{ mb: 4, color: 'white', textAlign: 'center' }}>
        Button Component Variants
      </Typography>
      
      {/* Button Variants */}
      <Box sx={{ mb: 6 }}>
        <Typography variant="h6" sx={{ mb: 3, color: 'white' }}>
          Button Variants
        </Typography>
        <Grid container spacing={3}>
          {variants.map(({ name, variant }) => (
            <Grid item xs={12} sm={6} md={2.4} key={variant}>
              <Stack spacing={2} alignItems="center">
                <Button 
                  variant={variant}
                  // onClick demo eliminado
                >
                  {name}
                </Button>
                <Button 
                  variant={variant}
                  disabled
                >
                  Disabled
                </Button>
              </Stack>
            </Grid>
          ))}
        </Grid>
      </Box>

      {/* Button Sizes */}
      <Box sx={{ mb: 6 }}>
        <Typography variant="h6" sx={{ mb: 3, color: 'white' }}>
          Button Sizes
        </Typography>
        <Stack direction="row" spacing={3} alignItems="center" justifyContent="center">
          {sizes.map((size) => (
            <Button 
              key={size}
              variant="primary"
              size={size}
              // onClick demo eliminado
            >
              {size.charAt(0).toUpperCase() + size.slice(1)}
            </Button>
          ))}
        </Stack>
      </Box>

      {/* Interactive Examples */}
      <Box>
        <Typography variant="h6" sx={{ mb: 3, color: 'white' }}>
          Interactive Examples
        </Typography>
        <Stack direction="row" spacing={3} alignItems="center" justifyContent="center" flexWrap="wrap">
          <Button 
            variant="primary"
            onClick={() => alert('Primary action executed!')}
          >
            Primary Action
          </Button>
          <Button 
            variant="secondary"
            onClick={() => alert('Secondary action executed!')}
          >
            Secondary Action
          </Button>
          <Button 
            variant="accent"
            onClick={() => alert('Special action executed!')}
          >
            Special Action
          </Button>
          <Button 
            variant="outline"
            onClick={() => alert('Outline action executed!')}
          >
            Outline Action
          </Button>
          <Button 
            variant="ghost"
            onClick={() => alert('Ghost action executed!')}
          >
            Ghost Action
          </Button>
        </Stack>
      </Box>
    </Box>
  );
};

export default ButtonDemo;
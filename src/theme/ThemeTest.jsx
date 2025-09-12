import React from 'react';
import { Box, Button, Card, CardContent, Typography, Paper } from '@mui/material';
import { useTheme } from './useTheme';

/**
 * Theme Test Component
 * 
 * A simple component to test and showcase the theme
 * This component demonstrates the key theme features and can be used for testing
 */
const ThemeTest = () => {
  const theme = useTheme();

  return (
    <Box 
      sx={{ 
        minHeight: '100vh',
        backgroundImage: 'url(/1.jpeg)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundAttachment: 'fixed',
        // Add overlay for better text readability
        position: 'relative',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'linear-gradient(135deg, rgba(30, 58, 138, 0.7) 0%, rgba(15, 23, 42, 0.8) 100%)',
          zIndex: 0,
        }
      }}
    >
      <Box sx={{ 
        position: 'relative', 
        zIndex: 1, 
        p: 3 
      }}>
      <Typography variant="h3" gutterBottom sx={{ color: 'text.primary', mb: 4 }}>
        Theme Test
      </Typography>
      
      {/* Color Palette Test */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h5" gutterBottom sx={{ color: 'text.primary' }}>
          Color Palette
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Button variant="contained" color="primary">Primary</Button>
          <Button variant="contained" color="secondary">Secondary</Button>
          <Button variant="contained" color="success">Success</Button>
          <Button variant="contained" color="warning">Warning</Button>
          <Button variant="contained" color="error">Error</Button>
        </Box>
      </Box>

      {/* Card Styles Test */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h5" gutterBottom sx={{ color: 'text.primary' }}>
          Card Styles
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 3 }}>
          <Card sx={theme.cardStyle('default')}>
            <CardContent>
              <Typography variant="h6" gutterBottom>Default Card</Typography>
              <Typography variant="body2" color="text.secondary">
                This is a default card with the professional theme styling.
              </Typography>
            </CardContent>
          </Card>
          
          <Card sx={theme.cardStyle('gradient')}>
            <CardContent>
              <Typography variant="h6" gutterBottom>Gradient Card</Typography>
              <Typography variant="body2" color="text.secondary">
                This card uses the gradient background variant.
              </Typography>
            </CardContent>
          </Card>
        </Box>
      </Box>

      {/* Glass Morphism Test */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h5" gutterBottom sx={{ color: 'text.primary' }}>
          Glass Morphism
        </Typography>
        <Paper sx={theme.glassStyle(20, 0.15)}>
          <Box sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>Glass Morphism Effect</Typography>
            <Typography variant="body2" color="text.secondary">
              This demonstrates the glass morphism styling with backdrop blur.
            </Typography>
          </Box>
        </Paper>
      </Box>

      {/* Button Styles Test */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h5" gutterBottom sx={{ color: 'text.primary' }}>
          Button Styles
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Button sx={theme.buttonStyle('contained', 'primary')}>
            Primary Button
          </Button>
          <Button sx={theme.buttonStyle('contained', 'secondary')}>
            Secondary Button
          </Button>
          <Button variant="outlined" color="primary">
            Outlined Button
          </Button>
          <Button variant="text" color="primary">
            Text Button
          </Button>
        </Box>
      </Box>

      {/* CSS Variables Test */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h5" gutterBottom sx={{ color: 'text.primary' }}>
          CSS Variables
        </Typography>
        <Box 
          className="theme-card"
          sx={{ 
            background: 'var(--background-card)',
            color: 'var(--color-text-primary)',
            p: 3,
          }}
        >
          <Typography variant="h6" gutterBottom>
            CSS Custom Properties
          </Typography>
          <Typography variant="body2">
            This card uses CSS custom properties for styling, demonstrating dynamic theming support.
          </Typography>
        </Box>
      </Box>

      {/* Typography Test */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h5" gutterBottom sx={{ color: 'text.primary' }}>
          Typography Scale
        </Typography>
        <Box sx={{ '& > *': { mb: 1 } }}>
          <Typography variant="h1">Heading 1</Typography>
          <Typography variant="h2">Heading 2</Typography>
          <Typography variant="h3">Heading 3</Typography>
          <Typography variant="h4">Heading 4</Typography>
          <Typography variant="h5">Heading 5</Typography>
          <Typography variant="h6">Heading 6</Typography>
          <Typography variant="body1">Body 1 - Regular body text</Typography>
          <Typography variant="body2">Body 2 - Smaller body text</Typography>
        </Box>
      </Box>
    </Box>
    </Box>
  );
};

export default ThemeTest;
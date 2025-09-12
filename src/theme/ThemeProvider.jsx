import React from 'react';
import { ThemeProvider as MuiThemeProvider, CssBaseline } from '@mui/material';
import { StyledEngineProvider } from '@mui/material/styles';
import theme from './theme';

/**
 * Theme Provider Wrapper
 * 
 * This component wraps the entire application with the theme
 * configuration, providing consistent styling across all components.
 * 
 * Features:
 * - Deep blue and warm orange color palette
 * - Typography and spacing standards
 * - CSS custom properties for dynamic theming
 * - Global component overrides
 * - Smooth animations and transitions
 */
const ThemeProvider = ({ children }) => {
  return (
    <StyledEngineProvider injectFirst>
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    </StyledEngineProvider>
  );
};

export default ThemeProvider;
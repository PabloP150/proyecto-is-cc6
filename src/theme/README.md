# Theme System

This directory contains the complete theme system for the TaskMate application, implementing a modern design with deep blue and warm orange color palette.

## Overview

The theme system provides:
- Modern color palette with semantic meaning
- Consistent typography and spacing standards
- CSS custom properties for dynamic theming
- Reusable component styles and utilities
- Smooth animations and transitions
- Accessibility support
- Responsive design helpers

## Files Structure

```
src/theme/
├── README.md                 # This documentation
├── index.js                  # Main exports
├── theme.js                  # Material-UI theme configuration
├── ThemeProvider.jsx         # Theme provider wrapper component
├── themeUtils.js            # Utility functions and constants
├── useTheme.js              # Custom theme hook
├── globalStyles.css         # Global CSS styles and custom properties
└── ThemeTest.jsx            # Test component for theme verification
```

## Usage

### Basic Setup

The theme is automatically applied when you wrap your app with `ThemeProvider`:

```jsx
import { ThemeProvider } from './theme';

function App() {
  return (
    <ThemeProvider>
      {/* Your app content */}
    </ThemeProvider>
  );
}
```

### Using the Theme Hook

```jsx
import { useTheme } from './theme';

function MyComponent() {
  const theme = useTheme();
  
  return (
    <Box sx={theme.cardStyle('gradient')}>
      <Button sx={theme.buttonStyle('contained', 'primary')}>
        Click me
      </Button>
    </Box>
  );
}
```

### Using CSS Custom Properties

```css
.my-component {
  background: var(--background-card);
  color: var(--color-text-primary);
  border-radius: var(--border-radius);
  padding: var(--spacing-md);
  transition: all 0.3s var(--transition-professional);
}
```

### Using Utility Classes

```jsx
<div className="theme-card">
  <button className="theme-button contained">
    Theme Button
  </button>
</div>
```

## Color Palette

### Primary Colors
- **Primary**: `#3b82f6` (Bright Blue) - Main actions and links
- **Primary Dark**: `#1e3a8a` (Deep Navy) - Hover states
- **Primary Light**: `#93c5fd` (Light Blue) - Accents

### Secondary Colors
- **Secondary**: `#f59e0b` (Warm Orange) - Secondary actions
- **Secondary Dark**: `#d97706` (Deep Orange) - Hover states
- **Secondary Light**: `#fbbf24` (Light Orange/Gold) - Accents

### Semantic Colors
- **Success**: `#10b981` (Emerald Green)
- **Warning**: `#f59e0b` (Orange)
- **Error**: `#ef4444` (Red)

### Text Colors
- **Primary Text**: `#f8fafc` (Near White)
- **Secondary Text**: `rgba(248, 250, 252, 0.7)` (Translucent White)
- **Disabled Text**: `rgba(248, 250, 252, 0.5)` (More Translucent)

## Component Styles

### Cards
```jsx
// Default card
<Card sx={theme.cardStyle('default')}>

// Gradient card
<Card sx={theme.cardStyle('gradient')}>

// Card without hover effects
<Card sx={theme.cardStyle('default', false)}>
```

### Buttons
```jsx
// Primary button
<Button sx={theme.buttonStyle('contained', 'primary')}>

// Secondary button
<Button sx={theme.buttonStyle('contained', 'secondary')}>
```

### Glass Morphism
```jsx
<Paper sx={theme.glassStyle(20, 0.15)}>
  Glass morphism effect
</Paper>
```

## CSS Custom Properties

All theme values are available as CSS custom properties:

### Colors
- `--color-primary`, `--color-primary-dark`, `--color-primary-light`
- `--color-secondary`, `--color-secondary-dark`, `--color-secondary-light`
- `--color-success`, `--color-warning`, `--color-error`
- `--color-text-primary`, `--color-text-secondary`, `--color-text-disabled`

### Backgrounds
- `--background-card`, `--background-card-hover`
- `--background-glass`, `--background-surface`

### Gradients
- `--gradient-primary`, `--gradient-secondary`, `--gradient-accent`

### Spacing
- `--spacing-xs` (4px), `--spacing-sm` (8px), `--spacing-md` (16px)
- `--spacing-lg` (24px), `--spacing-xl` (32px), `--spacing-2xl` (48px)

### Other
- `--border-radius` (14px), `--border-radius-sm` (8px), `--border-radius-lg` (20px)
- `--transition-professional`, `--transition-standard`
- `--shadow-card`, `--shadow-card-hover`, `--shadow-button`

## Animations

The theme includes several built-in animations:

### CSS Classes
- `.fade-in` - Fade in animation
- `.scale-in` - Scale in animation
- `.slide-up` - Slide up animation

### Keyframes
- `@keyframes fadeIn`
- `@keyframes scaleIn`
- `@keyframes slideUp`
- `@keyframes shimmer`
- `@keyframes popCheck`

## Responsive Design

The theme includes responsive breakpoints and utilities:

```jsx
// Using theme breakpoints
const theme = useTheme();

<Box sx={{
  [theme.breakpoints.up('md')]: {
    padding: theme.spacing(4),
  },
  [theme.breakpoints.down('sm')]: {
    padding: theme.spacing(2),
  },
}}>
```

## Accessibility

The theme includes accessibility features:
- High contrast mode support
- Reduced motion support
- Focus visible styles
- Proper color contrast ratios
- Screen reader friendly animations

## Testing

Use the `ThemeTest` component to verify theme implementation:

```jsx
import ThemeTest from './theme/ThemeTest';

// Add to your routes for testing
<Route path="/theme-test" element={<ThemeTest />} />
```

## Best Practices

1. **Use the theme hook** for accessing theme values in components
2. **Prefer CSS custom properties** for simple styling
3. **Use utility classes** for common patterns
4. **Follow the color semantics** (primary for main actions, secondary for supporting actions)
5. **Test with different screen sizes** and accessibility settings
6. **Use the provided animations** for consistent motion design

## Migration Guide

When updating existing components to use the new theme:

1. Wrap your app with `ThemeProvider`
2. Replace hardcoded colors with theme colors
3. Update card components to use `theme.cardStyle()`
4. Update buttons to use `theme.buttonStyle()`
5. Replace custom animations with theme animations
6. Test accessibility and responsive behavior

## Requirements Fulfilled

This theme system fulfills the following requirements:
- **1.1**: Consistent visual design across all pages
- **1.2**: Standardized color palette, typography, and spacing
- **2.1**: Professional gradients and modern color combinations
- **2.2**: Semantic color usage for different content types
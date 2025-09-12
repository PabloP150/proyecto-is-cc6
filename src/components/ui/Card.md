# Card Component

A professional styled Paper component with gradient backgrounds, hover animations, and smooth transitions.

## Features

- **Multiple Variants**: Default, gradient, glass morphism, and elevated styles
- **Smooth Animations**: Scale and shadow transitions on hover with professional easing
- **Gradient Backgrounds**: Beautiful gradient combinations using the theme color palette
- **Accessibility**: Full keyboard navigation and screen reader support
- **Responsive**: Works seamlessly across different screen sizes

## Variants

### Default
Standard card with subtle gradient background and hover effects.
```jsx
<Card variant="default">
  <Typography>Default card content</Typography>
</Card>
```

### Gradient
Enhanced gradient with vibrant colors from primary and secondary theme colors.
```jsx
<Card variant="gradient">
  <Typography>Gradient card content</Typography>
</Card>
```

### Glass
Glass morphism effect with backdrop blur and transparency.
```jsx
<Card variant="glass">
  <Typography>Glass card content</Typography>
</Card>
```

### Elevated
Higher elevation with stronger shadows and enhanced depth.
```jsx
<Card variant="elevated">
  <Typography>Elevated card content</Typography>
</Card>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'default' \| 'gradient' \| 'glass' \| 'elevated'` | `'default'` | Card style variant |
| `children` | `ReactNode` | - | Card content |
| `onClick` | `function` | - | Click handler |
| `sx` | `object` | `{}` | Additional styling |
| `...props` | `object` | - | All Material-UI Paper props |

## Usage Examples

### Basic Usage
```jsx
import { Card } from '../components/ui';

function MyComponent() {
  return (
    <Card>
      <Typography variant="h6">Card Title</Typography>
      <Typography variant="body2">Card content goes here</Typography>
    </Card>
  );
}
```

### With Click Handler
```jsx
<Card onClick={() => console.log('Card clicked!')}>
  <Typography>Clickable card</Typography>
</Card>
```

### Custom Styling
```jsx
<Card 
  variant="gradient"
  sx={{ 
    minHeight: 200,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  }}
>
  <Typography>Custom styled card</Typography>
</Card>
```

## Animation Details

- **Hover Scale**: `scale(1.02)` with professional cubic-bezier easing
- **Active Scale**: `scale(0.98)` for tactile feedback
- **Transition Duration**: 350ms for smooth animations
- **Easing Function**: `cubic-bezier(.4, 2, .3, 1)` for professional feel

## Color Scheme

The Card component uses the theme's color palette:
- **Primary**: Deep blue (#3b82f6) to navy (#1e3a8a)
- **Secondary**: Warm orange (#f59e0b) to deep orange (#d97706)
- **Background**: Transparent with gradient overlays
- **Borders**: Semi-transparent blue with hover states

## Accessibility

- Proper focus management with visible focus indicators
- Keyboard navigation support (Enter and Space for click events)
- Screen reader compatible with proper ARIA attributes
- High contrast ratios for text readability

## Requirements Satisfied

- **3.1**: Gradient background implementation with theme colors
- **3.2**: Smooth hover animations and transitions
- **3.3**: Multiple card variants for different use cases
- **6.2**: Professional visual feedback and micro-interactions
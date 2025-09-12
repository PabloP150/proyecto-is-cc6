# Button Component

A professional styled Button component with gradient backgrounds, hover effects, and shimmer animations using CSS pseudo-elements.

## Features

- **Multiple Variants**: Primary, secondary, accent, outline, and ghost styles
- **Shimmer Animation**: CSS pseudo-element shimmer effect on hover
- **Gradient Backgrounds**: Beautiful gradient combinations using theme colors
- **Size Variants**: Small, medium, and large sizes
- **Accessibility**: Full keyboard navigation and focus management
- **Smooth Animations**: Professional easing and micro-interactions

## Variants

### Primary
Main action button with primary blue gradient.
```jsx
<Button variant="primary">Primary Action</Button>
```

### Secondary
Secondary action with warm orange gradient.
```jsx
<Button variant="secondary">Secondary Action</Button>
```

### Accent
Special accent button with dual-color gradient (blue to orange).
```jsx
<Button variant="accent">Special Action</Button>
```

### Outline
Outlined button with gradient border that fills on hover.
```jsx
<Button variant="outline">Outline Action</Button>
```

### Ghost
Minimal button with subtle hover effects and transparent background.
```jsx
<Button variant="ghost">Ghost Action</Button>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'primary' \| 'secondary' \| 'accent' \| 'outline' \| 'ghost'` | `'primary'` | Button style variant |
| `size` | `'small' \| 'medium' \| 'large'` | `'medium'` | Button size |
| `disabled` | `boolean` | `false` | Disabled state |
| `children` | `ReactNode` | - | Button content |
| `onClick` | `function` | - | Click handler |
| `sx` | `object` | `{}` | Additional styling |
| `...props` | `object` | - | All Material-UI Button props |

## Usage Examples

### Basic Usage
```jsx
import { Button } from '../components/ui';

function MyComponent() {
  return (
    <Button onClick={() => console.log('Clicked!')}>
      Click Me
    </Button>
  );
}
```

### Different Variants
```jsx
<Stack direction="row" spacing={2}>
  <Button variant="primary">Primary</Button>
  <Button variant="secondary">Secondary</Button>
  <Button variant="accent">Accent</Button>
  <Button variant="outline">Outline</Button>
  <Button variant="ghost">Ghost</Button>
</Stack>
```

### Different Sizes
```jsx
<Stack direction="row" spacing={2} alignItems="center">
  <Button size="small">Small</Button>
  <Button size="medium">Medium</Button>
  <Button size="large">Large</Button>
</Stack>
```

### Disabled State
```jsx
<Button disabled>Disabled Button</Button>
```

### Custom Styling
```jsx
<Button 
  variant="primary"
  size="large"
  sx={{ 
    minWidth: 200,
    borderRadius: 20
  }}
>
  Custom Button
</Button>
```

## Animation Details

### Hover Effects
- **Transform**: `translateY(-2px)` for lift effect
- **Shimmer**: CSS pseudo-element animation with 0.6s duration
- **Box Shadow**: Enhanced shadows with theme colors
- **Transition**: 300ms with professional cubic-bezier easing

### Active State
- **Transform**: `translateY(0)` for tactile feedback
- **Immediate Response**: No transition delay for active state

### Shimmer Animation
The shimmer effect uses CSS pseudo-elements:
```css
&::before {
  content: "";
  position: absolute;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
  animation: shimmer 0.6s ease-in-out;
}
```

## Color Schemes

### Primary Variant
- **Background**: `linear-gradient(135deg, #3b82f6 0%, #1e3a8a 100%)`
- **Hover**: `linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)`
- **Shadow**: `rgba(59, 130, 246, 0.6)`

### Secondary Variant
- **Background**: `linear-gradient(135deg, #f59e0b 0%, #d97706 100%)`
- **Hover**: `linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)`
- **Shadow**: `rgba(245, 158, 11, 0.6)`

### Accent Variant
- **Background**: `linear-gradient(90deg, #3b82f6 0%, #f59e0b 100%)`
- **Hover**: `linear-gradient(90deg, #60a5fa 0%, #fbbf24 100%)`
- **Shadow**: Dual-color shadow combining both theme colors

## Accessibility

- **Focus Management**: Visible focus indicators with outline
- **Keyboard Navigation**: Full support for Enter and Space keys
- **Screen Reader**: Proper ARIA attributes and semantic HTML
- **Color Contrast**: High contrast ratios for text readability
- **Disabled State**: Proper disabled styling and behavior

## Requirements Satisfied

- **5.2**: Gradient backgrounds and hover effects implementation
- **6.1**: Smooth animations and micro-interactions
- **6.2**: Professional visual feedback system with shimmer effects
# TextField Component

A professional enhanced form input component with glass morphism styling, smooth focus states, border color transitions, and glow effects with proper validation styling.

## Features

- **Glass Morphism**: Background with backdrop blur and transparency effects
- **Smooth Transitions**: Border color transitions and glow effects on focus/hover
- **Enhanced Focus States**: Animated borders with professional easing
- **Validation Styling**: Error and success states with appropriate colors
- **Size Variants**: Small, medium, and large sizes
- **Adornments**: Support for start and end adornments (icons, text, etc.)
- **Accessibility**: Full keyboard navigation and screen reader support

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'outlined' \| 'filled' \| 'standard'` | `'outlined'` | TextField variant |
| `size` | `'small' \| 'medium' \| 'large'` | `'medium'` | TextField size |
| `fullWidth` | `boolean` | `true` | Whether to take full width |
| `error` | `boolean` | `false` | Error state |
| `success` | `boolean` | `false` | Success state (custom prop) |
| `helperText` | `string` | - | Helper text below input |
| `startAdornment` | `ReactNode` | - | Element at start of input |
| `endAdornment` | `ReactNode` | - | Element at end of input |
| `sx` | `object` | `{}` | Additional styling |
| `...props` | `object` | - | All Material-UI TextField props |

## Usage Examples

### Basic Usage
```jsx
import { TextField } from '../components/ui';

function MyForm() {
  return (
    <TextField
      label="Email Address"
      placeholder="Enter your email"
    />
  );
}
```

### With Validation States
```jsx
// Error state
<TextField
  label="Email"
  error
  helperText="Please enter a valid email address"
/>

// Success state
<TextField
  label="Username"
  success
  helperText="Username is available!"
/>
```

### Different Sizes
```jsx
<Stack spacing={2}>
  <TextField size="small" label="Small Input" />
  <TextField size="medium" label="Medium Input" />
  <TextField size="large" label="Large Input" />
</Stack>
```

### With Adornments
```jsx
import { Email, Visibility } from '@mui/icons-material';

// Start adornment
<TextField
  label="Email"
  startAdornment={<Email />}
/>

// End adornment
<TextField
  label="Password"
  type="password"
  endAdornment={
    <IconButton onClick={toggleVisibility}>
      <Visibility />
    </IconButton>
  }
/>
```

### Multiline Input
```jsx
<TextField
  label="Description"
  multiline
  rows={4}
  placeholder="Enter a detailed description..."
/>
```

### Controlled Input
```jsx
const [value, setValue] = useState('');

<TextField
  label="Controlled Input"
  value={value}
  onChange={(e) => setValue(e.target.value)}
/>
```

## Styling Details

### Glass Morphism Effect
- **Background**: `rgba(30, 58, 138, 0.1)` with `backdrop-filter: blur(20px)`
- **Border**: Semi-transparent with smooth transitions
- **Hover**: Enhanced background opacity and border glow

### Focus States
- **Border Color**: Changes to theme primary color (#3b82f6)
- **Glow Effect**: Box shadow with theme color and blur
- **Background**: Slightly enhanced opacity for better contrast

### Error States
- **Border Color**: Red (#ef4444) with error glow
- **Helper Text**: Red color with medium font weight
- **Focus Glow**: Red shadow with appropriate opacity

### Success States
- **Border Color**: Green (#10b981) with success glow
- **Helper Text**: Maintains normal styling
- **Focus Glow**: Green shadow with appropriate opacity

## Animation Details

- **Transition Duration**: 300ms for all state changes
- **Easing**: `cubic-bezier(.4, 2, .3, 1)` for professional feel
- **Focus Glow**: Combines box-shadow with blur for depth
- **Hover Effects**: Subtle background and border color changes

## Color Scheme

### Normal State
- **Background**: `rgba(30, 58, 138, 0.1)`
- **Border**: `rgba(248, 250, 252, 0.2)`
- **Text**: `#f8fafc`
- **Label**: `rgba(248, 250, 252, 0.7)`

### Focus State
- **Background**: `rgba(59, 130, 246, 0.2)`
- **Border**: `#3b82f6`
- **Glow**: `rgba(59, 130, 246, 0.3)` with blur

### Error State
- **Border**: `#ef4444`
- **Glow**: `rgba(239, 68, 68, 0.3)`
- **Helper Text**: `#f87171`

### Success State
- **Border**: `#10b981`
- **Glow**: `rgba(16, 185, 129, 0.3)`
- **Label**: `#10b981` when focused

## Accessibility

- **Focus Management**: Visible focus indicators with enhanced glow
- **Keyboard Navigation**: Full support for Tab, Enter, and arrow keys
- **Screen Reader**: Proper ARIA attributes and semantic HTML
- **Color Contrast**: High contrast ratios for all text states
- **Error Handling**: Proper error announcements for screen readers

## Requirements Satisfied

- **5.1**: Glass morphism styling and focus states implementation
- **5.3**: Smooth border color transitions and glow effects
- **5.4**: Proper validation styling with error states and visual feedback
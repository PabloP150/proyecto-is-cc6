import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import TextField from '../TextField';
import theme from '../../../theme/theme';

// Test wrapper with theme
const TestWrapper = ({ children }) => (
  <ThemeProvider theme={theme}>
    {children}
  </ThemeProvider>
);

describe('TextField Component', () => {
  it('renders with label correctly', () => {
    render(
      <TestWrapper>
        <TextField label="Test Label" />
      </TestWrapper>
    );
    
    expect(screen.getByLabelText('Test Label')).toBeTruthy();
  });

  it('renders with placeholder correctly', () => {
    render(
      <TestWrapper>
        <TextField placeholder="Test placeholder" />
      </TestWrapper>
    );
    
    expect(screen.getByPlaceholderText('Test placeholder')).toBeTruthy();
  });

  it('handles value changes', () => {
    const handleChange = jest.fn();
    
    render(
      <TestWrapper>
        <TextField 
          label="Test Input"
          value=""
          onChange={handleChange}
        />
      </TestWrapper>
    );
    
    const input = screen.getByLabelText('Test Input');
    fireEvent.change(input, { target: { value: 'test value' } });
    
    expect(handleChange).toHaveBeenCalled();
  });

  it('displays helper text', () => {
    render(
      <TestWrapper>
        <TextField 
          label="Test Input"
          helperText="This is helper text"
        />
      </TestWrapper>
    );
    
    expect(screen.getByText('This is helper text')).toBeTruthy();
  });

  it('shows error state correctly', () => {
    render(
      <TestWrapper>
        <TextField 
          label="Test Input"
          error
          helperText="This is an error"
        />
      </TestWrapper>
    );
    
    expect(screen.getByText('This is an error')).toBeTruthy();
  });

  it('applies small size styling', () => {
    render(
      <TestWrapper>
        <TextField 
          label="Small Input"
          size="small"
          data-testid="small-input"
        />
      </TestWrapper>
    );
    
    const input = screen.getByTestId('small-input');
    expect(input).toBeTruthy();
  });

  it('applies medium size styling by default', () => {
    render(
      <TestWrapper>
        <TextField 
          label="Medium Input"
          data-testid="medium-input"
        />
      </TestWrapper>
    );
    
    const input = screen.getByTestId('medium-input');
    expect(input).toBeTruthy();
  });

  it('applies large size styling', () => {
    render(
      <TestWrapper>
        <TextField 
          label="Large Input"
          size="large"
          data-testid="large-input"
        />
      </TestWrapper>
    );
    
    const input = screen.getByTestId('large-input');
    expect(input).toBeTruthy();
  });

  it('handles disabled state', () => {
    render(
      <TestWrapper>
        <TextField 
          label="Disabled Input"
          disabled
        />
      </TestWrapper>
    );
    
    const input = screen.getByLabelText('Disabled Input');
    expect(input.disabled).toBe(true);
  });

  it('supports multiline input', () => {
    render(
      <TestWrapper>
        <TextField 
          label="Multiline Input"
          multiline
          rows={4}
        />
      </TestWrapper>
    );
    
    const input = screen.getByLabelText('Multiline Input');
    expect(input.tagName).toBe('TEXTAREA');
  });

  it('renders start adornment', () => {
    render(
      <TestWrapper>
        <TextField 
          label="Input with Start Adornment"
          startAdornment={<span data-testid="start-adornment">@</span>}
        />
      </TestWrapper>
    );
    
    expect(screen.getByTestId('start-adornment')).toBeTruthy();
  });

  it('renders end adornment', () => {
    render(
      <TestWrapper>
        <TextField 
          label="Input with End Adornment"
          endAdornment={<span data-testid="end-adornment">$</span>}
        />
      </TestWrapper>
    );
    
    expect(screen.getByTestId('end-adornment')).toBeTruthy();
  });

  it('applies success state styling', () => {
    render(
      <TestWrapper>
        <TextField 
          label="Success Input"
          success
          data-testid="success-input"
        />
      </TestWrapper>
    );
    
    const input = screen.getByTestId('success-input');
    expect(input).toBeTruthy();
  });

  it('accepts custom sx props', () => {
    render(
      <TestWrapper>
        <TextField 
          label="Custom Input"
          sx={{ margin: 2 }}
          data-testid="custom-input"
        />
      </TestWrapper>
    );
    
    const input = screen.getByTestId('custom-input');
    expect(input).toBeTruthy();
  });

  it('forwards ref correctly', () => {
    const ref = React.createRef();
    
    render(
      <TestWrapper>
        <TextField 
          ref={ref}
          label="Ref Input"
        />
      </TestWrapper>
    );
    
    expect(ref.current).toBeInstanceOf(HTMLElement);
  });

  it('supports different input types', () => {
    render(
      <TestWrapper>
        <TextField 
          label="Email Input"
          type="email"
        />
      </TestWrapper>
    );
    
    const input = screen.getByLabelText('Email Input');
    expect(input.type).toBe('email');
  });

  it('handles focus and blur events', () => {
    const handleFocus = jest.fn();
    const handleBlur = jest.fn();
    
    render(
      <TestWrapper>
        <TextField 
          label="Focus Input"
          onFocus={handleFocus}
          onBlur={handleBlur}
        />
      </TestWrapper>
    );
    
    const input = screen.getByLabelText('Focus Input');
    
    fireEvent.focus(input);
    expect(handleFocus).toHaveBeenCalled();
    
    fireEvent.blur(input);
    expect(handleBlur).toHaveBeenCalled();
  });
});
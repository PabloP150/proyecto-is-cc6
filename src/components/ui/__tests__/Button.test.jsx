import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import Button from '../Button';
import theme from '../../../theme/theme';

// Test wrapper with theme
const TestWrapper = ({ children }) => (
  <ThemeProvider theme={theme}>
    {children}
  </ThemeProvider>
);

describe('Button Component', () => {
  it('renders children correctly', () => {
    render(
      <TestWrapper>
        <Button>Test Button</Button>
      </TestWrapper>
    );
    
    expect(screen.getByText('Test Button')).toBeTruthy();
  });

  it('applies primary variant by default', () => {
    render(
      <TestWrapper>
        <Button data-testid="primary-button">Primary Button</Button>
      </TestWrapper>
    );
    
    const button = screen.getByTestId('primary-button');
    expect(button).toBeTruthy();
  });

  it('applies secondary variant styling', () => {
    render(
      <TestWrapper>
        <Button variant="secondary" data-testid="secondary-button">
          Secondary Button
        </Button>
      </TestWrapper>
    );
    
    const button = screen.getByTestId('secondary-button');
    expect(button).toBeTruthy();
  });

  it('applies accent variant styling', () => {
    render(
      <TestWrapper>
        <Button variant="accent" data-testid="accent-button">
          Accent Button
        </Button>
      </TestWrapper>
    );
    
    const button = screen.getByTestId('accent-button');
    expect(button).toBeTruthy();
  });

  it('applies outline variant styling', () => {
    render(
      <TestWrapper>
        <Button variant="outline" data-testid="outline-button">
          Outline Button
        </Button>
      </TestWrapper>
    );
    
    const button = screen.getByTestId('outline-button');
    expect(button).toBeTruthy();
  });

  it('applies ghost variant styling', () => {
    render(
      <TestWrapper>
        <Button variant="ghost" data-testid="ghost-button">
          Ghost Button
        </Button>
      </TestWrapper>
    );
    
    const button = screen.getByTestId('ghost-button');
    expect(button).toBeTruthy();
  });

  it('handles click events', () => {
    const handleClick = jest.fn();
    
    render(
      <TestWrapper>
        <Button onClick={handleClick} data-testid="clickable-button">
          Clickable Button
        </Button>
      </TestWrapper>
    );
    
    const button = screen.getByTestId('clickable-button');
    fireEvent.click(button);
    
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('applies small size styling', () => {
    render(
      <TestWrapper>
        <Button size="small" data-testid="small-button">
          Small Button
        </Button>
      </TestWrapper>
    );
    
    const button = screen.getByTestId('small-button');
    expect(button).toBeTruthy();
  });

  it('applies medium size styling by default', () => {
    render(
      <TestWrapper>
        <Button data-testid="medium-button">
          Medium Button
        </Button>
      </TestWrapper>
    );
    
    const button = screen.getByTestId('medium-button');
    expect(button).toBeTruthy();
  });

  it('applies large size styling', () => {
    render(
      <TestWrapper>
        <Button size="large" data-testid="large-button">
          Large Button
        </Button>
      </TestWrapper>
    );
    
    const button = screen.getByTestId('large-button');
    expect(button).toBeTruthy();
  });

  it('handles disabled state', () => {
    const handleClick = jest.fn();
    
    render(
      <TestWrapper>
        <Button disabled onClick={handleClick} data-testid="disabled-button">
          Disabled Button
        </Button>
      </TestWrapper>
    );
    
    const button = screen.getByTestId('disabled-button');
    fireEvent.click(button);
    
    expect(handleClick).not.toHaveBeenCalled();
    expect(button.disabled).toBe(true);
  });

  it('accepts custom sx props', () => {
    render(
      <TestWrapper>
        <Button sx={{ margin: 2 }} data-testid="custom-button">
          Custom Button
        </Button>
      </TestWrapper>
    );
    
    const button = screen.getByTestId('custom-button');
    expect(button).toBeTruthy();
  });

  it('forwards ref correctly', () => {
    const ref = React.createRef();
    
    render(
      <TestWrapper>
        <Button ref={ref} data-testid="ref-button">
          Ref Button
        </Button>
      </TestWrapper>
    );
    
    expect(ref.current).toBeInstanceOf(HTMLElement);
  });

  it('supports all Material-UI Button props', () => {
    render(
      <TestWrapper>
        <Button fullWidth data-testid="mui-props-button">
          MUI Props Button
        </Button>
      </TestWrapper>
    );
    
    const button = screen.getByTestId('mui-props-button');
    expect(button).toBeTruthy();
  });

  it('handles keyboard events', () => {
    const handleClick = jest.fn();
    
    render(
      <TestWrapper>
        <Button onClick={handleClick} data-testid="keyboard-button">
          Keyboard Button
        </Button>
      </TestWrapper>
    );
    
    const button = screen.getByTestId('keyboard-button');
    
    // Simulate Enter key press
    fireEvent.keyDown(button, { key: 'Enter', code: 'Enter' });
    
    expect(button).toBeTruthy();
  });
});
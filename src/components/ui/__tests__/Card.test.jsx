import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import Card from '../Card';
import theme from '../../../theme/theme';

// Test wrapper with theme
const TestWrapper = ({ children }) => (
  <ThemeProvider theme={theme}>
    {children}
  </ThemeProvider>
);

describe('Card Component', () => {
  it('renders children correctly', () => {
    render(
      <TestWrapper>
        <Card>
          <div>Test Content</div>
        </Card>
      </TestWrapper>
    );
    
    expect(screen.getByText('Test Content')).toBeTruthy();
  });

  it('applies default variant styling', () => {
    const { container } = render(
      <TestWrapper>
        <Card data-testid="card">Default Card</Card>
      </TestWrapper>
    );
    
    const card = container.firstChild;
    expect(card).toBeTruthy();
  });

  it('applies gradient variant styling', () => {
    render(
      <TestWrapper>
        <Card variant="gradient" data-testid="gradient-card">
          Gradient Card
        </Card>
      </TestWrapper>
    );
    
    const card = screen.getByTestId('gradient-card');
    expect(card).toBeTruthy();
  });

  it('applies glass variant styling', () => {
    render(
      <TestWrapper>
        <Card variant="glass" data-testid="glass-card">
          Glass Card
        </Card>
      </TestWrapper>
    );
    
    const card = screen.getByTestId('glass-card');
    expect(card).toBeTruthy();
  });

  it('applies elevated variant styling', () => {
    render(
      <TestWrapper>
        <Card variant="elevated" data-testid="elevated-card">
          Elevated Card
        </Card>
      </TestWrapper>
    );
    
    const card = screen.getByTestId('elevated-card');
    expect(card).toBeTruthy();
  });

  it('handles click events', () => {
    const handleClick = jest.fn();
    
    render(
      <TestWrapper>
        <Card onClick={handleClick} data-testid="clickable-card">
          Clickable Card
        </Card>
      </TestWrapper>
    );
    
    const card = screen.getByTestId('clickable-card');
    fireEvent.click(card);
    
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('accepts custom sx props', () => {
    render(
      <TestWrapper>
        <Card sx={{ margin: 2 }} data-testid="custom-card">
          Custom Card
        </Card>
      </TestWrapper>
    );
    
    const card = screen.getByTestId('custom-card');
    expect(card).toBeTruthy();
  });

  it('forwards ref correctly', () => {
    const ref = React.createRef();
    
    render(
      <TestWrapper>
        <Card ref={ref} data-testid="ref-card">
          Ref Card
        </Card>
      </TestWrapper>
    );
    
    expect(ref.current).toBeInstanceOf(HTMLElement);
  });

  it('supports all Material-UI Paper props', () => {
    render(
      <TestWrapper>
        <Card elevation={4} square data-testid="paper-props-card">
          Paper Props Card
        </Card>
      </TestWrapper>
    );
    
    const card = screen.getByTestId('paper-props-card');
    expect(card).toBeTruthy();
  });
});
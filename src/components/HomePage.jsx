import React from 'react';
import {
  Container,
  Typography,
  Box,
  Grid2 as Grid,
  CssBaseline,
} from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { Link as RouterLink } from 'react-router-dom';
import {
  TaskAlt as TaskIcon,
  CalendarMonth as CalendarIcon,
  AccountTree as DiagramIcon,
  Groups as GroupsIcon,
} from '@mui/icons-material';

// Import the design system components
import { Card, Button } from './ui';
import { theme } from '../theme';

function HomePage() {
  const features = [
    {
      title: 'Task Management',
      description: 'Organize and track your tasks with powerful management tools',
      icon: <TaskIcon sx={{ fontSize: 36, color: 'primary.main', mb: 1.5 }} />,
      path: '/tasks',
      variant: 'elevated',
    },
    {
      title: 'Calendar View',
      description: 'Visualize your schedule and deadlines in an intuitive calendar',
      icon: <CalendarIcon sx={{ fontSize: 36, color: 'secondary.main', mb: 1.5 }} />,
      path: '/calendar',
      variant: 'elevated',
    },
    {
      title: 'Milestone Viewer',
      description: 'Track project progress with visual milestone diagrams',
      icon: <DiagramIcon sx={{ fontSize: 36, color: 'success.main', mb: 1.5 }} />,
      path: '/block-diagram',
      variant: 'elevated',
    },
    {
      title: 'Team Groups',
      description: 'Collaborate with your team and manage group projects',
      icon: <GroupsIcon sx={{ fontSize: 36, color: 'warning.main', mb: 1.5 }} />,
      path: '/groups',
      variant: 'elevated',
    },
  ];

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {/* Animated Background Layer */}
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: -2,
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)',
        }}
      />

      {/* Simple Radial Gradient Overlays */}
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: -1,
          background: `
            radial-gradient(circle at 20% 80%, rgba(59, 130, 246, 0.2) 0%, transparent 50%),
            radial-gradient(circle at 80% 20%, rgba(245, 158, 11, 0.15) 0%, transparent 50%)
          `,
        }}
      />
      <Box
        sx={{
          minHeight: '100vh',
          width: '100%',
          position: 'relative',
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'radial-gradient(ellipse at top, rgba(59, 130, 246, 0.15) 0%, transparent 50%), radial-gradient(ellipse at bottom, rgba(245, 158, 11, 0.1) 0%, transparent 50%)',
            zIndex: 1,
          },
        }}
      >
        <Container
          component="main"
          maxWidth="xl"
          sx={{
            position: 'relative',
            zIndex: 2,
            pt: 12, // Add top padding to account for navbar
            pb: 4,
          }}
        >
          {/* Hero Section */}
          <Card
            variant="gradient"
            sx={{
              mb: 6,
              p: 6,
              textAlign: 'center',
              background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(245, 158, 11, 0.1) 50%, rgba(55, 65, 81, 0.95) 100%)',
              boxShadow: '0 12px 36px 0 rgba(40,60,110,0.45), 0 4px 24px 0 rgba(0,0,0,0.28)', // Add shadow to the card
            }}
          >
            <Typography
              component="h1"
              variant="h2"
              sx={{
                mb: 3,
                background: 'linear-gradient(135deg, #60a5fa 0%, #fbbf24 100%)', // Brighter, more vibrant colors
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                fontWeight: 800,
                fontSize: '3.5rem',
                filter: 'brightness(1.2) saturate(1.2)', // Enhance brightness and saturation
                transition: 'all 0.3s ease',
                '&:hover': {
                  filter: 'brightness(1.4) saturate(1.5)', // Increase effect on hover
                  transform: 'scale(1.02)',
                }
              }}
            >
              Welcome to TaskMate
            </Typography>
            <Typography
              variant="h6"
              sx={{
                mb: 4,
                color: 'text.secondary',
                maxWidth: '600px',
                mx: 'auto',
                lineHeight: 1.6,
              }}
            >
              Your all-in-one task management solution. Organize your tasks, manage your time,
              and visualize your projects with ease using our modern, intuitive interface.
            </Typography>
            <Button
              variant="accent"
              size="large"
              component={RouterLink}
              to="/tasks"
              sx={{
                px: 4,
                py: 1.5,
                fontSize: '1.1rem',
              }}
            >
              Get Started
            </Button>
          </Card>

          {/* Features Grid - Using Flexbox for reliable layout */}
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
              justifyContent: 'center',
              '@media (min-width: 900px)': {
                flexWrap: 'nowrap',
              },
            }}
          >
            {features.map((feature, index) => (
              <Box
                key={index}
                sx={{
                  flex: '1 1 280px',
                  maxWidth: { xs: '100%', sm: 'calc(50% - 16px)', md: 'calc(25% - 12px)' },
                  minWidth: '250px',
                }}
              >
                <Card
                  variant={feature.variant}
                  component={RouterLink}
                  to={feature.path}
                  sx={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    textAlign: 'center',
                    p: 3,
                    textDecoration: 'none',
                    color: 'inherit',
                    minHeight: '220px',
                    justifyContent: 'center',
                    '&:hover': {
                      transform: 'scale(1.05) translateY(-8px)',
                      '& .feature-icon': {
                        transform: 'scale(1.1) rotate(5deg)',
                      },
                      '& .feature-button': {
                        transform: 'translateY(-2px)',
                      },
                    },
                  }}
                >
                  <Box
                    className="feature-icon"
                    sx={{
                      transition: 'all 0.3s cubic-bezier(.4,2,.3,1)',
                      mb: 2,
                    }}
                  >
                    {feature.icon}
                  </Box>
                  <Typography
                    variant="h6"
                    component="h3"
                    sx={{
                      mb: 1.5,
                      fontWeight: 600,
                      color: 'text.primary',
                      fontSize: '1.1rem',
                    }}
                  >
                    {feature.title}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      mb: 2,
                      color: 'text.secondary',
                      lineHeight: 1.5,
                      flexGrow: 1,
                      fontSize: '0.85rem',
                    }}
                  >
                    {feature.description}
                  </Typography>
                  <Button
                    className="feature-button"
                    variant="ghost"
                    size="small"
                    sx={{
                      transition: 'all 0.3s cubic-bezier(.4,2,.3,1)',
                      mt: 'auto',
                    }}
                  >
                    Explore
                  </Button>
                </Card>
              </Box>
            ))}
          </Box>

          {/* Additional Info Section */}
          <Grid container spacing={4} sx={{ mt: 4 }}>
            <Grid xs={12} md={6}>
              <Card
                variant="glass"
                sx={{
                  p: 4,
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                }}
              >
                <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>
                  Powerful Features
                </Typography>
                <Typography variant="body1" sx={{ color: 'text.secondary', lineHeight: 1.6 }}>
                  Experience seamless task management with our comprehensive suite of tools.
                  From simple to-do lists to complex project workflows, TaskMate adapts to your needs.
                </Typography>
              </Card>
            </Grid>
            <Grid xs={12} md={6}>
              <Card
                variant="elevated"
                sx={{
                  p: 4,
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  boxShadow: 'none', // Remove box shadow
                  '&:hover': {
                    boxShadow: 'none', // Ensure no shadow on hover
                    transform: 'none', // Optional: disable hover transform
                  },
                }}
              >
                <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>
                  Team Collaboration
                </Typography>
                <Typography variant="body1" sx={{ color: 'text.secondary', lineHeight: 1.6 }}>
                  Work together efficiently with real-time updates, shared workspaces,
                  and integrated communication tools designed for modern teams.
                </Typography>
              </Card>
            </Grid>
          </Grid>
        </Container>
      </Box>
    </ThemeProvider>
  );
}

export default HomePage;

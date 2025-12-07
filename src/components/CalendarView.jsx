import {
  Box,
  Container,
  CssBaseline,
  Typography,
} from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import moment from 'moment';
import { useContext, useEffect, useState } from 'react';
import { Calendar, momentLocalizer } from 'react-big-calendar';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import './CalendarView.css';
import { GroupContext } from './GroupContext';

// Import the design system components
import { theme } from '../theme';
import { Card } from './ui';

const localizer = momentLocalizer(moment);

function CalendarView() {
  const { selectedGroupId } = useContext(GroupContext);
  const [events, setEvents] = useState([]);

  useEffect(() => {
    if (!selectedGroupId) {
      setEvents([]);
      return;
    }
    const fetchTasks = async () => {
      try {
        const response = await fetch(`http://localhost:9000/api/nodes/tasks/${selectedGroupId}`);
        if (response.ok) {
          const data = await response.json();
          const tasks = data.data.map((task) => ({
            title: task.name,
            start: new Date(task.date),
            end: new Date(task.date),
          }));
          setEvents(tasks);
        }
      } catch (error) {
        console.error('Error fetching tasks:', error);
      }
    };
    fetchTasks();
  }, [selectedGroupId]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {/* Animated Background Layer - matching HomePage */}
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

      {/* Simple Radial Gradient Overlays - matching HomePage */}
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
          <Card
            variant="gradient"
            sx={{
              minHeight: '85vh',
              width: '100%',
              p: 4,
              background: 'linear-gradient(135deg, rgba(30, 58, 138, 0.2) 0%, rgba(55, 65, 81, 0.95) 100%)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(59, 130, 246, 0.2)',
              // Disable all animations
              transition: 'none !important',
              transform: 'none !important',
              cursor: 'default',
              '&:hover': {
                transform: 'none !important',
                background: 'linear-gradient(135deg, rgba(30, 58, 138, 0.2) 0%, rgba(55, 65, 81, 0.95) 100%)',
                borderColor: 'rgba(59, 130, 246, 0.2)',
                boxShadow: 'none',
              },
              '&:active': {
                transform: 'none !important',
              },
            }}
          >
            <Typography
              component="h1"
              variant="h3"
              align="center"
              sx={{
                mb: 4,
                fontWeight: 700,
                background: 'seashell',
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              Your Calendar
            </Typography>
            <Box
              sx={{
                height: 'calc(85vh - 120px)',
                minHeight: '600px',
                '& .rbc-calendar': {
                  height: '100% !important',
                },
              }}
            >
              {!selectedGroupId && (
                <div style={{ color: 'white', textAlign: 'center', marginTop: '2rem' }}>
                  Selecciona un grupo para ver el calendario.
                </div>
              )}
              {selectedGroupId && (
                <Calendar
                  localizer={localizer}
                  events={events}
                  startAccessor="start"
                  endAccessor="end"
                  style={{ height: '100%' }}
                  views={['month']}
                />
              )}
            </Box>
          </Card>
        </Container>
      </Box>
    </ThemeProvider>
  );
}

export default CalendarView;

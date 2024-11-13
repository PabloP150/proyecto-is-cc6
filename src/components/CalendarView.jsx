import React, { useState, useEffect, useContext } from 'react';
import {
  Typography,
  Container,
  Box,
  CssBaseline,
  Paper
} from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { Calendar, momentLocalizer } from 'react-big-calendar';
import moment from 'moment';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { GroupContext } from './GroupContext';
import './CalendarView.css';

const localizer = momentLocalizer(moment);

const theme = createTheme({
  palette: {
    mode: 'dark',
    background: {
      default: 'transparent',
      paper: 'rgba(0, 0, 0, 0.6)',
    },
  },
});

function CalendarView() {
  const { selectedGroupId } = useContext(GroupContext);
  const [events, setEvents] = useState([]);

  useEffect(() => {
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
          console.log(data.data);
          setEvents(tasks);
        }
      } catch (error) {
        console.error('Error fetching tasks:', error);
      }
    };
    fetchTasks();
  }, []);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundImage: 'url(/1.jpeg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          zIndex: -1,
        }}
      />
      <Box
        sx={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 1,
        }}
      >
        <Container component="main">
          <Paper elevation={6}
            sx={{
              height: '90vh',
              width: '100%',
              p: 4,
              backgroundColor: 'background.paper',
              borderRadius: 2,
            }}>
            <Typography component="h1" variant="h4" align="center" marginTop={-2} marginBottom={2}>
              Your Calendar
            </Typography>
            <div style={{ height: 600 }}>
              <Calendar
                localizer={localizer}
                events={events}
                startAccessor="start"
                endAccessor="end"
                style={{ height: 550 }}
                views={['month']}
              />
            </div>
          </Paper>
        </Container>
      </Box>
    </ThemeProvider>
  );
}

export default CalendarView;

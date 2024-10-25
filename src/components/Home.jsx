import React from 'react';
import { Typography, Box } from '@mui/material';

function Home() {
  return (
    <Box sx={{ p: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Bienvenido a TaskMate
      </Typography>
      <Typography variant="body1">
        Esta es la página de inicio. Aquí puedes ver tus recordatorios y grupos.
      </Typography>
    </Box>
  );
}

export default Home;


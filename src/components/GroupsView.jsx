import React, { useState, useEffect, useContext } from 'react';
import { Box, Typography, List, ListItem, CssBaseline, Paper, Container } from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { GroupContext } from './GroupContext'

function GroupsView() {
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const { setSelectedGroupId } = useContext(GroupContext);

  useEffect(() => {
    cargarGrupos();
  }, []);

  const cargarGrupos = async () => {
    const userId = localStorage.getItem('userId');
    if (!userId) {
      console.error('User ID is not available');
      return;
    }
    try {
      const response = await fetch(`http://localhost:9000/api/groups/user-groups?uid=${userId}`);
      if (response.ok) {
        const data = await response.json();
        setGroups(data.groups);
      } else {
        console.error('Error al cargar los grupos');
      }
    } catch (error) {
      console.error('Error en la solicitud:', error);
    }
  };

  const handleGroupClick = (group) => {
    setSelectedGroupId(group.gid);
    setSelectedGroup(group);
    // Cargar miembros del grupo seleccionado
    fetch(`http://localhost:9000/api/groups/${group.gid}/members`)
      .then(response => response.json())
      .then(data => setMembers(data.members));
  };

  const theme = createTheme({
    palette: {
      mode: 'dark',
      primary: {
        main: '#4a90e2',
      },
      background: {
        default: 'transparent',
        paper: 'rgba(0, 0, 0, 0.6)',
      },
    },
  });

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundImage: 'url(/1.jpeg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          zIndex: -1,
        }}
      >
        <Container component="main" maxWidth="ms" sx={{ mt: 8 }}>
          <Box sx={{ display: 'flex', flexGrow: 1, padding: 1 }}>
            <Paper sx={{ width: '20%', marginRight: 2, padding: 2, overflow: 'auto' }}>
            <Typography variant="h6" gutterBottom>Groups</Typography>
            <List>
              {groups.map(group => (
                <ListItem key={group.gid} button onClick={() => handleGroupClick(group)}>
                  {group.name}
                </ListItem>
              ))}
            </List>
          </Paper>
          <Paper sx={{ width: '80%', padding: 2, overflow: 'auto' }}>
            {selectedGroup ? (
              <>
                <Typography variant="h4" gutterBottom>{selectedGroup.name}</Typography>
                <Typography variant="h6" gutterBottom>Members</Typography>
                <List>
                  {members.map(member => (
                    <ListItem key={member.uid}>{member.username}</ListItem>
                  ))}
                </List>
              </>
            ) : (
              <Typography variant="h6">Select a group to see details</Typography>
            )}
          </Paper>
          </Box>
        </Container>
      </Box>
    </ThemeProvider>
  );
}

export default GroupsView;

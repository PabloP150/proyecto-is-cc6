import React, { useState, useEffect, useContext, useCallback } from 'react';
import { Box, Typography, List, ListItem, CssBaseline, Paper, Container, Button, TextField, Dialog, DialogActions, DialogContent, DialogTitle, styled } from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { GroupContext } from './GroupContext';

const UseButton = styled(Button)(({ theme, selected }) => ({
  backgroundColor: selected ? 'green' : 'white',
  color: selected ? 'white' : 'black',
  marginLeft: '10px',
  '&:hover': {
    backgroundColor: selected ? '#006400' : '#f0f0f0',
  },
}));

function GroupsView() {
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [openCreateGroup, setOpenCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [openAddUser, setOpenAddUser] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [openDeleteUser, setOpenDeleteUser] = useState(false);
  const [usernameToDelete, setUsernameToDelete] = useState('');
  const { selectedGroupId, setSelectedGroupId, setSelectedGroupName } = useContext(GroupContext);

  const cargarGrupos = useCallback(async () => {
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
        const storedGroupId = localStorage.getItem('selectedGroupId');
        if (storedGroupId) {
          const groupToSelect = data.groups.find(group => group.gid === storedGroupId);
          if (groupToSelect) {
            setSelectedGroupId(groupToSelect.gid);
            setSelectedGroupName(groupToSelect.name);
            setSelectedGroup(groupToSelect);
          }
        } else if (data.groups.length > 0) {
          const firstGroup = data.groups[0];
          setSelectedGroupId(firstGroup.gid);
          setSelectedGroupName(firstGroup.name);
          setSelectedGroup(firstGroup);
          localStorage.setItem('selectedGroupId', firstGroup.gid);
          localStorage.setItem('selectedGroupName', firstGroup.name);
        }
      } else {
        console.error('Error al cargar los grupos');
      }
    } catch (error) {
      console.error('Error en la solicitud:', error);
    }
  }, [setGroups, setSelectedGroupId, setSelectedGroupName, setSelectedGroup]);

  useEffect(() => {
    cargarGrupos();
  }, [cargarGrupos]);

  const handleGroupClick = (group) => {
    setSelectedGroupId(group.gid);
    setSelectedGroupName(group.name);
    setSelectedGroup(group);
    localStorage.setItem('selectedGroupId', group.gid);
    localStorage.setItem('selectedGroupName', group.name);
    fetch(`http://localhost:9000/api/groups/${group.gid}/members`)
      .then(response => response.json())
      .then(data => setMembers(data.members))
      .catch(error => console.error('Error loading members:', error));
  };

  const handleCreateGroup = async () => {
    const userId = localStorage.getItem('userId');
    if (!userId) {
      console.error('User ID is not available');
      return;
    }
    try {
      const response = await fetch('http://localhost:9000/api/groups/group', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ adminId: userId, name: newGroupName }),
      });

      if (response.ok) {
        const data = await response.json();
        console.log(data.message);
        setOpenCreateGroup(false);
        cargarGrupos();
      } else {
        const errorData = await response.json();
        console.error(errorData.error);
      }
    } catch (error) {
      console.error('Error en la solicitud:', error);
    }
    setNewGroupName('');
  };

  const handleAddUserToGroup = async () => {
    if (!selectedGroup) {
      console.error('No group selected');
      return;
    }
    try {
      console.log('Username:', newUsername);
      const userResponse = await fetch(`http://localhost:9000/api/users/getuid?username=${newUsername}`);
      if (!userResponse.ok) {
        const errorData = await userResponse.json();
        console.error(errorData.error);
        return;
      }
      const userData = await userResponse.json();
      const uid = userData.uid;

      if (!uid) {
        console.error('UID is null or undefined');
        return;
      }

      const response = await fetch('http://localhost:9000/api/groups/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uid, gid: selectedGroup.gid }),
      });

      if (response.ok) {
        console.log('User added successfully');
        setOpenAddUser(false);
        handleGroupClick(selectedGroup); // Refresh members
        setNewUsername('');
      } else {
        const errorData = await response.json();
        console.error(errorData.error);
      }
    } catch (error) {
      console.error('Error en la solicitud:', error);
    }
  };

  const handleUseGroup = (group) => {
    setSelectedGroupId(group.gid);
    console.log(`Using group: ${group.name} with gid: ${group.gid}`);
  };

  const handleDeleteUser = async () => {
    const userId = localStorage.getItem('userId');
    if (!userId) {
      console.error('User ID is not available');
      return;
    }

    try {
      console.log('Username to delete:', usernameToDelete);

      const userResponse = await fetch(`http://localhost:9000/api/users/getuid?username=${usernameToDelete}`);
      if (!userResponse.ok) {
        const errorData = await userResponse.json();
        console.error(errorData.error);
        return;
      }

      const userData = await userResponse.json();
      const uid = userData.uid;

      console.log('UID obtained for user:', uid, selectedGroup.gid);

      const response = await fetch(`http://localhost:9000/api/groups/remove-member`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uid, gid: selectedGroup.gid }),
      });

      if (response.ok) {
        console.log(`User ${usernameToDelete} deleted successfully`);
        // Actualiza la lista de miembros
        fetch(`http://localhost:9000/api/groups/${selectedGroup.gid}/members`)
          .then(response => response.json())
          .then(data => setMembers(data.members))
          .catch(error => console.error('Error loading members:', error));
      } else {
        const errorData = await response.json();
        console.error('Error deleting user:', errorData.error);
      }
    } catch (error) {
      console.error('Error in request:', error);
    }

    setOpenDeleteUser(false);
    setUsernameToDelete('');
  };

  const handleLeaveGroup = async () => {
    const userId = localStorage.getItem('userId');
    console.log(userId);
    if (!userId) {
      console.error('User ID is not available');
      return;
    }

    try {
      const response = await fetch(`http://localhost:9000/api/groups/leave`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uid: userId, gid: selectedGroup.gid }),
      });

      if (response.ok) {
        console.log('User left group successfully');
        fetch(`http://localhost:9000/api/groups/${selectedGroup.gid}/members`)
          .then(response => response.json())
          .then(data => setMembers(data.members))
          .catch(error => console.error('Error loading members:', error));
      } else {
        const errorData = await response.json();
        console.error('Error leaving group:', errorData.error);
      }
    } catch (error) {
      console.error('Error in request:', error);
    }
  };

  const handleDeleteGroup = async () => {
    const userId = localStorage.getItem('userId');
    if (!userId) {
      console.error('User ID is not available');
      return;
    }

    try {
      // Primero, elimina al grupo de la tabla UserGroup
      const userGroupResponse = await fetch(`http://localhost:9000/api/groups/leave`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uid: userId, gid: selectedGroup.gid }), // Enviar el GID del grupo
      });

      if (!userGroupResponse.ok) {
        const errorData = await userGroupResponse.json();
        console.error('Error removing group from UserGroup:', errorData.error);
        return;
      }

      // Luego, elimina el grupo de la tabla principal
      const groupResponse = await fetch(`http://localhost:9000/api/groups/delete`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ gid: selectedGroup.gid, adminId: userId }), // Enviar el GID del grupo y el ID del administrador 
      });

      if (groupResponse.ok) {
        console.log('Group deleted successfully');
        await cargarGrupos(); // Actualiza la lista de grupos
        setSelectedGroup(null); // Restablece el grupo seleccionado
      } else {
        const errorData = await groupResponse.json();
        console.error('Error deleting group:', errorData.error);
      }
    } catch (error) {
      console.error('Error in request:', error);
    }
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
            <Paper sx={{ width: '20%', marginRight: 2, padding: 2, overflow: 'auto', position: 'relative' }}>
              <Typography variant="h6" gutterBottom>Groups</Typography>
              <List>
                {groups.length === 0 ? (
                  <ListItem>
                    <Typography>No group yet</Typography>
                  </ListItem>
                ) : (
                  groups.map(group => (
                    <ListItem key={group.gid} button onClick={() => handleGroupClick(group)}>
                      {group.name}
                      <UseButton selected={selectedGroupId === group.gid} onClick={() => handleUseGroup(group)}>Use</UseButton>
                    </ListItem>
                  ))
                )}
              </List>
              <Button
                variant="contained"
                onClick={() => setOpenCreateGroup(true)}
                sx={{ position: 'absolute', top: 10, right: 10 }}
              >
                Create Group
              </Button>
            </Paper>
            <Paper sx={{ width: '80%', padding: 2, overflow: 'auto' }}>
              {selectedGroup ? (
                <>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="h4" gutterBottom>{selectedGroup.name}</Typography>
                    <Box>
                      {selectedGroup.adminId === localStorage.getItem('userId') ? (
                        <>
                          {members.length === 1 && (
                            <Button variant="contained" color="error" onClick={handleDeleteGroup} sx={{ marginRight: 2 }}>
                              Delete Group
                            </Button>
                          )}
                          {members.length > 1 && (
                            <Button variant="contained" color="error" onClick={() => setOpenDeleteUser(true)} sx={{ marginRight: 2 }}>
                              Delete Member
                            </Button>
                          )}
                          <Button variant="contained" onClick={() => setOpenAddUser(true)}>Add User</Button>
                        </>
                      ) : (
                        <Button variant="contained" color="error" onClick={handleLeaveGroup}>Abandon Group</Button>
                      )}
                    </Box>
                  </Box>
                  <Typography variant="h6" gutterBottom>Members</Typography>
                  <List>
                    {members.map(member => (
                      <ListItem key={member.uid}>
                        {member.username}
                      </ListItem>
                    ))}
                  </List>
                </>
              ) : (
                <Typography variant="h6">Create a group to start.</Typography>
              )}
            </Paper>
          </Box>
        </Container>
      </Box>

      <Dialog open={openAddUser} onClose={() => setOpenAddUser(false)}>
        <DialogTitle>Add User to Group</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            id="username"
            label="Username"
            type="text"
            fullWidth
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenAddUser(false)}>Cancel</Button>
          <Button onClick={handleAddUserToGroup}>Add</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={openDeleteUser} onClose={() => setOpenDeleteUser(false)}>
        <DialogTitle>Delete User from Group</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            id="deleteUsername"
            label="Username to Delete"
            type="text"
            fullWidth
            value={usernameToDelete}
            onChange={(e) => setUsernameToDelete(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDeleteUser(false)}>Cancel</Button>
          <Button onClick={handleDeleteUser}>Delete</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={openCreateGroup} onClose={() => setOpenCreateGroup(false)}>
        <DialogTitle>Create New Group</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            id="groupName"
            label="Group Name"
            type="text"
            fullWidth
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenCreateGroup(false)}>Cancel</Button>
          <Button onClick={handleCreateGroup}>Create</Button>
        </DialogActions>
      </Dialog>
    </ThemeProvider>
  );
}

export default GroupsView;
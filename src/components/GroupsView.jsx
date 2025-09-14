import { Box, Container, CssBaseline, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, styled, TextField, Typography } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { useCallback, useContext, useEffect, useState } from 'react';
import theme from '../theme/theme';
import AssignRolesDialog from './AssignRolesDialog';
import { GroupContext } from './GroupContext';
import GroupRolesPanel from './GroupRolesPanel';
import useGroupRoles from './hooks/useGroupRoles';
import Button from './ui/Button';
import Card from './ui/Card';
import UserRolesChips from './UserRolesChips';

const UseButton = styled(Button)(({ theme, selected }) => ({
  marginLeft: theme.spacing(1),
  minWidth: '60px',
  padding: theme.spacing(0.75, 1.5),
  fontSize: '0.875rem',
  background: selected 
    ? 'linear-gradient(135deg, #10b981 0%, #065f46 100%)'
    : 'linear-gradient(135deg, #3b82f6 0%, #1e3a8a 100%)',
  color: '#ffffff',
  border: 'none',
  transition: 'all 0.3s cubic-bezier(.4,2,.3,1)',
  '&:hover': {
    background: selected
      ? 'linear-gradient(135deg, #6ee7b7 0%, #10b981 100%)'
      : 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
    transform: 'translateY(-1px)',
    boxShadow: selected
      ? '0 6px 20px 0 rgba(16, 185, 129, 0.6)'
      : '0 6px 20px 0 rgba(59, 130, 246, 0.6)',
  },
  '&:active': {
    transform: 'translateY(0)',
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
  // Estado para diálogos de roles (solo una vez, al inicio)
  const [openRoleForm, setOpenRoleForm] = useState(false);
  const [editingRole, setEditingRole] = useState(null);
  const [openAssignDialog, setOpenAssignDialog] = useState(false);
  const { selectedGroupId, setSelectedGroupId, setSelectedGroupName } = useContext(GroupContext);

  const groupId = selectedGroup?.gid;
  const {
    roles,
    userRolesMap,
    fetchRoles,
    fetchUserRoles,
    createRole,
    updateRole,
    deleteRole,
    assignRole,
    removeRole,
    loading: rolesLoading,
    error: rolesError,
  } = useGroupRoles(groupId);

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

  // Estado para diálogos de roles
  // Eliminadas declaraciones duplicadas aquí

  // Callbacks para roles
  const handleCreateRole = () => {
    setEditingRole(null);
    setOpenRoleForm(true);
  };
  const handleEditRole = (role) => {
    setEditingRole(role);
    setOpenRoleForm(true);
  };
  const handleSubmitRole = async (data) => {
    if (editingRole) {
      await updateRole(editingRole.gr_id, data);
    } else {
      await createRole(data);
    }
    setOpenRoleForm(false);
  };
  const handleDeleteRole = async (role) => {
    await deleteRole(role.gr_id);
  };

  // Para AssignRolesDialog
  const handleOpenAssignDialog = () => setOpenAssignDialog(true);
  const handleCloseAssignDialog = () => setOpenAssignDialog(false);

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
          <Box sx={{ display: 'flex', flexGrow: 1, padding: 1, gap: 2 }}>
            <Card 
              variant="default" 
              sx={{ 
                width: '20%', 
                padding: 2, 
                overflow: 'auto',
                cursor: 'default',
                '&:hover': {
                  transform: 'none',
                }
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 2 }}>
                <Typography variant="h6" sx={{ fontWeight: 600, mr: 1, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Groups</Typography>
                <Button variant="secondary" size="small" onClick={() => setOpenCreateGroup(true)}>Create</Button>
              </Box>
              <List sx={{ padding: 0 }}>
                {groups.length === 0 ? (
                  <ListItem sx={{ padding: 2, justifyContent: 'center' }}>
                    <Typography color="text.secondary">No groups yet</Typography>
                  </ListItem>
                ) : (
                  groups.map(group => (
                    <ListItem 
                      key={group.gid} 
                      onClick={() => handleGroupClick(group)} 
                      sx={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: 1,
                        padding: 1.5,
                        borderRadius: 2,
                        marginBottom: 1,
                        transition: 'all 0.3s cubic-bezier(.4,2,.3,1)',
                        background: selectedGroupId === group.gid 
                          ? 'rgba(59, 130, 246, 0.15)' 
                          : 'transparent',
                        border: selectedGroupId === group.gid 
                          ? '1px solid rgba(59, 130, 246, 0.3)' 
                          : '1px solid transparent',
                        '&:hover': {
                          background: 'rgba(59, 130, 246, 0.1)',
                          borderColor: 'rgba(59, 130, 246, 0.2)',
                          transform: 'translateX(4px)',
                        }
                      }}
                    >
                      <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
                        <Typography sx={{
                          overflow: 'hidden',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          fontWeight: selectedGroupId === group.gid ? 600 : 400,
                        }} title={group.name}>
                          {group.name}
                        </Typography>
                      </Box>
                      <UseButton selected={selectedGroupId === group.gid} onClick={(e) => { e.stopPropagation(); handleUseGroup(group); }}>Use</UseButton>
                    </ListItem>
                  ))
                )}
              </List>
            </Card>
            <Card 
              variant="default" 
              sx={{ 
                width: '80%', 
                padding: 3, 
                overflow: 'auto',
                cursor: 'default',
                '&:hover': {
                  transform: 'none',
                }
              }}
            >
              {selectedGroup ? (
                <>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: { xs: 'wrap', sm: 'nowrap' }, mb: 3 }}>
                    <Typography
                      variant="h4"
                      component="h2"
                      sx={{
                        flex: '1 1 auto',
                        minWidth: 0,
                        fontSize: 'clamp(1.25rem, 2.2vw, 1.75rem)',
                        fontWeight: 600,
                        lineHeight: 1.3,
                        overflowWrap: 'anywhere',
                        whiteSpace: 'normal',
                        background: 'linear-gradient(90deg, #3b82f6 0%, #f59e0b 100%)',
                        backgroundClip: 'text',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                      }}
                      title={selectedGroup?.name}
                    >
                      {selectedGroup.name}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1.5, flexShrink: 0, flexWrap: 'wrap', justifyContent: { xs: 'flex-start', md: 'flex-end' } }}>
                      {selectedGroup.adminId === localStorage.getItem('userId') ? (
                        <>
                          {members.length === 1 && (
                            <Button variant="primary" onClick={handleDeleteGroup} sx={{ 
                              background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                              '&:hover': {
                                background: 'linear-gradient(135deg, #f87171 0%, #ef4444 100%)',
                                boxShadow: '0 8px 24px 0 rgba(239, 68, 68, 0.6)',
                              }
                            }}>
                              Delete Group
                            </Button>
                          )}
                          {members.length > 1 && (
                            <Button variant="primary" onClick={() => setOpenDeleteUser(true)} sx={{ 
                              background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                              '&:hover': {
                                background: 'linear-gradient(135deg, #f87171 0%, #ef4444 100%)',
                                boxShadow: '0 8px 24px 0 rgba(239, 68, 68, 0.6)',
                              }
                            }}>
                              Delete Member
                            </Button>
                          )}
                          <Button variant="primary" onClick={() => setOpenAddUser(true)}>Add User</Button>
                        </>
                      ) : (
                        <Button variant="primary" onClick={handleLeaveGroup} sx={{ 
                          background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                          '&:hover': {
                            background: 'linear-gradient(135deg, #f87171 0%, #ef4444 100%)',
                            boxShadow: '0 8px 24px 0 rgba(239, 68, 68, 0.6)',
                          }
                        }}>Abandon Group</Button>
                      )}
                    </Box>
                  </Box>
                  <Typography variant="h5" gutterBottom sx={{ fontWeight: 600, mb: 2 }}>Members</Typography>
                  <List sx={{ padding: 0 }}>
                    {members.map((member, index) => (
                      <ListItem 
                        key={member.uid}
                        sx={{
                          padding: 2,
                          marginBottom: 1,
                          borderRadius: 2,
                          background: 'rgba(59, 130, 246, 0.05)',
                          border: '1px solid rgba(59, 130, 246, 0.1)',
                          transition: 'all 0.3s cubic-bezier(.4,2,.3,1)',
                          '&:hover': {
                            background: 'rgba(59, 130, 246, 0.1)',
                            borderColor: 'rgba(59, 130, 246, 0.2)',
                            transform: 'translateX(4px)',
                          }
                        }}
                      >
                        <Typography sx={{ fontWeight: 500 }}>
                          {member.username}
                          {selectedGroup.adminId === member.uid && (
                            <Typography 
                              component="span" 
                              sx={{ 
                                ml: 1, 
                                fontSize: '0.75rem',
                                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                                color: 'white',
                                padding: '2px 8px',
                                borderRadius: 1,
                                fontWeight: 600,
                              }}
                            >
                              Admin
                            </Typography>
                          )}
                        </Typography>
                        <UserRolesChips roles={(userRolesMap[member.uid] || []).map(rid => roles.find(r => r.gr_id === rid)).filter(Boolean)} />
                      </ListItem>
                    ))}
                  </List>

                  {/* Group Roles Panel - Nueva sección añadida */}
                  <Box mb={3}>
                    <GroupRolesPanel
                      groupId={selectedGroup.gid}
                      isLeader={selectedGroup.adminId === localStorage.getItem('userId')}
                      roles={roles}
                      onCreateRole={handleCreateRole}
                      onEditRole={handleEditRole}
                      onDeleteRole={handleDeleteRole}
                      loading={rolesLoading}
                      error={rolesError}
                      onAssignRoles={handleOpenAssignDialog}
                    />
                    <AssignRolesDialog
                      open={openAssignDialog}
                      onClose={handleCloseAssignDialog}
                      groupId={selectedGroup.gid}
                      users={members.map(m => ({ id: m.uid, name: m.username }))}
                      roles={roles}
                      getUserRoles={userId => fetchUserRoles(userId)}
                      onAssign={assignRole}
                      onRemove={removeRole}
                    />
                  </Box>
                </>
              ) : (
                <Box sx={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  minHeight: '300px',
                  textAlign: 'center',
                  gap: 2
                }}>
                  <Typography variant="h5" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                    No Group Selected
                  </Typography>
                  <Typography variant="body1" sx={{ color: 'text.secondary', maxWidth: '400px' }}>
                    Select a group from the sidebar to view its details and manage members, or create a new group to get started.
                  </Typography>
                  <Button variant="secondary" onClick={() => setOpenCreateGroup(true)} sx={{ mt: 1 }}>
                    Create Your First Group
                  </Button>
                </Box>
              )}
            </Card>
          </Box>
        </Container>
      </Box>

      <Dialog 
        open={openAddUser} 
        onClose={() => setOpenAddUser(false)}
        PaperProps={{
          sx: {
            borderRadius: 3,
            background: 'linear-gradient(135deg, rgba(30, 58, 138, 0.2) 0%, rgba(55, 65, 81, 0.95) 100%)',
            border: '1px solid rgba(59, 130, 246, 0.2)',
            backdropFilter: 'blur(20px)',
          }
        }}
      >
        <DialogTitle sx={{ fontWeight: 600, fontSize: '1.25rem' }}>Add User to Group</DialogTitle>
        <DialogContent sx={{ padding: 3 }}>
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
        <DialogActions sx={{ padding: 2, gap: 1 }}>
          <Button variant="ghost" onClick={() => setOpenAddUser(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleAddUserToGroup}>Add</Button>
        </DialogActions>
      </Dialog>

      <Dialog 
        open={openDeleteUser} 
        onClose={() => setOpenDeleteUser(false)}
        PaperProps={{
          sx: {
            borderRadius: 3,
            background: 'linear-gradient(135deg, rgba(30, 58, 138, 0.2) 0%, rgba(55, 65, 81, 0.95) 100%)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            backdropFilter: 'blur(20px)',
          }
        }}
      >
        <DialogTitle sx={{ fontWeight: 600, fontSize: '1.25rem', color: 'error.main' }}>Delete User from Group</DialogTitle>
        <DialogContent sx={{ padding: 3 }}>
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
        <DialogActions sx={{ padding: 2, gap: 1 }}>
          <Button variant="ghost" onClick={() => setOpenDeleteUser(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleDeleteUser} sx={{ 
            background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
            '&:hover': {
              background: 'linear-gradient(135deg, #f87171 0%, #ef4444 100%)',
              boxShadow: '0 8px 24px 0 rgba(239, 68, 68, 0.6)',
            }
          }}>Delete</Button>
        </DialogActions>
      </Dialog>

      <Dialog 
        open={openCreateGroup} 
        onClose={() => setOpenCreateGroup(false)}
        PaperProps={{
          sx: {
            borderRadius: 3,
            background: 'linear-gradient(135deg, rgba(30, 58, 138, 0.2) 0%, rgba(55, 65, 81, 0.95) 100%)',
            border: '1px solid rgba(245, 158, 11, 0.2)',
            backdropFilter: 'blur(20px)',
          }
        }}
      >
        <DialogTitle sx={{ fontWeight: 600, fontSize: '1.25rem', color: 'secondary.main' }}>Create New Group</DialogTitle>
        <DialogContent sx={{ padding: 3 }}>
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
        <DialogActions sx={{ padding: 2, gap: 1 }}>
          <Button variant="ghost" onClick={() => setOpenCreateGroup(false)}>Cancel</Button>
          <Button variant="secondary" onClick={handleCreateGroup}>Create</Button>
        </DialogActions>
      </Dialog>
    </ThemeProvider>
  );
}

export default GroupsView;
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import PersonIcon from '@mui/icons-material/Person';
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
  const [selectedAssignUser, setSelectedAssignUser] = useState(null);
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
  // Eliminados estados openRoleForm / editingRole (no usados tras refactor de roles controlados)
  const [openAssignDialog, setOpenAssignDialog] = useState(false);
  // Feedback visual (iconos) para eliminación de grupo
  const [deleteSuccess, setDeleteSuccess] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  // Controla si mostramos los detalles (miembros/roles) dentro de esta vista. Persistimos en localStorage.
  const [showDetails, setShowDetails] = useState(() => localStorage.getItem('showGroupDetails') === '1');
  const { selectedGroupId, setSelectedGroupId, setSelectedGroupName } = useContext(GroupContext);

  // Solo cargamos roles cuando el grupo está realmente "en uso" (selectedGroupId coincide)
  const groupId = (selectedGroup && selectedGroupId === selectedGroup.gid && showDetails) ? selectedGroup.gid : null;
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

  // Cargar roles de cada miembro automáticamente cuando se usan los detalles del grupo
  useEffect(() => {
    if (!groupId || !showDetails) return;
    if (!members || members.length === 0) return;
    members.forEach(m => {
      if (!userRolesMap[m.uid]) {
        fetchUserRoles(m.uid);
      }
    });
  }, [groupId, members, showDetails, userRolesMap, fetchUserRoles]);

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
        const storedShow = localStorage.getItem('showGroupDetails') === '1';
        if (storedGroupId) {
          const groupToSelect = data.groups.find(g => g.gid === storedGroupId);
          if (groupToSelect) {
            setSelectedGroupId(groupToSelect.gid);
            setSelectedGroupName(groupToSelect.name);
            setSelectedGroup(groupToSelect);
            if (storedShow) {
              setShowDetails(true);
              // Cargar miembros inmediatamente
              fetch(`http://localhost:9000/api/groups/${groupToSelect.gid}/members`)
                .then(r => r.json())
                .then(d => setMembers(d.members))
                .catch(err => console.error('Error loading members:', err));
            }
          }
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

  // Solo resalta el grupo al hacer clic en el nombre, pero no lo selecciona como "en uso"
  const handleGroupClick = (group) => {
    setSelectedGroup(group);      // Mostrar nombre
    // Si este grupo ya está en uso y showDetails persistido, mantener detalles.
    const persistShow = localStorage.getItem('showGroupDetails') === '1' && localStorage.getItem('selectedGroupId') === String(group.gid);
    setShowDetails(persistShow);
    if (!persistShow) setMembers([]);
  };

  // Solo el botón USE activa el grupo y carga miembros

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
    setSelectedGroupName(group.name);
    setSelectedGroup(group);
    setShowDetails(true); // Mostrar detalles inmediatamente
    localStorage.setItem('selectedGroupId', group.gid);
    localStorage.setItem('selectedGroupName', group.name);
    localStorage.setItem('showGroupDetails', '1');
    fetch(`http://localhost:9000/api/groups/${group.gid}/members`)
      .then(r => r.json())
      .then(data => setMembers(data.members))
      .catch(err => console.error('Error loading members:', err));
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
    if (!userId || !selectedGroup) {
      console.error('Cannot delete: missing userId or selectedGroup');
      return;
    }

    try {
      const groupResponse = await fetch(`http://localhost:9000/api/groups/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gid: selectedGroup.gid, adminId: userId }),
      });

      if (groupResponse.ok) {
        console.log('Group deleted successfully');
        // Limpieza inmediata de estado local para mejor UX
        setGroups(prev => prev.filter(g => g.gid !== selectedGroup.gid));
        setSelectedGroup(null);
        setSelectedGroupId(null);
  setMembers([]); // roles y userRolesMap se limpian implícitamente al no tener groupId
        setShowDetails(false);
        setOpenAssignDialog(false);
        setDeleteError(false);
        setDeleteSuccess(true);
        setTimeout(() => setDeleteSuccess(false), 3000);
      } else {
        const errorData = await groupResponse.json();
        console.error('Error deleting group:', errorData.error);
        setDeleteSuccess(false);
        setDeleteError(true);
        setTimeout(() => setDeleteError(false), 4000);
      }
    } catch (error) {
      console.error('Error in request:', error);
      setDeleteSuccess(false);
      setDeleteError(true);
      setTimeout(() => setDeleteError(false), 4000);
    }
  };

  // Estado para diálogos de roles
  // Eliminadas declaraciones duplicadas aquí

  // Callbacks para roles
  // Se removieron handlers de roles y assign dialog sin uso directo (warnings ESLint)

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
                      // onClick solo resalta, no activa el grupo
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
              {selectedGroup && showDetails && selectedGroupId === selectedGroup.gid ? (
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
                          },
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <Box display="flex" alignItems="center" gap={1}>
                          <Typography sx={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            {member.username}
                            {selectedGroup.adminId === member.uid ? (
                              <Typography 
                                component="span" 
                                sx={{ 
                                  ml: 1, 
                                  fontSize: '0.7rem',
                                  lineHeight: 1,
                                  background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                                  color: 'white',
                                  padding: '2px 8px',
                                  borderRadius: 1,
                                  fontWeight: 600,
                                  letterSpacing: 0.3,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}
                              >
                                {/* Corona inline (CrownIcon) */}
                                <svg
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  xmlns="http://www.w3.org/2000/svg"
                                  style={{ filter: 'drop-shadow(0 0 2px rgba(255,255,255,0.4))', transform: 'translateY(-1px)' }}
                                >
                                  {/* Corona estilo flat: tres puntas con círculos y base */}
                                  <path
                                    fill="#ffffff"
                                    d="M4 9.5 7.2 12 10 7l2 3.5L14 7l2.8 5 3.2-2.5-.8 6.5H4.8L4 9.5Z"
                                  />
                                  <circle cx="10" cy="6" r="1.1" fill="#ffffff" />
                                  <circle cx="14" cy="6" r="1.1" fill="#ffffff" />
                                  <circle cx="12" cy="5" r="1.1" fill="#ffffff" />
                                  <rect x="6" y="17" width="12" height="3" rx="1.2" fill="#ffffff" />
                                </svg>
                                Admin
                              </Typography>
                            ) : (
                              <Typography
                                component="span"
                                sx={{
                                  ml: 1,
                                  fontSize: '0.7rem',
                                  lineHeight: 1,
                                  background: 'linear-gradient(135deg, #3b82f6 0%, #1e3a8a 100%)',
                                  color: 'white',
                                  padding: '2px 8px',
                                  borderRadius: 1,
                                  fontWeight: 600,
                                  letterSpacing: 0.3,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  opacity: 0.85
                                }}
                              >
                                <PersonIcon sx={{ fontSize: '0.9rem' }} /> Member
                              </Typography>
                            )}
                          </Typography>
                          <UserRolesChips roles={(userRolesMap[member.uid] || []).map(rid => roles.find(r => r.gr_id === rid)).filter(Boolean)} />
                        </Box>
                        {/* Botón para asignar/editar roles, visible para todos si el usuario es admin del grupo */}
                        {selectedGroup.adminId === localStorage.getItem('userId') && (
                          <Button
                            variant="outlined"
                            size="small"
                            sx={{ ml: 2, minWidth: 110 }}
                            onClick={async () => {
                              if (typeof fetchRoles === 'function') await fetchRoles();
                              setSelectedAssignUser(member);
                              setTimeout(() => setOpenAssignDialog(true), 0);
                            }}
                          >
                            Assign/Edit Rol
                          </Button>
                        )}
                      </ListItem>
                    ))}
                  </List>

                  {/* Group Roles Panel - igual que Members */}
                  <Box mb={3}>
                    {(roles && roles.length > 0) || (selectedGroup.adminId === localStorage.getItem('userId')) ? (
                      // Si hay roles o el usuario es líder, mostramos el panel completo (maneja su propio estado vacío y botón New Role)
                      <GroupRolesPanel
                        groupId={selectedGroup.gid}
                        isLeader={selectedGroup.adminId === localStorage.getItem('userId')}
                        roles={roles}
                        createRole={createRole}
                        updateRole={updateRole}
                        deleteRole={deleteRole}
                        loading={rolesLoading}
                        error={rolesError}
                      />
                    ) : (
                      // Usuario no es líder y no existen roles: solo mensaje informativo
                      <>
                        <Typography variant="h5" gutterBottom sx={{ fontWeight: 600, mb: 2 }}>Group Roles</Typography>
                        <Typography color="text.secondary" sx={{ mb: 2 }}>No roles defined.</Typography>
                      </>
                    )}
                    <AssignRolesDialog
                      open={openAssignDialog}
                      onClose={() => {
                        setOpenAssignDialog(false);
                        setSelectedAssignUser(null);
                      }}
                      groupId={selectedGroup.gid}
                      users={members.map(m => ({ id: m.uid, name: m.username }))}
                      roles={roles}
                      getUserRoles={userId => fetchUserRoles(userId)}
                      onAssign={assignRole}
                      onRemove={removeRole}
                      selectedUser={selectedAssignUser}
                      setSelectedUser={setSelectedAssignUser}
                    />
                  </Box>
                </>
              ) : selectedGroup ? (
                // Caso: se dio clic a un grupo pero aún no se ha presionado USE
                <Box>
                  <Typography
                    variant="h4"
                    component="h2"
                    sx={{
                      mb: 2,
                      fontSize: 'clamp(1.25rem, 2.2vw, 1.75rem)',
                      fontWeight: 600,
                      lineHeight: 1.3,
                      background: 'linear-gradient(90deg, #3b82f6 0%, #f59e0b 100%)',
                      backgroundClip: 'text',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                    }}
                  >
                    {selectedGroup.name}
                  </Typography>
                  <Typography color="text.secondary" sx={{ mb: 1 }}>
                    Press the group's USE button to view members and roles.
                  </Typography>
                </Box>
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

      {/* Feedback icon (sin diálogo) para eliminación de grupo */}
      {(deleteSuccess || deleteError) && (
        <Box
          sx={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 2.5,
            py: 1.25,
            borderRadius: '999px',
            background: deleteSuccess
              ? 'linear-gradient(135deg, rgba(16,185,129,0.15) 0%, rgba(5,150,105,0.4) 100%)'
              : 'linear-gradient(135deg, rgba(239,68,68,0.15) 0%, rgba(220,38,38,0.4) 100%)',
            border: `1px solid ${deleteSuccess ? 'rgba(16,185,129,0.5)' : 'rgba(239,68,68,0.5)'}`,
            boxShadow: deleteSuccess
              ? '0 4px 18px -2px rgba(16,185,129,0.4)'
              : '0 4px 18px -2px rgba(239,68,68,0.4)',
            backdropFilter: 'blur(12px)',
            zIndex: 1200,
            color: '#fff',
            fontWeight: 500,
            fontSize: '0.9rem'
          }}
        >
          {deleteSuccess && <CheckCircleIcon sx={{ color: '#10b981' }} />}
          {deleteError && <ErrorOutlineIcon sx={{ color: '#f87171' }} />}
          <span>{deleteSuccess ? 'Group deleted' : 'Delete failed'}</span>
        </Box>
      )}

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
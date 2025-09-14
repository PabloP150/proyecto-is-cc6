import {
    Box,
    Button,
    Checkbox, CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    List, ListItem, ListItemText,
    Stack, Typography
} from '@mui/material';
import { useEffect, useState } from 'react';

/**
 * Dialogo para asignar/quitar roles a usuarios de un grupo.
 * Props:
 * - open: bool
 * - onClose: fn
 * - groupId: id del grupo
 * - users: [{ id, name }]
 * - roles: [{ gr_id, gr_name }]
 * - getUserRoles: async (userId) => [gr_id, ...]
 * - onAssign: async (userId, gr_id) => void
 * - onRemove: async (userId, gr_id) => void
 */
const AssignRolesDialog = ({
  open, onClose, groupId, users = [], roles = [], getUserRoles, onAssign, onRemove
}) => {
  const [selectedUser, setSelectedUser] = useState(null);
  const [userRoles, setUserRoles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    if (selectedUser && getUserRoles) {
      setLoading(true);
      getUserRoles(selectedUser.id)
        .then(setUserRoles)
        .finally(() => setLoading(false));
    }
  }, [selectedUser, getUserRoles]);

  const handleToggleRole = async (roleId) => {
    if (!selectedUser) return;
    setAssigning(true);
    const hasRole = userRoles.includes(roleId);
    try {
      if (hasRole) {
        await onRemove(selectedUser.id, roleId);
        setUserRoles(userRoles.filter(r => r !== roleId));
      } else {
        await onAssign(selectedUser.id, roleId);
        setUserRoles([...userRoles, roleId]);
      }
    } finally {
      setAssigning(false);
    }
  };

  const handleUserClick = (user) => {
    setSelectedUser(user);
    setUserRoles([]);
  };

  const handleClose = () => {
    setSelectedUser(null);
    setUserRoles([]);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>Asignar roles a usuarios</DialogTitle>
      <DialogContent>
        <Stack direction="row" spacing={4}>
          <Box flex={1}>
            <Typography variant="subtitle1">Usuarios</Typography>
            <List dense>
              {users.map(user => (
                <ListItem
                  key={user.id}
                  button
                  selected={selectedUser && selectedUser.id === user.id}
                  onClick={() => handleUserClick(user)}
                >
                  <ListItemText primary={user.name} />
                </ListItem>
              ))}
            </List>
          </Box>
          <Box flex={2}>
            <Typography variant="subtitle1">Roles</Typography>
            {loading ? <CircularProgress size={24} /> : (
              <List dense>
                {roles.map(role => (
                  <ListItem key={role.gr_id}>
                    <Checkbox
                      checked={userRoles.includes(role.gr_id)}
                      onChange={() => handleToggleRole(role.gr_id)}
                      disabled={assigning}
                    />
                    <ListItemText primary={role.gr_name} />
                  </ListItem>
                ))}
              </List>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cerrar</Button>
      </DialogActions>
    </Dialog>
  );
};

export default AssignRolesDialog;

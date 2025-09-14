import {
  Box,
  Button,
  Checkbox, CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  ListItem, ListItemText,
  Typography
} from '@mui/material';
import { useEffect, useRef, useState } from 'react';

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
  open, onClose, groupId, users = [], roles = [], getUserRoles, onAssign, onRemove, selectedUser, setSelectedUser
}) => {
  const [userRoles, setUserRoles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [lastLoadedUser, setLastLoadedUser] = useState(null);
  const [localUser, setLocalUser] = useState(null);
  const [localRoles, setLocalRoles] = useState([]);
  const loaderTimeout = useRef();

  // Mantener copia local de usuario y roles mientras el diálogo está abierto
  useEffect(() => {
    if (open && selectedUser) {
      setLocalUser(selectedUser);
      setLocalRoles(roles);
    }
  }, [open, selectedUser, roles]);

  useEffect(() => {
    // Solo cargar si el usuario cambió realmente
    if (open && selectedUser && selectedUser.uid && getUserRoles && selectedUser.uid !== lastLoadedUser) {
      setLoading(true);
      loaderTimeout.current = setTimeout(() => {
        getUserRoles(selectedUser.uid)
          .then(setUserRoles)
          .finally(() => {
            setLoading(false);
            setLastLoadedUser(selectedUser.uid);
          });
      }, 150);
    } else if (!open) {
      // No limpiar aquí, solo en onExited
      if (loaderTimeout.current) clearTimeout(loaderTimeout.current);
    }
    return () => {
      if (loaderTimeout.current) clearTimeout(loaderTimeout.current);
    };
  }, [open, selectedUser, getUserRoles, lastLoadedUser]);

  const handleToggleRole = async (roleId) => {
    if (!selectedUser || !selectedUser.uid) return;
    setAssigning(true);
    const hasRole = userRoles.includes(roleId);
    try {
      if (hasRole) {
        await onRemove(selectedUser.uid, roleId);
        setUserRoles(userRoles.filter(r => r !== roleId));
      } else {
        await onAssign(selectedUser.uid, roleId);
        setUserRoles([...userRoles, roleId]);
      }
    } catch (err) {
      alert('Error al asignar/quitar rol: ' + (err?.message || err));
      console.error('Error al asignar/quitar rol:', err);
    } finally {
      setAssigning(false);
    }
  };

  // handleUserClick eliminado (no se estaba usando)

  // Limpiar estado solo cuando el diálogo esté completamente cerrado
  const handleClose = () => {
    onClose();
  };

  const handleExited = () => {
    setUserRoles([]);
    setLoading(false);
    setLastLoadedUser(null);
    setLocalUser(null);
    setLocalRoles([]);
    if (typeof setSelectedUser === 'function') setSelectedUser(null);
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      onExited={handleExited}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          background: '#19223a',
          borderRadius: 3,
          boxShadow: 6,
          color: '#fff',
          p: 0,
        }
      }}
    >
      <DialogTitle sx={{ bgcolor: 'transparent', color: '#fff', fontWeight: 600, fontSize: 22, px: 4, pt: 3, pb: 1 }}>
        Assign roles to users
      </DialogTitle>
      <DialogContent sx={{ px: 4, pb: 2, pt: 0 }}>
        <Typography variant="subtitle1" sx={{ color: '#90a7e6', fontWeight: 500, mb: 2 }}>
          {localUser && localUser.username ? (
            <>
              Editing roles for
              <span style={{
                color: '#3b82f6',
                fontWeight: 700,
                fontSize: '1.15em',
                marginLeft: 8,
                letterSpacing: 0.5
              }}>
                {localUser.username}
              </span>
            </>
          ) : (
            <span style={{ color: '#f87171' }}>Select a user to assign roles</span>
          )}
        </Typography>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 60 }}>
            <CircularProgress size={28} thickness={4} />
          </Box>
        ) : (
          <Grid container spacing={2} columns={12}>
            {Array.from({ length: Math.ceil(localRoles.length / 4) }).map((_, colIdx) => (
              <Grid item xs={12} sm={6} md={3} key={colIdx}>
                {localRoles.slice(colIdx * 4, colIdx * 4 + 4).map(role => (
                  <ListItem key={role.gr_id} sx={{ borderRadius: 2, mb: 1, pl: 0 }} disableGutters>
                    <Checkbox
                      checked={userRoles.includes(role.gr_id)}
                      onChange={() => handleToggleRole(role.gr_id)}
                      disabled={assigning}
                      sx={{ color: '#90a7e6', '&.Mui-checked': { color: '#2196f3' } }}
                    />
                    <ListItemText primary={role.gr_name} sx={{ color: '#fff' }} />
                  </ListItem>
                ))}
              </Grid>
            ))}
          </Grid>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 4, pb: 2 }}>
        <Button onClick={handleClose} variant="outlined" sx={{ color: '#90a7e6', borderColor: '#90a7e6' }}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default AssignRolesDialog;

import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { Alert, Box, Button, Chip, CircularProgress, Dialog, IconButton, Snackbar, Stack, Tooltip, Typography } from '@mui/material';
import { useState } from 'react';
import RoleForm from './RoleForm';
import useGroupRoles from './hooks/useGroupRoles';

// Componente principal para gestión de roles en un grupo

const GroupRolesPanel = ({ groupId, isLeader }) => {
  const { roles, loading, error, createRole, updateRole, deleteRole } = useGroupRoles(groupId);
  const [openForm, setOpenForm] = useState(false);
  const [editingRole, setEditingRole] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [formLoading, setFormLoading] = useState(false);

  // Abrir formulario para crear o editar
  const handleOpenForm = (role = null) => {
    setEditingRole(role);
    setOpenForm(true);
  };

  // Eliminar rol
  const handleDeleteRole = async (role) => {
    if (!window.confirm(`¿Eliminar el rol "${role.gr_name}"?`)) return;
    try {
      await deleteRole(role.gr_id);
      setSnackbar({ open: true, message: 'Rol eliminado', severity: 'success' });
    } catch (e) {
      setSnackbar({ open: true, message: 'Error al eliminar rol', severity: 'error' });
    }
  };

  if (loading) return <Box p={2}><CircularProgress size={28} /></Box>;
  if (error) return <Box p={2}><Typography color="error">{error}</Typography></Box>;

  return (
    <Box p={0}>
      <Box sx={{ mt: 5 }} />
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2} sx={{ mt: 0, ml: 0 }}>
        <Typography variant="h5" gutterBottom sx={{ fontWeight: 600, mb: 2, ml: 0 }}>Group Roles</Typography>
        {isLeader && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            size="small"
            onClick={() => handleOpenForm()}
            sx={{ ml: 2 }}
          >
            New Role
          </Button>
        )}
      </Stack>
      <Stack spacing={1}>
        {roles.length === 0 && <Typography color="text.secondary">No hay roles definidos.</Typography>}
        {roles.map(role => (
          <Box key={role.gr_id} display="flex" alignItems="center" gap={1}>
            <Chip
              label={role.gr_name}
              style={{ background: role.gr_color || '#eee', color: '#222' }}
              icon={role.gr_icon ? <span className={`material-icons`}>{role.gr_icon}</span> : null}
            />
            <Typography variant="body2" color="text.secondary">{role.gr_desc}</Typography>
            {isLeader && (
              <>
                <Tooltip title="Editar rol">
                  <IconButton size="small" onClick={() => handleOpenForm(role)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Eliminar rol">
                  <IconButton size="small" onClick={() => handleDeleteRole(role)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </>
            )}
          </Box>
        ))}
      </Stack>

      {/* Modal para crear/editar rol */}
      <Dialog
        open={openForm}
        onClose={() => setOpenForm(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            background: 'none',
            boxShadow: 'none',
            overflow: 'visible',
          }
        }}
      >
        <Box sx={{
          bgcolor: '#19223a',
          borderRadius: 3,
          boxShadow: 6,
          p: 3,
          minWidth: 340,
          maxWidth: 420,
          mx: 'auto',
        }}>
          <RoleForm
            initialData={editingRole || {}}
            onSubmit={async (data) => {
              setFormLoading(true);
              try {
                if (editingRole) {
                  await updateRole(editingRole.gr_id, data);
                  setSnackbar({ open: true, message: 'Rol editado exitosamente', severity: 'success' });
                } else {
                  await createRole(data);
                  setSnackbar({ open: true, message: 'Rol creado exitosamente', severity: 'success' });
                }
                setOpenForm(false);
              } catch (e) {
                setSnackbar({ open: true, message: 'Error al guardar rol', severity: 'error' });
              } finally {
                setFormLoading(false);
                setEditingRole(null);
              }
            }}
            onCancel={() => { setOpenForm(false); setEditingRole(null); }}
            loading={formLoading}
          />
        </Box>
      </Dialog>
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} sx={{ width: '100%' }}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
};

export default GroupRolesPanel;

import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { Alert, Box, Button, Chip, CircularProgress, Dialog, IconButton, Snackbar, Stack, styled, Tooltip, Typography } from '@mui/material';
import { useState } from 'react';
import RoleForm from './RoleForm';
import useGroupRoles from './hooks/useGroupRoles';
// Estilos de chip (integrados)
const GRChip = styled(Chip)(({ ownerState }) => {
  const adjust = (hex, amt) => {
    let h = hex?.replace('#','') || '1976d2';
    if (h.length===3) h = h.split('').map(c=>c+c).join('');
    const num = parseInt(h,16);
    const r = Math.min(255, Math.max(0, ((num>>16)&255)+amt));
    const g = Math.min(255, Math.max(0, ((num>>8)&255)+amt));
    const b = Math.min(255, Math.max(0, (num&255)+amt));
    return `#${[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('')}`;
  };
  const readable = (hex) => {
    let h = hex?.replace('#','') || '1976d2';
    if (h.length===3) h = h.split('').map(c=>c+c).join('');
    const num = parseInt(h,16); const r=(num>>16)&255; const g=(num>>8)&255; const b=num&255; const lum=(0.2126*r+0.7152*g+0.0722*b)/255; return lum>0.55?'#17202e':'#fff';
  };
  const base = ownerState.baseColor || '#1976d2';
  const light = adjust(base,40);
  const dark = adjust(base,-25);
  const text = readable(base);
  return {
    fontWeight:600,
    letterSpacing:0.25,
    paddingInline:4,
    color:text,
    background:`linear-gradient(140deg, ${light} 0%, ${base} 40%, ${dark} 100%)`,
    border:`1px solid ${adjust(base,-35)}`,
    boxShadow:'0 2px 4px rgba(0,0,0,0.25), inset 0 0 0 1px rgba(255,255,255,0.08)',
    '.material-icons':{fontSize:18, marginLeft:2, color:text},
    '&:hover':{boxShadow:'0 4px 10px rgba(0,0,0,0.35)', transform:'translateY(-1px)'},
    '&:active':{transform:'translateY(0)', boxShadow:'0 2px 5px rgba(0,0,0,0.3)'},
    transition:'all .18s cubic-bezier(.4,0,.2,1)'
  };
});

// Componente principal para gestión de roles en un grupo

const GroupRolesPanel = ({ groupId, isLeader, roles: externalRoles, createRole: externalCreate, updateRole: externalUpdate, deleteRole: externalDelete, loading: externalLoading, error: externalError }) => {
  // Si vienen props externas, las usamos; si no, caemos al hook interno (compatibilidad)
  const hook = useGroupRoles(groupId);
  const roles = externalRoles ?? hook.roles;
  const loading = externalLoading ?? hook.loading;
  const error = externalError ?? hook.error;
  const createRole = externalCreate ?? hook.createRole;
  const updateRole = externalUpdate ?? hook.updateRole;
  const deleteRole = externalDelete ?? hook.deleteRole;
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
      {roles.length === 0 && <Typography color="text.secondary">No roles defined.</Typography>}
      {roles.length > 0 && (
        <Box
          sx={{
            display: 'flex',
            gap: 3,
            flexWrap: 'wrap',
            alignItems: 'flex-start'
          }}
        >
          {Array.from({ length: Math.ceil(roles.length / 4) }).map((_, colIndex) => {
            const slice = roles.slice(colIndex * 4, colIndex * 4 + 4);
            return (
              <Stack key={colIndex} spacing={1.25} sx={{ minWidth: 210 }}>
                {slice.map(role => (
                  <Box
                    key={role.gr_id}
                    display="flex"
                    alignItems="center"
                    gap={1} // aún menos espacio
                    sx={{
                      p: 1, // padding más compacto
                      pl: 4,
                      borderRadius: 2,
                      transition: 'background .18s ease',
                      '&:hover': { background: 'rgba(255,255,255,0.035)' }
                    }}
                  >
                    <Box flexGrow={1} minWidth={0} display="flex" flexDirection="column" gap={0.25}>
                      <span style={{ display: 'inline-flex' }}>
                        <GRChip
                          label={role.gr_name}
                          ownerState={{ baseColor: role.gr_color }}
                          icon={role.gr_icon ? <span className="material-icons">{role.gr_icon}</span> : null}
                          size="small"
                        />
                      </span>
                    </Box>
                    {isLeader && (
                      <Stack direction="row" spacing={0.8} sx={{ ml: 0.1 }}> {/* más reducción */}
                        <Tooltip title="Edit role">
                          <IconButton
                            size="small"
                            onClick={() => handleOpenForm(role)}
                            sx={{
                              width: 30,
                              height: 28,
                              borderRadius: 1,
                              color: 'white',
                              background: 'rgba(59, 130, 246, 0.1)',
                              border: '1px solid rgba(59, 130, 246, 0.3)',
                              transition: 'all 0.3s cubic-bezier(.4, 2, .3, 1)',
                              boxShadow: '0 2px 6px -1px rgba(0,0,0,0.4)',
                              '&:hover': {
                                background: 'rgba(59, 130, 246, 0.18)',
                                transform: 'scale(1.06)',
                                boxShadow: '0 3px 10px 0 rgba(59, 130, 246, 0.28)',
                              },
                              '&:active': { transform: 'scale(1.0)' }
                            }}
                          >
                            <EditIcon fontSize="inherit" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete role">
                          <IconButton
                            size="small"
                            onClick={() => handleDeleteRole(role)}
                            sx={{
                              width: 35,
                              height: 28,
                              borderRadius: 1,
                              color: 'white',
                              background: 'rgba(239, 68, 68, 0.1)',
                              border: '1px solid rgba(239, 68, 68, 0.3)',
                              transition: 'all 0.3s cubic-bezier(.4, 2, .3, 1)',
                              boxShadow: '0 2px 6px -1px rgba(0,0,0,0.4)',
                              '&:hover': {
                                background: 'rgba(239, 68, 68, 0.18)',
                                transform: 'scale(1.06)',
                                boxShadow: '0 3px 10px 0 rgba(239, 68, 68, 0.28)',
                              },
                              '&:active': { transform: 'scale(1.0)' }
                            }}
                          >
                            <DeleteIcon fontSize="inherit" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    )}
                  </Box>
                ))}
              </Stack>
            );
          })}
        </Box>
      )}

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

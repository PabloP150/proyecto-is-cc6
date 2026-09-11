import React, { useContext, useEffect, useState } from 'react';
import { Alert, Menu, MenuItem, IconButton, Snackbar } from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import { GroupContext } from './GroupContext';
import Switch from '@mui/material/Switch';
import { api, errorMessage } from '../api/client';

const SeleccionarPersona = ({ tid }) => {
  const { selectedGroupId } = useContext(GroupContext);
  const [members, setMembers] = useState([]);
  const [anchorEl, setAnchorEl] = useState(null);
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!selectedGroupId) return;
    const controller = new AbortController();

    api.get(`/api/groups/${selectedGroupId}/members`, { signal: controller.signal })
      .then(data => setMembers(data?.members || []))
      .catch(err => { if (err?.name !== 'AbortError') setErrorMsg(errorMessage(err, 'Error al cargar los miembros')); });

    return () => controller.abort();
  }, [selectedGroupId]);

  useEffect(() => {
    const cargarEstado = async () => {
      // Solo consulta cuando hay grupo, miembros cargados y el menú está abierto
      if (!selectedGroupId || members.length === 0 || !anchorEl) return;

      try {
        const data = await api.get(`/api/usertask?tid=${encodeURIComponent(tid)}`);
        const assignments = Array.isArray(data?.data) ? data.data : [];
        setSelectedMembers(assignments.filter(task => task.completed).map(task => task.uid));
      } catch {
        // Cualquier error (incluye 404) equivale a "sin asignaciones"
        setSelectedMembers([]);
      }
    };

    cargarEstado();
  }, [selectedGroupId, tid, members, anchorEl]);

  // Optimista: cambia el switch de inmediato y lo revierte si el servidor rechaza el cambio.
  const handleSelect = async (member) => {
    const isSelected = selectedMembers.includes(member.uid);
    setSelectedMembers(prev => isSelected ? prev.filter(m => m !== member.uid) : [...prev, member.uid]);
    try {
      if (isSelected) {
        await api.del(`/api/usertask?uid=${encodeURIComponent(member.uid)}&tid=${encodeURIComponent(tid)}`, {
          body: { uid: member.uid, tid },
        });
      } else {
        await api.post('/api/usertask', { uid: member.uid, tid, completed: true });
      }
    } catch (err) {
      setSelectedMembers(prev => isSelected ? [...prev, member.uid] : prev.filter(m => m !== member.uid));
      setErrorMsg(errorMessage(err, isSelected ? 'Error al quitar la asignación' : 'Error al asignar el usuario'));
    }
  };

  const handleClick = (event) => {
    setAnchorEl(event.currentTarget); // abrir menú dispara la carga del estado
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  return (
    <>
      <IconButton
        onClick={handleClick}
        sx={{
          color: 'white',
          background: 'rgba(139, 92, 246, 0.1)',
          border: '1px solid rgba(139, 92, 246, 0.3)',
          borderRadius: 1,
          transition: 'all 0.3s cubic-bezier(.4, 2, .3, 1)',
          '&:hover': {
            background: 'rgba(139, 92, 246, 0.2)',
            transform: 'scale(1.1)',
            boxShadow: '0 4px 12px 0 rgba(139, 92, 246, 0.3)',
          },
        }}
      >
        <PersonIcon fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleClose}
        slotProps={{
          paper: {
            sx: {
              background: 'linear-gradient(135deg, rgba(30, 58, 138, 0.95) 0%, rgba(55, 65, 81, 0.98) 100%)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(59, 130, 246, 0.2)',
              borderRadius: '14px',
              color: 'white',
              boxShadow: '0 8px 32px 0 rgba(30, 58, 138, 0.3)',
            },
          },
        }}
      >
        {members.length > 0 ? (
          <MemberSwitchList members={members} selectedMembers={selectedMembers} onToggle={handleSelect} />
        ) : (
          <MenuItem
            disabled
            sx={{
              color: 'rgba(255, 255, 255, 0.7)',
              '&.Mui-disabled': {
                color: 'rgba(255, 255, 255, 0.5)',
              },
            }}
          >
            No hay miembros disponibles
          </MenuItem>
        )}
      </Menu>
      <Snackbar
        open={Boolean(errorMsg)}
        autoHideDuration={4000}
        onClose={(event, reason) => { if (reason !== 'clickaway') setErrorMsg(''); }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setErrorMsg('')} severity="error" sx={{ width: '100%' }}>
          {errorMsg}
        </Alert>
      </Snackbar>
    </>
  );
};

const MemberRow = ({ member, selectedMembers, onToggle }) => {
  const [hovered, setHovered] = React.useState(false);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        marginBottom: '12px',
        padding: '8px 12px',
        borderRadius: '8px',
        transition: 'all 0.2s ease',
        cursor: 'pointer',
        background: hovered ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onToggle(member)}
    >
      <Switch
        checked={selectedMembers.includes(member.uid)}
        onChange={() => onToggle(member)}
        onClick={(e) => e.stopPropagation()}
        name={member.username}
        color="primary"
        sx={{
          '& .MuiSwitch-switchBase.Mui-checked': { color: '#3b82f6' },
          '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: '#3b82f6' },
          '& .MuiSwitch-track': { backgroundColor: 'rgba(255, 255, 255, 0.3)' },
        }}
      />
      <span style={{ marginLeft: '12px', color: 'white', fontWeight: '500', fontSize: '14px' }}>
        {member.username}
      </span>
    </div>
  );
};

const MemberSwitchList = ({ members, selectedMembers, onToggle }) => (
  <div style={{ padding: '16px', borderRadius: '12px', minWidth: '200px' }}>
    {members.map((member) => (
      <MemberRow key={member.uid} member={member} selectedMembers={selectedMembers} onToggle={onToggle} />
    ))}
  </div>
);

export default SeleccionarPersona;
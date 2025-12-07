import React, { useContext, useEffect, useState } from 'react';
import { Menu, MenuItem, IconButton } from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import { GroupContext } from './GroupContext';
import Switch from '@mui/material/Switch';

const SeleccionarPersona = ({ tid }) => {
  const { selectedGroupId } = useContext(GroupContext);
  const [members, setMembers] = useState([]);
  const [anchorEl, setAnchorEl] = useState(null);
  const [selectedMembers, setSelectedMembers] = useState([]);

  useEffect(() => {
    const cargarMiembros = async () => {
      if (!selectedGroupId) return;

      try {
        const response = await fetch(`http://localhost:9000/api/groups/${selectedGroupId}/members`);
        if (response.ok) {
          const data = await response.json();
          setMembers(data.members);
        } else {
          console.error('Error al cargar los miembros');
        }
      } catch (error) {
        console.error('Error en la solicitud:', error);
      }
    };

    cargarMiembros();
  }, [selectedGroupId]);

  useEffect(() => {
    const cargarEstado = async () => {
      // Solo consulta cuando hay grupo, miembros cargados y el menú está abierto
      if (!selectedGroupId || members.length === 0 || !anchorEl) return;

      try {
        const response = await fetch(`http://localhost:9000/api/usertask?tid=${tid}`);
        if (response.ok) {
          const data = await response.json();
          if (!data.data || data.data.length === 0) {
            setSelectedMembers([]);
            return;
          }
          const completedUsers = data.data
            .filter(task => task.completed)
            .map(task => task.uid);
          setSelectedMembers(completedUsers);
          return;
        }
        // Tratar cualquier estado no-OK (incluye 404) como "sin asignaciones" sin loguear error
        setSelectedMembers([]);
      } catch (error) {
        // Silenciar errores de red u otras excepciones
        setSelectedMembers([]);
      }
    };

    cargarEstado();
  }, [selectedGroupId, tid, members, anchorEl]);

  const handleSelect = async (member) => {
    const isSelected = selectedMembers.includes(member.uid);
    setSelectedMembers((prev) => {
      const newSelectedMembers = isSelected
        ? prev.filter((m) => m !== member.uid)
        : [...prev, member.uid];

      if (isSelected) {
        removeUserFromTask(member.uid, tid);
      } else {
        addUserToTask(member.uid, tid);
      }

      return newSelectedMembers;
    });
  };

  const handleClick = (event) => {
    setAnchorEl(event.currentTarget); // abrir menú dispara la carga del estado
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const addUserToTask = async (uid, tid) => {
    try {
      const response = await fetch('http://localhost:9000/api/usertask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uid, tid, completed: true }),
      });
      if (!response.ok) {
        console.error('Error al agregar usuario a usertask');
      }
    } catch (error) {
      console.error('Error en la solicitud:', error);
    }
  };

  const removeUserFromTask = async (uid, tid) => {
    try {
      const response = await fetch(`http://localhost:9000/api/usertask?uid=${uid}&tid=${tid}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uid, tid }),
      });
      if (!response.ok) {
        console.error('Error al eliminar usuario de usertask');
      }
    } catch (error) {
      console.error('Error en la solicitud:', error);
    }
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
    </>
  );
};

const MemberSwitchList = ({ members, selectedMembers, onToggle }) => (
  <div style={{
    padding: '16px',
    borderRadius: '12px',
    minWidth: '200px',
  }}>
    {members.map((member) => (
      <div
        key={member.uid}
        style={{
          display: 'flex',
          alignItems: 'center',
          marginBottom: '12px',
          padding: '8px 12px',
          borderRadius: '8px',
          transition: 'all 0.2s ease',
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => {
          e.target.style.background = 'rgba(59, 130, 246, 0.2)';
        }}
        onMouseLeave={(e) => {
          e.target.style.background = 'transparent';
        }}
        onClick={() => onToggle(member)}
      >
        <Switch
          checked={selectedMembers.includes(member.uid)}
          onChange={() => onToggle(member)}
          name={member.username}
          color="primary"
          sx={{
            '& .MuiSwitch-switchBase.Mui-checked': {
              color: '#3b82f6',
            },
            '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
              backgroundColor: '#3b82f6',
            },
            '& .MuiSwitch-track': {
              backgroundColor: 'rgba(255, 255, 255, 0.3)',
            },
          }}
        />
        <span style={{
          marginLeft: '12px',
          color: 'white',
          fontWeight: '500',
          fontSize: '14px',
        }}>
          {member.username}
        </span>
      </div>
    ))}
  </div>
);

export default SeleccionarPersona;
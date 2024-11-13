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
      if (!selectedGroupId || members.length === 0) return;

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
        } else {
          console.error('No es error solo no hay ninguna tarea asignada');
        }
      } catch (error) {
        console.error('Error en la solicitud:', error);
      }
    };

    cargarEstado();
  }, [selectedGroupId, tid, members]);

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
    setAnchorEl(event.currentTarget);
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
      <IconButton onClick={handleClick}>
        <PersonIcon />
      </IconButton>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleClose}>
        {members.length > 0 ? (
          <MemberSwitchList members={members} selectedMembers={selectedMembers} onToggle={handleSelect} />
        ) : (
          <MenuItem disabled>No hay miembros disponibles</MenuItem>
        )}
      </Menu>
    </>
  );
};

const MemberSwitchList = ({ members, selectedMembers, onToggle }) => (
  <div style={{ padding: '10px', borderRadius: '5px' }}>
    {members.map((member) => (
      <div key={member.uid} style={{ display: 'flex', alignItems: 'center', marginRight: '10px' }}>
        <Switch
          checked={selectedMembers.includes(member.uid)}
          onChange={() => onToggle(member)}
          name={member.username}
          color="primary"
        />
        <span style={{ marginLeft: '10px' }}>{member.username}</span>
      </div>
    ))}
  </div>
);

export default SeleccionarPersona;
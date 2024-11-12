import React, { useContext, useEffect, useState } from 'react';
import { Menu, MenuItem, IconButton } from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import { GroupContext } from './GroupContext';

const SeleccionarPersona = ({ onSelect }) => {
  const { selectedGroupId } = useContext(GroupContext);
  const [members, setMembers] = useState([]);
  const [anchorEl, setAnchorEl] = useState(null);

  useEffect(() => {
    const cargarMiembros = async () => {
      if (!selectedGroupId) return;

      try {
        const response = await fetch(`http://localhost:9000/api/groups/${selectedGroupId}/members`);
        if (response.ok) {
          const data = await response.json();
          console.log('Miembros cargados:', data.members);
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

  const handleClick = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleSelect = (member) => {
    onSelect(member);
    handleClose();
  };

  return (
    <>
      <IconButton onClick={handleClick}>
        <PersonIcon />
      </IconButton>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleClose}>
        {members.length > 0 ? (
          members.map((member) => (
            <MenuItem key={member.id} onClick={() => handleSelect(member)}>
              {member.username}
            </MenuItem>
          ))
        ) : (
          <MenuItem disabled>No hay miembros disponibles</MenuItem>
        )}
      </Menu>
    </>
  );
};

export default SeleccionarPersona;

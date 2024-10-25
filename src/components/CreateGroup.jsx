import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

function CreateGroup() {
  const [groupName, setGroupName] = useState('');
  const navigate = useNavigate();
  const [userId, setUserId] = useState('');

  useEffect(() => {
    const storedUserId = sessionStorage.getItem('userId');
    if (storedUserId) {
      setUserId(storedUserId);
    }
  }, []);

  const handleCreateGroup = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch('http://localhost:9000/api/groups', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ adminId: userId, name: groupName }),
      });

      if (response.ok) {
        const data = await response.json();
        console.log(data.message);
        navigate('/recordatorios');
      } else {
        const errorData = await response.json();
        console.error(errorData.error);
      }
    } catch (error) {
      console.error('Error en la solicitud:', error);
    }
  };

  return (
    <form onSubmit={handleCreateGroup}>
      <input
        type="text"
        value={groupName}
        onChange={(e) => setGroupName(e.target.value)}
        placeholder="Nombre del grupo"
        required
      />
      <button type="submit">Crear Grupo</button>
    </form>
  );
}

export default CreateGroup;

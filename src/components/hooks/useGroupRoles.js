import { useCallback, useEffect, useState } from 'react';

/**
 * Hook para gestionar roles de grupo y asignaciones de roles a usuarios.
 * @param {string} groupId - ID del grupo seleccionado
 */
export default function useGroupRoles(groupId) {
  const [roles, setRoles] = useState([]);
  const [userRolesMap, setUserRolesMap] = useState({}); // { [userId]: [roleId, ...] }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Obtener roles del grupo
  const fetchRoles = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    console.log('[fetchRoles] Cargando roles para', groupId);
    try {
      const res = await fetch(`http://localhost:9000/api/grouproles/groups/${groupId}/roles`);
      console.log('[fetchRoles] Respuesta status:', res.status);
      if (!res.ok) throw new Error('Error al obtener roles');
      const data = await res.json();
      console.log('[fetchRoles] Data recibida:', data);
      setRoles(data.roles || []);
    } catch (err) {
      setError(err.message);
      console.error('[fetchRoles] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  // Obtener roles de un usuario en el grupo
  const fetchUserRoles = useCallback(async (userId) => {
    if (!groupId || !userId) return [];
    try {
      const res = await fetch(`http://localhost:9000/api/user-group-roles/${groupId}/${userId}`);
      if (!res.ok) throw new Error('Error al obtener roles de usuario');
      const data = await res.json();
      setUserRolesMap(prev => ({ ...prev, [userId]: data.roleIds || [] }));
      return data.roleIds || [];
    } catch (err) {
      setError(err.message);
      return [];
    }
  }, [groupId]);

  // Crear rol
  const createRole = async (roleData) => {
    if (!groupId) return;
    setLoading(true);
    console.log('[createRole] Creando rol en grupo', groupId, 'con datos:', roleData);
    try {
      const res = await fetch(`http://localhost:9000/api/grouproles/groups/${groupId}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(roleData),
      });
      console.log('[createRole] Respuesta status:', res.status);
      if (!res.ok) throw new Error('Error al crear rol');
      const data = await res.json();
      console.log('[createRole] Data recibida:', data);
      await fetchRoles();
    } catch (err) {
      setError(err.message);
      console.error('[createRole] Error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Editar rol
  const updateRole = async (roleId, roleData) => {
    if (!groupId || !roleId) return;
    setLoading(true);
    try {
      const res = await fetch(`http://localhost:9000/api/grouproles/groups/${groupId}/roles/${roleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(roleData),
      });
      if (!res.ok) throw new Error('Error al editar rol');
      await fetchRoles();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Eliminar rol
  const deleteRole = async (roleId) => {
    if (!groupId || !roleId) return;
    setLoading(true);
    try {
      const res = await fetch(`http://localhost:9000/api/grouproles/groups/${groupId}/roles/${roleId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Error al eliminar rol');
      await fetchRoles();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Asignar rol a usuario
  const assignRole = async (userId, roleId) => {
    if (!groupId || !userId) return;
    setLoading(true);
    try {
      const res = await fetch(`http://localhost:9000/api/user-group-roles/${groupId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, roleId }),
      });
      if (!res.ok) throw new Error('Error al asignar rol');
      await fetchUserRoles(userId);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Quitar rol a usuario
  const removeRole = async (userId, roleId) => {
    if (!groupId || !userId) return;
    setLoading(true);
    try {
      const res = await fetch(`http://localhost:9000/api/user-group-roles/${groupId}/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, roleId }),
      });
      if (!res.ok) throw new Error('Error al quitar rol');
      await fetchUserRoles(userId);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (groupId) fetchRoles();
  }, [groupId, fetchRoles]);

  return {
    roles,
    userRolesMap,
    fetchRoles,
    fetchUserRoles,
    createRole,
    updateRole,
    deleteRole,
    assignRole,
    removeRole,
    loading,
    error,
  };
}

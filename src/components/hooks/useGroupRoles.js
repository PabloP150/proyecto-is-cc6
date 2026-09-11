import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';

/**
 * Hook para gestionar roles de grupo y asignaciones de roles a usuarios.
 * Las cargas guardan el error en `error`; las mutaciones (crear/editar/eliminar/asignar/quitar)
 * revierten su cambio optimista y relanzan el ApiError para que la UI muestre el mensaje.
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
    try {
      const [rolesData, matrixData] = await Promise.all([
        api.get(`/api/grouproles/groups/${groupId}/roles`),
        // La matriz es opcional: si falla, los roles por usuario se cargan uno a uno.
        api.get(`/api/usergrouproles/groups/${groupId}/rolesmatrix`).catch(() => null),
      ]);
      setRoles(rolesData?.roles || []);
      setError(null);
      if (Array.isArray(matrixData?.matrix)) {
        const builtMap = matrixData.matrix.reduce((acc, row) => {
          if (!acc[row.uid]) acc[row.uid] = [];
          if (row.gr_id && !acc[row.uid].includes(row.gr_id)) acc[row.uid].push(row.gr_id);
          return acc;
        }, {});
        setUserRolesMap(prev => ({ ...prev, ...builtMap }));
      }
    } catch (err) {
      setError(err.message || 'Error al obtener roles');
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  // Obtener roles de un usuario en el grupo
  const fetchUserRoles = useCallback(async (userId) => {
    if (!groupId || !userId) return [];
    try {
      const data = await api.get(`/api/usergrouproles/groups/${groupId}/users/${userId}/roles`);
      const roleIds = data?.roleIds || [];
      setUserRolesMap(prev => ({ ...prev, [userId]: roleIds }));
      return roleIds;
    } catch (err) {
      setError(err.message || 'Error al obtener roles de usuario');
      return [];
    }
  }, [groupId]);

  // Crear rol
  const createRole = async (roleData) => {
    if (!groupId) return;
    setLoading(true);
    try {
      await api.post(`/api/grouproles/groups/${groupId}/roles`, roleData);
      await fetchRoles();
    } finally {
      setLoading(false);
    }
  };

  // Editar rol
  const updateRole = async (roleId, roleData) => {
    if (!groupId || !roleId) return;
    setLoading(true);
    const prevRoles = roles;
    setRoles(r => r.map(role => role.gr_id === roleId ? { ...role, ...roleData, gr_id: roleId } : role));
    try {
      const payload = await api.put(`/api/grouproles/groups/${groupId}/roles/${roleId}`, roleData);
      if (payload && payload.role) {
        setRoles(r => r.map(role => role.gr_id === roleId ? { ...role, ...payload.role } : role));
      }
    } catch (err) {
      setRoles(prevRoles);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  // Eliminar rol
  const deleteRole = async (roleId) => {
    if (!groupId || !roleId) return;
    setLoading(true);
    try {
      await api.del(`/api/grouproles/groups/${groupId}/roles/${roleId}`);
      await fetchRoles();
    } finally {
      setLoading(false);
    }
  };

  // Asignar rol a usuario (optimistic update — sin re-fetch)
  const assignRole = async (userId, roleId) => {
    if (!groupId || !userId) return;
    const prev = userRolesMap[userId] || [];
    if (prev.includes(roleId)) return; // ya asignado
    setUserRolesMap(m => ({ ...m, [userId]: [...prev, roleId] }));
    try {
      await api.post(`/api/usergrouproles/groups/${groupId}/userroles`, { uid: userId, gr_id: roleId });
    } catch (err) {
      setUserRolesMap(m => ({ ...m, [userId]: prev }));
      throw err;
    }
  };

  // Quitar rol a usuario (optimistic update — sin re-fetch)
  const removeRole = async (userId, roleId) => {
    if (!groupId || !userId) return;
    const prev = userRolesMap[userId] || [];
    setUserRolesMap(m => ({ ...m, [userId]: prev.filter(id => id !== roleId) }));
    try {
      await api.del(`/api/usergrouproles/groups/${groupId}/userroles`, { body: { uid: userId, gr_id: roleId } });
    } catch (err) {
      setUserRolesMap(m => ({ ...m, [userId]: prev }));
      throw err;
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

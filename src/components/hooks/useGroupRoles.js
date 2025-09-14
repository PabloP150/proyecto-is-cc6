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
    try {
      const res = await fetch(`http://localhost:9000/api/grouproles/groups/${groupId}/roles`);
      if (!res.ok) throw new Error('Error al obtener roles');
      const data = await res.json();
      setRoles(data.roles || []);
      // Después de cargar roles, intentar cargar matriz completa de asignaciones para poblar userRolesMap
      try {
        const matrixRes = await fetch(`http://localhost:9000/api/usergrouproles/groups/${groupId}/rolesmatrix`);
        if (matrixRes.ok) {
          const matrixData = await matrixRes.json();
          if (Array.isArray(matrixData.matrix)) {
            // Construir mapa: uid -> [gr_id]
            const builtMap = matrixData.matrix.reduce((acc, row) => {
              if (!acc[row.uid]) acc[row.uid] = [];
              if (row.gr_id && !acc[row.uid].includes(row.gr_id)) acc[row.uid].push(row.gr_id);
              return acc;
            }, {});
            setUserRolesMap(prev => ({ ...prev, ...builtMap }));
          }
        }
      } catch (e) {
        // Silencioso: no bloquear por error de matriz
        console.debug('No se pudo cargar rolesmatrix:', e.message);
      }
    } catch (err) {
  setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  // Obtener roles de un usuario en el grupo
  const fetchUserRoles = useCallback(async (userId) => {
    if (!groupId || !userId) return [];
    try {
  const res = await fetch(`http://localhost:9000/api/usergrouproles/groups/${groupId}/users/${userId}/roles`);
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
    try {
      const res = await fetch(`http://localhost:9000/api/grouproles/groups/${groupId}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(roleData),
      });
      if (!res.ok) throw new Error('Error al crear rol');
      await fetchRoles();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Editar rol
  const updateRole = async (roleId, roleData) => {
    if (!groupId || !roleId) return;
    setLoading(true);
    // Guardar snapshot para posible rollback
    const prevRoles = roles;
    // Actualización optimista local inmediata
    setRoles(r => {
      const updated = r.map(role => role.gr_id === roleId ? { ...role, ...roleData, gr_id: roleId } : role);
      console.debug('[updateRole optimistic] roleId', roleId, 'data', roleData);
      return updated;
    });
    try {
      const res = await fetch(`http://localhost:9000/api/grouproles/groups/${groupId}/roles/${roleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(roleData),
      });
      if (!res.ok) throw new Error('Error al editar rol');
      // Intentar usar payload actualizado si el backend lo envía
      try {
        const payload = await res.json();
        if (payload && payload.role) {
          setRoles(r => {
            console.debug('[updateRole server payload]', payload.role);
            return r.map(role => role.gr_id === roleId ? { ...role, ...payload.role } : role);
          });
        }
      } catch { /* ignorar si no hay json */ }
    } catch (err) {
      setError(err.message);
      // Rollback si falla
      setRoles(prevRoles);
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
      const res = await fetch(`http://localhost:9000/api/usergrouproles/groups/${groupId}/userroles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: userId, gr_id: roleId }),
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
      const res = await fetch(`http://localhost:9000/api/usergrouproles/groups/${groupId}/userroles`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: userId, gr_id: roleId }),
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

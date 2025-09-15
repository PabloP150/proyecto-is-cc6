const { execReadCommand, execWriteCommand } = require('../helpers/execQuery');
const { TYPES } = require('tedious');
// Verificar si un usuario tiene un rol específico en un grupo
const getUserRoleAssignment = async (uid, gid, gr_id) => {
  const query = `SELECT ugr.ugr_id, ugr.uid, ugr.gr_id, ugr.gid
    FROM dbo.UserGroupRoles ugr
    WHERE ugr.uid = @uid AND ugr.gid = @gid AND ugr.gr_id = @gr_id`;
  const params = [
    { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
    { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
    { name: 'gr_id', type: TYPES.UniqueIdentifier, value: gr_id },
  ];
  const result = await execReadCommand(query, params);
  return result.length > 0 ? result[0] : null;
};

// Contar usuarios por rol en un grupo
const countUsersWithRoleInGroup = async (gr_id, gid) => {
  const query = `SELECT COUNT(*) as count
    FROM dbo.UserGroupRoles
    WHERE gr_id = @gr_id AND gid = @gid`;
  const params = [
    { name: 'gr_id', type: TYPES.UniqueIdentifier, value: gr_id },
    { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
  ];
  const result = await execReadCommand(query, params);
  return result[0]?.count || 0;
};

// Matriz completa de roles de todos los usuarios de un grupo
const getRolesMatrixForGroup = async (gid) => {
  const query = `SELECT ugr.uid, ugr.gr_id, gr.gr_name, gr.gr_color, gr.gr_icon
    FROM dbo.UserGroupRoles ugr
    JOIN dbo.GroupRoles gr ON ugr.gr_id = gr.gr_id AND ugr.gid = gr.gid
    WHERE ugr.gid = @gid`;
  const params = [
    { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
  ];
  return execReadCommand(query, params);
};

const getUserGroupRoles = async (gid) => {
  const query = `SELECT ugr.ugr_id, ugr.uid, ugr.gr_id, ugr.gid, gr.gr_name, gr.gr_color, gr.gr_icon
    FROM dbo.UserGroupRoles ugr
    JOIN dbo.GroupRoles gr ON ugr.gr_id = gr.gr_id AND ugr.gid = gr.gid
    WHERE ugr.gid = @gid`;
  const params = [{ name: 'gid', type: TYPES.UniqueIdentifier, value: gid }];
  return execReadCommand(query, params);
};

const assignRoleToUser = async ({ ugr_id, uid, gr_id, gid }) => {
  const query = `INSERT INTO dbo.UserGroupRoles (ugr_id, uid, gr_id, gid) VALUES (@ugr_id, @uid, @gr_id, @gid)`;
  const params = [
    { name: 'ugr_id', type: TYPES.UniqueIdentifier, value: ugr_id },
    { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
    { name: 'gr_id', type: TYPES.UniqueIdentifier, value: gr_id },
    { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
  ];
  await execWriteCommand(query, params);
  return { success: true };
};


const removeRoleFromUser = async ({ ugr_id, uid, gr_id, gid }) => {
  // Permite borrar por ugr_id o por combinación de claves
  let query, params;
  if (ugr_id) {
    query = `DELETE FROM dbo.UserGroupRoles WHERE ugr_id = @ugr_id`;
    params = [{ name: 'ugr_id', type: TYPES.UniqueIdentifier, value: ugr_id }];
  } else {
    query = `DELETE FROM dbo.UserGroupRoles WHERE uid = @uid AND gr_id = @gr_id AND gid = @gid`;
    params = [
      { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
      { name: 'gr_id', type: TYPES.UniqueIdentifier, value: gr_id },
      { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
    ];
  }
  await execWriteCommand(query, params);
  return { success: true };
};

// Obtener los roles de un usuario en un grupo
const getRolesOfUserInGroup = async (uid, gid) => {
  const query = `SELECT ugr.ugr_id, ugr.uid, ugr.gr_id, ugr.gid, gr.gr_name, gr.gr_color, gr.gr_icon
    FROM dbo.UserGroupRoles ugr
    JOIN dbo.GroupRoles gr ON ugr.gr_id = gr.gr_id AND ugr.gid = gr.gid
    WHERE ugr.uid = @uid AND ugr.gid = @gid`;
  const params = [
    { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
    { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
  ];
  return execReadCommand(query, params);
};

// Obtener los usuarios con un rol específico en un grupo
const getUsersWithRoleInGroup = async (gr_id, gid) => {
  const query = `SELECT ugr.ugr_id, ugr.uid, ugr.gr_id, ugr.gid
    FROM dbo.UserGroupRoles ugr
    WHERE ugr.gr_id = @gr_id AND ugr.gid = @gid`;
  const params = [
    { name: 'gr_id', type: TYPES.UniqueIdentifier, value: gr_id },
    { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
  ];
  return execReadCommand(query, params);
};


module.exports = {
  getUserGroupRoles,
  assignRoleToUser,
  removeRoleFromUser,
  getRolesOfUserInGroup,
  getUsersWithRoleInGroup,
  getUserRoleAssignment,
  countUsersWithRoleInGroup,
  getRolesMatrixForGroup,
};

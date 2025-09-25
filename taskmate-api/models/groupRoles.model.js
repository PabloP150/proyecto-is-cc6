// models/groupRoles.model.js
const { execReadCommand, execWriteCommand } = require('../helpers/execQuery');
const { TYPES } = require('tedious');

const getGroupRoles = async (gid) => {
  const query = `SELECT * FROM dbo.GroupRoles WHERE gid = @gid`;
  const params = [{ name: 'gid', type: TYPES.UniqueIdentifier, value: gid }];
  return execReadCommand(query, params);
};

const addGroupRole = async (roleData) => {
  const { gr_id, gid, gr_name, gr_color, gr_icon } = roleData;
  const query = `INSERT INTO dbo.GroupRoles (gr_id, gid, gr_name, gr_color, gr_icon) VALUES (@gr_id, @gid, @gr_name, @gr_color, @gr_icon)`;
  const params = [
    { name: 'gr_id', type: TYPES.UniqueIdentifier, value: gr_id },
    { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
    { name: 'gr_name', type: TYPES.VarChar, value: gr_name },
    { name: 'gr_color', type: TYPES.VarChar, value: gr_color },
    { name: 'gr_icon', type: TYPES.VarChar, value: gr_icon },
  ];
  await execWriteCommand(query, params);
  return { success: true };
};

const updateGroupRole = async (roleData) => {
  const { gr_id, gid, gr_name, gr_color, gr_icon } = roleData;
  const query = `UPDATE dbo.GroupRoles SET gr_name = @gr_name, gr_color = @gr_color, gr_icon = @gr_icon WHERE gr_id = @gr_id AND gid = @gid`;
  const params = [
    { name: 'gr_id', type: TYPES.UniqueIdentifier, value: gr_id },
    { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
    { name: 'gr_name', type: TYPES.VarChar, value: gr_name },
    { name: 'gr_color', type: TYPES.VarChar, value: gr_color },
    { name: 'gr_icon', type: TYPES.VarChar, value: gr_icon },
  ];
  await execWriteCommand(query, params);
  return { success: true };
};

const deleteGroupRole = async (gr_id, gid) => {
  // Primero elimina las asignaciones de ese rol
  const deleteAssignments = `DELETE FROM dbo.UserGroupRoles WHERE gr_id = @gr_id AND gid = @gid`;
  const params = [
    { name: 'gr_id', type: TYPES.UniqueIdentifier, value: gr_id },
    { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
  ];
  await execWriteCommand(deleteAssignments, params);
  // Luego elimina el rol
  const deleteRole = `DELETE FROM dbo.GroupRoles WHERE gr_id = @gr_id AND gid = @gid`;
  await execWriteCommand(deleteRole, params);
  return { success: true };
};

module.exports = {
  getGroupRoles,
  addGroupRole,
  updateGroupRole,
  deleteGroupRole,
};

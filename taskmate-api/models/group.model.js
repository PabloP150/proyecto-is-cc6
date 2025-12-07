// models/group.model.js
const { execReadCommand, execWriteCommand } = require('../helpers/execQuery');
const { TYPES } = require('tedious');

const addGroup = async (groupData) => {
    const { gid, adminId, name } = groupData;
    const query = `INSERT INTO dbo.Groups (gid, adminId, name) VALUES (@gid, @adminId, @name)`;
    const params = [
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'adminId', type: TYPES.UniqueIdentifier, value: adminId },
        { name: 'name', type: TYPES.VarChar, value: name },
    ];
    await execWriteCommand(query, params);
    return { success: true };
};

const getGroupsByUserId = async (uid) => {
    const query = `
        SELECT g.gid, g.adminId, g.name
        FROM dbo.Groups g
        INNER JOIN dbo.UserGroups ug ON ug.gid = g.gid
        WHERE ug.uid = @uid
    `;
    const params = [{ name: 'uid', type: TYPES.UniqueIdentifier, value: uid }];
    return execReadCommand(query, params);
};

const getRolesByGroupId = async (gid) => {
    const query = `
        SELECT gr_id, gr_name, gr_color, gr_icon
        FROM dbo.GroupRoles
        WHERE gid = @gid
        ORDER BY gr_name
    `;
    const params = [{ name: 'gid', type: TYPES.UniqueIdentifier, value: gid }];
    return execReadCommand(query, params);
};

// Eliminación en cascada con una sola consulta transaccional (consistencia de estilo)
const deleteGroup = async (gid, adminId) => {
    const query = `
        BEGIN TRY
            BEGIN TRANSACTION;

            -- Verificar autorización
            IF NOT EXISTS (SELECT 1 FROM dbo.Groups WHERE gid=@gid AND adminId=@adminId)
            BEGIN
                RAISERROR('Not authorized to delete this group', 16, 1);
            END

            -- Eliminar dependencias en orden
            DELETE FROM dbo.UserGroupRoles WHERE gid=@gid;      -- asignaciones de roles
            DELETE FROM dbo.GroupRoles WHERE gid=@gid;          -- roles del grupo
            DELETE FROM dbo.Edges WHERE gid=@gid;               -- edges
            DELETE FROM dbo.Nodes WHERE gid=@gid;               -- nodes
            DELETE FROM dbo.Tasks WHERE gid=@gid;               -- tasks
            DELETE FROM dbo.UserGroups WHERE gid=@gid;          -- membresías

            -- Por si hay registros de historial (opcional, ignora si no existe la tabla)
            IF OBJECT_ID('dbo.DeleteTask','U') IS NOT NULL
                DELETE FROM dbo.DeleteTask WHERE gid=@gid;

            -- Finalmente el grupo
            DELETE FROM dbo.Groups WHERE gid=@gid AND adminId=@adminId;

            COMMIT TRANSACTION;
        END TRY
        BEGIN CATCH
            IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
            DECLARE @ErrMsg NVARCHAR(4000) = ERROR_MESSAGE();
            DECLARE @ErrSeverity INT = ERROR_SEVERITY();
            RAISERROR(@ErrMsg, @ErrSeverity, 1);
        END CATCH;
    `;

    const params = [
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'adminId', type: TYPES.UniqueIdentifier, value: adminId },
    ];
    await execWriteCommand(query, params);
    return { success: true };
};

module.exports = {
    addGroup,
    getGroupsByUserId,
    getRolesByGroupId,
    deleteGroup,
};

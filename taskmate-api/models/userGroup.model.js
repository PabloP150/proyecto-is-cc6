// models/userGroup.model.js
const { execReadCommand, execWriteCommand } = require('../helpers/execQuery');
const { TYPES } = require('tedious');

const addUserToGroup = async (userGroupData) => {
  const { uid, gid } = userGroupData;
  const query = `
    IF NOT EXISTS (SELECT 1 FROM dbo.UserGroups WHERE uid = @uid AND gid = @gid)
      INSERT INTO dbo.UserGroups (uid, gid) VALUES (@uid, @gid)
  `;
  const params = [
    { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
    { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
  ];
  await execWriteCommand(query, params);
  return { success: true };
};

const getMembersByGroupId = async (gid) => {
  const query = `
    SELECT u.uid, u.username
    FROM dbo.Users u
    INNER JOIN dbo.UserGroups ug ON ug.uid = u.uid
    WHERE ug.gid = @gid
  `;
  const params = [{ name: 'gid', type: TYPES.UniqueIdentifier, value: gid }];
  return execReadCommand(query, params);
};

const removeMemberFromGroup = async (uid, gid) => {
  const query = `
    BEGIN TRY
      BEGIN TRANSACTION;

      -- Si se elimina al admin, transferir a otro miembro antes de borrarlo
      IF EXISTS (SELECT 1 FROM dbo.Groups WHERE gid = @gid AND adminId = @uid)
      BEGIN
        DECLARE @nextAdmin UNIQUEIDENTIFIER;
        SELECT TOP 1 @nextAdmin = ug.uid
        FROM dbo.UserGroups ug
        INNER JOIN dbo.Users u ON u.uid = ug.uid
        WHERE ug.gid = @gid AND ug.uid != @uid
        ORDER BY u.username;

        IF @nextAdmin IS NOT NULL
          UPDATE dbo.Groups SET adminId = @nextAdmin WHERE gid = @gid;
      END

      DELETE FROM dbo.UserGroupRoles WHERE uid = @uid AND gid = @gid;
      DELETE FROM dbo.UserGroups WHERE uid = @uid AND gid = @gid;

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
    { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
    { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
  ];
  await execWriteCommand(query, params);
  return { success: true };
};

const leaveGroup = async (uid, gid) => {
  const query = `
    BEGIN TRY
      BEGIN TRANSACTION;

      IF EXISTS (SELECT 1 FROM dbo.Groups WHERE gid = @gid AND adminId = @uid)
      BEGIN
        -- El que sale es el admin
        DECLARE @otherCount INT;
        SELECT @otherCount = COUNT(*) FROM dbo.UserGroups WHERE gid = @gid AND uid != @uid;

        IF @otherCount > 0
        BEGIN
          -- Transferir admin al siguiente miembro (orden por username)
          DECLARE @newAdmin UNIQUEIDENTIFIER;
          SELECT TOP 1 @newAdmin = ug.uid
          FROM dbo.UserGroups ug
          INNER JOIN dbo.Users u ON u.uid = ug.uid
          WHERE ug.gid = @gid AND ug.uid != @uid
          ORDER BY u.username;

          UPDATE dbo.Groups SET adminId = @newAdmin WHERE gid = @gid;
          DELETE FROM dbo.UserGroups WHERE uid = @uid AND gid = @gid;

          SELECT 'transferred' AS result, @newAdmin AS newAdminId;
        END
        ELSE
        BEGIN
          -- Nadie más en el grupo → eliminar todo
          DELETE FROM dbo.UserGroupRoles WHERE gid = @gid;
          DELETE FROM dbo.GroupRoles WHERE gid = @gid;
          DELETE FROM dbo.Edges WHERE gid = @gid;
          DELETE FROM dbo.Nodes WHERE gid = @gid;
          IF OBJECT_ID('dbo.DeleteTask','U') IS NOT NULL
            DELETE FROM dbo.DeleteTask WHERE gid = @gid;
          IF OBJECT_ID('dbo.Completados','U') IS NOT NULL
            DELETE FROM dbo.Completados WHERE gid = @gid;
          DELETE FROM dbo.Tasks WHERE gid = @gid;
          DELETE FROM dbo.UserGroups WHERE gid = @gid;
          DELETE FROM dbo.Groups WHERE gid = @gid;

          SELECT 'deleted' AS result, NULL AS newAdminId;
        END
      END
      ELSE
      BEGIN
        -- No es admin, simplemente sale
        DELETE FROM dbo.UserGroups WHERE uid = @uid AND gid = @gid;
        SELECT 'left' AS result, NULL AS newAdminId;
      END

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
    { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
    { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
  ];
  await execWriteCommand(query, params);
  return { success: true };
};

module.exports = {
  addUserToGroup,
  getMembersByGroupId,
  removeMemberFromGroup,
  leaveGroup,
};

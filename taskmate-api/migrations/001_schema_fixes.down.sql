-- Reverts 001_schema_fixes. Data is kept: the TaskAnalytics -> Tasks FK comes back
-- WITH NOCHECK because history rows may now reference tasks that no longer exist.

IF OBJECT_ID(N'dbo.AnalyticsConfig', N'U') IS NOT NULL
    DROP TABLE dbo.AnalyticsConfig;
GO

IF OBJECT_ID(N'dbo.FK_Edges_TargetNode_Gid', N'F') IS NOT NULL
    ALTER TABLE dbo.Edges DROP CONSTRAINT FK_Edges_TargetNode_Gid;
IF OBJECT_ID(N'dbo.FK_Edges_SourceNode_Gid', N'F') IS NOT NULL
    ALTER TABLE dbo.Edges DROP CONSTRAINT FK_Edges_SourceNode_Gid;
IF OBJECT_ID(N'dbo.FK_UserGroupRoles_UserGroups', N'F') IS NOT NULL
    ALTER TABLE dbo.UserGroupRoles DROP CONSTRAINT FK_UserGroupRoles_UserGroups;
IF OBJECT_ID(N'dbo.FK_UserGroupRoles_GroupRoles_Gid', N'F') IS NOT NULL
    ALTER TABLE dbo.UserGroupRoles DROP CONSTRAINT FK_UserGroupRoles_GroupRoles_Gid;
GO

IF OBJECT_ID(N'dbo.UQ_Nodes_Nid_Gid', N'UQ') IS NOT NULL
    ALTER TABLE dbo.Nodes DROP CONSTRAINT UQ_Nodes_Nid_Gid;
IF OBJECT_ID(N'dbo.UQ_GroupRoles_GrId_Gid', N'UQ') IS NOT NULL
    ALTER TABLE dbo.GroupRoles DROP CONSTRAINT UQ_GroupRoles_GrId_Gid;
IF OBJECT_ID(N'dbo.UQ_UserTask_Utid', N'UQ') IS NOT NULL
    ALTER TABLE dbo.UserTask DROP CONSTRAINT UQ_UserTask_Utid;
IF OBJECT_ID(N'dbo.UQ_Edges_Source_Target', N'UQ') IS NOT NULL
    ALTER TABLE dbo.Edges DROP CONSTRAINT UQ_Edges_Source_Target;
IF OBJECT_ID(N'dbo.UQ_GroupRoles_Gid_Name', N'UQ') IS NOT NULL
    ALTER TABLE dbo.GroupRoles DROP CONSTRAINT UQ_GroupRoles_Gid_Name;
IF OBJECT_ID(N'dbo.UQ_UserGroupRoles_Uid_GrId', N'UQ') IS NOT NULL
    ALTER TABLE dbo.UserGroupRoles DROP CONSTRAINT UQ_UserGroupRoles_Uid_GrId;
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_UserTask_Utid' AND object_id = OBJECT_ID(N'dbo.UserTask'))
    DROP INDEX IX_UserTask_Utid ON dbo.UserTask;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Edges_SourceId' AND object_id = OBJECT_ID(N'dbo.Edges'))
    DROP INDEX IX_Edges_SourceId ON dbo.Edges;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_GroupRoles_Gid' AND object_id = OBJECT_ID(N'dbo.GroupRoles'))
    DROP INDEX IX_GroupRoles_Gid ON dbo.GroupRoles;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_UserGroupRoles_Uid' AND object_id = OBJECT_ID(N'dbo.UserGroupRoles'))
    DROP INDEX IX_UserGroupRoles_Uid ON dbo.UserGroupRoles;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_TaskAnalytics_Gid' AND object_id = OBJECT_ID(N'dbo.TaskAnalytics'))
    DROP INDEX IX_TaskAnalytics_Gid ON dbo.TaskAnalytics;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_TaskAnalytics_Uid' AND object_id = OBJECT_ID(N'dbo.TaskAnalytics'))
    DROP INDEX IX_TaskAnalytics_Uid ON dbo.TaskAnalytics;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_TaskAnalytics_Tid' AND object_id = OBJECT_ID(N'dbo.TaskAnalytics'))
    DROP INDEX IX_TaskAnalytics_Tid ON dbo.TaskAnalytics;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_UserGroupRoles_GrId_Gid' AND object_id = OBJECT_ID(N'dbo.UserGroupRoles'))
    DROP INDEX IX_UserGroupRoles_GrId_Gid ON dbo.UserGroupRoles;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_UserGroupRoles_Gid' AND object_id = OBJECT_ID(N'dbo.UserGroupRoles'))
    DROP INDEX IX_UserGroupRoles_Gid ON dbo.UserGroupRoles;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_DeleteTask_Gid' AND object_id = OBJECT_ID(N'dbo.DeleteTask'))
    DROP INDEX IX_DeleteTask_Gid ON dbo.DeleteTask;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Complete_Gid' AND object_id = OBJECT_ID(N'dbo.Complete'))
    DROP INDEX IX_Complete_Gid ON dbo.Complete;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Edges_TargetId' AND object_id = OBJECT_ID(N'dbo.Edges'))
    DROP INDEX IX_Edges_TargetId ON dbo.Edges;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Edges_Gid' AND object_id = OBJECT_ID(N'dbo.Edges'))
    DROP INDEX IX_Edges_Gid ON dbo.Edges;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Nodes_Gid' AND object_id = OBJECT_ID(N'dbo.Nodes'))
    DROP INDEX IX_Nodes_Gid ON dbo.Nodes;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_UserTask_Tid' AND object_id = OBJECT_ID(N'dbo.UserTask'))
    DROP INDEX IX_UserTask_Tid ON dbo.UserTask;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Tasks_Gid_List' AND object_id = OBJECT_ID(N'dbo.Tasks'))
    DROP INDEX IX_Tasks_Gid_List ON dbo.Tasks;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_UserGroups_Gid' AND object_id = OBJECT_ID(N'dbo.UserGroups'))
    DROP INDEX IX_UserGroups_Gid ON dbo.UserGroups;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Groups_AdminId' AND object_id = OBJECT_ID(N'dbo.Groups'))
    DROP INDEX IX_Groups_AdminId ON dbo.Groups;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys
               WHERE parent_object_id = OBJECT_ID(N'dbo.TaskAnalytics')
                 AND referenced_object_id = OBJECT_ID(N'dbo.Tasks'))
    ALTER TABLE dbo.TaskAnalytics WITH NOCHECK ADD CONSTRAINT FK_TaskAnalytics_Tasks
        FOREIGN KEY (tid) REFERENCES dbo.Tasks (tid);
GO

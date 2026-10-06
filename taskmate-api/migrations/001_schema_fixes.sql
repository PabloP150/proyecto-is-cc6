-- 001_schema_fixes: indexes on every FK, missing UNIQUE constraints (never deletes data:
-- when duplicates exist the constraint is skipped with a WARNING), composite FKs that keep
-- the derivable gid consistent, TaskAnalytics as a history fact table, AnalyticsConfig.
-- Idempotent: every statement is guarded, running it twice is a no-op.

-- ---------------------------------------------------------------- indexes on FK columns
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Groups_AdminId' AND object_id = OBJECT_ID(N'dbo.Groups'))
    CREATE INDEX IX_Groups_AdminId ON dbo.Groups (adminId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_UserGroups_Gid' AND object_id = OBJECT_ID(N'dbo.UserGroups'))
    CREATE INDEX IX_UserGroups_Gid ON dbo.UserGroups (gid);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Tasks_Gid_List' AND object_id = OBJECT_ID(N'dbo.Tasks'))
    CREATE INDEX IX_Tasks_Gid_List ON dbo.Tasks (gid, list);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_UserTask_Tid' AND object_id = OBJECT_ID(N'dbo.UserTask'))
    CREATE INDEX IX_UserTask_Tid ON dbo.UserTask (tid);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Nodes_Gid' AND object_id = OBJECT_ID(N'dbo.Nodes'))
    CREATE INDEX IX_Nodes_Gid ON dbo.Nodes (gid);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Edges_Gid' AND object_id = OBJECT_ID(N'dbo.Edges'))
    CREATE INDEX IX_Edges_Gid ON dbo.Edges (gid);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Edges_TargetId' AND object_id = OBJECT_ID(N'dbo.Edges'))
    CREATE INDEX IX_Edges_TargetId ON dbo.Edges (targetId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Complete_Gid' AND object_id = OBJECT_ID(N'dbo.Complete'))
    CREATE INDEX IX_Complete_Gid ON dbo.Complete (gid);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_DeleteTask_Gid' AND object_id = OBJECT_ID(N'dbo.DeleteTask'))
    CREATE INDEX IX_DeleteTask_Gid ON dbo.DeleteTask (gid);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_UserGroupRoles_Gid' AND object_id = OBJECT_ID(N'dbo.UserGroupRoles'))
    CREATE INDEX IX_UserGroupRoles_Gid ON dbo.UserGroupRoles (gid);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_UserGroupRoles_GrId_Gid' AND object_id = OBJECT_ID(N'dbo.UserGroupRoles'))
    CREATE INDEX IX_UserGroupRoles_GrId_Gid ON dbo.UserGroupRoles (gr_id, gid);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_TaskAnalytics_Tid' AND object_id = OBJECT_ID(N'dbo.TaskAnalytics'))
    CREATE INDEX IX_TaskAnalytics_Tid ON dbo.TaskAnalytics (tid, success_status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_TaskAnalytics_Uid' AND object_id = OBJECT_ID(N'dbo.TaskAnalytics'))
    CREATE INDEX IX_TaskAnalytics_Uid ON dbo.TaskAnalytics (uid, success_status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_TaskAnalytics_Gid' AND object_id = OBJECT_ID(N'dbo.TaskAnalytics'))
    CREATE INDEX IX_TaskAnalytics_Gid ON dbo.TaskAnalytics (gid);
GO

-- ---------------------------------------------------------------- missing UNIQUE constraints
-- If duplicates exist the constraint is skipped (reported) and a plain index still covers the FK;
-- re-running the file after fixing the data creates the constraint and drops that index.
IF OBJECT_ID(N'dbo.UQ_UserGroupRoles_Uid_GrId', N'UQ') IS NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.UserGroupRoles GROUP BY uid, gr_id HAVING COUNT(*) > 1)
    BEGIN
        PRINT 'WARNING 001: duplicate (uid, gr_id) rows in dbo.UserGroupRoles; UQ_UserGroupRoles_Uid_GrId skipped. Fix the data, then re-run this file (node migrations/runner.js reapply 1).';
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_UserGroupRoles_Uid' AND object_id = OBJECT_ID(N'dbo.UserGroupRoles'))
            CREATE INDEX IX_UserGroupRoles_Uid ON dbo.UserGroupRoles (uid);
    END
    ELSE
    BEGIN
        ALTER TABLE dbo.UserGroupRoles ADD CONSTRAINT UQ_UserGroupRoles_Uid_GrId UNIQUE (uid, gr_id);
        IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_UserGroupRoles_Uid' AND object_id = OBJECT_ID(N'dbo.UserGroupRoles'))
            DROP INDEX IX_UserGroupRoles_Uid ON dbo.UserGroupRoles;
    END
END;

IF OBJECT_ID(N'dbo.UQ_GroupRoles_Gid_Name', N'UQ') IS NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.GroupRoles GROUP BY gid, gr_name HAVING COUNT(*) > 1)
    BEGIN
        PRINT 'WARNING 001: duplicate (gid, gr_name) rows in dbo.GroupRoles; UQ_GroupRoles_Gid_Name skipped. Fix the data, then re-run this file (node migrations/runner.js reapply 1).';
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_GroupRoles_Gid' AND object_id = OBJECT_ID(N'dbo.GroupRoles'))
            CREATE INDEX IX_GroupRoles_Gid ON dbo.GroupRoles (gid);
    END
    ELSE
    BEGIN
        ALTER TABLE dbo.GroupRoles ADD CONSTRAINT UQ_GroupRoles_Gid_Name UNIQUE (gid, gr_name);
        IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_GroupRoles_Gid' AND object_id = OBJECT_ID(N'dbo.GroupRoles'))
            DROP INDEX IX_GroupRoles_Gid ON dbo.GroupRoles;
    END
END;

IF OBJECT_ID(N'dbo.UQ_Edges_Source_Target', N'UQ') IS NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.Edges GROUP BY sourceId, targetId HAVING COUNT(*) > 1)
    BEGIN
        PRINT 'WARNING 001: duplicate (sourceId, targetId) rows in dbo.Edges; UQ_Edges_Source_Target skipped. Fix the data, then re-run this file (node migrations/runner.js reapply 1).';
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Edges_SourceId' AND object_id = OBJECT_ID(N'dbo.Edges'))
            CREATE INDEX IX_Edges_SourceId ON dbo.Edges (sourceId);
    END
    ELSE
    BEGIN
        ALTER TABLE dbo.Edges ADD CONSTRAINT UQ_Edges_Source_Target UNIQUE (sourceId, targetId);
        IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Edges_SourceId' AND object_id = OBJECT_ID(N'dbo.Edges'))
            DROP INDEX IX_Edges_SourceId ON dbo.Edges;
    END
END;

IF OBJECT_ID(N'dbo.UQ_UserTask_Utid', N'UQ') IS NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.UserTask GROUP BY utid HAVING COUNT(*) > 1)
    BEGIN
        PRINT 'WARNING 001: duplicate utid values in dbo.UserTask; UQ_UserTask_Utid skipped. Fix the data, then re-run this file (node migrations/runner.js reapply 1).';
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_UserTask_Utid' AND object_id = OBJECT_ID(N'dbo.UserTask'))
            CREATE INDEX IX_UserTask_Utid ON dbo.UserTask (utid);
    END
    ELSE
    BEGIN
        ALTER TABLE dbo.UserTask ADD CONSTRAINT UQ_UserTask_Utid UNIQUE (utid);
        IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_UserTask_Utid' AND object_id = OBJECT_ID(N'dbo.UserTask'))
            DROP INDEX IX_UserTask_Utid ON dbo.UserTask;
    END
END;

-- Targets of the composite FKs below (always unique: the first column is the PK).
IF OBJECT_ID(N'dbo.UQ_GroupRoles_GrId_Gid', N'UQ') IS NULL
    ALTER TABLE dbo.GroupRoles ADD CONSTRAINT UQ_GroupRoles_GrId_Gid UNIQUE (gr_id, gid);
IF OBJECT_ID(N'dbo.UQ_Nodes_Nid_Gid', N'UQ') IS NULL
    ALTER TABLE dbo.Nodes ADD CONSTRAINT UQ_Nodes_Nid_Gid UNIQUE (nid, gid);
GO

-- ---------------------------------------------------------------- composite FKs (gid consistency)
-- The gid stored in UserGroupRoles/Edges is derivable from gr_id/nid; these FKs make it
-- impossible for it to disagree, and a role can only be held by a member of the group.
IF OBJECT_ID(N'dbo.FK_UserGroupRoles_GroupRoles_Gid', N'F') IS NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.UserGroupRoles ugr
               WHERE NOT EXISTS (SELECT 1 FROM dbo.GroupRoles gr WHERE gr.gr_id = ugr.gr_id AND gr.gid = ugr.gid))
        PRINT 'WARNING 001: UserGroupRoles rows whose gid differs from their role''s gid; FK_UserGroupRoles_GroupRoles_Gid skipped.';
    ELSE
        ALTER TABLE dbo.UserGroupRoles WITH CHECK ADD CONSTRAINT FK_UserGroupRoles_GroupRoles_Gid
            FOREIGN KEY (gr_id, gid) REFERENCES dbo.GroupRoles (gr_id, gid);
END;

IF OBJECT_ID(N'dbo.FK_UserGroupRoles_UserGroups', N'F') IS NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.UserGroupRoles ugr
               WHERE NOT EXISTS (SELECT 1 FROM dbo.UserGroups ug WHERE ug.uid = ugr.uid AND ug.gid = ugr.gid))
        PRINT 'WARNING 001: UserGroupRoles rows for users that are not group members; FK_UserGroupRoles_UserGroups skipped.';
    ELSE
        ALTER TABLE dbo.UserGroupRoles WITH CHECK ADD CONSTRAINT FK_UserGroupRoles_UserGroups
            FOREIGN KEY (uid, gid) REFERENCES dbo.UserGroups (uid, gid);
END;

IF OBJECT_ID(N'dbo.FK_Edges_SourceNode_Gid', N'F') IS NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.Edges e
               WHERE NOT EXISTS (SELECT 1 FROM dbo.Nodes n WHERE n.nid = e.sourceId AND n.gid = e.gid))
        PRINT 'WARNING 001: Edges whose source node belongs to another group; FK_Edges_SourceNode_Gid skipped.';
    ELSE
        ALTER TABLE dbo.Edges WITH CHECK ADD CONSTRAINT FK_Edges_SourceNode_Gid
            FOREIGN KEY (sourceId, gid) REFERENCES dbo.Nodes (nid, gid);
END;

IF OBJECT_ID(N'dbo.FK_Edges_TargetNode_Gid', N'F') IS NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.Edges e
               WHERE NOT EXISTS (SELECT 1 FROM dbo.Nodes n WHERE n.nid = e.targetId AND n.gid = e.gid))
        PRINT 'WARNING 001: Edges whose target node belongs to another group; FK_Edges_TargetNode_Gid skipped.';
    ELSE
        ALTER TABLE dbo.Edges WITH CHECK ADD CONSTRAINT FK_Edges_TargetNode_Gid
            FOREIGN KEY (targetId, gid) REFERENCES dbo.Nodes (nid, gid);
END;
GO

-- ---------------------------------------------------------------- TaskAnalytics as a fact table
-- Completion/deletion history must outlive the Tasks row, so the FK to Tasks goes away.
DECLARE @fk SYSNAME, @sql NVARCHAR(400);
DECLARE fk_cursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT name FROM sys.foreign_keys
    WHERE parent_object_id = OBJECT_ID(N'dbo.TaskAnalytics')
      AND referenced_object_id = OBJECT_ID(N'dbo.Tasks');
OPEN fk_cursor;
FETCH NEXT FROM fk_cursor INTO @fk;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'ALTER TABLE dbo.TaskAnalytics DROP CONSTRAINT ' + QUOTENAME(@fk);
    EXEC sys.sp_executesql @sql;
    FETCH NEXT FROM fk_cursor INTO @fk;
END;
CLOSE fk_cursor;
DEALLOCATE fk_cursor;
GO

-- ---------------------------------------------------------------- schema drift
-- Databases built from an older taskmate_tables.sql lack DeleteTask.percentage, which
-- delete.model already writes. Additive, so the down script leaves it in place.
IF COL_LENGTH(N'dbo.DeleteTask', N'percentage') IS NULL
    ALTER TABLE dbo.DeleteTask ADD percentage INT NOT NULL
        CONSTRAINT DF_DeleteTask_Percentage DEFAULT 0
        CONSTRAINT CK_DeleteTask_Percentage CHECK (percentage BETWEEN 0 AND 100);
GO

-- ---------------------------------------------------------------- AnalyticsConfig
-- Used by analytics.controller (_getGroupAnalyticsConfig / _updateGroupAnalyticsConfig).
IF OBJECT_ID(N'dbo.AnalyticsConfig', N'U') IS NULL
    CREATE TABLE dbo.AnalyticsConfig (
        gid                     UNIQUEIDENTIFIER    NOT NULL
            CONSTRAINT PK_AnalyticsConfig PRIMARY KEY
            CONSTRAINT FK_AnalyticsConfig_Groups REFERENCES dbo.Groups (gid) ON DELETE CASCADE,
        analytics_enabled       BIT                 NOT NULL CONSTRAINT DF_AnalyticsConfig_AnalyticsEnabled DEFAULT 1,
        track_completion_time   BIT                 NOT NULL CONSTRAINT DF_AnalyticsConfig_TrackCompletionTime DEFAULT 1,
        track_success_rate      BIT                 NOT NULL CONSTRAINT DF_AnalyticsConfig_TrackSuccessRate DEFAULT 1,
        track_workload          BIT                 NOT NULL CONSTRAINT DF_AnalyticsConfig_TrackWorkload DEFAULT 1,
        track_expertise         BIT                 NOT NULL CONSTRAINT DF_AnalyticsConfig_TrackExpertise DEFAULT 1,
        track_capacity          BIT                 NOT NULL CONSTRAINT DF_AnalyticsConfig_TrackCapacity DEFAULT 1,
        data_retention_days     INT                 NOT NULL CONSTRAINT DF_AnalyticsConfig_RetentionDays DEFAULT 365
            CONSTRAINT CK_AnalyticsConfig_RetentionDays CHECK (data_retention_days BETWEEN 1 AND 3650),
        privacy_mode            VARCHAR(30)         NOT NULL CONSTRAINT DF_AnalyticsConfig_PrivacyMode DEFAULT 'team_leader_only'
            CONSTRAINT CK_AnalyticsConfig_PrivacyMode CHECK (privacy_mode IN ('team_leader_only', 'team', 'private')),
        updated_at              DATETIMEOFFSET(0)   NOT NULL CONSTRAINT DF_AnalyticsConfig_UpdatedAt DEFAULT SYSDATETIMEOFFSET()
    );
GO

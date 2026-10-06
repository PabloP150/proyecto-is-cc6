-- 005_unicode_membership_github:
--  (a) user-facing text columns VARCHAR -> NVARCHAR (same length): 'Tarea ✓ 漢字' was stored as 'Tarea ? ??'.
--  (b) UserGroups.joined_at; admin succession = earliest member (joined_at, then uid), never by username.
--  (c) GroupRoles.gr_icon VARCHAR(40) (icon names such as 'integration_instructions' did not fit).
--  (d) GroupRepositories.ai_analysis_enabled: admin opt-in before repository data is sent to the AI.
--  (e) GitHubWebhookDeliveries.payload_sha256 + filtered unique index (replay protection).
-- Idempotent: every change is guarded.

-- Filtered indexes need these options at creation time (sqlcmd defaults differ from tedious').
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
GO

-- ---------------------------------------------------------------- (a) NVARCHAR
-- Column still VARCHAR? (sys.types name of the column's type)
IF EXISTS (SELECT 1 FROM sys.columns c INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID(N'dbo.Tasks') AND c.name = N'list' AND t.name = N'varchar')
BEGIN
    IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Tasks_Gid_List' AND object_id = OBJECT_ID(N'dbo.Tasks'))
        DROP INDEX IX_Tasks_Gid_List ON dbo.Tasks;
    ALTER TABLE dbo.Tasks ALTER COLUMN list NVARCHAR(25) NOT NULL;
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Tasks_Gid_List' AND object_id = OBJECT_ID(N'dbo.Tasks'))
    CREATE INDEX IX_Tasks_Gid_List ON dbo.Tasks (gid, list);

IF EXISTS (SELECT 1 FROM sys.columns c INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID(N'dbo.Tasks') AND c.name = N'name' AND t.name = N'varchar')
    ALTER TABLE dbo.Tasks ALTER COLUMN name NVARCHAR(25) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID(N'dbo.Tasks') AND c.name = N'description' AND t.name = N'varchar')
    ALTER TABLE dbo.Tasks ALTER COLUMN description NVARCHAR(1000) NOT NULL;

IF EXISTS (SELECT 1 FROM sys.columns c INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID(N'dbo.Nodes') AND c.name = N'name' AND t.name = N'varchar')
    ALTER TABLE dbo.Nodes ALTER COLUMN name NVARCHAR(25) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID(N'dbo.Nodes') AND c.name = N'description' AND t.name = N'varchar')
    ALTER TABLE dbo.Nodes ALTER COLUMN description NVARCHAR(1000) NOT NULL;

IF EXISTS (SELECT 1 FROM sys.columns c INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID(N'dbo.Groups') AND c.name = N'name' AND t.name = N'varchar')
    ALTER TABLE dbo.Groups ALTER COLUMN name NVARCHAR(25) NOT NULL;

IF EXISTS (SELECT 1 FROM sys.columns c INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID(N'dbo.Complete') AND c.name = N'name' AND t.name = N'varchar')
    ALTER TABLE dbo.Complete ALTER COLUMN name NVARCHAR(25) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID(N'dbo.Complete') AND c.name = N'description' AND t.name = N'varchar')
    ALTER TABLE dbo.Complete ALTER COLUMN description NVARCHAR(1000) NOT NULL;

IF EXISTS (SELECT 1 FROM sys.columns c INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID(N'dbo.DeleteTask') AND c.name = N'name' AND t.name = N'varchar')
    ALTER TABLE dbo.DeleteTask ALTER COLUMN name NVARCHAR(25) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID(N'dbo.DeleteTask') AND c.name = N'description' AND t.name = N'varchar')
    ALTER TABLE dbo.DeleteTask ALTER COLUMN description NVARCHAR(1000) NOT NULL;
GO

-- GroupRoles.gr_name carries UQ_GroupRoles_Gid_Name (unless 001 had to skip it): drop, convert, re-add.
DECLARE @hadRoleUq BIT = CASE WHEN OBJECT_ID(N'dbo.UQ_GroupRoles_Gid_Name', N'UQ') IS NULL THEN 0 ELSE 1 END;
IF EXISTS (SELECT 1 FROM sys.columns c INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID(N'dbo.GroupRoles') AND c.name = N'gr_name' AND t.name = N'varchar')
BEGIN
    IF @hadRoleUq = 1 ALTER TABLE dbo.GroupRoles DROP CONSTRAINT UQ_GroupRoles_Gid_Name;
    ALTER TABLE dbo.GroupRoles ALTER COLUMN gr_name NVARCHAR(40) NOT NULL;
    IF @hadRoleUq = 1 ALTER TABLE dbo.GroupRoles ADD CONSTRAINT UQ_GroupRoles_Gid_Name UNIQUE (gid, gr_name);
END;

-- (c) icon names up to 40 characters.
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.GroupRoles') AND name = N'gr_icon' AND max_length < 40)
    ALTER TABLE dbo.GroupRoles ALTER COLUMN gr_icon VARCHAR(40) NULL;

-- Users.username: the base schema's unique constraint "noDuplicates" becomes UQ_Users_Username.
IF EXISTS (SELECT 1 FROM sys.columns c INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID(N'dbo.Users') AND c.name = N'username' AND t.name = N'varchar')
BEGIN
    IF OBJECT_ID(N'dbo.noDuplicates', N'UQ') IS NOT NULL ALTER TABLE dbo.Users DROP CONSTRAINT noDuplicates;
    IF OBJECT_ID(N'dbo.UQ_Users_Username', N'UQ') IS NOT NULL ALTER TABLE dbo.Users DROP CONSTRAINT UQ_Users_Username;
    ALTER TABLE dbo.Users ALTER COLUMN username NVARCHAR(25) NOT NULL;
END;
IF OBJECT_ID(N'dbo.UQ_Users_Username', N'UQ') IS NULL AND OBJECT_ID(N'dbo.noDuplicates', N'UQ') IS NULL
    ALTER TABLE dbo.Users ADD CONSTRAINT UQ_Users_Username UNIQUE (username);
GO

-- ---------------------------------------------------------------- (b) membership date + succession
IF COL_LENGTH(N'dbo.UserGroups', N'joined_at') IS NULL
    ALTER TABLE dbo.UserGroups ADD joined_at DATETIMEOFFSET(0) NOT NULL
        CONSTRAINT DF_UserGroups_JoinedAt DEFAULT SYSDATETIMEOFFSET();
GO

-- Same repair as 004 with the new succession rule (a group whose admin is no longer a member).
UPDATE g
SET g.adminId = (
    SELECT TOP 1 ug2.uid FROM dbo.UserGroups ug2
    WHERE ug2.gid = g.gid
    ORDER BY ug2.joined_at, ug2.uid
)
FROM dbo.Groups g
WHERE NOT EXISTS (SELECT 1 FROM dbo.UserGroups ug WHERE ug.uid = g.adminId AND ug.gid = g.gid)
  AND EXISTS (SELECT 1 FROM dbo.UserGroups ug WHERE ug.gid = g.gid);
GO

-- ---------------------------------------------------------------- (d) AI analysis opt-in
IF COL_LENGTH(N'dbo.GroupRepositories', N'ai_analysis_enabled') IS NULL
    ALTER TABLE dbo.GroupRepositories ADD ai_analysis_enabled BIT NOT NULL
        CONSTRAINT DF_GroupRepositories_AiAnalysisEnabled DEFAULT 0;
GO

-- ---------------------------------------------------------------- (e) webhook replay protection
IF COL_LENGTH(N'dbo.GitHubWebhookDeliveries', N'payload_sha256') IS NULL
    ALTER TABLE dbo.GitHubWebhookDeliveries ADD payload_sha256 CHAR(64) NULL
        CONSTRAINT CK_GitHubWebhookDeliveries_PayloadSha256 CHECK (payload_sha256 NOT LIKE '%[^0-9a-f]%');
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_GitHubWebhookDeliveries_PayloadSha256'
               AND object_id = OBJECT_ID(N'dbo.GitHubWebhookDeliveries'))
    CREATE UNIQUE INDEX IX_GitHubWebhookDeliveries_PayloadSha256
        ON dbo.GitHubWebhookDeliveries (payload_sha256) WHERE payload_sha256 IS NOT NULL;
GO

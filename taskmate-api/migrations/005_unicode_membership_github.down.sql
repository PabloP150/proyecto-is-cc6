-- Reverts 005. Lossy by nature: characters outside the database code page become '?' when the
-- text columns go back to VARCHAR (and a now-duplicated username would make the UNIQUE fail);
-- icon names are cut to the old 20 characters.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_GitHubWebhookDeliveries_PayloadSha256'
           AND object_id = OBJECT_ID(N'dbo.GitHubWebhookDeliveries'))
    DROP INDEX IX_GitHubWebhookDeliveries_PayloadSha256 ON dbo.GitHubWebhookDeliveries;
IF OBJECT_ID(N'dbo.CK_GitHubWebhookDeliveries_PayloadSha256', N'C') IS NOT NULL
    ALTER TABLE dbo.GitHubWebhookDeliveries DROP CONSTRAINT CK_GitHubWebhookDeliveries_PayloadSha256;
IF COL_LENGTH(N'dbo.GitHubWebhookDeliveries', N'payload_sha256') IS NOT NULL
    ALTER TABLE dbo.GitHubWebhookDeliveries DROP COLUMN payload_sha256;

IF OBJECT_ID(N'dbo.DF_GroupRepositories_AiAnalysisEnabled', N'D') IS NOT NULL
    ALTER TABLE dbo.GroupRepositories DROP CONSTRAINT DF_GroupRepositories_AiAnalysisEnabled;
IF COL_LENGTH(N'dbo.GroupRepositories', N'ai_analysis_enabled') IS NOT NULL
    ALTER TABLE dbo.GroupRepositories DROP COLUMN ai_analysis_enabled;

IF OBJECT_ID(N'dbo.DF_UserGroups_JoinedAt', N'D') IS NOT NULL
    ALTER TABLE dbo.UserGroups DROP CONSTRAINT DF_UserGroups_JoinedAt;
IF COL_LENGTH(N'dbo.UserGroups', N'joined_at') IS NOT NULL
    ALTER TABLE dbo.UserGroups DROP COLUMN joined_at;
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.GroupRoles') AND name = N'gr_icon' AND max_length > 20)
BEGIN
    UPDATE dbo.GroupRoles SET gr_icon = LEFT(gr_icon, 20) WHERE LEN(gr_icon) > 20;
    ALTER TABLE dbo.GroupRoles ALTER COLUMN gr_icon VARCHAR(20) NULL;
END;
GO

IF EXISTS (SELECT 1 FROM sys.columns c INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID(N'dbo.Users') AND c.name = N'username' AND t.name = N'nvarchar')
BEGIN
    IF OBJECT_ID(N'dbo.UQ_Users_Username', N'UQ') IS NOT NULL ALTER TABLE dbo.Users DROP CONSTRAINT UQ_Users_Username;
    ALTER TABLE dbo.Users ALTER COLUMN username VARCHAR(25) NOT NULL;
    IF OBJECT_ID(N'dbo.noDuplicates', N'UQ') IS NULL ALTER TABLE dbo.Users ADD CONSTRAINT noDuplicates UNIQUE (username);
END;

DECLARE @hadRoleUq BIT = CASE WHEN OBJECT_ID(N'dbo.UQ_GroupRoles_Gid_Name', N'UQ') IS NULL THEN 0 ELSE 1 END;
IF EXISTS (SELECT 1 FROM sys.columns c INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID(N'dbo.GroupRoles') AND c.name = N'gr_name' AND t.name = N'nvarchar')
BEGIN
    IF @hadRoleUq = 1 ALTER TABLE dbo.GroupRoles DROP CONSTRAINT UQ_GroupRoles_Gid_Name;
    ALTER TABLE dbo.GroupRoles ALTER COLUMN gr_name VARCHAR(40) NOT NULL;
    IF @hadRoleUq = 1 ALTER TABLE dbo.GroupRoles ADD CONSTRAINT UQ_GroupRoles_Gid_Name UNIQUE (gid, gr_name);
END;
GO

IF EXISTS (SELECT 1 FROM sys.columns c INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID(N'dbo.Tasks') AND c.name = N'list' AND t.name = N'nvarchar')
BEGIN
    IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Tasks_Gid_List' AND object_id = OBJECT_ID(N'dbo.Tasks'))
        DROP INDEX IX_Tasks_Gid_List ON dbo.Tasks;
    ALTER TABLE dbo.Tasks ALTER COLUMN list VARCHAR(25) NOT NULL;
    CREATE INDEX IX_Tasks_Gid_List ON dbo.Tasks (gid, list);
END;
IF EXISTS (SELECT 1 FROM sys.columns c INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID(N'dbo.Tasks') AND c.name = N'name' AND t.name = N'nvarchar')
    ALTER TABLE dbo.Tasks ALTER COLUMN name VARCHAR(25) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID(N'dbo.Tasks') AND c.name = N'description' AND t.name = N'nvarchar')
    ALTER TABLE dbo.Tasks ALTER COLUMN description VARCHAR(1000) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID(N'dbo.Nodes') AND c.name = N'name' AND t.name = N'nvarchar')
    ALTER TABLE dbo.Nodes ALTER COLUMN name VARCHAR(25) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID(N'dbo.Nodes') AND c.name = N'description' AND t.name = N'nvarchar')
    ALTER TABLE dbo.Nodes ALTER COLUMN description VARCHAR(1000) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID(N'dbo.Groups') AND c.name = N'name' AND t.name = N'nvarchar')
    ALTER TABLE dbo.Groups ALTER COLUMN name VARCHAR(25) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID(N'dbo.Complete') AND c.name = N'name' AND t.name = N'nvarchar')
    ALTER TABLE dbo.Complete ALTER COLUMN name VARCHAR(25) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID(N'dbo.Complete') AND c.name = N'description' AND t.name = N'nvarchar')
    ALTER TABLE dbo.Complete ALTER COLUMN description VARCHAR(1000) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID(N'dbo.DeleteTask') AND c.name = N'name' AND t.name = N'nvarchar')
    ALTER TABLE dbo.DeleteTask ALTER COLUMN name VARCHAR(25) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID(N'dbo.DeleteTask') AND c.name = N'description' AND t.name = N'nvarchar')
    ALTER TABLE dbo.DeleteTask ALTER COLUMN description VARCHAR(1000) NOT NULL;
GO

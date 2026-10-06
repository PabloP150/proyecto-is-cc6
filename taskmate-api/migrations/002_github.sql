-- 002_github: GitHub App installations, repositories, group <-> repo link, branch per task,
-- pull requests and the webhook delivery log. Installation tokens are never stored.
-- Branch names use a binary collation: Git refs are case-sensitive.

IF OBJECT_ID(N'dbo.GitHubInstallations', N'U') IS NULL
    CREATE TABLE dbo.GitHubInstallations (
        installation_id BIGINT              NOT NULL CONSTRAINT PK_GitHubInstallations PRIMARY KEY,
        account_login   NVARCHAR(39)        NOT NULL,
        account_type    VARCHAR(12)         NOT NULL
            CONSTRAINT CK_GitHubInstallations_AccountType CHECK (account_type IN ('User', 'Organization')),
        created_at      DATETIMEOFFSET(0)   NOT NULL CONSTRAINT DF_GitHubInstallations_CreatedAt DEFAULT SYSDATETIMEOFFSET(),
        suspended_at    DATETIMEOFFSET(0)   NULL
    );
GO

-- The repository owner is the installation account (account_login).
IF OBJECT_ID(N'dbo.GitHubRepositories', N'U') IS NULL
    CREATE TABLE dbo.GitHubRepositories (
        repo_id         BIGINT              NOT NULL CONSTRAINT PK_GitHubRepositories PRIMARY KEY,
        installation_id BIGINT              NOT NULL
            CONSTRAINT FK_GitHubRepositories_Installations REFERENCES dbo.GitHubInstallations (installation_id) ON DELETE CASCADE,
        name            NVARCHAR(100)       NOT NULL,
        default_branch  NVARCHAR(255)       COLLATE Latin1_General_100_BIN2 NOT NULL,
        is_private      BIT                 NOT NULL,
        updated_at      DATETIMEOFFSET(0)   NOT NULL CONSTRAINT DF_GitHubRepositories_UpdatedAt DEFAULT SYSDATETIMEOFFSET()
    );
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_GitHubRepositories_InstallationId' AND object_id = OBJECT_ID(N'dbo.GitHubRepositories'))
    CREATE INDEX IX_GitHubRepositories_InstallationId ON dbo.GitHubRepositories (installation_id);
GO

-- One repository per group; a repository may be linked to several groups.
IF OBJECT_ID(N'dbo.GroupRepositories', N'U') IS NULL
    CREATE TABLE dbo.GroupRepositories (
        gid             UNIQUEIDENTIFIER    NOT NULL
            CONSTRAINT PK_GroupRepositories PRIMARY KEY
            CONSTRAINT FK_GroupRepositories_Groups REFERENCES dbo.Groups (gid) ON DELETE CASCADE,
        repo_id         BIGINT              NOT NULL
            CONSTRAINT FK_GroupRepositories_Repositories REFERENCES dbo.GitHubRepositories (repo_id) ON DELETE CASCADE,
        connected_by    UNIQUEIDENTIFIER    NOT NULL
            CONSTRAINT FK_GroupRepositories_Users REFERENCES dbo.Users (uid),
        connected_at    DATETIMEOFFSET(0)   NOT NULL CONSTRAINT DF_GroupRepositories_ConnectedAt DEFAULT SYSDATETIMEOFFSET()
    );
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_GroupRepositories_RepoId' AND object_id = OBJECT_ID(N'dbo.GroupRepositories'))
    CREATE INDEX IX_GroupRepositories_RepoId ON dbo.GroupRepositories (repo_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_GroupRepositories_ConnectedBy' AND object_id = OBJECT_ID(N'dbo.GroupRepositories'))
    CREATE INDEX IX_GroupRepositories_ConnectedBy ON dbo.GroupRepositories (connected_by);
GO

IF OBJECT_ID(N'dbo.TaskBranches', N'U') IS NULL
    CREATE TABLE dbo.TaskBranches (
        tid             UNIQUEIDENTIFIER    NOT NULL
            CONSTRAINT PK_TaskBranches PRIMARY KEY
            CONSTRAINT FK_TaskBranches_Tasks REFERENCES dbo.Tasks (tid) ON DELETE CASCADE,
        repo_id         BIGINT              NOT NULL
            CONSTRAINT FK_TaskBranches_Repositories REFERENCES dbo.GitHubRepositories (repo_id) ON DELETE CASCADE,
        branch_name     NVARCHAR(255)       COLLATE Latin1_General_100_BIN2 NOT NULL,
        base_sha        CHAR(40)            NOT NULL
            CONSTRAINT CK_TaskBranches_BaseSha CHECK (base_sha NOT LIKE '%[^0-9a-fA-F]%'),
        created_by      UNIQUEIDENTIFIER    NOT NULL
            CONSTRAINT FK_TaskBranches_Users REFERENCES dbo.Users (uid),
        created_at      DATETIMEOFFSET(0)   NOT NULL CONSTRAINT DF_TaskBranches_CreatedAt DEFAULT SYSDATETIMEOFFSET(),
        CONSTRAINT UQ_TaskBranches_Repo_Branch UNIQUE (repo_id, branch_name)
    );
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_TaskBranches_CreatedBy' AND object_id = OBJECT_ID(N'dbo.TaskBranches'))
    CREATE INDEX IX_TaskBranches_CreatedBy ON dbo.TaskBranches (created_by);
GO

-- No FK to TaskBranches: PRs are matched to tasks by (repo_id, head_branch), and a PR can
-- exist before or after the branch row. `state` is derived, never stored.
IF OBJECT_ID(N'dbo.PullRequests', N'U') IS NULL
    CREATE TABLE dbo.PullRequests (
        pr_id           BIGINT              NOT NULL CONSTRAINT PK_PullRequests PRIMARY KEY,
        repo_id         BIGINT              NOT NULL
            CONSTRAINT FK_PullRequests_Repositories REFERENCES dbo.GitHubRepositories (repo_id) ON DELETE CASCADE,
        number          INT                 NOT NULL CONSTRAINT CK_PullRequests_Number CHECK (number > 0),
        head_branch     NVARCHAR(255)       COLLATE Latin1_General_100_BIN2 NOT NULL,
        base_branch     NVARCHAR(255)       COLLATE Latin1_General_100_BIN2 NOT NULL,
        title           NVARCHAR(256)       NOT NULL,
        is_draft        BIT                 NOT NULL CONSTRAINT DF_PullRequests_IsDraft DEFAULT 0,
        opened_at       DATETIMEOFFSET(0)   NOT NULL,
        closed_at       DATETIMEOFFSET(0)   NULL,
        merged_at       DATETIMEOFFSET(0)   NULL,
        gh_updated_at   DATETIMEOFFSET(0)   NOT NULL,
        state           AS (CAST(CASE WHEN merged_at IS NOT NULL THEN 'merged'
                                      WHEN closed_at IS NOT NULL THEN 'closed'
                                      ELSE 'open' END AS VARCHAR(6))),
        CONSTRAINT CK_PullRequests_MergedClosed CHECK (merged_at IS NULL OR closed_at IS NOT NULL),
        CONSTRAINT UQ_PullRequests_Repo_Number UNIQUE (repo_id, number)
    );
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_PullRequests_Repo_HeadBranch' AND object_id = OBJECT_ID(N'dbo.PullRequests'))
    CREATE INDEX IX_PullRequests_Repo_HeadBranch ON dbo.PullRequests (repo_id, head_branch);
GO

-- Delivery log (no FKs on purpose: it records what GitHub sent, even for unknown installations).
IF OBJECT_ID(N'dbo.GitHubWebhookDeliveries', N'U') IS NULL
    CREATE TABLE dbo.GitHubWebhookDeliveries (
        delivery_id     UNIQUEIDENTIFIER    NOT NULL CONSTRAINT PK_GitHubWebhookDeliveries PRIMARY KEY,
        event           VARCHAR(50)         NOT NULL,
        action          VARCHAR(50)         NULL,
        installation_id BIGINT              NULL,
        received_at     DATETIMEOFFSET(0)   NOT NULL CONSTRAINT DF_GitHubWebhookDeliveries_ReceivedAt DEFAULT SYSDATETIMEOFFSET(),
        processed_at    DATETIMEOFFSET(0)   NULL,
        status          VARCHAR(10)         NOT NULL CONSTRAINT DF_GitHubWebhookDeliveries_Status DEFAULT 'processing'
            CONSTRAINT CK_GitHubWebhookDeliveries_Status CHECK (status IN ('processing', 'processed', 'ignored', 'failed')),
        error           NVARCHAR(1000)      NULL,
        CONSTRAINT CK_GitHubWebhookDeliveries_ProcessedAt CHECK (
            (status = 'processing' AND processed_at IS NULL) OR (status <> 'processing' AND processed_at IS NOT NULL))
    );
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_GitHubWebhookDeliveries_ReceivedAt' AND object_id = OBJECT_ID(N'dbo.GitHubWebhookDeliveries'))
    CREATE INDEX IX_GitHubWebhookDeliveries_ReceivedAt ON dbo.GitHubWebhookDeliveries (received_at);
GO

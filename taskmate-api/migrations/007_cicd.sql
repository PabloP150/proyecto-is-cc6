-- 007_cicd: Phase 4 (CI/CD inside TaskMate). The pipeline TaskMate wrote into each repository and
-- the production deploy requests that wait for a group admin. Workflow runs, logs and the deploy
-- history are not copied: GitHub stays the source of truth and TaskMate reads them live.

-- One TaskMate pipeline per repository (groups that share a repository share its workflow file).
-- `spec` is the validated JSON the workflow was rendered from, so the setup screen can reopen it.
IF OBJECT_ID(N'dbo.RepoPipelines', N'U') IS NULL
    CREATE TABLE dbo.RepoPipelines (
        repo_id         BIGINT              NOT NULL
            CONSTRAINT PK_RepoPipelines PRIMARY KEY
            CONSTRAINT FK_RepoPipelines_Repositories REFERENCES dbo.GitHubRepositories (repo_id) ON DELETE CASCADE,
        workflow_path   NVARCHAR(255)       NOT NULL,
        spec            NVARCHAR(4000)      NOT NULL
            CONSTRAINT CK_RepoPipelines_Spec CHECK (ISJSON(spec) = 1),
        commit_sha      CHAR(40)            NOT NULL
            CONSTRAINT CK_RepoPipelines_CommitSha CHECK (commit_sha NOT LIKE '%[^0-9a-fA-F]%'),
        configured_by   UNIQUEIDENTIFIER    NOT NULL
            CONSTRAINT FK_RepoPipelines_Users REFERENCES dbo.Users (uid),
        configured_at   DATETIMEOFFSET(0)   NOT NULL CONSTRAINT DF_RepoPipelines_ConfiguredAt DEFAULT SYSDATETIMEOFFSET()
    );
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_RepoPipelines_ConfiguredBy' AND object_id = OBJECT_ID(N'dbo.RepoPipelines'))
    CREATE INDEX IX_RepoPipelines_ConfiguredBy ON dbo.RepoPipelines (configured_by);
GO

-- A member asks to deploy a version that already passed CI; an admin approves (TaskMate then
-- dispatches the deploy) or rejects it. At most one pending request per group and environment.
IF OBJECT_ID(N'dbo.DeployRequests', N'U') IS NULL
    CREATE TABLE dbo.DeployRequests (
        request_id      UNIQUEIDENTIFIER    NOT NULL
            CONSTRAINT PK_DeployRequests PRIMARY KEY
            CONSTRAINT DF_DeployRequests_RequestId DEFAULT NEWID(),
        gid             UNIQUEIDENTIFIER    NOT NULL
            CONSTRAINT FK_DeployRequests_Groups REFERENCES dbo.Groups (gid) ON DELETE CASCADE,
        repo_id         BIGINT              NOT NULL
            CONSTRAINT FK_DeployRequests_Repositories REFERENCES dbo.GitHubRepositories (repo_id) ON DELETE CASCADE,
        environment     VARCHAR(10)         NOT NULL
            CONSTRAINT CK_DeployRequests_Environment CHECK (environment IN ('staging', 'production')),
        version_sha     CHAR(40)            NOT NULL
            CONSTRAINT CK_DeployRequests_VersionSha CHECK (version_sha NOT LIKE '%[^0-9a-fA-F]%'),
        requested_by    UNIQUEIDENTIFIER    NOT NULL
            CONSTRAINT FK_DeployRequests_RequestedBy REFERENCES dbo.Users (uid),
        requested_at    DATETIMEOFFSET(0)   NOT NULL CONSTRAINT DF_DeployRequests_RequestedAt DEFAULT SYSDATETIMEOFFSET(),
        status          VARCHAR(10)         NOT NULL CONSTRAINT DF_DeployRequests_Status DEFAULT 'pending'
            CONSTRAINT CK_DeployRequests_Status CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
        decided_by      UNIQUEIDENTIFIER    NULL
            CONSTRAINT FK_DeployRequests_DecidedBy REFERENCES dbo.Users (uid),
        decided_at      DATETIMEOFFSET(0)   NULL,
        note            NVARCHAR(500)       NULL,
        CONSTRAINT CK_DeployRequests_Decision CHECK (
            (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL)
            OR (status <> 'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL))
    );
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_DeployRequests_Pending' AND object_id = OBJECT_ID(N'dbo.DeployRequests'))
    CREATE UNIQUE INDEX UX_DeployRequests_Pending ON dbo.DeployRequests (gid, environment) WHERE status = 'pending';
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_DeployRequests_Gid_RequestedAt' AND object_id = OBJECT_ID(N'dbo.DeployRequests'))
    CREATE INDEX IX_DeployRequests_Gid_RequestedAt ON dbo.DeployRequests (gid, requested_at DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_DeployRequests_RepoId' AND object_id = OBJECT_ID(N'dbo.DeployRequests'))
    CREATE INDEX IX_DeployRequests_RepoId ON dbo.DeployRequests (repo_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_DeployRequests_RequestedBy' AND object_id = OBJECT_ID(N'dbo.DeployRequests'))
    CREATE INDEX IX_DeployRequests_RequestedBy ON dbo.DeployRequests (requested_by);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_DeployRequests_DecidedBy' AND object_id = OBJECT_ID(N'dbo.DeployRequests'))
    CREATE INDEX IX_DeployRequests_DecidedBy ON dbo.DeployRequests (decided_by);
GO

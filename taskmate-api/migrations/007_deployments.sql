-- 007_deployments: deployment lifecycle from Vercel (or another provider) reflected in TaskMate.
--
-- The proposal asks for connectivity with Vercel/AWS "mediante APIs y webhooks para monitorear
-- el ciclo de vida del despliegue; esto permitira reflejar automaticamente en la plataforma si
-- una compilacion fue exitosa y alertar sobre fallos en el pipeline".
--
-- Shape mirrors dbo.PullRequests: the provider owns the identity (deployment_id), we own the
-- link to a group, and `state` is stored rather than derived because providers send it directly.

IF OBJECT_ID(N'dbo.Deployments', N'U') IS NULL
    CREATE TABLE dbo.Deployments (
        deployment_id   NVARCHAR(128)       COLLATE Latin1_General_100_BIN2 NOT NULL,
        provider        VARCHAR(20)         NOT NULL
            CONSTRAINT CK_Deployments_Provider CHECK (provider IN ('vercel', 'aws')),
        gid             UNIQUEIDENTIFIER    NOT NULL
            CONSTRAINT FK_Deployments_Groups REFERENCES dbo.Groups (gid) ON DELETE CASCADE,
        -- Nullable: a deployment can arrive before the repository is linked, and the
        -- deployment is still worth recording.
        repo_id         BIGINT              NULL
            CONSTRAINT FK_Deployments_Repositories REFERENCES dbo.GitHubRepositories (repo_id),
        state           VARCHAR(12)         NOT NULL
            CONSTRAINT CK_Deployments_State CHECK (state IN ('queued', 'building', 'ready', 'error', 'canceled')),
        environment     VARCHAR(20)         NOT NULL
            CONSTRAINT DF_Deployments_Environment DEFAULT 'production',
        branch          NVARCHAR(255)       COLLATE Latin1_General_100_BIN2 NULL,
        commit_sha      CHAR(40)            NULL
            CONSTRAINT CK_Deployments_Sha CHECK (commit_sha IS NULL OR commit_sha NOT LIKE '%[^0-9a-fA-F]%'),
        url             NVARCHAR(512)       NULL,
        error_message   NVARCHAR(1024)      NULL,
        created_at      DATETIMEOFFSET(0)   NOT NULL CONSTRAINT DF_Deployments_CreatedAt DEFAULT SYSDATETIMEOFFSET(),
        updated_at      DATETIMEOFFSET(0)   NOT NULL CONSTRAINT DF_Deployments_UpdatedAt DEFAULT SYSDATETIMEOFFSET(),
        -- A deployment id is only unique within its provider.
        CONSTRAINT PK_Deployments PRIMARY KEY (provider, deployment_id)
    );
GO

-- The dashboard query: newest deployments of one group.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Deployments_Gid_CreatedAt' AND object_id = OBJECT_ID(N'dbo.Deployments'))
    CREATE INDEX IX_Deployments_Gid_CreatedAt ON dbo.Deployments (gid, created_at DESC);
GO

-- Delivery log, same purpose as dbo.GitHubWebhookDeliveries: record what the provider sent even
-- when it cannot be routed, and make retries idempotent. No FKs on purpose.
IF OBJECT_ID(N'dbo.DeploymentWebhookDeliveries', N'U') IS NULL
    CREATE TABLE dbo.DeploymentWebhookDeliveries (
        delivery_id     NVARCHAR(128)       COLLATE Latin1_General_100_BIN2 NOT NULL
            CONSTRAINT PK_DeploymentWebhookDeliveries PRIMARY KEY,
        provider        VARCHAR(20)         NOT NULL,
        event           VARCHAR(50)         NOT NULL,
        received_at     DATETIMEOFFSET(0)   NOT NULL CONSTRAINT DF_DeploymentDeliveries_ReceivedAt DEFAULT SYSDATETIMEOFFSET(),
        processed_at    DATETIMEOFFSET(0)   NULL,
        status          VARCHAR(12)         NOT NULL
            CONSTRAINT DF_DeploymentDeliveries_Status DEFAULT 'received'
            CONSTRAINT CK_DeploymentDeliveries_Status CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
        error_message   NVARCHAR(1024)      NULL
    );
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_DeploymentDeliveries_ReceivedAt' AND object_id = OBJECT_ID(N'dbo.DeploymentWebhookDeliveries'))
    CREATE INDEX IX_DeploymentDeliveries_ReceivedAt ON dbo.DeploymentWebhookDeliveries (received_at);
GO

-- Which project on the provider maps to which TaskMate group. Vercel sends a project id, not a
-- repository, so without this a webhook cannot be routed to a group.
IF OBJECT_ID(N'dbo.GroupDeployTargets', N'U') IS NULL
    CREATE TABLE dbo.GroupDeployTargets (
        gid             UNIQUEIDENTIFIER    NOT NULL
            CONSTRAINT FK_GroupDeployTargets_Groups REFERENCES dbo.Groups (gid) ON DELETE CASCADE,
        provider        VARCHAR(20)         NOT NULL
            CONSTRAINT CK_GroupDeployTargets_Provider CHECK (provider IN ('vercel', 'aws')),
        project_ref     NVARCHAR(128)       COLLATE Latin1_General_100_BIN2 NOT NULL,
        connected_by    UNIQUEIDENTIFIER    NOT NULL
            CONSTRAINT FK_GroupDeployTargets_Users REFERENCES dbo.Users (uid),
        created_at      DATETIMEOFFSET(0)   NOT NULL CONSTRAINT DF_GroupDeployTargets_CreatedAt DEFAULT SYSDATETIMEOFFSET(),
        -- One target per provider per group, and a provider project belongs to one group.
        CONSTRAINT PK_GroupDeployTargets PRIMARY KEY (gid, provider),
        CONSTRAINT UQ_GroupDeployTargets_Project UNIQUE (provider, project_ref)
    );
GO

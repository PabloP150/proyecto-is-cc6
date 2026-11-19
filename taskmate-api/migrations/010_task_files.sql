-- 010_task_files: which files each task touched.
--
-- The proposal asks for a task interface with "un listado de los archivos de codigo o
-- documentacion relacionados, incluyendo enlaces directos e interactivos hacia sus
-- respectivas rutas en GitHub".
--
-- Files come from the pull request that closed the task (GET /repos/.../pulls/{n}/files),
-- which is why this hangs off the PR rather than off the branch: the PR file list is the
-- authoritative diff against the base, already deduplicated across commits.
--
-- This also feeds Fase 7 (file-collision detection, 6-20 nov): knowing which files past
-- tasks touched is what makes overlap between active tasks detectable.

IF OBJECT_ID(N'dbo.TaskFiles', N'U') IS NULL
    CREATE TABLE dbo.TaskFiles (
        tid             UNIQUEIDENTIFIER    NOT NULL
            CONSTRAINT FK_TaskFiles_Tasks REFERENCES dbo.Tasks (tid) ON DELETE CASCADE,
        path            NVARCHAR(400)       COLLATE Latin1_General_100_BIN2 NOT NULL,
        status          VARCHAR(10)         NOT NULL
            CONSTRAINT CK_TaskFiles_Status CHECK (status IN ('added', 'modified', 'removed', 'renamed', 'copied', 'changed')),
        additions       INT                 NOT NULL CONSTRAINT DF_TaskFiles_Additions DEFAULT 0,
        deletions       INT                 NOT NULL CONSTRAINT DF_TaskFiles_Deletions DEFAULT 0,
        -- The PR this came from; a task has one branch, so one PR supplies its file list.
        pr_number       INT                 NULL,
        -- Commit the file list was read at, so a stale list is detectable.
        head_sha        CHAR(40)            NULL
            CONSTRAINT CK_TaskFiles_HeadSha CHECK (head_sha IS NULL OR head_sha NOT LIKE '%[^0-9a-fA-F]%'),
        recorded_at     DATETIMEOFFSET(0)   NOT NULL CONSTRAINT DF_TaskFiles_RecordedAt DEFAULT SYSDATETIMEOFFSET(),
        -- NVARCHAR(400) under a BIN2 collation fits in an index key; paths are unique per task.
        CONSTRAINT PK_TaskFiles PRIMARY KEY (tid, path)
    );
GO

-- Fase 7 will ask "which other tasks touch this path?" -- that is this index.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_TaskFiles_Path' AND object_id = OBJECT_ID(N'dbo.TaskFiles'))
    CREATE INDEX IX_TaskFiles_Path ON dbo.TaskFiles (path) INCLUDE (tid, status);
GO

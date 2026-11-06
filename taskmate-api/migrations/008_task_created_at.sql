-- 008_task_created_at: created_at, the moment the task was created, on dbo.Tasks and on the two
-- tables a task moves to (dbo.Complete, dbo.DeleteTask). The task lists sort by it («Creation
-- Date», the default order on /tasks, also in the Completed and Deleted views); until now no table
-- had a creation time and the lists came in whatever order SQL Server returned the rows.
--  (a) The columns, filled by their DEFAULT, so no INSERT has to name them; completeTask and
--      trashTask copy the task's own created_at. The tasks of an AI plan are inserted one after
--      another in the same transaction, faster than SYSDATETIMEOFFSET() ticks, so their
--      created_at can tie: created_seq (an IDENTITY on Tasks, copied into Complete and
--      DeleteTask) breaks the tie in insertion order. Lists sort by created_at, created_seq.
--  (b) Best-effort backfill. Adding a column stamps every existing row with the migration time;
--      a task that was assigned before that was created no later than its first assignment, so
--      it takes TaskAnalytics' earliest assigned_at instead (the facts outlive the task, so this
--      also reaches completed and deleted ones). The rest keep the migration time and fall back
--      to tid order. assigned_at is GETDATE(), the server's local clock without a zone (UTC in
--      the Docker container), so it takes the server's offset.
-- Idempotent: each column is guarded and the backfill only ever moves a time earlier.

IF COL_LENGTH(N'dbo.Tasks', N'created_at') IS NULL
    ALTER TABLE dbo.Tasks ADD created_at DATETIMEOFFSET(7) NOT NULL
        CONSTRAINT DF_Tasks_CreatedAt DEFAULT SYSDATETIMEOFFSET();
IF COL_LENGTH(N'dbo.Complete', N'created_at') IS NULL
    ALTER TABLE dbo.Complete ADD created_at DATETIMEOFFSET(7) NOT NULL
        CONSTRAINT DF_Complete_CreatedAt DEFAULT SYSDATETIMEOFFSET();
IF COL_LENGTH(N'dbo.DeleteTask', N'created_at') IS NULL
    ALTER TABLE dbo.DeleteTask ADD created_at DATETIMEOFFSET(7) NOT NULL
        CONSTRAINT DF_DeleteTask_CreatedAt DEFAULT SYSDATETIMEOFFSET();
-- Existing rows get created_seq in storage order; they are ordered by their backfilled created_at first.
IF COL_LENGTH(N'dbo.Tasks', N'created_seq') IS NULL
    ALTER TABLE dbo.Tasks ADD created_seq BIGINT IDENTITY(1, 1) NOT NULL;
IF COL_LENGTH(N'dbo.Complete', N'created_seq') IS NULL
    ALTER TABLE dbo.Complete ADD created_seq BIGINT NULL;
IF COL_LENGTH(N'dbo.DeleteTask', N'created_seq') IS NULL
    ALTER TABLE dbo.DeleteTask ADD created_seq BIGINT NULL;
GO

UPDATE t
SET t.created_at = fa.first_assigned
FROM dbo.Tasks t
CROSS APPLY (
    SELECT TODATETIMEOFFSET(MIN(ta.assigned_at), DATEPART(TZOFFSET, SYSDATETIMEOFFSET())) AS first_assigned
    FROM dbo.TaskAnalytics ta
    WHERE ta.tid = t.tid
) fa
WHERE fa.first_assigned < t.created_at;

UPDATE c
SET c.created_at = fa.first_assigned
FROM dbo.Complete c
CROSS APPLY (
    SELECT TODATETIMEOFFSET(MIN(ta.assigned_at), DATEPART(TZOFFSET, SYSDATETIMEOFFSET())) AS first_assigned
    FROM dbo.TaskAnalytics ta
    WHERE ta.tid = c.tid
) fa
WHERE fa.first_assigned < c.created_at;

UPDATE d
SET d.created_at = fa.first_assigned
FROM dbo.DeleteTask d
CROSS APPLY (
    SELECT TODATETIMEOFFSET(MIN(ta.assigned_at), DATEPART(TZOFFSET, SYSDATETIMEOFFSET())) AS first_assigned
    FROM dbo.TaskAnalytics ta
    WHERE ta.tid = d.tid
) fa
WHERE fa.first_assigned < d.created_at;
GO

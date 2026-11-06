-- Reverts 008: tasks lose their creation time and insertion sequence in Tasks, Complete and
-- DeleteTask (in each table the default constraint goes first, then the columns).
IF COL_LENGTH(N'dbo.Tasks', N'created_seq') IS NOT NULL
    ALTER TABLE dbo.Tasks DROP COLUMN created_seq;
IF COL_LENGTH(N'dbo.Complete', N'created_seq') IS NOT NULL
    ALTER TABLE dbo.Complete DROP COLUMN created_seq;
IF COL_LENGTH(N'dbo.DeleteTask', N'created_seq') IS NOT NULL
    ALTER TABLE dbo.DeleteTask DROP COLUMN created_seq;
IF OBJECT_ID(N'dbo.DF_Tasks_CreatedAt', N'D') IS NOT NULL
    ALTER TABLE dbo.Tasks DROP CONSTRAINT DF_Tasks_CreatedAt;
IF COL_LENGTH(N'dbo.Tasks', N'created_at') IS NOT NULL
    ALTER TABLE dbo.Tasks DROP COLUMN created_at;
IF OBJECT_ID(N'dbo.DF_Complete_CreatedAt', N'D') IS NOT NULL
    ALTER TABLE dbo.Complete DROP CONSTRAINT DF_Complete_CreatedAt;
IF COL_LENGTH(N'dbo.Complete', N'created_at') IS NOT NULL
    ALTER TABLE dbo.Complete DROP COLUMN created_at;
IF OBJECT_ID(N'dbo.DF_DeleteTask_CreatedAt', N'D') IS NOT NULL
    ALTER TABLE dbo.DeleteTask DROP CONSTRAINT DF_DeleteTask_CreatedAt;
IF COL_LENGTH(N'dbo.DeleteTask', N'created_at') IS NOT NULL
    ALTER TABLE dbo.DeleteTask DROP COLUMN created_at;
GO

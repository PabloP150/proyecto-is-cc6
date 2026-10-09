-- Reverts 008_task_files.
IF OBJECT_ID(N'dbo.TaskFiles', N'U') IS NOT NULL DROP TABLE dbo.TaskFiles;
GO

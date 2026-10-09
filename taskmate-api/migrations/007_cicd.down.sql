-- Reverts 007_cicd (drops the pipeline and deploy request tables and their data).
IF OBJECT_ID(N'dbo.DeployRequests', N'U') IS NOT NULL DROP TABLE dbo.DeployRequests;
IF OBJECT_ID(N'dbo.RepoPipelines', N'U') IS NOT NULL DROP TABLE dbo.RepoPipelines;
GO

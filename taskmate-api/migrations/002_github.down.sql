-- Reverts 002_github (drops the GitHub tables and their data).
IF OBJECT_ID(N'dbo.GitHubWebhookDeliveries', N'U') IS NOT NULL DROP TABLE dbo.GitHubWebhookDeliveries;
IF OBJECT_ID(N'dbo.PullRequests', N'U') IS NOT NULL DROP TABLE dbo.PullRequests;
IF OBJECT_ID(N'dbo.TaskBranches', N'U') IS NOT NULL DROP TABLE dbo.TaskBranches;
IF OBJECT_ID(N'dbo.GroupRepositories', N'U') IS NOT NULL DROP TABLE dbo.GroupRepositories;
IF OBJECT_ID(N'dbo.GitHubRepositories', N'U') IS NOT NULL DROP TABLE dbo.GitHubRepositories;
IF OBJECT_ID(N'dbo.GitHubInstallations', N'U') IS NOT NULL DROP TABLE dbo.GitHubInstallations;
GO

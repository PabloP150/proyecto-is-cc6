-- Reverts 009_deployments (drops the deployment tables and their data).
IF OBJECT_ID(N'dbo.DeploymentWebhookDeliveries', N'U') IS NOT NULL DROP TABLE dbo.DeploymentWebhookDeliveries;
IF OBJECT_ID(N'dbo.Deployments', N'U') IS NOT NULL DROP TABLE dbo.Deployments;
IF OBJECT_ID(N'dbo.GroupDeployTargets', N'U') IS NOT NULL DROP TABLE dbo.GroupDeployTargets;
GO

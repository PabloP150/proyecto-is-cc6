-- Reverts 003_triggers.
DROP TRIGGER IF EXISTS dbo.UpdateTargetOnPrerequisiteChange;
DROP TRIGGER IF EXISTS dbo.UpdateTargetNodePercentage;
GO

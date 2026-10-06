-- Closed by run-migrations.sh after each migration file: records it and commits.
SET NOCOUNT ON;
INSERT INTO dbo.SchemaMigrations (version, name) VALUES ($(MIGRATION_VERSION), N'$(MIGRATION_NAME)');
COMMIT TRANSACTION;
GO

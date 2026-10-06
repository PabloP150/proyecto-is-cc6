-- Bookkeeping table shared by run-migrations.sh and runner.js.
IF OBJECT_ID(N'dbo.SchemaMigrations', N'U') IS NULL
    CREATE TABLE dbo.SchemaMigrations (
        version     INT                 NOT NULL CONSTRAINT PK_SchemaMigrations PRIMARY KEY,
        name        NVARCHAR(200)       NOT NULL,
        applied_at  DATETIMEOFFSET(0)   NOT NULL CONSTRAINT DF_SchemaMigrations_AppliedAt DEFAULT SYSDATETIMEOFFSET()
    );
GO

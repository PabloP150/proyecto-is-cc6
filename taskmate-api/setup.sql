CREATE DATABASE [taskmate-db];
GO

USE [taskmate-db];
GO

CREATE LOGIN sqladmin WITH PASSWORD = '$(DB_PASSWORD)';
GO

CREATE USER sqladmin FOR LOGIN sqladmin;
GO

ALTER ROLE db_owner ADD MEMBER sqladmin;
GO

-- Grant control to the user to allow it to create tables
GRANT CONTROL ON DATABASE::[taskmate-db] TO sqladmin;
GO
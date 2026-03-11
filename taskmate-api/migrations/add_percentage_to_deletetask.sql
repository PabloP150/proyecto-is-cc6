-- Migration: add percentage column to dbo.DeleteTask
ALTER TABLE dbo.DeleteTask
ADD percentage INT NOT NULL DEFAULT 0 CHECK(percentage BETWEEN 0 AND 100);

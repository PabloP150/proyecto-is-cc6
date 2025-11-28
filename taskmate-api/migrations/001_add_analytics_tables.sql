-- Migration: Add Analytics Tables for Task Assignment Recommendations
-- Date: 2025-01-16
-- Description: Creates tables to track task analytics for intelligent assignment recommendations

-- Check if analytics tables already exist before creating
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='TaskAnalytics' AND xtype='U')
BEGIN
    -- Track task assignments and completions for analytics
    CREATE TABLE dbo.TaskAnalytics (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        tid UNIQUEIDENTIFIER NOT NULL,
        uid UNIQUEIDENTIFIER NOT NULL,
        gid UNIQUEIDENTIFIER NOT NULL,
        task_category VARCHAR(50) DEFAULT 'general',
        assigned_at DATETIME2 NOT NULL DEFAULT GETDATE(),
        completed_at DATETIME2 NULL,
        success_status VARCHAR(20) DEFAULT 'pending', -- 'completed', 'failed', 'reassigned', 'pending'
        completion_time_hours DECIMAL(10,2) NULL,
        created_at DATETIME2 DEFAULT GETDATE(),
        FOREIGN KEY (tid) REFERENCES dbo.Tasks(tid) ON DELETE CASCADE,
        FOREIGN KEY (uid) REFERENCES dbo.Users(uid) ON DELETE CASCADE,
        FOREIGN KEY (gid) REFERENCES dbo.Groups(gid) ON DELETE CASCADE,
        -- Add constraints for data validation
        CONSTRAINT CK_TaskAnalytics_SuccessStatus CHECK (success_status IN ('pending', 'completed', 'failed', 'reassigned')),
        CONSTRAINT CK_TaskAnalytics_CompletionTime CHECK (completion_time_hours >= 0),
        CONSTRAINT CK_TaskAnalytics_CompletedAt CHECK (completed_at IS NULL OR completed_at >= assigned_at)
    );
    
    PRINT 'Created TaskAnalytics table with validation constraints';
END
ELSE
BEGIN
    PRINT 'TaskAnalytics table already exists';
END

IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='UserMetrics' AND xtype='U')
BEGIN
    -- Track user workload and capacity metrics (daily aggregates)
    CREATE TABLE dbo.UserMetrics (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        uid UNIQUEIDENTIFIER NOT NULL,
        metric_date DATE NOT NULL,
        active_tasks_count INT DEFAULT 0,
        max_concurrent_tasks INT DEFAULT 0,
        avg_completion_time_hours DECIMAL(10,2) DEFAULT 0,
        success_rate_percentage DECIMAL(5,2) DEFAULT 0,
        updated_at DATETIME2 DEFAULT GETDATE(),
        FOREIGN KEY (uid) REFERENCES dbo.Users(uid) ON DELETE CASCADE,
        CONSTRAINT UQ_UserMetrics_UID_Date UNIQUE(uid, metric_date),
        -- Add constraints for data validation
        CONSTRAINT CK_UserMetrics_ActiveTasks CHECK (active_tasks_count >= 0),
        CONSTRAINT CK_UserMetrics_MaxConcurrent CHECK (max_concurrent_tasks >= 0),
        CONSTRAINT CK_UserMetrics_AvgTime CHECK (avg_completion_time_hours >= 0),
        CONSTRAINT CK_UserMetrics_SuccessRate CHECK (success_rate_percentage >= 0 AND success_rate_percentage <= 100)
    );
    
    PRINT 'Created UserMetrics table with validation constraints';
END
ELSE
BEGIN
    PRINT 'UserMetrics table already exists';
END

IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='UserExpertise' AND xtype='U')
BEGIN
    -- Track expertise scores by category for each user
    CREATE TABLE dbo.UserExpertise (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        uid UNIQUEIDENTIFIER NOT NULL,
        task_category VARCHAR(50) NOT NULL,
        expertise_score DECIMAL(5,2) DEFAULT 0, -- 0-100 score
        tasks_completed INT DEFAULT 0,
        avg_completion_time_hours DECIMAL(10,2) DEFAULT 0,
        success_rate_percentage DECIMAL(5,2) DEFAULT 0,
        last_updated DATETIME2 DEFAULT GETDATE(),
        FOREIGN KEY (uid) REFERENCES dbo.Users(uid) ON DELETE CASCADE,
        CONSTRAINT UQ_UserExpertise_UID_Category UNIQUE(uid, task_category),
        -- Add constraints for data validation
        CONSTRAINT CK_UserExpertise_Score CHECK (expertise_score >= 0 AND expertise_score <= 100),
        CONSTRAINT CK_UserExpertise_TasksCompleted CHECK (tasks_completed >= 0),
        CONSTRAINT CK_UserExpertise_AvgTime CHECK (avg_completion_time_hours >= 0),
        CONSTRAINT CK_UserExpertise_SuccessRate CHECK (success_rate_percentage >= 0 AND success_rate_percentage <= 100),
        CONSTRAINT CK_UserExpertise_Category CHECK (task_category IN ('frontend', 'backend', 'database', 'testing', 'general'))
    );
    
    PRINT 'Created UserExpertise table with validation constraints';
END
ELSE
BEGIN
    PRINT 'UserExpertise table already exists';
END

-- Create indexes for better query performance
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_TaskAnalytics_UID_Status')
BEGIN
    CREATE INDEX IX_TaskAnalytics_UID_Status ON dbo.TaskAnalytics(uid, success_status);
    PRINT 'Created index IX_TaskAnalytics_UID_Status';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_TaskAnalytics_GID_Category')
BEGIN
    CREATE INDEX IX_TaskAnalytics_GID_Category ON dbo.TaskAnalytics(gid, task_category);
    PRINT 'Created index IX_TaskAnalytics_GID_Category';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_TaskAnalytics_AssignedAt')
BEGIN
    CREATE INDEX IX_TaskAnalytics_AssignedAt ON dbo.TaskAnalytics(assigned_at);
    PRINT 'Created index IX_TaskAnalytics_AssignedAt';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_TaskAnalytics_TID')
BEGIN
    CREATE INDEX IX_TaskAnalytics_TID ON dbo.TaskAnalytics(tid);
    PRINT 'Created index IX_TaskAnalytics_TID';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_TaskAnalytics_CompletedAt')
BEGIN
    CREATE INDEX IX_TaskAnalytics_CompletedAt ON dbo.TaskAnalytics(completed_at) WHERE completed_at IS NOT NULL;
    PRINT 'Created index IX_TaskAnalytics_CompletedAt';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_UserMetrics_UID_Date')
BEGIN
    CREATE INDEX IX_UserMetrics_UID_Date ON dbo.UserMetrics(uid, metric_date);
    PRINT 'Created index IX_UserMetrics_UID_Date';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_UserMetrics_Date')
BEGIN
    CREATE INDEX IX_UserMetrics_Date ON dbo.UserMetrics(metric_date);
    PRINT 'Created index IX_UserMetrics_Date';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_UserExpertise_UID_Category')
BEGIN
    CREATE INDEX IX_UserExpertise_UID_Category ON dbo.UserExpertise(uid, task_category);
    PRINT 'Created index IX_UserExpertise_UID_Category';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_UserExpertise_Category')
BEGIN
    CREATE INDEX IX_UserExpertise_Category ON dbo.UserExpertise(task_category);
    PRINT 'Created index IX_UserExpertise_Category';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_UserExpertise_Score')
BEGIN
    CREATE INDEX IX_UserExpertise_Score ON dbo.UserExpertise(expertise_score DESC);
    PRINT 'Created index IX_UserExpertise_Score';
END

PRINT 'Analytics tables migration completed successfully';
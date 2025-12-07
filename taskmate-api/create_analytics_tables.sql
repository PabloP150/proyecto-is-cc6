-- Create Analytics Tables for TaskMate
-- These tables support the analytics dashboard functionality

-- TaskAnalytics table - tracks task assignments and completions
CREATE TABLE dbo.TaskAnalytics (
    id UNIQUEIDENTIFIER PRIMARY KEY,
    tid UNIQUEIDENTIFIER NOT NULL,
    uid UNIQUEIDENTIFIER NOT NULL,
    gid UNIQUEIDENTIFIER NOT NULL,
    task_category NVARCHAR(50) NOT NULL,
    assigned_at DATETIME2 NOT NULL,
    completed_at DATETIME2 NULL,
    success_status NVARCHAR(20) NOT NULL DEFAULT 'pending',
    completion_time_hours DECIMAL(10,2) NULL,
    FOREIGN KEY (tid) REFERENCES dbo.Tasks(tid),
    FOREIGN KEY (uid) REFERENCES dbo.Users(uid),
    FOREIGN KEY (gid) REFERENCES dbo.Groups(gid)
);

-- UserExpertise table - tracks user expertise scores by task category
CREATE TABLE dbo.UserExpertise (
    id UNIQUEIDENTIFIER PRIMARY KEY,
    uid UNIQUEIDENTIFIER NOT NULL,
    task_category NVARCHAR(50) NOT NULL,
    expertise_score DECIMAL(5,2) NOT NULL DEFAULT 0.0,
    tasks_completed INT NOT NULL DEFAULT 0,
    avg_completion_time_hours DECIMAL(10,2) NOT NULL DEFAULT 0.0,
    success_rate_percentage DECIMAL(5,2) NOT NULL DEFAULT 0.0,
    FOREIGN KEY (uid) REFERENCES dbo.Users(uid),
    UNIQUE(uid, task_category)
);

-- UserMetrics table - tracks daily user workload and capacity metrics
CREATE TABLE dbo.UserMetrics (
    id UNIQUEIDENTIFIER PRIMARY KEY,
    uid UNIQUEIDENTIFIER NOT NULL,
    metric_date DATE NOT NULL,
    active_tasks_count INT NOT NULL DEFAULT 0,
    max_concurrent_tasks INT NOT NULL DEFAULT 0,
    avg_completion_time_hours DECIMAL(10,2) NOT NULL DEFAULT 0.0,
    success_rate_percentage DECIMAL(5,2) NOT NULL DEFAULT 0.0,
    FOREIGN KEY (uid) REFERENCES dbo.Users(uid),
    UNIQUE(uid, metric_date)
);

-- Create indexes for better performance
CREATE INDEX IX_TaskAnalytics_uid ON dbo.TaskAnalytics(uid);
CREATE INDEX IX_TaskAnalytics_gid ON dbo.TaskAnalytics(gid);
CREATE INDEX IX_TaskAnalytics_assigned_at ON dbo.TaskAnalytics(assigned_at);
CREATE INDEX IX_TaskAnalytics_task_category ON dbo.TaskAnalytics(task_category);

CREATE INDEX IX_UserExpertise_uid ON dbo.UserExpertise(uid);
CREATE INDEX IX_UserExpertise_task_category ON dbo.UserExpertise(task_category);

CREATE INDEX IX_UserMetrics_uid ON dbo.UserMetrics(uid);
CREATE INDEX IX_UserMetrics_metric_date ON dbo.UserMetrics(metric_date);

PRINT 'Analytics tables created successfully!';
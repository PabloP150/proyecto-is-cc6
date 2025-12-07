-- Insert user expertise data with proper UUID handling
INSERT INTO dbo.UserExpertise (id, uid, task_category, expertise_score, tasks_completed, avg_completion_time_hours, success_rate_percentage) VALUES
-- Sarah Chen (Development Team Leader)
(NEWID(), CAST('11111111-1111-1111-1111-111111111111' AS UNIQUEIDENTIFIER), 'backend', 87.0, 12, 5.1, 91.7),

-- Marcus Johnson (Senior Developer)
(NEWID(), CAST('22222222-2222-2222-2222-222222222222' AS UNIQUEIDENTIFIER), 'backend', 89.0, 18, 4.8, 94.4),
(NEWID(), CAST('22222222-2222-2222-2222-222222222222' AS UNIQUEIDENTIFIER), 'database', 85.0, 10, 6.2, 90.0),

-- Elena Rodriguez (Senior Developer)
(NEWID(), CAST('33333333-3333-3333-3333-333333333333' AS UNIQUEIDENTIFIER), 'database', 91.0, 14, 5.5, 92.9),
(NEWID(), CAST('33333333-3333-3333-3333-333333333333' AS UNIQUEIDENTIFIER), 'backend', 83.0, 11, 5.8, 90.9),

-- David Kim (Developer)
(NEWID(), CAST('44444444-4444-4444-4444-444444444444' AS UNIQUEIDENTIFIER), 'testing', 86.0, 16, 3.9, 93.8),
(NEWID(), CAST('44444444-4444-4444-4444-444444444444' AS UNIQUEIDENTIFIER), 'frontend', 78.0, 8, 6.1, 87.5),

-- Maya Patel (Design Lead)
(NEWID(), CAST('66666666-6666-6666-6666-666666666666' AS UNIQUEIDENTIFIER), 'general', 96.0, 20, 3.2, 95.0),

-- Lisa Wang (QA Lead)
(NEWID(), CAST('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AS UNIQUEIDENTIFIER), 'testing', 93.0, 22, 4.1, 95.5);

-- Insert user metrics for recent dates
INSERT INTO dbo.UserMetrics (id, uid, metric_date, active_tasks_count, max_concurrent_tasks, avg_completion_time_hours, success_rate_percentage) VALUES
-- Recent metrics for key users
(NEWID(), CAST('11111111-1111-1111-1111-111111111111' AS UNIQUEIDENTIFIER), '2024-12-05', 4, 5, 4.2, 93.3),
(NEWID(), CAST('22222222-2222-2222-2222-222222222222' AS UNIQUEIDENTIFIER), '2024-12-05', 3, 5, 4.8, 94.4),
(NEWID(), CAST('33333333-3333-3333-3333-333333333333' AS UNIQUEIDENTIFIER), '2024-12-05', 5, 6, 5.5, 92.9),
(NEWID(), CAST('66666666-6666-6666-6666-666666666666' AS UNIQUEIDENTIFIER), '2024-12-05', 3, 4, 3.2, 95.0),
(NEWID(), CAST('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AS UNIQUEIDENTIFIER), '2024-12-05', 4, 5, 4.1, 95.5);

PRINT 'User analytics data inserted successfully!';
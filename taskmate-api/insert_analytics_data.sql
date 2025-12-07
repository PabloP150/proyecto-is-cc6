-- Insert sample analytics data
INSERT INTO dbo.TaskAnalytics (id, tid, uid, gid, task_category, assigned_at, completed_at, success_status, completion_time_hours) VALUES
('ta111111-1111-1111-1111-111111111111', 't5555555-5555-5555-5555-555555555555', '77777777-7777-7777-7777-777777777777', '00000000-0000-0000-0000-000000000789', 'general', '2024-12-03 09:00:00', '2024-12-03 16:00:00', 'completed', 7.0),
('ta222222-2222-2222-2222-222222222222', 't1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000456', 'backend', '2024-12-04 10:00:00', NULL, 'pending', NULL),
('ta333333-3333-3333-3333-333333333333', 't3333333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000456', 'frontend', '2024-12-04 14:00:00', NULL, 'pending', NULL);

-- Insert user expertise data
INSERT INTO dbo.UserExpertise (id, uid, task_category, expertise_score, tasks_completed, avg_completion_time_hours, success_rate_percentage) VALUES
-- Sarah Chen (Development Team Leader)
('ue111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'frontend', 94.0, 15, 4.2, 93.3),
('ue111112-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'backend', 87.0, 12, 5.1, 91.7),

-- Marcus Johnson (Senior Developer)
('ue222221-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'backend', 89.0, 18, 4.8, 94.4),
('ue222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'database', 85.0, 10, 6.2, 90.0),

-- Elena Rodriguez (Senior Developer)
('ue333331-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', 'database', 91.0, 14, 5.5, 92.9),
('ue333332-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', 'backend', 83.0, 11, 5.8, 90.9),

-- David Kim (Developer)
('ue444441-4444-4444-4444-444444444444', '44444444-4444-4444-4444-444444444444', 'testing', 86.0, 16, 3.9, 93.8),
('ue444442-4444-4444-4444-444444444444', '44444444-4444-4444-4444-444444444444', 'frontend', 78.0, 8, 6.1, 87.5),

-- Maya Patel (Design Lead)
('ue666661-6666-6666-6666-666666666666', '66666666-6666-6666-6666-666666666666', 'general', 96.0, 20, 3.2, 95.0),

-- Lisa Wang (QA Lead)
('ueaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'testing', 93.0, 22, 4.1, 95.5);

-- Insert user metrics for recent dates
INSERT INTO dbo.UserMetrics (id, uid, metric_date, active_tasks_count, max_concurrent_tasks, avg_completion_time_hours, success_rate_percentage) VALUES
-- Recent metrics for key users
('um111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', '2024-12-05', 4, 5, 4.2, 93.3),
('um222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', '2024-12-05', 3, 5, 4.8, 94.4),
('um333333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', '2024-12-05', 5, 6, 5.5, 92.9),
('um666666-6666-6666-6666-666666666666', '66666666-6666-6666-6666-666666666666', '2024-12-05', 3, 4, 3.2, 95.0),
('umaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2024-12-05', 4, 5, 4.1, 95.5);

PRINT 'Analytics data inserted successfully!';
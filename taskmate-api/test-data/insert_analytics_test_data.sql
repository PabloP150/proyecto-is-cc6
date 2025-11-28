-- Test data for Analytics Agent testing
-- Run this script to populate analytics tables with sample data

-- Sample test users (assuming these exist in Users table)
-- User IDs for testing - replace with actual UUIDs from your Users table
DECLARE @user1 UNIQUEIDENTIFIER = '11111111-1111-1111-1111-111111111111';
DECLARE @user2 UNIQUEIDENTIFIER = '22222222-2222-2222-2222-222222222222';
DECLARE @user3 UNIQUEIDENTIFIER = '33333333-3333-3333-3333-333333333333';
DECLARE @group1 UNIQUEIDENTIFIER = '44444444-4444-4444-4444-444444444444';

-- Clear existing test data
DELETE FROM dbo.TaskAnalytics WHERE gid = @group1;
DELETE FROM dbo.UserMetrics WHERE uid IN (@user1, @user2, @user3);
DELETE FROM dbo.UserExpertise WHERE uid IN (@user1, @user2, @user3);

-- Insert UserExpertise test data
-- User 1: Frontend expert, good at UI work
INSERT INTO dbo.UserExpertise (uid, task_category, expertise_score, tasks_completed, avg_completion_time_hours, success_rate_percentage) VALUES
(@user1, 'frontend', 85.0, 12, 3.5, 92.0),
(@user1, 'backend', 45.0, 3, 8.0, 67.0),
(@user1, 'testing', 60.0, 5, 4.0, 80.0),
(@user1, 'general', 70.0, 8, 4.5, 88.0);

-- User 2: Backend specialist, reliable but slower
INSERT INTO dbo.UserExpertise (uid, task_category, expertise_score, tasks_completed, avg_completion_time_hours, success_rate_percentage) VALUES
(@user2, 'frontend', 30.0, 2, 12.0, 50.0),
(@user2, 'backend', 90.0, 15, 5.0, 95.0),
(@user2, 'database', 88.0, 10, 4.5, 90.0),
(@user2, 'testing', 75.0, 8, 3.0, 88.0),
(@user2, 'general', 65.0, 6, 6.0, 83.0);

-- User 3: Balanced generalist, moderate capacity
INSERT INTO dbo.UserExpertise (uid, task_category, expertise_score, tasks_completed, avg_completion_time_hours, success_rate_percentage) VALUES
(@user3, 'frontend', 65.0, 8, 5.0, 75.0),
(@user3, 'backend', 70.0, 9, 6.0, 78.0),
(@user3, 'database', 55.0, 4, 7.0, 75.0),
(@user3, 'testing', 80.0, 12, 3.5, 92.0),
(@user3, 'general', 72.0, 10, 4.8, 80.0);

-- Insert UserMetrics test data (recent daily metrics)
INSERT INTO dbo.UserMetrics (uid, metric_date, active_tasks_count, max_concurrent_tasks, avg_completion_time_hours, success_rate_percentage) VALUES
-- User 1: Currently busy (4 active tasks, max capacity 6)
(@user1, '2025-01-16', 4, 6, 4.2, 88.0),
(@user1, '2025-01-15', 3, 5, 3.8, 90.0),
(@user1, '2025-01-14', 2, 4, 4.0, 85.0),

-- User 2: Moderate load (2 active tasks, high capacity 8)
(@user2, '2025-01-16', 2, 8, 5.5, 92.0),
(@user2, '2025-01-15', 3, 7, 5.2, 94.0),
(@user2, '2025-01-14', 4, 8, 4.8, 91.0),

-- User 3: Light load (1 active task, moderate capacity 5)
(@user3, '2025-01-16', 1, 5, 4.5, 78.0),
(@user3, '2025-01-15', 2, 4, 5.0, 80.0),
(@user3, '2025-01-14', 3, 5, 4.2, 82.0);

-- Insert some TaskAnalytics records to simulate current active tasks
INSERT INTO dbo.TaskAnalytics (tid, uid, gid, task_category, assigned_at, success_status) VALUES
-- User 1 active tasks (4 tasks - at high load)
(NEWID(), @user1, @group1, 'frontend', DATEADD(day, -2, GETDATE()), 'pending'),
(NEWID(), @user1, @group1, 'frontend', DATEADD(day, -1, GETDATE()), 'pending'),
(NEWID(), @user1, @group1, 'testing', DATEADD(hour, -8, GETDATE()), 'pending'),
(NEWID(), @user1, @group1, 'general', DATEADD(hour, -4, GETDATE()), 'pending'),

-- User 2 active tasks (2 tasks - moderate load)
(NEWID(), @user2, @group1, 'backend', DATEADD(day, -1, GETDATE()), 'pending'),
(NEWID(), @user2, @group1, 'database', DATEADD(hour, -6, GETDATE()), 'pending'),

-- User 3 active tasks (1 task - light load)
(NEWID(), @user3, @group1, 'testing', DATEADD(hour, -3, GETDATE()), 'pending');

-- Insert some completed tasks for history
INSERT INTO dbo.TaskAnalytics (tid, uid, gid, task_category, assigned_at, completed_at, success_status, completion_time_hours) VALUES
-- Recent completions to show patterns
(NEWID(), @user1, @group1, 'frontend', DATEADD(day, -3, GETDATE()), DATEADD(day, -2, GETDATE()), 'completed', 4.0),
(NEWID(), @user1, @group1, 'frontend', DATEADD(day, -4, GETDATE()), DATEADD(day, -3, GETDATE()), 'completed', 3.0),
(NEWID(), @user2, @group1, 'backend', DATEADD(day, -5, GETDATE()), DATEADD(day, -4, GETDATE()), 'completed', 5.5),
(NEWID(), @user2, @group1, 'backend', DATEADD(day, -6, GETDATE()), DATEADD(day, -5, GETDATE()), 'completed', 4.5),
(NEWID(), @user3, @group1, 'testing', DATEADD(day, -2, GETDATE()), DATEADD(day, -1, GETDATE()), 'completed', 3.5);

PRINT 'Test data inserted successfully!';
PRINT 'User 1 (Frontend Expert): 4 active tasks, capacity 6 - HIGH LOAD';
PRINT 'User 2 (Backend Expert): 2 active tasks, capacity 8 - MODERATE LOAD'; 
PRINT 'User 3 (Testing Expert): 1 active task, capacity 5 - LIGHT LOAD';

-- Query to verify the test data
SELECT 'Current Workloads' as Info;
SELECT 
    ta.uid,
    COUNT(*) as active_tasks,
    um.max_concurrent_tasks as capacity
FROM dbo.TaskAnalytics ta
LEFT JOIN dbo.UserMetrics um ON ta.uid = um.uid AND um.metric_date = '2025-01-16'
WHERE ta.success_status = 'pending' AND ta.gid = @group1
GROUP BY ta.uid, um.max_concurrent_tasks
ORDER BY active_tasks DESC;
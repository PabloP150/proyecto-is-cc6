-- Insert sample users for analytics dashboard testing
-- These users match the mock data used in the analytics controller

-- First, let's insert some test users
INSERT INTO dbo.Users (uid, username, password) VALUES
-- Development Team users
('11111111-1111-1111-1111-111111111111', 'sarah.chen', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'), -- password: password
('22222222-2222-2222-2222-222222222222', 'marcus.johnson', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'), -- password: password
('33333333-3333-3333-3333-333333333333', 'elena.rodriguez', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'), -- password: password
('44444444-4444-4444-4444-444444444444', 'david.kim', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'), -- password: password
('55555555-5555-5555-5555-555555555555', 'alex.thompson', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'), -- password: password

-- Design Team users
('66666666-6666-6666-6666-666666666666', 'maya.patel', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'), -- password: password
('77777777-7777-7777-7777-777777777777', 'james.wilson', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'), -- password: password
('88888888-8888-8888-8888-888888888888', 'zoe.martinez', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'), -- password: password
('99999999-9999-9999-9999-999999999999', 'ryan.foster', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'), -- password: password

-- QA Team users
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'lisa.wang', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'), -- password: password
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'tom.anderson', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'), -- password: password
('cccccccc-cccc-cccc-cccc-cccccccccccc', 'priya.sharma', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'), -- password: password
('dddddddd-dddd-dddd-dddd-dddddddddddd', 'jake.miller', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'), -- password: password
('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'nina.kowalski', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'), -- password: password
('ffffffff-ffff-ffff-ffff-ffffffffffff', 'carlos.mendez', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'); -- password: password

-- Create test groups
INSERT INTO dbo.Groups (gid, adminId, name) VALUES
('00000000-0000-0000-0000-000000000456', '11111111-1111-1111-1111-111111111111', 'Development Team'), -- Sarah Chen as admin
('00000000-0000-0000-0000-000000000789', '66666666-6666-6666-6666-666666666666', 'Design Team'), -- Maya Patel as admin
('00000000-0000-0000-0000-000000000123', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'QA Team'); -- Lisa Wang as admin

-- Add users to their respective groups
-- Development Team
INSERT INTO dbo.UserGroups (uid, gid) VALUES
('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000456'),
('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000456'),
('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000456'),
('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000456'),
('55555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000456'),

-- Design Team
('66666666-6666-6666-6666-666666666666', '00000000-0000-0000-0000-000000000789'),
('77777777-7777-7777-7777-777777777777', '00000000-0000-0000-0000-000000000789'),
('88888888-8888-8888-8888-888888888888', '00000000-0000-0000-0000-000000000789'),
('99999999-9999-9999-9999-999999999999', '00000000-0000-0000-0000-000000000789'),

-- QA Team
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000123'),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '00000000-0000-0000-0000-000000000123'),
('cccccccc-cccc-cccc-cccc-cccccccccccc', '00000000-0000-0000-0000-000000000123'),
('dddddddd-dddd-dddd-dddd-dddddddddddd', '00000000-0000-0000-0000-000000000123'),
('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '00000000-0000-0000-0000-000000000123'),
('ffffffff-ffff-ffff-ffff-ffffffffffff', '00000000-0000-0000-0000-000000000123');

-- Create some group roles
INSERT INTO dbo.GroupRoles (gr_id, gid, gr_name, gr_color, gr_icon) VALUES
-- Development Team roles
('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000456', 'Team Leader', '#FF6B6B', 'crown'),
('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000456', 'Senior Developer', '#4ECDC4', 'star'),
('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000456', 'Developer', '#45B7D1', 'code'),

-- Design Team roles
('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000789', 'Design Lead', '#FF6B6B', 'crown'),
('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000789', 'Senior Designer', '#4ECDC4', 'star'),
('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000789', 'Designer', '#45B7D1', 'palette'),

-- QA Team roles
('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000123', 'QA Lead', '#FF6B6B', 'crown'),
('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000123', 'Senior QA', '#4ECDC4', 'star'),
('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000123', 'QA Tester', '#45B7D1', 'check');

-- Assign roles to users
INSERT INTO dbo.UserGroupRoles (ugr_id, uid, gid, gr_id) VALUES
-- Development Team
('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000456', '10000000-0000-0000-0000-000000000001'), -- Sarah Chen - Team Leader
('a0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000456', '10000000-0000-0000-0000-000000000002'), -- Marcus Johnson - Senior Developer
('a0000000-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000456', '10000000-0000-0000-0000-000000000002'), -- Elena Rodriguez - Senior Developer
('a0000000-0000-0000-0000-000000000004', '44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000456', '10000000-0000-0000-0000-000000000003'), -- David Kim - Developer
('a0000000-0000-0000-0000-000000000005', '55555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000456', '10000000-0000-0000-0000-000000000003'), -- Alex Thompson - Developer

-- Design Team
('b0000000-0000-0000-0000-000000000001', '66666666-6666-6666-6666-666666666666', '00000000-0000-0000-0000-000000000789', '20000000-0000-0000-0000-000000000001'), -- Maya Patel - Design Lead
('b0000000-0000-0000-0000-000000000002', '77777777-7777-7777-7777-777777777777', '00000000-0000-0000-0000-000000000789', '20000000-0000-0000-0000-000000000002'), -- James Wilson - Senior Designer
('b0000000-0000-0000-0000-000000000003', '88888888-8888-8888-8888-888888888888', '00000000-0000-0000-0000-000000000789', '20000000-0000-0000-0000-000000000002'), -- Zoe Martinez - Senior Designer
('b0000000-0000-0000-0000-000000000004', '99999999-9999-9999-9999-999999999999', '00000000-0000-0000-0000-000000000789', '20000000-0000-0000-0000-000000000003'), -- Ryan Foster - Designer

-- QA Team
('c0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000123', '30000000-0000-0000-0000-000000000001'), -- Lisa Wang - QA Lead
('c0000000-0000-0000-0000-000000000002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '00000000-0000-0000-0000-000000000123', '30000000-0000-0000-0000-000000000002'), -- Tom Anderson - Senior QA
('c0000000-0000-0000-0000-000000000003', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '00000000-0000-0000-0000-000000000123', '30000000-0000-0000-0000-000000000002'), -- Priya Sharma - Senior QA
('c0000000-0000-0000-0000-000000000004', 'dddddddd-dddd-dddd-dddd-dddddddddddd', '00000000-0000-0000-0000-000000000123', '30000000-0000-0000-0000-000000000003'), -- Jake Miller - QA Tester
('c0000000-0000-0000-0000-000000000005', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '00000000-0000-0000-0000-000000000123', '30000000-0000-0000-0000-000000000003'), -- Nina Kowalski - QA Tester
('c0000000-0000-0000-0000-000000000006', 'ffffffff-ffff-ffff-ffff-ffffffffffff', '00000000-0000-0000-0000-000000000123', '30000000-0000-0000-0000-000000000003'); -- Carlos Mendez - QA Tester

-- Insert some sample tasks for each group
INSERT INTO dbo.Tasks (tid, gid, name, description, list, datetime, percentage) VALUES
-- Development Team tasks
('t1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000456', 'API Refactoring', 'Refactor user authentication API', 'In Progress', '2024-12-05 10:00:00', 75),
('t2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000456', 'Database Migration', 'Migrate user data to new schema', 'To Do', '2024-12-06 09:00:00', 0),
('t3333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000456', 'Frontend Components', 'Build reusable UI components', 'In Progress', '2024-12-04 14:00:00', 60),

-- Design Team tasks
('t4444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000789', 'UI Mockups', 'Create mockups for new dashboard', 'In Progress', '2024-12-05 11:00:00', 80),
('t5555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000789', 'User Research', 'Conduct user interviews', 'Done', '2024-12-03 16:00:00', 100),

-- QA Team tasks
('t6666666-6666-6666-6666-666666666666', '00000000-0000-0000-0000-000000000123', 'Test Automation', 'Write automated tests for API', 'In Progress', '2024-12-05 13:00:00', 45),
('t7777777-7777-7777-7777-777777777777', '00000000-0000-0000-0000-000000000123', 'Performance Testing', 'Load test the application', 'To Do', '2024-12-07 10:00:00', 0);

-- Assign tasks to users
INSERT INTO dbo.UserTask (utid, uid, tid, completed) VALUES
-- Development Team task assignments
('ut111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 't1111111-1111-1111-1111-111111111111', 0), -- Sarah Chen - API Refactoring
('ut222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 't2222222-2222-2222-2222-222222222222', 0), -- Marcus Johnson - Database Migration
('ut333333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', 't3333333-3333-3333-3333-333333333333', 0), -- Elena Rodriguez - Frontend Components

-- Design Team task assignments
('ut444444-4444-4444-4444-444444444444', '66666666-6666-6666-6666-666666666666', 't4444444-4444-4444-4444-444444444444', 0), -- Maya Patel - UI Mockups
('ut555555-5555-5555-5555-555555555555', '77777777-7777-7777-7777-777777777777', 't5555555-5555-5555-5555-555555555555', 1), -- James Wilson - User Research

-- QA Team task assignments
('ut666666-6666-6666-6666-666666666666', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 't6666666-6666-6666-6666-666666666666', 0), -- Lisa Wang - Test Automation
('ut777777-7777-7777-7777-777777777777', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 't7777777-7777-7777-7777-777777777777', 0); -- Tom Anderson - Performance Testing

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

-- Verification queries (commented out - uncomment to run)
/*
SELECT 'Users' as TableName, COUNT(*) as RecordCount FROM dbo.Users
UNION ALL
SELECT 'Groups', COUNT(*) FROM dbo.Groups
UNION ALL
SELECT 'UserGroups', COUNT(*) FROM dbo.UserGroups
UNION ALL
SELECT 'GroupRoles', COUNT(*) FROM dbo.GroupRoles
UNION ALL
SELECT 'UserGroupRoles', COUNT(*) FROM dbo.UserGroupRoles
UNION ALL
SELECT 'Tasks', COUNT(*) FROM dbo.Tasks
UNION ALL
SELECT 'UserTask', COUNT(*) FROM dbo.UserTask
UNION ALL
SELECT 'TaskAnalytics', COUNT(*) FROM dbo.TaskAnalytics
UNION ALL
SELECT 'UserExpertise', COUNT(*) FROM dbo.UserExpertise
UNION ALL
SELECT 'UserMetrics', COUNT(*) FROM dbo.UserMetrics;

-- Check the created groups and their IDs
SELECT g.gid, g.name, u.username as admin_username
FROM dbo.Groups g
JOIN dbo.Users u ON g.adminId = u.uid;

-- Check users in each group
SELECT g.name as group_name, u.username, gr.gr_name as role_name
FROM dbo.Groups g
JOIN dbo.UserGroups ug ON g.gid = ug.gid
JOIN dbo.Users u ON ug.uid = u.uid
LEFT JOIN dbo.UserGroupRoles ugr ON u.uid = ugr.uid AND g.gid = ugr.gid
LEFT JOIN dbo.GroupRoles gr ON ugr.gr_id = gr.gr_id
ORDER BY g.name, gr.gr_name, u.username;
*/
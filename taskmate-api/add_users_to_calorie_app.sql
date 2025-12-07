-- Add all users to Calorie Tracker App group with appropriate roles
DECLARE @CalorieAppGroupId UNIQUEIDENTIFIER = '05beecb1-aff3-4813-8bac-d68b1d82f8e4';

-- First, create role types for the Calorie Tracker App group
INSERT INTO dbo.GroupRoles (gr_id, gid, gr_name, gr_color, gr_icon) VALUES
(NEWID(), @CalorieAppGroupId, 'Frontend Developer', '#61DAFB', 'code'),
(NEWID(), @CalorieAppGroupId, 'Backend Developer', '#68D391', 'server'),
(NEWID(), @CalorieAppGroupId, 'QA Engineer', '#F6AD55', 'check'),
(NEWID(), @CalorieAppGroupId, 'UI/UX Designer', '#ED64A6', 'palette'),
(NEWID(), @CalorieAppGroupId, 'DevOps Engineer', '#9F7AEA', 'settings'),
(NEWID(), @CalorieAppGroupId, 'Product Manager', '#4299E1', 'briefcase');

-- Get the role IDs we just created
DECLARE @FrontendRoleId UNIQUEIDENTIFIER = (SELECT gr_id FROM dbo.GroupRoles WHERE gid = @CalorieAppGroupId AND gr_name = 'Frontend Developer');
DECLARE @BackendRoleId UNIQUEIDENTIFIER = (SELECT gr_id FROM dbo.GroupRoles WHERE gid = @CalorieAppGroupId AND gr_name = 'Backend Developer');
DECLARE @QARoleId UNIQUEIDENTIFIER = (SELECT gr_id FROM dbo.GroupRoles WHERE gid = @CalorieAppGroupId AND gr_name = 'QA Engineer');
DECLARE @DesignerRoleId UNIQUEIDENTIFIER = (SELECT gr_id FROM dbo.GroupRoles WHERE gid = @CalorieAppGroupId AND gr_name = 'UI/UX Designer');
DECLARE @DevOpsRoleId UNIQUEIDENTIFIER = (SELECT gr_id FROM dbo.GroupRoles WHERE gid = @CalorieAppGroupId AND gr_name = 'DevOps Engineer');
DECLARE @PMRoleId UNIQUEIDENTIFIER = (SELECT gr_id FROM dbo.GroupRoles WHERE gid = @CalorieAppGroupId AND gr_name = 'Product Manager');

-- Add all users to the Calorie Tracker App group
INSERT INTO dbo.UserGroups (uid, gid)
SELECT u.uid, @CalorieAppGroupId
FROM dbo.Users u
WHERE u.uid NOT IN (
    SELECT ug.uid 
    FROM dbo.UserGroups ug 
    WHERE ug.gid = @CalorieAppGroupId
);

-- Assign roles to users based on their expertise/background
-- Sarah Chen - Frontend Developer (Team Leader background)
INSERT INTO dbo.UserGroupRoles (ugr_id, uid, gid, gr_id) VALUES
(NEWID(), '11111111-1111-1111-1111-111111111111', @CalorieAppGroupId, @FrontendRoleId);

-- Marcus Johnson - Backend Developer (Senior Developer background)
INSERT INTO dbo.UserGroupRoles (ugr_id, uid, gid, gr_id) VALUES
(NEWID(), '22222222-2222-2222-2222-222222222222', @CalorieAppGroupId, @BackendRoleId);

-- Elena Rodriguez - Backend Developer (Senior Developer background)
INSERT INTO dbo.UserGroupRoles (ugr_id, uid, gid, gr_id) VALUES
(NEWID(), '33333333-3333-3333-3333-333333333333', @CalorieAppGroupId, @BackendRoleId);

-- David Kim - QA Engineer (Developer background)
INSERT INTO dbo.UserGroupRoles (ugr_id, uid, gid, gr_id) VALUES
(NEWID(), '44444444-4444-4444-4444-444444444444', @CalorieAppGroupId, @QARoleId);

-- Alex Thompson - Frontend Developer (Developer background)
INSERT INTO dbo.UserGroupRoles (ugr_id, uid, gid, gr_id) VALUES
(NEWID(), '55555555-5555-5555-5555-555555555555', @CalorieAppGroupId, @FrontendRoleId);

-- Maya Patel - UI/UX Designer (Design Lead background)
INSERT INTO dbo.UserGroupRoles (ugr_id, uid, gid, gr_id) VALUES
(NEWID(), '66666666-6666-6666-6666-666666666666', @CalorieAppGroupId, @DesignerRoleId);

-- James Wilson - UI/UX Designer (Senior Designer background)
INSERT INTO dbo.UserGroupRoles (ugr_id, uid, gid, gr_id) VALUES
(NEWID(), '77777777-7777-7777-7777-777777777777', @CalorieAppGroupId, @DesignerRoleId);

-- Zoe Martinez - Frontend Developer (Senior Designer background)
INSERT INTO dbo.UserGroupRoles (ugr_id, uid, gid, gr_id) VALUES
(NEWID(), '88888888-8888-8888-8888-888888888888', @CalorieAppGroupId, @FrontendRoleId);

-- Ryan Foster - DevOps Engineer (Designer background)
INSERT INTO dbo.UserGroupRoles (ugr_id, uid, gid, gr_id) VALUES
(NEWID(), '99999999-9999-9999-9999-999999999999', @CalorieAppGroupId, @DevOpsRoleId);

-- Lisa Wang - QA Engineer (QA Lead background)
INSERT INTO dbo.UserGroupRoles (ugr_id, uid, gid, gr_id) VALUES
(NEWID(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', @CalorieAppGroupId, @QARoleId);

-- Tom Anderson - Backend Developer (Senior QA background)
INSERT INTO dbo.UserGroupRoles (ugr_id, uid, gid, gr_id) VALUES
(NEWID(), 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', @CalorieAppGroupId, @BackendRoleId);

-- Priya Sharma - QA Engineer (Senior QA background)
INSERT INTO dbo.UserGroupRoles (ugr_id, uid, gid, gr_id) VALUES
(NEWID(), 'cccccccc-cccc-cccc-cccc-cccccccccccc', @CalorieAppGroupId, @QARoleId);

-- Jake Miller - Frontend Developer (QA Tester background)
INSERT INTO dbo.UserGroupRoles (ugr_id, uid, gid, gr_id) VALUES
(NEWID(), 'dddddddd-dddd-dddd-dddd-dddddddddddd', @CalorieAppGroupId, @FrontendRoleId);

-- Nina Kowalski - Product Manager (QA Tester background)
INSERT INTO dbo.UserGroupRoles (ugr_id, uid, gid, gr_id) VALUES
(NEWID(), 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', @CalorieAppGroupId, @PMRoleId);

-- Carlos Mendez - DevOps Engineer (QA Tester background)
INSERT INTO dbo.UserGroupRoles (ugr_id, uid, gid, gr_id) VALUES
(NEWID(), 'ffffffff-ffff-ffff-ffff-ffffffffffff', @CalorieAppGroupId, @DevOpsRoleId);

-- Get the existing user (test user) and assign them a role too
DECLARE @ExistingUserId UNIQUEIDENTIFIER = (
    SELECT TOP 1 uid FROM dbo.Users 
    WHERE uid NOT IN (
        '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444',
        '55555555-5555-5555-5555-555555555555', '66666666-6666-6666-6666-666666666666',
        '77777777-7777-7777-7777-777777777777', '88888888-8888-8888-8888-888888888888',
        '99999999-9999-9999-9999-999999999999', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        'dddddddd-dddd-dddd-dddd-dddddddddddd', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
        'ffffffff-ffff-ffff-ffff-ffffffffffff'
    )
);

-- Assign the existing user a Product Manager role if they exist
IF @ExistingUserId IS NOT NULL
BEGIN
    INSERT INTO dbo.UserGroupRoles (ugr_id, uid, gid, gr_id) VALUES
    (NEWID(), @ExistingUserId, @CalorieAppGroupId, @PMRoleId);
END

PRINT 'Successfully added all users to Calorie Tracker App group with roles!';

-- Display summary
SELECT 
    'Role Distribution' as Summary,
    gr.gr_name as Role,
    COUNT(ugr.uid) as UserCount
FROM dbo.GroupRoles gr
LEFT JOIN dbo.UserGroupRoles ugr ON gr.gr_id = ugr.gr_id
WHERE gr.gid = @CalorieAppGroupId
GROUP BY gr.gr_name
ORDER BY gr.gr_name;
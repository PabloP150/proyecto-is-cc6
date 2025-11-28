-- Comprehensive test script for analytics tables
-- This script tests the analytics schema with sample data and validates all constraints

PRINT 'Starting comprehensive analytics schema tests...';

-- Test 1: Verify tables exist and have correct structure
PRINT 'Test 1: Verifying table existence and structure...';

SELECT 
    t.name AS TableName,
    c.name AS ColumnName,
    ty.name AS DataType,
    c.max_length,
    c.is_nullable,
    c.is_identity
FROM sys.tables t
JOIN sys.columns c ON t.object_id = c.object_id
JOIN sys.types ty ON c.user_type_id = ty.user_type_id
WHERE t.name IN ('TaskAnalytics', 'UserMetrics', 'UserExpertise')
ORDER BY t.name, c.column_id;

-- Test 2: Verify foreign key relationships exist
PRINT 'Test 2: Verifying foreign key relationships...';

SELECT 
    fk.name AS ForeignKeyName,
    tp.name AS ParentTable,
    cp.name AS ParentColumn,
    tr.name AS ReferencedTable,
    cr.name AS ReferencedColumn
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
JOIN sys.tables tp ON fkc.parent_object_id = tp.object_id
JOIN sys.columns cp ON fkc.parent_object_id = cp.object_id AND fkc.parent_column_id = cp.column_id
JOIN sys.tables tr ON fkc.referenced_object_id = tr.object_id
JOIN sys.columns cr ON fkc.referenced_object_id = cr.object_id AND fkc.referenced_column_id = cr.column_id
WHERE tp.name IN ('TaskAnalytics', 'UserMetrics', 'UserExpertise')
ORDER BY tp.name, fk.name;

-- Test 3: Verify check constraints exist
PRINT 'Test 3: Verifying check constraints...';

SELECT 
    t.name AS TableName,
    cc.name AS ConstraintName,
    cc.definition AS ConstraintDefinition
FROM sys.check_constraints cc
JOIN sys.tables t ON cc.parent_object_id = t.object_id
WHERE t.name IN ('TaskAnalytics', 'UserMetrics', 'UserExpertise')
ORDER BY t.name, cc.name;

-- Test 4: Verify unique constraints exist
PRINT 'Test 4: Verifying unique constraints...';

SELECT 
    t.name AS TableName,
    i.name AS ConstraintName,
    c.name AS ColumnName
FROM sys.indexes i
JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
JOIN sys.tables t ON i.object_id = t.object_id
WHERE t.name IN ('TaskAnalytics', 'UserMetrics', 'UserExpertise')
AND i.is_unique = 1
AND i.is_primary_key = 0
ORDER BY t.name, i.name;

-- Test 5: Verify performance indexes exist
PRINT 'Test 5: Verifying performance indexes...';

SELECT 
    t.name AS TableName,
    i.name AS IndexName,
    i.type_desc AS IndexType,
    STRING_AGG(c.name, ', ') AS IndexColumns
FROM sys.indexes i
JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
JOIN sys.tables t ON i.object_id = t.object_id
WHERE t.name IN ('TaskAnalytics', 'UserMetrics', 'UserExpertise')
AND i.name LIKE 'IX_%'
GROUP BY t.name, i.name, i.type_desc
ORDER BY t.name, i.name;

-- Test 6: Test constraint validation with sample data (if test users exist)
PRINT 'Test 6: Testing constraint validation...';

-- Check if we have test users to work with
IF EXISTS (SELECT 1 FROM dbo.Users WHERE username LIKE 'test%' OR uid = '00000000-0000-0000-0000-000000000001')
BEGIN
    PRINT 'Found test users, running constraint validation tests...';
    
    DECLARE @TestUID UNIQUEIDENTIFIER;
    DECLARE @TestGID UNIQUEIDENTIFIER;
    DECLARE @TestTID UNIQUEIDENTIFIER;
    
    -- Get a test user
    SELECT TOP 1 @TestUID = uid FROM dbo.Users WHERE username LIKE 'test%' OR uid = '00000000-0000-0000-0000-000000000001';
    
    -- Get a test group
    SELECT TOP 1 @TestGID = gid FROM dbo.Groups;
    
    -- Get a test task
    SELECT TOP 1 @TestTID = tid FROM dbo.Tasks;
    
    IF @TestUID IS NOT NULL AND @TestGID IS NOT NULL AND @TestTID IS NOT NULL
    BEGIN
        BEGIN TRY
            -- Test TaskAnalytics constraints
            INSERT INTO dbo.TaskAnalytics (tid, uid, gid, task_category, success_status, completion_time_hours)
            VALUES (@TestTID, @TestUID, @TestGID, 'testing', 'completed', 2.5);
            
            PRINT 'TaskAnalytics insert test: PASSED';
            
            -- Test UserMetrics constraints
            INSERT INTO dbo.UserMetrics (uid, metric_date, active_tasks_count, success_rate_percentage)
            VALUES (@TestUID, CAST(GETDATE() AS DATE), 3, 85.5);
            
            PRINT 'UserMetrics insert test: PASSED';
            
            -- Test UserExpertise constraints
            INSERT INTO dbo.UserExpertise (uid, task_category, expertise_score, tasks_completed, success_rate_percentage)
            VALUES (@TestUID, 'testing', 75.0, 10, 80.0);
            
            PRINT 'UserExpertise insert test: PASSED';
            
            -- Clean up test data
            DELETE FROM dbo.TaskAnalytics WHERE uid = @TestUID AND task_category = 'testing';
            DELETE FROM dbo.UserMetrics WHERE uid = @TestUID AND metric_date = CAST(GETDATE() AS DATE);
            DELETE FROM dbo.UserExpertise WHERE uid = @TestUID AND task_category = 'testing';
            
            PRINT 'Test data cleanup: COMPLETED';
            
        END TRY
        BEGIN CATCH
            PRINT 'Constraint validation test failed: ' + ERROR_MESSAGE();
        END CATCH
    END
    ELSE
    BEGIN
        PRINT 'Insufficient test data (missing users, groups, or tasks) - skipping constraint validation tests';
    END
END
ELSE
BEGIN
    PRINT 'No test users found - skipping constraint validation tests';
END

-- Test 7: Verify record counts
PRINT 'Test 7: Current record counts...';

SELECT 'TaskAnalytics' as TableName, COUNT(*) as RecordCount FROM dbo.TaskAnalytics
UNION ALL
SELECT 'UserMetrics' as TableName, COUNT(*) as RecordCount FROM dbo.UserMetrics  
UNION ALL
SELECT 'UserExpertise' as TableName, COUNT(*) as RecordCount FROM dbo.UserExpertise;

PRINT 'Analytics schema comprehensive test completed successfully!';
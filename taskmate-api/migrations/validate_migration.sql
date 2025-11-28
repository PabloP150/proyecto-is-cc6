-- Validation script for analytics migration
-- This script validates that the migration was applied correctly

PRINT 'Starting analytics migration validation...';

-- Check 1: Verify all three analytics tables exist
PRINT 'Checking if analytics tables exist...';

DECLARE @TableCount INT = 0;

IF EXISTS (SELECT * FROM sysobjects WHERE name='TaskAnalytics' AND xtype='U')
BEGIN
    SET @TableCount = @TableCount + 1;
    PRINT '✓ TaskAnalytics table exists';
END
ELSE
BEGIN
    PRINT '✗ TaskAnalytics table missing';
END

IF EXISTS (SELECT * FROM sysobjects WHERE name='UserMetrics' AND xtype='U')
BEGIN
    SET @TableCount = @TableCount + 1;
    PRINT '✓ UserMetrics table exists';
END
ELSE
BEGIN
    PRINT '✗ UserMetrics table missing';
END

IF EXISTS (SELECT * FROM sysobjects WHERE name='UserExpertise' AND xtype='U')
BEGIN
    SET @TableCount = @TableCount + 1;
    PRINT '✓ UserExpertise table exists';
END
ELSE
BEGIN
    PRINT '✗ UserExpertise table missing';
END

-- Check 2: Verify foreign key constraints
PRINT 'Checking foreign key constraints...';

DECLARE @FKCount INT = 0;

SELECT @FKCount = COUNT(*)
FROM sys.foreign_keys fk
JOIN sys.tables t ON fk.parent_object_id = t.object_id
WHERE t.name IN ('TaskAnalytics', 'UserMetrics', 'UserExpertise');

IF @FKCount >= 6  -- TaskAnalytics has 3 FKs, UserMetrics has 1, UserExpertise has 1
BEGIN
    PRINT '✓ Foreign key constraints found: ' + CAST(@FKCount AS VARCHAR(10));
END
ELSE
BEGIN
    PRINT '✗ Missing foreign key constraints. Found: ' + CAST(@FKCount AS VARCHAR(10)) + ', Expected: 6+';
END

-- Check 3: Verify unique constraints
PRINT 'Checking unique constraints...';

DECLARE @UniqueCount INT = 0;

SELECT @UniqueCount = COUNT(*)
FROM sys.indexes i
JOIN sys.tables t ON i.object_id = t.object_id
WHERE t.name IN ('UserMetrics', 'UserExpertise')
AND i.is_unique = 1
AND i.is_primary_key = 0;

IF @UniqueCount >= 2  -- UserMetrics and UserExpertise each have unique constraints
BEGIN
    PRINT '✓ Unique constraints found: ' + CAST(@UniqueCount AS VARCHAR(10));
END
ELSE
BEGIN
    PRINT '✗ Missing unique constraints. Found: ' + CAST(@UniqueCount AS VARCHAR(10)) + ', Expected: 2+';
END

-- Check 4: Verify check constraints
PRINT 'Checking data validation constraints...';

DECLARE @CheckCount INT = 0;

SELECT @CheckCount = COUNT(*)
FROM sys.check_constraints cc
JOIN sys.tables t ON cc.parent_object_id = t.object_id
WHERE t.name IN ('TaskAnalytics', 'UserMetrics', 'UserExpertise');

IF @CheckCount >= 10  -- Multiple check constraints across all tables
BEGIN
    PRINT '✓ Check constraints found: ' + CAST(@CheckCount AS VARCHAR(10));
END
ELSE
BEGIN
    PRINT '✗ Missing check constraints. Found: ' + CAST(@CheckCount AS VARCHAR(10)) + ', Expected: 10+';
END

-- Check 5: Verify performance indexes
PRINT 'Checking performance indexes...';

DECLARE @IndexCount INT = 0;

SELECT @IndexCount = COUNT(*)
FROM sys.indexes i
JOIN sys.tables t ON i.object_id = t.object_id
WHERE t.name IN ('TaskAnalytics', 'UserMetrics', 'UserExpertise')
AND i.name LIKE 'IX_%';

IF @IndexCount >= 8  -- Multiple performance indexes
BEGIN
    PRINT '✓ Performance indexes found: ' + CAST(@IndexCount AS VARCHAR(10));
END
ELSE
BEGIN
    PRINT '✗ Missing performance indexes. Found: ' + CAST(@IndexCount AS VARCHAR(10)) + ', Expected: 8+';
END

-- Summary
PRINT '';
PRINT '=== VALIDATION SUMMARY ===';

IF @TableCount = 3 AND @FKCount >= 6 AND @UniqueCount >= 2 AND @CheckCount >= 10 AND @IndexCount >= 8
BEGIN
    PRINT '✓ ALL VALIDATION CHECKS PASSED';
    PRINT 'Analytics migration was applied successfully!';
    PRINT '';
    PRINT 'Available tables:';
    PRINT '  - TaskAnalytics: Tracks task assignments and completions';
    PRINT '  - UserMetrics: Tracks daily user workload and capacity metrics';
    PRINT '  - UserExpertise: Tracks user expertise scores by task category';
END
ELSE
BEGIN
    PRINT '✗ VALIDATION FAILED';
    PRINT 'Some components of the analytics migration are missing or incomplete.';
    PRINT 'Please review the migration script and re-run if necessary.';
END

PRINT '';
PRINT 'Validation completed.';
# Analytics Database Migrations

This directory contains database migration scripts for the TaskMate analytics feature.

## Overview

The analytics system adds intelligent task assignment recommendations by tracking 5 core metrics:
1. Task completion time
2. Task success rate  
3. Current workload
4. Task category expertise
5. Historical capacity

## Migration Files

### `001_add_analytics_tables.sql`
Main migration script that creates the analytics database schema:

- **TaskAnalytics**: Tracks individual task assignments and completions
- **UserMetrics**: Stores daily aggregated user workload and capacity metrics  
- **UserExpertise**: Tracks user expertise scores by task category

**Features:**
- Foreign key relationships with CASCADE delete
- Data validation constraints
- Performance indexes for analytics queries
- Unique constraints to prevent duplicate data

### `test_analytics_schema.sql`
Comprehensive test script that validates:
- Table structure and columns
- Foreign key relationships
- Check constraints
- Unique constraints
- Performance indexes
- Sample data insertion (if test data available)

### `validate_migration.sql`
Quick validation script to verify migration success:
- Checks table existence
- Validates constraint counts
- Provides summary report

## Running the Migration

### Option 1: Using the Migration Runner (Recommended)
```bash
cd taskmate-api
./run-analytics-migration.sh
```

This script will:
1. Apply the analytics migration
2. Run comprehensive validation tests
3. Provide detailed success/failure reporting

### Option 2: Manual Execution
```bash
# Apply migration
sqlcmd -S localhost -U SA -P "$SA_PASSWORD" -d taskmate-db -i migrations/001_add_analytics_tables.sql

# Run tests
sqlcmd -S localhost -U SA -P "$SA_PASSWORD" -d taskmate-db -i migrations/test_analytics_schema.sql

# Validate
sqlcmd -S localhost -U SA -P "$SA_PASSWORD" -d taskmate-db -i migrations/validate_migration.sql
```

## Database Schema

### TaskAnalytics Table
```sql
CREATE TABLE dbo.TaskAnalytics (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    tid UNIQUEIDENTIFIER NOT NULL,           -- Task ID
    uid UNIQUEIDENTIFIER NOT NULL,           -- User ID  
    gid UNIQUEIDENTIFIER NOT NULL,           -- Group ID
    task_category VARCHAR(50) DEFAULT 'general',
    assigned_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    completed_at DATETIME2 NULL,
    success_status VARCHAR(20) DEFAULT 'pending', -- 'completed', 'failed', 'reassigned', 'pending'
    completion_time_hours DECIMAL(10,2) NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    -- Foreign keys and constraints...
);
```

### UserMetrics Table
```sql
CREATE TABLE dbo.UserMetrics (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    uid UNIQUEIDENTIFIER NOT NULL,
    metric_date DATE NOT NULL,
    active_tasks_count INT DEFAULT 0,
    max_concurrent_tasks INT DEFAULT 0,
    avg_completion_time_hours DECIMAL(10,2) DEFAULT 0,
    success_rate_percentage DECIMAL(5,2) DEFAULT 0,
    updated_at DATETIME2 DEFAULT GETDATE(),
    -- Unique constraint on (uid, metric_date)
);
```

### UserExpertise Table
```sql
CREATE TABLE dbo.UserExpertise (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    uid UNIQUEIDENTIFIER NOT NULL,
    task_category VARCHAR(50) NOT NULL,      -- 'frontend', 'backend', 'database', 'testing', 'general'
    expertise_score DECIMAL(5,2) DEFAULT 0, -- 0-100 score
    tasks_completed INT DEFAULT 0,
    avg_completion_time_hours DECIMAL(10,2) DEFAULT 0,
    success_rate_percentage DECIMAL(5,2) DEFAULT 0,
    last_updated DATETIME2 DEFAULT GETDATE(),
    -- Unique constraint on (uid, task_category)
);
```

## Performance Indexes

The migration creates several indexes for optimal query performance:

- `IX_TaskAnalytics_UID_Status`: User workload queries
- `IX_TaskAnalytics_GID_Category`: Group analytics queries  
- `IX_TaskAnalytics_AssignedAt`: Time-based analytics
- `IX_TaskAnalytics_TID`: Task lookup
- `IX_TaskAnalytics_CompletedAt`: Completion analysis
- `IX_UserMetrics_UID_Date`: User metrics lookup
- `IX_UserMetrics_Date`: Daily metrics aggregation
- `IX_UserExpertise_UID_Category`: Expertise lookup
- `IX_UserExpertise_Category`: Category-based queries
- `IX_UserExpertise_Score`: Top performers queries

## Data Validation Constraints

### TaskAnalytics Constraints
- `CK_TaskAnalytics_SuccessStatus`: Valid status values only
- `CK_TaskAnalytics_CompletionTime`: Non-negative completion times
- `CK_TaskAnalytics_CompletedAt`: Completion date after assignment date

### UserMetrics Constraints  
- `CK_UserMetrics_ActiveTasks`: Non-negative task counts
- `CK_UserMetrics_MaxConcurrent`: Non-negative concurrent tasks
- `CK_UserMetrics_AvgTime`: Non-negative average times
- `CK_UserMetrics_SuccessRate`: Success rate between 0-100%

### UserExpertise Constraints
- `CK_UserExpertise_Score`: Expertise score between 0-100
- `CK_UserExpertise_TasksCompleted`: Non-negative task counts
- `CK_UserExpertise_AvgTime`: Non-negative average times  
- `CK_UserExpertise_SuccessRate`: Success rate between 0-100%
- `CK_UserExpertise_Category`: Valid category values only

## Troubleshooting

### Migration Fails
1. Check database connection parameters
2. Verify SA_PASSWORD environment variable is set
3. Ensure taskmate-db database exists
4. Check that base tables (Users, Groups, Tasks) exist

### Foreign Key Errors
- Ensure the main TaskMate tables are created first
- Verify foreign key references match existing table structure

### Permission Errors
- Ensure the database user has CREATE TABLE permissions
- Check that the user can create indexes and constraints

### Rollback (if needed)
```sql
-- Drop analytics tables (will cascade delete data)
DROP TABLE IF EXISTS dbo.TaskAnalytics;
DROP TABLE IF EXISTS dbo.UserMetrics;  
DROP TABLE IF EXISTS dbo.UserExpertise;
```

## Next Steps

After successful migration:

1. **Implement AnalyticsService** (Task 2)
   - Create service class for analytics data operations
   - Add methods for recording assignments and completions

2. **Create Analytics Agent** (Task 3)  
   - Implement MCP agent for task recommendations
   - Add hybrid analytics + LLM decision making

3. **Integrate with Task Operations** (Task 5)
   - Modify existing task flows to record analytics data
   - Add batch jobs for metrics updates

## Support

For issues with the analytics migration:
1. Check the migration logs for specific error messages
2. Run the validation script to identify missing components
3. Review the comprehensive test output for detailed diagnostics
#!/bin/bash

# Script to run analytics migration and tests
# This script applies the analytics tables migration and runs validation tests

echo "=== TaskMate Analytics Migration Runner ==="
echo "Starting analytics database migration..."

# Check if required environment variables are set
if [ -z "$SA_PASSWORD" ]; then
    echo "Error: SA_PASSWORD environment variable is not set"
    exit 1
fi

# Database connection parameters
DB_SERVER="localhost"
DB_NAME="taskmate-db"
DB_USER="SA"
MIGRATION_FILE="./migrations/001_add_analytics_tables.sql"
TEST_FILE="./migrations/test_analytics_schema.sql"

echo "Database Server: $DB_SERVER"
echo "Database Name: $DB_NAME"
echo "Migration File: $MIGRATION_FILE"
echo "Test File: $TEST_FILE"

# Function to run SQL script
run_sql_script() {
    local script_file=$1
    local description=$2
    
    echo "Running $description..."
    /opt/mssql-tools/bin/sqlcmd -S "$DB_SERVER" -U "$DB_USER" -P "$SA_PASSWORD" -d "$DB_NAME" -i "$script_file"
    
    if [ $? -eq 0 ]; then
        echo "✓ $description completed successfully"
        return 0
    else
        echo "✗ Error: $description failed"
        return 1
    fi
}

# Check if migration file exists
if [ ! -f "$MIGRATION_FILE" ]; then
    echo "Error: Migration file $MIGRATION_FILE not found"
    exit 1
fi

# Check if test file exists
if [ ! -f "$TEST_FILE" ]; then
    echo "Error: Test file $TEST_FILE not found"
    exit 1
fi

# Run the analytics migration
echo ""
echo "Step 1: Applying analytics tables migration..."
if ! run_sql_script "$MIGRATION_FILE" "Analytics Migration"; then
    echo "Migration failed. Exiting."
    exit 1
fi

# Wait a moment for the migration to complete
sleep 2

# Run the schema validation tests
echo ""
echo "Step 2: Running schema validation tests..."
if ! run_sql_script "$TEST_FILE" "Schema Validation Tests"; then
    echo "Schema validation failed. Please check the output above."
    exit 1
fi

echo ""
echo "=== Migration Summary ==="
echo "✓ Analytics tables created successfully"
echo "✓ Foreign key relationships established"
echo "✓ Constraints and indexes applied"
echo "✓ Schema validation tests passed"
echo ""
echo "Analytics migration completed successfully!"
echo "The following tables are now available:"
echo "  - TaskAnalytics (tracks task assignments and completions)"
echo "  - UserMetrics (tracks daily user workload and capacity metrics)"
echo "  - UserExpertise (tracks user expertise scores by task category)"
echo ""
echo "Next steps:"
echo "1. Implement AnalyticsService for data operations"
echo "2. Create Analytics Agent for recommendations"
echo "3. Integrate with existing task operations"
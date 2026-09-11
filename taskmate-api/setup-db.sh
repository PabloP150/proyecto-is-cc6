#!/bin/bash
# Container entrypoint. Starts SQL Server, then idempotently creates the database, the app
# login/user (db_datareader + db_datawriter only) and the base schema (each step is skipped when
# it already exists) and applies pending migrations as SA. Safe to run on every container start.
#
# Env: SA_PASSWORD, DB_PASSWORD (app login), DB_NAME=taskmate-db, DB_USERNAME=sqladmin.
set -uo pipefail

APP_DIR="${APP_DIR:-/usr/src/app}"
SQLCMD="${SQLCMD:-/opt/mssql-tools/bin/sqlcmd}"
DB_NAME="${DB_NAME:-taskmate-db}"
APP_LOGIN="${DB_USERNAME:-sqladmin}"
export SQLCMDPASSWORD="$SA_PASSWORD"

fail() { echo "Error: $1"; exit 1; }

# Identifiers are interpolated into SQL below, so only plain names are accepted.
[[ "$DB_NAME" =~ ^[A-Za-z0-9_-]+$ ]] || fail "invalid DB_NAME"
[[ "$APP_LOGIN" =~ ^[A-Za-z0-9_]+$ ]] || fail "invalid DB_USERNAME"
[ -n "${DB_PASSWORD:-}" ] || fail "DB_PASSWORD is required"

sa() { "$SQLCMD" -S localhost -U SA -b -I "$@"; }

echo "Starting SQL Server..."
/opt/mssql/bin/sqlservr &
SQL_PID=$!

echo "Waiting for SQL Server to be ready..."
ready=0
for _ in $(seq 1 90); do
    if sa -Q "SELECT 1" >/dev/null 2>&1; then ready=1; break; fi
    sleep 2
done
[ "$ready" = 1 ] || fail "SQL Server did not start"

echo "Ensuring database, login and user..."
# Fed through stdin with -x (no sqlcmd variable expansion) so the password neither appears
# in the process list nor gets mangled if it contains "$(".
APP_PASSWORD_SQL="${DB_PASSWORD//\'/\'\'}"
sa -x -d master <<SQL || fail "database/login bootstrap failed"
IF DB_ID(N'$DB_NAME') IS NULL CREATE DATABASE [$DB_NAME];
GO
IF SUSER_ID(N'$APP_LOGIN') IS NULL CREATE LOGIN [$APP_LOGIN] WITH PASSWORD = N'$APP_PASSWORD_SQL';
GO
USE [$DB_NAME];
GO
IF DATABASE_PRINCIPAL_ID(N'$APP_LOGIN') IS NULL CREATE USER [$APP_LOGIN] FOR LOGIN [$APP_LOGIN];
GO
-- Least privilege: the API only reads and writes data. Schema changes run as SA (migrations).
-- Older images made the app login db_owner with CONTROL; that is taken back here.
IF IS_ROLEMEMBER(N'db_owner', N'$APP_LOGIN') = 1 ALTER ROLE db_owner DROP MEMBER [$APP_LOGIN];
GO
REVOKE CONTROL ON DATABASE::[$DB_NAME] FROM [$APP_LOGIN];
GO
IF IS_ROLEMEMBER(N'db_datareader', N'$APP_LOGIN') = 0 ALTER ROLE db_datareader ADD MEMBER [$APP_LOGIN];
GO
IF IS_ROLEMEMBER(N'db_datawriter', N'$APP_LOGIN') = 0 ALTER ROLE db_datawriter ADD MEMBER [$APP_LOGIN];
GO
SQL

has_base="$(sa -d "$DB_NAME" -h -1 -W -Q "SET NOCOUNT ON; SELECT CASE WHEN OBJECT_ID(N'dbo.Users', N'U') IS NULL THEN 0 ELSE 1 END" | tr -d '[:space:]')"
if [ "$has_base" = "0" ]; then
    echo "Creating base schema..."
    sa -d "$DB_NAME" -i "$APP_DIR/taskmate_tables.sql" || fail "taskmate_tables.sql failed"
else
    echo "Base schema already present"
fi

echo "Applying migrations..."
DB_HOST=localhost DB_NAME="$DB_NAME" MIGRATE_USER=SA SQLCMD="$SQLCMD" \
    "$APP_DIR/migrations/run-migrations.sh" || fail "migrations failed"

# db_datawriter covers every table; the migration log must only change through migrations (SA).
sa -d "$DB_NAME" -Q "IF OBJECT_ID(N'dbo.SchemaMigrations', N'U') IS NOT NULL DENY INSERT, UPDATE, DELETE ON dbo.SchemaMigrations TO [$APP_LOGIN];" \
    || fail "could not protect dbo.SchemaMigrations"

echo "Setup complete. Keeping container running."
wait "$SQL_PID"

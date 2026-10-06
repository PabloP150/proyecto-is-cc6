#!/bin/bash
# Applies pending migrations with sqlcmd (used by setup-db.sh; runner.js is the Node twin).
# Each NNN_name.sql runs in ONE transaction, in the same sqlcmd session as _begin.sql and
# _record.sql, so a failing migration (sqlcmd -b) is rolled back together with its record.
#
# Env: SQLCMDPASSWORD (required), DB_HOST=localhost, DB_NAME=taskmate-db, MIGRATE_USER=SA,
#      SQLCMD=/opt/mssql-tools/bin/sqlcmd, SQLCMD_EXTRA_OPTS (e.g. "-C" for mssql-tools18).
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
SQLCMD="${SQLCMD:-/opt/mssql-tools/bin/sqlcmd}"
HOST="${DB_HOST:-localhost}"
DB="${DB_NAME:-taskmate-db}"
LOGIN="${MIGRATE_USER:-SA}"
: "${SQLCMDPASSWORD:?SQLCMDPASSWORD must be set}"
export SQLCMDPASSWORD

# shellcheck disable=SC2086
run() { "$SQLCMD" -S "$HOST" -U "$LOGIN" -d "$DB" -b -I ${SQLCMD_EXTRA_OPTS:-} "$@"; }

run -i "$DIR/_schema_migrations.sql"

for file in "$DIR"/[0-9][0-9][0-9]_*.sql; do
    case "$file" in *.down.sql) continue ;; esac
    base="$(basename "$file" .sql)"
    version=$((10#${base:0:3}))
    name="${base:4}"
    applied="$(run -h -1 -W -Q "SET NOCOUNT ON; SELECT COUNT(*) FROM dbo.SchemaMigrations WHERE version = $version" | tr -d '[:space:]')"
    if [ "$applied" != "0" ]; then
        echo "  = $base (already applied)"
        continue
    fi
    echo "  + $base"
    run -v MIGRATION_VERSION="$version" MIGRATION_NAME="$name" -i "$DIR/_begin.sql","$file","$DIR/_record.sql"
done

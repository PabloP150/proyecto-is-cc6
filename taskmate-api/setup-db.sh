#!/bin/bash

echo "Starting SQL Server..."
/opt/mssql/bin/sqlservr &

echo "Waiting for SQL Server to be ready..."
sleep 30

echo "Replacing password placeholder..."
sed -i "s/\$(DB_PASSWORD)/$DB_PASSWORD/g" /usr/src/app/setup.sql

echo "Running setup script to create database and user..."
/opt/mssql-tools/bin/sqlcmd -S localhost -U SA -P "$SA_PASSWORD" -d master -i /usr/src/app/setup.sql
if [ $? -ne 0 ]; then
  echo "Error: Failed to execute setup.sql"
  exit 1
fi

echo "Running script to create tables..."
/opt/mssql-tools/bin/sqlcmd -S localhost -U SA -P "$SA_PASSWORD" -d taskmate-db -i /usr/src/app/taskmate_tables.sql
if [ $? -ne 0 ]; then
  echo "Error: Failed to execute taskmate_tables.sql"
  exit 1
fi

echo "Setup complete. Keeping container running."
wait
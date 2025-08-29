# Automated SQL Server Setup with a Custom User

This guide explains how to create a custom Docker image for SQL Server that automatically creates a database and a dedicated user for your application. This avoids using the `SA` user in your application.

## 1. Create Setup Files

In your `taskmate-api` directory, create the following three files:

### `Dockerfile`

This file defines the custom Docker image.

```dockerfile
FROM mcr.microsoft.com/mssql/server:2019-latest

# Switch to root user to install packages and set permissions
USER root

# Create a directory for the setup scripts
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

# Copy the setup scripts and table creation script
COPY setup-db.sh ./
COPY setup.sql ./
COPY taskmate_tables.sql ./

# Make the setup script executable
RUN chmod +x setup-db.sh

# Grant permissions to the mssql user to run the script


# Switch back to mssql user
USER mssql

# Set the entrypoint to our custom script
CMD ["/bin/bash", "./setup-db.sh"]
```

### `setup.sql`

This SQL script creates the database and the new user.

```sql
CREATE DATABASE taskmate_db;
GO

USE taskmate_db;
GO

CREATE LOGIN app_user WITH PASSWORD = '$(DB_PASSWORD)';
GO

CREATE USER app_user FOR LOGIN app_user;
GO

ALTER ROLE db_owner ADD MEMBER app_user;
GO

-- Grant control to the user to allow it to create tables
GRANT CONTROL ON DATABASE::taskmate_db TO app_user;
GO
```

### `setup-db.sh`

This shell script orchestrates the setup process inside the container.

```bash
#!/bin/bash

# Start SQL Server in the background
/opt/mssql/bin/sqlservr &

# Wait for SQL Server to be ready
sleep 30

# Replace the password placeholder in the setup script
sed -i "s/\$(DB_PASSWORD)/$DB_PASSWORD/g" /usr/src/app/setup.sql

# Run the setup script to create the database and user
/opt/mssql-tools/bin/sqlcmd -S localhost -U SA -P "$SA_PASSWORD" -d master -i /usr/src/app/setup.sql

# Run the script to create the tables
/opt/mssql-tools/bin/sqlcmd -S localhost -U app_user -P "$DB_PASSWORD" -d taskmate_db -i /usr/src/app/taskmate_tables.sql

# Keep the container running
wait
```

## 2. Build the Docker Image

Navigate to the `taskmate-api` directory in your terminal and run the following command to build the Docker image:

```bash
sudo docker build -t custom-sql-server .
```

## 3. Run the Custom Docker Container

Now, run your custom Docker image. You need to provide two passwords as environment variables:

*   `SA_PASSWORD`: A password for the `SA` user (still required for the initial setup).
*   `DB_PASSWORD`: The password for your new `sqladmin`.

```bash
sudo docker run -e "ACCEPT_EULA=Y" -e "SA_PASSWORD=Pswrd123" -e "DB_PASSWORD=Pswrd123" -p 1433:1433 --name custom-sql1 -d custom-sql-server
```

## 4. Update Your `.env` File

Finally, update the `.env` file in your `taskmate-api` directory to use the new `sqladmin` and its password:

```
DB_SERVER=localhost
DB_USERNAME=sqladmin
DB_PASSWORD=YourAppUserPassword
DB_NAME=taskmate_db
DB_PORT=1433
```

## 5. Restart Your Backend Server

Restart your `taskmate-api` server. It will now connect to the database using the dedicated `sqladmin`.

## 6. Start an interactive session

You can now start an interactive sqlcmd session to run queries with the following command:

```bash
sqlcmd -S localhost -U sqladmin -P 'Pswrd123' -d 'taskmate-db'
```
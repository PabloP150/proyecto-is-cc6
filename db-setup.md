# Automated SQL Server Setup with a Custom User

This guide explains how to create a custom Docker image for SQL Server that automatically creates a database and a dedicated user for your application. This avoids using the `SA` user in your application.

## 1. Create Setup Files

In your `taskmate-api` directory, create the following three files:

### `Dockerfile`

This file defines the custom Docker image.

```dockerfile
FROM mcr.microsoft.com/mssql/server:2019-latest

USER root

# Install dependencies and mssql-tools
RUN apt-get update
RUN apt-get install -y curl apt-transport-https gnupg
RUN curl -sSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > /etc/apt/trusted.gpg.d/microsoft.gpg
RUN echo "deb [arch=amd64] https://packages.microsoft.com/ubuntu/20.04/prod focal main" > /etc/apt/sources.list.d/mssql-release.list
RUN apt-get update
RUN ACCEPT_EULA=Y apt-get install -y mssql-tools unixodbc-dev

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

COPY setup-db.sh .
COPY setup.sql .
COPY taskmate_tables.sql .

RUN chmod +x setup-db.sh
RUN chown -R 10001:0 /usr/src/app

USER mssql

CMD ["/bin/bash", "./setup-db.sh"]
```

### `setup.sql`

This SQL script creates the database and the new user.

```sql
CREATE DATABASE [taskmate-db];
GO

USE [taskmate-db];
GO

CREATE LOGIN sqladmin WITH PASSWORD = \'$(DB_PASSWORD)\';
GO

CREATE USER sqladmin FOR LOGIN sqladmin;
GO

ALTER ROLE db_owner ADD MEMBER sqladmin;
GO

-- Grant control to the user to allow it to create tables
GRANT CONTROL ON DATABASE::[taskmate-db] TO sqladmin;
GO
```

### `setup-db.sh`

This shell script orchestrates the setup process inside the container.

```bash
#!/bin/bash

echo "Starting SQL Server..."
/opt/mssql/bin/sqlservr &

echo "Waiting for SQL Server to be ready..."
sleep 30

echo "Replacing password placeholder..."
sed -i "s/\$\(DB_PASSWORD\)/$DB_PASSWORD/g" /usr/src/app/setup.sql

echo "Running setup script to create database and user..."
/opt/mssql-tools/bin/sqlcmd -S localhost -U SA -P "$SA_PASSWORD" -d master -i /usr/src/app/setup.sql
if [ $? -ne 0 ]; then
  echo "Error: Failed to execute setup.sql"
  exit 1
fi

echo "Running script to create tables..."
/opt/mssql-tools/bin/sqlcmd -S localhost -U sqladmin -P "$DB_PASSWORD" -d taskmate-db -i /usr/src/app/taskmate_tables.sql
if [ $? -ne 0 ]; then
  echo "Error: Failed to execute taskmate_tables.sql"
  exit 1
fi

echo "Setup complete. Keeping container running."
wait
```

## 2. Build the Docker Image

Navigate to the `taskmate-api` directory in your terminal and run the following command to build the Docker image:

```bash
docker build -t custom-sql-server .
```

## 3. Run the Custom Docker Container

Now, run your custom Docker image. You need to provide two passwords as environment variables:

*   `SA_PASSWORD`: A password for the `SA` user (still required for the initial setup).
*   `DB_PASSWORD`: The password for your new `sqladmin`.

```bash
docker run -e "ACCEPT_EULA=Y" -e "SA_PASSWORD=Pswrd123" -e "DB_PASSWORD=Pswrd123" -p 1433:1433 --name custom-sql1 -d custom-sql-server
```

Replace `YourSAPassword` and `YourAppUserPassword` with strong passwords.

## 4. Update Your `.env` File

Finally, update the `.env` file in your `taskmate-api` directory to use the new `sqladmin` and its password:

```
DB_SERVER=localhost
DB_USERNAME=sqladmin
DB_PASSWORD=YourAppUserPassword
DB_NAME=taskmate-db
DB_PORT=1433
```

## 5. Restart Your Backend Server

Restart your `taskmate-api` server. It will now connect to the database using the dedicated `sqladmin`.

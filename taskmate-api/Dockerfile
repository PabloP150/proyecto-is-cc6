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
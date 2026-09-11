# SQL Server en Docker para TaskMate

La imagen de SQL Server se construye con los archivos de `taskmate-api/`:

| Archivo | Qué hace |
|---------|----------|
| `Dockerfile` | SQL Server 2019 + `mssql-tools`; copia el esquema base, las migraciones y `setup-db.sh` |
| `setup-db.sh` | Arranque idempotente: crea la BD y el login de la app si no existen, crea el esquema base solo la primera vez, aplica las migraciones pendientes y protege `dbo.SchemaMigrations` |
| `taskmate_tables.sql` | Esquema base (versión 0) |
| `migrations/NNN_*.sql` | Cambios posteriores, versionados, con su `.down.sql`; se registran en `dbo.SchemaMigrations` |

## 1. Construir la imagen

```bash
cd taskmate-api
docker build -t taskmate-sql .
```

## 2. Crear el contenedor

```bash
docker run -d --name taskmate-sql \
  -e ACCEPT_EULA=Y \
  -e SA_PASSWORD='<password-fuerte-para-sa>' \
  -e DB_PASSWORD='<password-fuerte-para-la-app>' \
  -p 1433:1433 taskmate-sql
docker logs -f taskmate-sql   # esperar "Setup complete. Keeping container running."
```

En Macs con Apple Silicon agrega `--platform linux/amd64` (la imagen es amd64).

Qué deja listo el primer arranque:
- La BD `taskmate-db` y el login `sqladmin` con **mínimo privilegio**: solo `db_datareader` + `db_datawriter` (no puede cambiar el esquema ni escribir en `dbo.SchemaMigrations`).
- El esquema base y las migraciones 001–005, aplicadas como `SA`.

Los reinicios posteriores no repiten nada: cada paso se salta si ya está hecho.

## 3. Configurar `.env`

En la `.env` de la raíz (plantilla completa en `taskmate-api/.env.example`):

```env
DB_SERVER=localhost
DB_PORT=1433
DB_NAME=taskmate-db
DB_USERNAME=sqladmin                  # la API nunca usa sa
DB_PASSWORD=<password-de-la-app>
MIGRATION_DB_USERNAME=sa              # solo para npm run db:migrate
MIGRATION_DB_PASSWORD=<password-de-sa>
```

## 4. Migrar una BD que ya existía

Los contenedores creados antes de la Fase 3 no tienen las migraciones. Para aplicarlas sin perder datos:

1. **Respalda los triggers actuales.** La migración 003 los reemplaza por la versión del repositorio, y la BD de desarrollo podría tener una versión distinta:
   ```bash
   read -s "SA_PW?Contraseña SA: "; echo     # zsh (en bash: read -s -p "Contraseña SA: " SA_PW; echo)
   docker exec -i -e SQLCMDPASSWORD="$SA_PW" taskmate-sql /opt/mssql-tools/bin/sqlcmd -S localhost -U SA \
     -d taskmate-db -h -1 -y 0 -Q "SET NOCOUNT ON; SELECT name, OBJECT_DEFINITION(object_id) FROM sys.triggers" \
     > "$HOME/triggers-backup.sql"
   ```
2. **Aplica las migraciones** (idempotentes; las ya aplicadas se saltan):
   ```bash
   cd taskmate-api && MIGRATION_DB_USERNAME=sa MIGRATION_DB_PASSWORD="$SA_PW" npm run db:migrate
   unset SA_PW
   ```
   Paso a paso completo: [docs/fase-03-integracion-github/GUIA-GITHUB-APP.md](docs/fase-03-integracion-github/GUIA-GITHUB-APP.md#7-migrar-la-bd-de-desarrollo).
3. **Opcional: baja los privilegios del login de la app.** En contenedores antiguos `sqladmin` es `db_owner`. Ejecuta como `SA` las mismas sentencias que `setup-db.sh` (sección "Least privilege") o crea el contenedor de nuevo con la imagen actual.

Estado y reversión (desde `taskmate-api/`): `node migrations/runner.js status` lista las migraciones aplicadas; `node migrations/runner.js down` revierte la última (`--steps N` o `--to <versión>` para más). La reversión de la 005 convierte los textos a `VARCHAR` y pierde los caracteres fuera de Latin-1.

## 5. BD desechable para pruebas

Las pruebas de integración (`npm run test:db`) crean y borran datos. Úsalas siempre contra un contenedor aparte, por ejemplo en el puerto 14333. Los pasos exactos están en [docs/fase-03-integracion-github/README.md](docs/fase-03-integracion-github/README.md#cómo-reproducir--verificar).

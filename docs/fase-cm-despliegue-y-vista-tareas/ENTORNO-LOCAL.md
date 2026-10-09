# Levantar TaskMate en local (Fedora + Podman)

Probado el 9 oct 2026 en Fedora 43 con Podman rootless. `start.sh` del repositorio está escrito
para macOS con Docker Desktop (`open -a Docker`, `lsof`); estos pasos son el equivalente aquí.

## 1. Base de datos

```bash
cd taskmate-api
podman build -t taskmate-sql .

podman run -d --name taskmate-sql \
  -e ACCEPT_EULA=Y \
  -e SA_PASSWORD='TaskMate#Local2026' \
  -e DB_PASSWORD='AppLocal#2026pw' \
  -p 127.0.0.1:1433:1433 taskmate-sql

podman logs -f taskmate-sql   # esperar "Setup complete. Keeping container running."
```

El primer arranque tarda ~1 minuto: crea la base, el login `sqladmin` (solo `db_datareader` +
`db_datawriter`) y aplica **todas** las migraciones, incluidas las nuevas:

```
  + 001_schema_fixes … + 006_bfs_progress_triggers
  + 007_deployments
  + 008_task_files
```

El `Dockerfile` copia `migrations/`, así que no hay que aplicarlas a mano.

Reinicios posteriores: `podman start taskmate-sql` (no repite nada).

## 2. Configuración

Crear `.env` en la **raíz** del repositorio:

```bash
API_PORT=9000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
JWT_SECRET=local-dev-secret-at-least-32-characters-long-xyz
DB_SERVER=localhost
DB_PORT=1433
DB_AUTH_TYPE=default
DB_USERNAME=sqladmin
DB_PASSWORD='AppLocal#2026pw'
DB_NAME=taskmate-db
DB_POOL_MAX=10
MIGRATION_DB_USERNAME=sa
MIGRATION_DB_PASSWORD='TaskMate#Local2026'
VERCEL_WEBHOOK_SECRET=local-vercel-secret
```

> **Las comillas importan.** `dotenv` trata un `#` sin comillas como inicio de comentario, así que
> `DB_PASSWORD=AppLocal#2026pw` llega truncado a `AppLocal` y el login falla con
> *"Login failed for user 'sqladmin'"*. Costó un rato descubrirlo.

## 3. Dependencias y arranque

```bash
npm install            # workspace: instala también taskmate-api

cd taskmate-api && node server.js    # API en :9000
npm start                            # frontend en :3000 (otra terminal)
```

## 4. Comprobar que funciona

```bash
curl -s localhost:9000/api/deploy/groups/<gid>/deployments   # 401 sin token: correcto
```

Las tablas nuevas:

```bash
podman exec taskmate-sql /opt/mssql-tools/bin/sqlcmd \
  -S localhost -U SA -P 'TaskMate#Local2026' -d taskmate-db -W \
  -Q "SELECT name FROM sys.tables WHERE name IN
      ('Deployments','GroupDeployTargets','DeploymentWebhookDeliveries','TaskFiles')"
```

## 5. Simular un despliegue de Vercel sin cuenta de Vercel

La firma es HMAC-SHA1 del cuerpo exacto, así que se puede generar en local:

```bash
node -e '
const crypto = require("crypto");
const body = JSON.stringify({
  id: "evt_demo_1",
  type: "deployment.succeeded",              // o deployment.error / .building
  createdAt: Date.now(),
  payload: {
    project: { id: "prj_demo" },             // debe coincidir con el Project ID vinculado
    deployment: { id: "dpl_demo_1", url: "taskmate.vercel.app", target: "production",
      meta: { githubCommitRef: "main", githubCommitSha: "a".repeat(40) } },
  },
});
const sig = crypto.createHmac("sha1", "local-vercel-secret").update(body).digest("hex");
fetch("http://127.0.0.1:9000/api/deploy/webhook/vercel", {
  method: "POST",
  headers: { "content-type": "application/json", "x-vercel-signature": sig },
  body,
}).then(r => r.json()).then(console.log);
'
```

Respuestas posibles:

| Respuesta | Significado |
|---|---|
| `{"status":"processed"}` | guardado contra el grupo vinculado |
| `{"status":"ignored"}` | firma válida, pero el proyecto no está vinculado a ningún grupo (o no es un evento de despliegue) |
| `{"status":"duplicate"}` | ese `id` de entrega ya se procesó |
| `401` | firma inválida, o `VERCEL_WEBHOOK_SECRET` sin configurar |

Para llegar a `processed`: entrar a TaskMate, pestaña **Despliegues**, pegar `prj_demo` como
Project ID, y repetir.

Qué quedó registrado:

```bash
podman exec taskmate-sql /opt/mssql-tools/bin/sqlcmd \
  -S localhost -U SA -P 'TaskMate#Local2026' -d taskmate-db -W \
  -Q "SELECT delivery_id, event, status, error_message FROM dbo.DeploymentWebhookDeliveries ORDER BY received_at"
```

## 6. Con una cuenta real de Vercel

El webhook tiene que ser accesible desde internet:

```bash
npx localtunnel --port 9000          # o: cloudflared tunnel --url http://localhost:9000
```

En Vercel: **Settings → Webhooks** → URL `https://<túnel>/api/deploy/webhook/vercel`, eventos
`deployment.*`. Copiar el secreto que genera Vercel a `VERCEL_WEBHOOK_SECRET` y reiniciar la API.

## Qué se verificó realmente

- Las migraciones 007 y 008 se aplican sobre SQL Server 2019 real; las cuatro tablas quedan
  creadas con sus `CHECK` constraints.
- Los modelos funcionan contra la base real: vincular proyecto, enrutar por project id, avanzar
  de estado, **rechazar un reintento fuera de orden**, guardar el mensaje de fallo, idempotencia
  de entregas, y para archivos: registrar, leer, reemplazar y la consulta de solapamiento.
- El webhook completo sobre HTTP contra la API en marcha.

**Un fallo real que sólo apareció al ejecutarlo así:** el handler estaba declarado como
`(req, res, deadlineMs = 8000)`. Express llama a los handlers con `(req, res, next)`, así que
`next` caía en `deadlineMs`; una función usada como retardo de `setTimeout` se convierte en `0`,
y **todas** las peticiones respondían `{"status":"timeout"}` aunque el trabajo terminara bien.
Los tests unitarios no lo detectaron porque pasaban el número explícitamente. Ahora el handler se
construye con una factoría —igual que el de GitHub, que evita el problema por la misma razón— y
hay un test de regresión que lo monta tal como lo monta `app.js`.

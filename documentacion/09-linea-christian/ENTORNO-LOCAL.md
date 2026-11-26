# Levantar TaskMate en local

```bash
./scripts/local-up.sh          # todo: IA local, base de datos, servicio Python del chat, API y web
./scripts/local-down.sh        # detenerlo (sin borrar datos)
./scripts/local-down.sh --all  # también la IA local (Ollama, servidor de IA)
```

Probado en Fedora con Podman. `local-up.sh` es solo para Linux (usa `ss`, `setsid`, `sed -i` de GNU
y `systemctl --user`). `start.sh` del repositorio nació para macOS con Docker Desktop; desde el
18 nov (`d529af6`) usa Podman si está instalado y responde, y solo llama a `open -a Docker` si
existe `open`. Sigue usando `lsof` y `nc`, solo arranca SQL Server, el servicio Python del chat y
la API (sin web, sin IA local) y no aplica migraciones nuevas.

> **Actualizado el 25 nov 2026** contra `test/e2e` (`50f77da`). La interfaz está en inglés desde el
> 19 nov, así que la pestaña se cita como «Vercel (monitoring)». El servidor de IA local se describe
> en el módulo [10 · IA sobre el código](../02-arquitectura/10-ia-sobre-el-codigo.md), y los límites
> conocidos están en [limitaciones conocidas](../01-proyecto/cierre-del-proyecto.md#limitaciones-conocidas).

| Arranque | Tiempo medido |
|---|---|
| Con SQL Server detenido | 26 s |
| Con todo ya en marcha (reinicio) | 5 s |
| Primera vez | + construir la imagen de SQL Server (unos minutos) |

## Qué levanta, en orden

| # | Servicio | Puerto | Notas |
|---|---|---|---|
| 1 | IA local | :8000 | Ollama (:11434) + el servidor de IA de `../ai-server` (RAG + comandos, con Postgres 17 + pgvector en :5432), vía su propio `up.sh`. Sin `../ai-server` (o `AI_SERVER_DIR`) solo arranca Ollama |
| 2 | SQL Server | :1433 | contenedor `taskmate-sql`; luego aplica las migraciones pendientes |
| 3 | Servicio Python del chat | :8001 | `taskmate-api/mcp/`, apuntando al modelo local (`LLM_PROVIDER=ollama`) |
| 4 | API | :9000 | Node/Express |
| 5 | Web | :3000 | servidor de desarrollo de React (`--no-web` lo omite) |

## Qué hace por ti

- **`.env`**: si no existe, lo genera con secretos aleatorios. Si existe, **nunca lo sobrescribe**:
  solo añade las claves que falten (`MCP_SHARED_SECRET`, `LLM_PROVIDER=ollama`, `AI_SERVER_URL`,
  `VERCEL_WEBHOOK_SECRET`…). La única excepción es `AI_SERVER_SECRET`: si el de `../ai-server/.env`
  es distinto, lo reemplaza por ese.
- **Dependencias**: `npm install` y el entorno de Python solo cuando faltan o cambiaron.
- **Migraciones nuevas**: la imagen de SQL Server lleva las migraciones con las que se construyó;
  las posteriores se aplican con `npm run db:migrate`. Así un `git pull` no obliga a reconstruir la
  imagen, que borraría los datos del contenedor.
- **Precalienta los modelos**: el primer embedding tarda más que el límite de 3 s que tiene el
  servicio Python del chat para consultar al servidor de IA local, así que sin esto el primer mensaje perdería el contexto
  del proyecto sin avisar. Según el código, el calentamiento del embedding que hace `local-up.sh`
  llama a `/search` sin `X-AI-Server-Secret` y recibe 401 en silencio; los dos modelos ya los deja
  cargados el `up.sh` del servidor de IA.
- **Solo toca lo suyo**: detiene los procesos que arrancó (archivos pid en `.local/run/`) y se niega
  a matar algo ajeno que ocupe un puerto.

Logs en `.local/logs/{mcp,api,web}.log`, más `ai-server-up.log`, `sql-build.log`, `migrate.log`,
`npm-install.log` y `pip.log`. `.local/` está en `.gitignore`.

## Problemas encontrados al probarlo

Cada uno de estos se encontró ejecutando el script, no leyéndolo:

- **El pid guardado no era el del servicio.** `( cd dir && setsid cmd & )` deja en segundo plano un
  *shell envoltorio*, no el servicio. Detenerlo dejaba el servicio vivo, y el envoltorio mantenía
  abierta la salida del script, que parecía no terminar nunca. Se corrigió con `exec`.
- **Un segundo arranque se colgaba 3 minutos.** Con SQL Server ya en marcha, `podman start` no hace
  nada y no escribe un nuevo «Setup complete», que era lo que el script esperaba.
- **El `.env` local se colaba en los tests de Python.** Al escribir `LLM_PROVIDER=ollama` en `.env`,
  10 tests de Groq pasaron a ejecutarse contra Ollama. `tests/conftest.py` ahora fija esas variables.
- **Las contraseñas con `#` necesitan comillas** en `.env`: `dotenv` corta el valor en el `#`.

## Simular un despliegue de Vercel sin cuenta de Vercel

La firma es HMAC-SHA1 del cuerpo exacto, así que se genera en local con el secreto de `.env`:

```bash
SECRET=$(grep ^VERCEL_WEBHOOK_SECRET= .env | cut -d= -f2-) node -e '
const crypto = require("crypto");
const body = JSON.stringify({
  id: "evt_demo_" + Date.now(),
  type: "deployment.succeeded",              // o deployment.error / deployment.building
  createdAt: Date.now(),
  payload: {
    project: { id: "prj_demo" },             // el Project ID vinculado en «Vercel (monitoring)»
    deployment: { id: "dpl_demo_1", url: "taskmate.vercel.app", target: "production",
      meta: { githubCommitRef: "main", githubCommitSha: "a".repeat(40) } },
  },
});
const sig = crypto.createHmac("sha1", process.env.SECRET).update(body).digest("hex");
fetch("http://127.0.0.1:9000/api/deploy/webhook/vercel", {
  method: "POST", headers: { "content-type": "application/json", "x-vercel-signature": sig }, body,
}).then(r => r.json()).then(console.log);
'
```

| Respuesta | Significado |
|---|---|
| `{"status":"processed"}` | guardado contra el grupo vinculado |
| `{"status":"ignored"}` | firma válida, pero el proyecto no está vinculado (o no es un evento de despliegue) |
| `{"status":"duplicate"}` | ese `id` de entrega ya se recibió antes, aunque haya fallado: no se reprocesa |
| `{"status":"failed"}` | el evento era válido, pero falló al guardarse (queda en `DeploymentWebhookDeliveries`) |
| `{"status":"timeout"}` | no terminó en 8 s; se responde igual y el proceso sigue |
| `400` | cuerpo firmado que no es un objeto JSON con `type` |
| `401` | firma inválida, o `VERCEL_WEBHOOK_SECRET` sin configurar |

Para llegar a `processed`: en la web, en `/github`, pestaña **«Vercel (monitoring)»**, el admin
del grupo vincula `prj_demo` y se repite el envío. La pestaña necesita un repositorio de GitHub
conectado (sin él vuelve a «Repository»), y el panel no se actualiza solo: pulsar **Refresh**.

Con una cuenta real, el webhook tiene que ser accesible desde internet
(`npx localtunnel --port 9000` o `cloudflared tunnel --url http://localhost:9000`); en Vercel,
**Settings → Webhooks** con la URL `https://<túnel>/api/deploy/webhook/vercel` y eventos
`deployment.*`, y su secreto en `VERCEL_WEBHOOK_SECRET`.

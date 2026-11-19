# Integración con Vercel/AWS e interfaz de tareas detallada

| Campo | Valor |
|-------|-------|
| **Funcionalidades** | Integración con Vercel/AWS · Interfaz de tareas más detallada |
| **Complejidad** | Baja · Baja |
| **Fechas planificadas** | 11–18 sep · 18–25 sep 2026 |
| **Fechas reales** | 9 oct 2026 |
| **Estado** | ✅ Vista de tareas · ✅ Vercel solo monitoreo (desplegar desde la app queda para después: los proyectos ya se publican en GitHub Pages con la Fase 4) |
| **Rama** | `feature/vercel-deploy-y-vista-tareas` |
| **Responsable** | Christian Martínez |

---

## Objetivo

Dos funcionalidades de la propuesta, ambas apoyadas en la integración con GitHub de la Fase 3:

1. **Vercel/AWS** — *"conectividad con Vercel o AWS mediante APIs y webhooks para monitorear el
   ciclo de vida del despliegue; esto permitirá reflejar automáticamente en la plataforma si una
   compilación fue exitosa y alertar sobre fallos en el pipeline."*
2. **Interfaz de tareas más detallada** — *"un listado de los archivos de código o documentación
   relacionados, incluyendo enlaces directos e interactivos hacia sus respectivas rutas en
   GitHub."*

Se eligió **Vercel** sobre AWS: el frontend es una aplicación React que Vercel despliega
directamente, y su webhook es un único endpoint firmado. El esquema admite `aws` como proveedor
sin cambios de tablas.

---

## Qué se hizo

### 1. Despliegues

| Pieza | Archivo |
|---|---|
| Esquema | `migrations/009_deployments.sql` |
| Verificación de firma | `services/deploy/deploySignature.js` |
| Traducción de eventos | `services/deploy/vercelEvents.js` |
| Webhook | `services/deploy/deployWebhookHandler.js` |
| Modelo | `models/deployment.model.js` |
| Rutas | `controllers/deploy.controller.js` |
| Interfaz | `src/components/deploy/DeploymentPanel.jsx` (pestaña «Vercel (monitoreo)») |

Tres tablas:

- **`Deployments`** — un despliegue por `(provider, deployment_id)`, con su estado, rama, commit,
  URL y mensaje de error.
- **`GroupDeployTargets`** — qué proyecto del proveedor corresponde a qué grupo. Vercel envía un
  *project id*, nunca un grupo de TaskMate, así que sin esta tabla un webhook no se puede enrutar.
- **`DeploymentWebhookDeliveries`** — registro de entregas, igual que `GitHubWebhookDeliveries`:
  hace idempotentes los reintentos y deja constancia de lo que el proveedor envió.

**Decisiones que vale la pena justificar:**

- **Vercel firma con SHA-1 en `x-vercel-signature`**, sin prefijo de algoritmo — distinto a
  GitHub (`sha256=...` en `X-Hub-Signature-256`). Por eso hay un verificador aparte y no se
  reutiliza el de GitHub. Un test comprueba que una firma SHA-256 válida *no* pasa.
- **La ruta se monta con `express.raw` antes de `express.json`**, porque el HMAC cubre los bytes
  exactos recibidos. Es el mismo orden que ya usaba el webhook de GitHub.
- **Vercel no envía un header de delivery id**, así que la clave de idempotencia es el `id` del
  evento y, si falta, el hash del cuerpo.
- **Los eventos fuera de orden no retroceden el estado**: una actualización sólo se aplica si su
  marca de tiempo es igual o posterior a la almacenada, igual que `applyPullRequest` con
  `gh_updated_at`.
- **Un proyecto no vinculado se ignora, no falla**: se responde 200 y se registra el motivo, para
  que Vercel no reintente indefinidamente algo que nunca va a poder enrutarse.

### 2. Archivos por tarea

| Pieza | Archivo |
|---|---|
| Esquema | `migrations/010_task_files.sql` |
| Lectura desde GitHub | `services/github/repoService.js` → `getPullRequestFiles` |
| Registro | `services/github/taskFileService.js` |
| Modelo | `models/github.model.js` → `replaceTaskFiles`, `getTaskFiles`, `findTasksTouchingPaths` |
| Rutas | `GET /api/github/tasks/:tid/files`, `GET /api/github/tasks/:tid/overlaps` |
| Interfaz | `src/components/github/TaskFilesDialog.jsx` |

Los archivos salen del **pull request** de la rama de la tarea, no de sus commits: la lista de
archivos del PR es el diff autoritativo contra la base, ya deduplicado y con un estado final por
archivo. Recorrer los commits contaría dos veces un archivo editado más de una vez.

Se registran automáticamente al fusionarse el PR (`pullRequestProcessor` → en segundo plano, para
que el webhook no espere a GitHub) y, si una tarea no tiene lista — por ejemplo porque su PR se
fusionó antes de que esto existiera — se recupera bajo demanda al abrir el diálogo.

`replaceTaskFiles` **reemplaza** en lugar de mezclar: si un archivo desaparece del PR porque el
cambio se revirtió antes de fusionar, también debe desaparecer aquí.

---

## Lo que esto habilita

`findTasksTouchingPaths` responde «¿qué otras tareas del grupo tocan estas rutas?». Es
exactamente la consulta que necesita la **Fase 7 — Algoritmo de colisión de archivos**
(6–20 nov, junto con Pablo). El diálogo ya marca en ámbar los archivos que otra tarea toca.

---

## Cómo probarlo

### Despliegues, sin cuenta de Vercel

```bash
cd taskmate-api && npx jest tests/deploy
```

29 tests cubren firma, traducción de eventos y el webhook completo: éxito, fallo con mensaje,
reintento duplicado, proyecto no vinculado, firma inválida y cuerpo manipulado.

### Despliegues, con cuenta de Vercel

1. En Vercel: **Settings → Webhooks**, URL `https://<host>/api/deploy/webhook/vercel`,
   eventos `deployment.*`. Copiar el secreto a `VERCEL_WEBHOOK_SECRET`.
2. En TaskMate: pestaña **Despliegues** → pegar el **Project ID** (Settings → General).
3. Hacer un push. El despliegue aparece y cambia de estado solo.

### Archivos por tarea

Crear la rama de una tarea desde TaskMate, abrir un PR, fusionarlo. Al abrir el icono de
archivos en la tarea aparece la lista con enlaces a GitHub.

---

## Estado y límites conocidos

- **No se ha probado contra una cuenta real de Vercel.** La verificación de firma, el enrutado y
  el almacenamiento están probados de extremo a extremo sobre HTTP con payloads de ejemplo
  tomados de la documentación de Vercel, pero los campos exactos de un evento real pueden
  diferir. `vercelEvents.js` concentra toda la traducción: si algo no cuadra, se ajusta ahí.
- **AWS no está implementado.** El esquema lo admite (`provider IN ('vercel','aws')`); falta el
  verificador de firma y el traductor de eventos.
- **Las migraciones 007 y 008 no se han ejecutado contra una base de datos.** No había SQL Server
  disponible en el entorno de desarrollo; el SQL sigue el estilo idempotente de las migraciones
  anteriores pero debe aplicarse y revisarse antes de fusionar.
- **Un PR fusionado contra una base distinta a la rama por defecto** no completa la tarea (regla
  existente de la Fase 3) y por tanto no dispara el registro automático de archivos. La
  recuperación bajo demanda cubre ese caso.

## Conexión con el servidor de IA (19 nov 2026)

TaskMate llama al servidor de IA (repo `taskmate-ai-server`) por HTTP con un secreto compartido
(`X-AI-Server-Secret`, variable `AI_SERVER_SECRET` en los dos `.env`; `scripts/local-up.sh` lo copia).

| Pieza | Archivo |
|---|---|
| Cliente HTTP (errores → `AI_SERVER_*`) | `taskmate-api/services/aiServer/client.js` |
| Diff de la rama de la tarea (API compare de GitHub) | `repoService.getComparePatches`, `services/aiServer/taskAi.js` |
| Ruta | `POST /api/github/tasks/:tid/audit` (miembro del grupo, 5/min) |
| Interfaz | `src/components/github/TaskAiPanel.jsx`, dentro del diálogo de archivos de la tarea |

El servidor de IA no necesita una copia del repositorio: recibe los parches por archivo.

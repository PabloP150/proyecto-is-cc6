# Integración con Vercel/AWS, interfaz de tareas detallada e IA sobre el código

| Campo | Valor |
|-------|-------|
| **Funcionalidades** | Integración con Vercel/AWS · Interfaz de tareas más detallada · `audit` · IA para generar pruebas · IA revisando PRs · Chatbot como asistente del proyecto |
| **Complejidad** | Baja · Baja · Media · Alta · Alta · — |
| **Fechas planificadas** | 11–18 sep · 18–25 sep · 25 sep–9 oct · 9–23 oct · 23 oct–6 nov 2026 · — (el chatbot no está en la calendarización) |
| **Fechas reales** | 9 oct 2026 (Vercel, archivos por tarea, chatbot local) · 18–19 nov 2026 (IA sobre el código, asistente del proyecto, interfaz en inglés) |
| **Estado** | ✅ Vista de tareas · ✅ Vercel solo monitoreo (desplegar desde la app queda para después: los proyectos ya se publican en GitHub Pages con la Fase 4) · ✅ Audit, Generate tests y Review PR · ⏸️ Colisión de archivos pospuesta (base hecha) · ⏳ Pruebas finales pendientes |
| **Rama** | `feature/linea-christian` (merge `fea7541`, 18 nov). Sobre ella, del 18 al 19 nov, entraron `feature/ai-server-link`, `feature/generate-tests`, `feature/ai-pr-review`, `feature/chat-assistant` y `perf/app`; todo se juntó en `test/e2e`, que se fusionó en `master` el 26 nov 2026 |
| **Responsable** | Christian Martínez |

> **Actualizado el 26 nov 2026** contra el código de `test/e2e` (`50f77da`) más los arreglos del 26 nov
> (rama `fix/christian-bugs`), todo ya en `master`. La interfaz está en
> inglés desde el 19 nov (`d148763`), así que los botones y pestañas se citan como se ven ahora.
> La parte de IA se documenta también en el módulo **10 · IA sobre el código**
> ([arquitectura](../02-arquitectura/10-ia-sobre-el-codigo.md) ·
> [base de datos](../03-base-de-datos/10-ia-sobre-el-codigo.md) ·
> [casos de uso](../04-casos-de-uso/10-ia-sobre-el-codigo.md) ·
> [interfaz](../05-interfaz/10-ia-sobre-el-codigo.md) ·
> [flujos](../06-flujos/10-ia-sobre-el-codigo.md)). Los fallos y límites de esta línea están
> reunidos en [limitaciones conocidas](../01-proyecto/cierre-del-proyecto.md#limitaciones-conocidas).

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
| Interfaz | `src/components/deploy/DeploymentPanel.jsx` (pestaña «Vercel (monitoring)» en `/github`) |

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
fusionó antes de que esto existiera — se recupera bajo demanda al abrir el diálogo «Task files»
(icono «View task files» de la tarea). Según el código, el registro al fusionar hoy no queda
guardado: ver [límites](#estado-y-límites-conocidos).

`replaceTaskFiles` **reemplaza** en lugar de mezclar: si un archivo desaparece del PR porque el
cambio se revirtió antes de fusionar, también debe desaparecer aquí.

---

## Lo que esto habilita

`findTasksTouchingPaths` responde «¿qué otras tareas del grupo tocan estas rutas?». Es
exactamente la consulta que necesita el **algoritmo de colisión de archivos** (Fase 7 de la
calendarización, planificada del 6 al 20 nov). En esta línea quedó ⏸️ **pospuesto** con esta base
ya hecha (`findTasksTouchingPaths` y `GET /api/github/tasks/:tid/overlaps`). El diálogo ya marca
en ámbar, con «Also changed by», los archivos que otra tarea toca.

---

## Cómo probarlo

### Despliegues, sin cuenta de Vercel

```bash
cd taskmate-api && npx jest tests/deploy
```

31 tests (8 de firma, 11 de eventos y 12 del webhook) cubren firma, traducción de eventos y el
webhook completo: éxito, fallo con mensaje, reintento duplicado, proyecto no vinculado, firma
inválida y cuerpo manipulado, un error de BD al reclamar la entrega (responde 500 en vez de
dejar la petición colgada, arreglado el 26 nov), más la regresión del montaje en la ruta (Express
pasaba su `next` como plazo y el webhook respondía siempre `timeout`, `c0d28e2`). Usan el modelo simulado: no
tocan la base de datos.

### Despliegues, con cuenta de Vercel

1. En Vercel: **Settings → Webhooks**, URL `https://<host>/api/deploy/webhook/vercel`,
   eventos `deployment.*`. Copiar el secreto a `VERCEL_WEBHOOK_SECRET`.
2. En TaskMate: en `/github`, pestaña **«Vercel (monitoring)»** → pegar el **Vercel Project ID**
   (Settings → General). Solo el admin del grupo vincula o desvincula, y la pestaña necesita un
   repositorio de GitHub conectado (sin él vuelve a «Repository»).
3. Hacer un push. El despliegue se guarda y cambia de estado solo en la base, pero el panel no se
   actualiza en vivo: pulsar **Refresh** o volver a abrir la pestaña.

### Archivos por tarea

Crear la rama de una tarea desde TaskMate y abrir un PR. Con la rama creada, el icono
«View task files» de la tarea abre «Task files» con la lista y enlaces a GitHub (la lista sale del
PR de la rama y se recupera bajo demanda). Al fusionar el PR en la rama por defecto la tarea pasa
a «Completed», donde el icono ya no se muestra.

---

## Estado y límites conocidos

La lista completa, con los fallos encontrados al revisar el código el 25 nov, está en
[limitaciones conocidas](../01-proyecto/cierre-del-proyecto.md#limitaciones-conocidas). Tres se
corrigieron el 26 nov: el webhook de Vercel que podía tumbar la API, la revisión de PR fallida
que bloqueaba su commit y el error de ESLint en `NavGroupSelector.test.jsx`
([correcciones del 26 nov](../01-proyecto/cierre-del-proyecto.md#correcciones-del-26-nov-2026)).

- Vercel sin probar con una cuenta real, AWS sin implementar y lo demás del despliegue:
  [Monitoreo de Vercel](../01-proyecto/cierre-del-proyecto.md#monitoreo-de-vercel).
- La lista de archivos que no se guarda al fusionar, el tope de 100 y la sincronización manual:
  [Archivos por tarea](../01-proyecto/cierre-del-proyecto.md#archivos-por-tarea).
- Las tablas de la 009 y la 010 sin pruebas de BD (la 011 sí tiene `aiReview.dbtest.js`):
  [Pruebas](../01-proyecto/cierre-del-proyecto.md#pruebas).
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
| Rutas | `POST /api/github/tasks/:tid/audit`, `/generate-tests` y `/review`, más `GET /api/github/tasks/:tid/review` (la última revisión). Todas piden ser miembro del grupo de la tarea. Los tres POST requieren el permiso de IA del grupo y comparten un solo límite de 5 por minuto por usuario |
| Interfaz | `src/components/github/TaskAiPanel.jsx` («AI on the branch», con «Audit», «Generate tests» y «Review PR»), dentro del diálogo «Task files» de la tarea |

El servidor de IA no necesita una copia del repositorio: recibe los parches por archivo.

### IA para generar pruebas

«Generate tests» propone un archivo de pruebas por archivo de código cambiado en la rama (pytest o
Jest), con sus casos y datos de ejemplo. La ruta sigue la convención del repo. Python se verifica
con `ast.parse`; JS se revisa que tenga `test()`/`it()`. **No se ejecutan ni se suben**: ejecutar
código escrito por el modelo en el servidor permitiría que un diff malicioso corra código ahí.
Medido en un cambio de ejemplo: 8 de 9 pruebas de Python pasaron tal cual; los errores fueron
expectativas aritméticas. Se revisan antes de agregarlas a la rama.

### IA revisando pull requests

Cuando se abre (o recibe commits) el PR de la rama de una tarea, el webhook de GitHub dispara la
revisión en segundo plano si el grupo tiene el permiso de IA activo. El servidor de IA (`review-pr`)
devuelve comentarios en línea (hallazgos altos/medios de la auditoría), un resumen y riesgos.

- Se guarda en `dbo.AiReviews` (migración `011_ai_reviews`), una por commit: un webhook repetido no
  revisa dos veces. La vista de la tarea muestra la última; «Review PR» (solo con el PR abierto)
  la pide a mano. Una que falló se vuelve a intentar sobre el mismo commit (con «Review PR» o con
  el siguiente webhook), y una que quedó `pending` más de 15 minutos también; sin `AI_SERVER_URL`,
  «Review PR» responde 503 sin reservar el commit (arreglado el 26 nov; antes hacía falta un
  commit nuevo).
- Se publica en GitHub como revisión **COMMENT** (nunca aprueba ni bloquea). Requiere que la GitHub
  App tenga **Pull requests: write**; sin ese permiso queda guardada en TaskMate como no publicada
  y la interfaz lo explica («Not posted on GitHub: the GitHub App needs the “Pull requests: write”
  permission.»).
- Seguridad: el texto del PR y del modelo se escapa (sin enlaces, imágenes, HTML ni @menciones
  inyectados) y los secretos detectados no aparecen en ningún comentario.

### Chatbot como asistente del proyecto

Antes, con un proyecto seleccionado, cada mensaje lanzaba un análisis completo del repositorio
(hasta 90 s) y bloqueaba el chat un minuto; sin proyecto, el bot empujaba a generar un plan.

- **Conversación normal.** Con o sin proyecto, cada mensaje es una pregunta de chat.
- **El proyecto es el grupo del navbar.** Desde el 19 nov (`d148763`) el chat ya no tiene selector
  propio: sigue el grupo elegido en la barra de navegación (`NavGroupSelector`) y solo lo muestra
  (`ChatProjectInfo`).
- **Contexto una sola vez.** Al primer mensaje después de elegir un proyecto, la API arma su
  contexto: estructura, README, dependencias, commits e issues de GitHub, solo con «Allow AI
  analysis»; además, tareas, hitos, equipo y quién tiene cada tarea. Lo reutiliza hasta que se
  cambia de proyecto. Cambiar de proyecto también reinicia la memoria de la conversación.
- **Plan solo si se pide.** Un paso corto con el modelo clasifica cada mensaje:
  - Plan: «crea un plan…», o el botón «Propose tasks». Con proyecto, se convierte en el análisis
    del repositorio de siempre (tarjeta para confirmar o descartar, con el límite de uno por minuto,
    que ya no afecta al chat). Sin proyecto, se genera el plan de proyecto nuevo.
  - Chat: cualquier tema de software, del proyecto o de TaskMate.
  - Fuera de tema: respuesta fija, sin que el modelo responda lo pedido.
- El plan de proyecto nuevo pide al menos 8 tareas en vez de 50 (`MIN_TASKS`). Se bajó pensando
  en el modelo local, porque un modelo pequeño no alcanza a escribir 50 dentro de su límite de
  tokens, pero el mínimo vale con cualquier proveedor (también con Groq, el respaldo en la nube).

Medido con el modelo local (gemma4 e2b): respuestas de chat en 0.3–2.6 s; las preguntas fuera de tema
se rechazan en 0.1–0.5 s; el plan del proyecto tarda unos 5 s, reutilizando el snapshot ya cargado.

Más detalle del chat (modelo local, streaming, conocimiento del servidor de IA) en
[CHATBOT-IA-LOCAL.md](CHATBOT-IA-LOCAL.md) y en el módulo
[5 · Chat con IA](../02-arquitectura/05-chat-ia.md). Cómo levantarlo todo en local:
[ENTORNO-LOCAL.md](ENTORNO-LOCAL.md).

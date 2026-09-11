# Fase 3 — Seguridad y base de datos

**Documento complementario de [README.md](README.md)** · Estado del código: commit `a931a1a` (rama `feature/fase-3-integracion-github`)

Este documento explica **cómo** está protegida la integración con GitHub y el resto de la API, y **por qué** la base de datos quedó como quedó: qué tablas se agregaron, por qué cumplen 3FN, qué operaciones son atómicas, cómo se migra y qué riesgos quedan.

---

## Índice

- [Parte A — Modelo de seguridad](#parte-a--modelo-de-seguridad)
  - [A.1 Límites de confianza](#a1-límites-de-confianza)
  - [A.2 Tokens y credenciales](#a2-tokens-y-credenciales)
  - [A.3 Autenticación REST y WebSocket](#a3-autenticación-rest-y-websocket)
  - [A.4 Matriz de autorización](#a4-matriz-de-autorización)
  - [A.5 GitHub App: protección contra *confused deputy*](#a5-github-app-protección-contra-confused-deputy)
  - [A.6 Webhooks: HMAC, deduplicación y orden](#a6-webhooks-hmac-deduplicación-y-orden)
  - [A.7 IA: datos enviados a Groq y *prompt injection*](#a7-ia-datos-enviados-a-groq-y-prompt-injection)
  - [A.8 Límites de tasa y de recursos](#a8-límites-de-tasa-y-de-recursos)
  - [A.9 WebSocket](#a9-websocket)
  - [A.10 Servidor de IA (Python)](#a10-servidor-de-ia-python)
  - [A.11 Otras defensas](#a11-otras-defensas)
  - [A.12 Resultado de las revisiones](#a12-resultado-de-las-revisiones)
- [Parte B — Diseño de la base de datos](#parte-b--diseño-de-la-base-de-datos)
- [Parte C — Riesgos residuales](#parte-c--riesgos-residuales)

---

## Parte A — Modelo de seguridad

### A.1 Límites de confianza

| Componente | Confía en | No confía en |
|------------|-----------|--------------|
| **API Node** (`:9000`) | Su propio `JWT_SECRET`, la BD, la llave privada de la App, el secreto del webhook | El navegador (IDs del body/query, *origin*), el contenido de GitHub, la salida del modelo de IA |
| **Servidor de IA** (`127.0.0.1:8001`) | Conexiones que presentan `MCP_SHARED_SECRET` | Navegadores (se rechaza cualquier *handshake* con `Origin`), el contenido del repositorio y las instrucciones del usuario (se tratan como datos) |
| **Frontend** | La API (con su token) | URLs que no sean `https://github.com`, HTML del README o del modelo (se sanitiza) |
| **SQL Server** | Solo el login de la app (lectura/escritura de datos) y el de migraciones (DDL) | — |

Reglas generales: el usuario que actúa **siempre** sale del token (`req.user.userId`); un `uid` en el body/query solo se usa cuando es un usuario **objetivo** (p. ej. asignar una tarea a otra persona) y además se verifica que pertenezca al grupo. Si un mismo ID llega en ruta, query y body con valores distintos, la petición se rechaza (400), para que el handler nunca actúe sobre un ID distinto al autorizado.

### A.2 Tokens y credenciales

| Credencial | Quién la emite | Formato / algoritmo | Vida | Dónde vive | Para qué |
|------------|----------------|---------------------|------|------------|----------|
| Token de acceso de TaskMate | `POST /api/users/login` | JWT HS256 con `typ: 'access'`, sin `aud`, con `exp` | 24 h | `localStorage` del navegador | `Authorization: Bearer` en REST y `?token=` en el WebSocket |
| `state` de instalación | `POST /api/github/groups/:gid/install` | JWT HS256 con `typ: 'gh_install_state'`, `aud: 'taskmate'`, `gid`, `uid`, `nonce` | 10 min, **un solo uso** (nonce en memoria) | URL de GitHub | Autentica el callback público y lo ata al admin y al grupo que lo iniciaron |
| JWT de la App | API | RS256 firmado con `GITHUB_APP_PRIVATE_KEY` (`iss` = App ID), emitido 60 s antes por desfase de reloj | 9 min | Memoria | Llamar `/app/*`: datos de la instalación y emisión de tokens de instalación |
| Token de instalación | GitHub (`POST /app/installations/:id/access_tokens`) | Token opaco de GitHub, pedido con `repository_ids = [repo del grupo]` y permisos mínimos por operación | 1 h (se renueva 5 min antes) | **Solo memoria**, nunca en BD | Leer el repo, crear ramas, listar PRs |
| Token de usuario (OAuth) | GitHub, al canjear el `code` del callback | Token opaco | Se **revoca** al terminar el callback | Variable local del callback | `GET /user`, `/user/installations`, `/user/installations/:id/repositories` |
| Selección de repositorio | Callback | 32 bytes aleatorios (base64url, 43 caracteres) | 10 min, un solo uso, ligada a `uid` + `gid` | Memoria | Que el mismo usuario elija explícitamente el repositorio |
| Secreto del webhook | Tú (en la App y en `GITHUB_WEBHOOK_SECRET`) | HMAC-SHA256 | — | `.env` | Autenticar cada webhook |
| Secreto compartido de IA | Tú (`MCP_SHARED_SECRET`, ≥ 32 caracteres) | Cabecera `X-MCP-Secret`, comparación en tiempo constante | — | `.env` | Autenticar a Node ante Python |

Permisos que la API pide a GitHub por operación (`githubApp.PERMISSIONS`): explorar → `contents: read`; *snapshot* para IA → `contents: read` + `issues: read`; sincronizar PRs → `pull_requests: read`; crear rama → `contents: write`. Si GitHub responde 401 con un token en caché (desinstalación o cambio de permisos), se descarta y se pide uno nuevo una sola vez.

`JWT_SECRET` y `MCP_SHARED_SECRET` deben tener ≥ 32 caracteres y no parecer de ejemplo; si no, la API o el servidor de IA **se niegan a arrancar**.

### A.3 Autenticación REST y WebSocket

- **REST:** `requireAuth` exige `Authorization: Bearer <token>` y solo acepta `HS256`, `typ: 'access'`, sin audiencia y con `exp` (los tokens de propósito, como el `state`, no sirven como sesión y viceversa). Rutas públicas: `POST /api/users` (registro), `POST /api/users/login` (ambas con `authLimiter`), `GET /api/github/callback` (la autentica el `state`) y `POST /api/github/webhook` (la autentica el HMAC).
- **WebSocket** (`/chat`, `/insights`): mismo token en `?token=`, verificado **antes** del *upgrade* con las mismas reglas; además el `Origin` debe estar en `FRONTEND_URL`. El socket se cierra con código `4001` cuando el token expira; el frontend cierra la sesión.
- **Frontend:** `src/api/client.js` agrega el Bearer a todas las llamadas; ante un 401 emite `taskmate:unauthorized` y la app cierra la sesión.

### A.4 Matriz de autorización

Orden de las respuestas en rutas por recurso: UUID mal formado → **400**; recurso inexistente → **404**; existe pero no eres miembro/admin → **403** (`NOT_GROUP_MEMBER` / `NOT_GROUP_ADMIN`).

| Familia | Rutas | Regla |
|---------|-------|-------|
| Usuarios | `POST /api/users`, `POST /api/users/login` | Públicas, 10 intentos por 15 min por IP |
| | `GET /api/users/getuid?username=` | Autenticado (se usa para agregar miembros) |
| Grupos | `POST /api/groups/group` | Autenticado; el admin es quien lo crea (se ignora `adminId` del body) |
| | `GET /api/groups/user-groups` | Solo los grupos del usuario del token |
| | `GET /:gid/members`, `GET /:gid/roles`, `DELETE /leave` | Miembro (salir: siempre el usuario del token) |
| | `POST /join`, `DELETE /remove-member`, `DELETE /delete` | Admin (el `uid` del body es el usuario objetivo) |
| Tareas | `GET /api/tasks?gid=`, `POST /api/tasks`, `DELETE /api/tasks/list/:gid/:list` | Miembro del `gid` |
| | `GET/PUT /api/tasks/:id`, `PUT /api/tasks/nodes/:id`, `POST /:tid/complete`, `POST /:tid/trash` | Miembro del grupo de la tarea (o del nodo) |
| Nodos / aristas | `POST` con `gid`, `GET /group/:gid`, `GET /nodes/tasks/:gid` | Miembro del `gid` |
| | `GET/PUT/DELETE` por `nid`/`eid` | Miembro del grupo del recurso; `GET /api/nodes` (todos los nodos) **eliminado** |
| Completadas / eliminadas | `GET/DELETE /api/completados/:gid`, `/api/delete/:gid` | Miembro |
| Asignaciones | `POST/GET/DELETE /api/usertask` | Miembro del grupo de la tarea; el asignado debe ser miembro |
| Roles | `GET /api/grouproles/groups/:gid/roles`, `GET /api/usergrouproles/...` | Miembro |
| | `POST/PUT/DELETE` de roles y asignaciones de rol | Admin; el rol/asignación debe pertenecer a ese grupo |
| Analytics | `/team`, `/workload`, `/expertise`, `/dashboard`, `/config` (GET y PUT) | **Líder**: admin del grupo o miembro con un rol cuyo nombre contenga «leader» |
| | `/user/:userId` | El propio usuario, o un líder del `?groupId` (solo ve la parte de ese grupo) |
| | `/trends/:userId` | Solo el propio usuario |
| | `/recommendations`, `/assignment`, `/completion` | Miembro (+ la tarea es del grupo y el asignado es miembro); la membresía se verifica antes de validar el cuerpo |
| Utilidades | `POST /api/utils/populate-assignments/:groupId` | Admin |
| GitHub | `POST /groups/:gid/install`, `POST/DELETE /groups/:gid/repository`, `PUT /groups/:gid/ai-analysis` | Admin |
| | `GET /groups/:gid/{repository,tree,file,readme,commits,task-links}`, `POST /groups/:gid/sync` | Miembro |
| | `POST /tasks/:tid/branch` | Miembro del grupo de la tarea |
| | `GET /selections/:id` | Solo el usuario que inició el flujo (las ajenas, vencidas o inexistentes responden igual: 404) |
| | `GET /callback`, `POST /webhook` | Públicas: `state` firmado de un solo uso / HMAC |
| WebSocket `/chat` | `set_context`, `repo_analysis`, `repo_plan_confirm` | Miembro del grupo; `repo_analysis` además exige el permiso de IA del grupo |
| | `analytics` (acciones de equipo) | Líder; el `team_context` lo construye el servidor (el enviado por el cliente se descarta) |
| WebSocket `/insights` | `analytics` | Mismas reglas que `/chat` |

En el E2E en vivo se probaron ~75 intentos de acceso cruzado entre grupos; todos fueron rechazados.

### A.5 GitHub App: protección contra *confused deputy*

El riesgo: la API actúa con los permisos de la App. Si confiara en el `installation_id` que llega en la URL del callback, alguien podría vincular a su grupo un repositorio de una instalación ajena (la App tiene acceso, el usuario no). GitHub documenta que ese parámetro se puede falsificar. Defensas, en orden:

1. **`state` firmado, con propósito y nonce de un solo uso**, ligado al `gid` y al `uid` que iniciaron el flujo (anti-CSRF y anti-replay). Expira a los 10 min.
2. El callback vuelve a comprobar que ese usuario **sigue siendo admin** del grupo.
3. **OAuth durante la instalación**: el `code` se canjea por un token del **usuario** y se exige que el `installation_id` esté en `GET /user/installations` de ese usuario.
4. Los repositorios ofrecidos son los que ese usuario ve dentro de la instalación (`/user/installations/:id/repositories`: intersección de la instalación y los permisos del usuario).
5. El token del usuario se **revoca** inmediatamente; nunca se guarda.
6. **Nunca se vincula en el callback**, ni siquiera con un único repositorio: el `state` prueba quién *empezó* el flujo, no qué navegador lo terminó. Se crea una selección opaca de un solo uso y el vínculo exige `POST /groups/:gid/repository` con el Bearer del mismo usuario, rol de admin y un `repoId` que esté en esa selección.
7. Los datos de la instalación se leen con el **JWT de la App** (prueba que es una instalación de esta App).
8. Las redirecciones solo van a `FRONTEND_URL/github`, con `Cache-Control: no-store` y `Referrer-Policy: no-referrer`; el frontend solo navega a URLs `https://github.com/...`.

Además: los tokens de instalación se piden acotados al repositorio del grupo, y `findTaskByBranch` solo sigue ramas del repositorio **vinculado hoy** al grupo, así que un *merge* en un repositorio anterior no completa tareas.

### A.6 Webhooks: HMAC, deduplicación y orden

- **Autenticidad:** `POST /api/github/webhook` se monta con `express.raw` (1 MB) **antes** de `express.json()`; se calcula HMAC-SHA256 sobre los bytes exactos y se compara con `crypto.timingSafeEqual`. Secreto vacío, cabecera ausente o mal formada → 401. Se exigen `X-GitHub-Event` y un `X-GitHub-Delivery` con forma de UUID (400 si no); `ping` → `pong`; el cuerpo debe ser un objeto JSON.
- **Idempotencia y *replay*:** `beginDelivery` (con `UPDLOCK, HOLDLOCK`) registra la entrega. Es duplicado si ese `delivery_id` **o** otra entrega con el mismo SHA-256 del cuerpo ya está `processed`/`ignored` o `processing` reciente. El hash cubre el caso de un cuerpo firmado capturado y reenviado con otro `X-GitHub-Delivery` (esa cabecera no está firmada). Las entregas `failed`, o `processing` abandonadas más de 10 min, se pueden reclamar de nuevo. La bitácora se purga a diario (`WEBHOOK_DELIVERY_RETENTION_DAYS`, mínimo 30, por defecto 90), porque también es la protección contra reenvíos.
- **Orden:** los eventos se aplican según `gh_updated_at`; uno más viejo no cambia nada, salvo que traiga un *merge*: `merged_at` es un hecho terminal y nunca se borra. En empate del mismo segundo, `closed_at` se mantiene (un «opened» tardío no reabre).
- **Qué se ignora:** PRs cuya rama vive en otro repositorio (forks, o fork borrado), eventos no manejados, instalaciones o repositorios desconocidos (violación de FK → `ignored`).
- **Resultado:** 200 `processed`/`ignored`/`duplicate`; 202 si tarda más de 8 s (sigue en segundo plano); 500 si falla (la entrega queda `failed` y GitHub la muestra como fallida para reenviarla a mano; GitHub no reintenta solo). `POST /groups/:gid/sync` reconcilia contra la API.

### A.7 IA: datos enviados a Groq y *prompt injection*

**Qué sale hacia Groq (`llama-3.1-8b-instant`):**

| Flujo | Datos |
|-------|-------|
| Análisis del repositorio (funcionalidad 2) | Nombre completo y rama por defecto; descripción (≤ 300); lenguaje; rutas del árbol (≈ 2 600 caracteres, sin `node_modules`, builds, binarios, *lockfiles*, llaves/certificados ni `.env*`); README (≤ 1 500); hasta 3 manifiestos (≤ 450 cada uno; de `package.json` solo nombre, descripción y nombres de dependencias y scripts); 10 commits (SHA corto, primera línea ≤ 120, fecha); 10 títulos de issues abiertos (≤ 120); nombres/listas/porcentajes de tareas e hitos existentes (≈ 1 500); instrucciones del usuario (≤ 500). **Nunca el contenido de archivos de código.** Patrones de secretos (llaves PEM, tokens de GitHub/AWS/Google/Slack/Stripe/Groq/OpenAI, JWT, credenciales en URLs, `clave = valor` con nombres tipo *password/token/secret*) se reemplazan por `[REDACTED]` en Node **y** en Python. |
| Chat clásico («Nuevo proyecto») | Los mensajes del usuario y el historial de la conversación |
| Recomendaciones de asignación (líderes) | Descripción/categoría de la tarea y, por miembro del grupo, nombre de usuario, carga, capacidad y experiencia **calculadas solo con la actividad de ese grupo** |

Consentimiento: el análisis del repositorio requiere que el admin active **«Permitir análisis con IA»** (columna `ai_analysis_enabled`, apagada por defecto y reiniciada al cambiar de repositorio), y la UI muestra qué se envía.

**Mitigaciones de *prompt injection*:**
- Todo el contenido del repositorio y las instrucciones van dentro de una etiqueta con nombre aleatorio por petición (`<DATA-xxxxxxxx>`); el *prompt* de sistema declara ese bloque como **datos no confiables** y fija las reglas y el formato con prioridad máxima. Las instrucciones del usuario solo pueden cambiar prioridades.
- Modo JSON de Groq, validación con Pydantic en Python y **revalidación en Node** (`sanitizePlan`): texto plano sin etiquetas ni caracteres de control, longitudes de columna, fechas reales ≥ hoy, categorías de una lista cerrada, sin duplicar tareas existentes, máximo 12 tareas y 5 hitos.
- El modelo **no tiene herramientas**: no puede llamar a GitHub ni a la BD. Lo peor que puede hacer un repositorio malicioso es proponer un plan malo, que el usuario ve en una tarjeta estructurada (sin markdown) y puede descartar. Nada se guarda sin **Confirmar**, y el guardado vuelve a verificar la membresía.
- En el chat clásico, `save_plan` solo se acepta si Python mostró antes un plan esperando confirmación (y el usuario lo confirmó por palabra completa).

### A.8 Límites de tasa y de recursos

| Qué | Límite | Clave |
|-----|--------|-------|
| Registro + login | 10 por 15 min (`AUTH_RATE_LIMIT_MAX`) | IP |
| API general | 300 por min (`API_RATE_LIMIT_MAX`) | Usuario |
| GitHub: instalar / vincular | 10 por min | Usuario |
| GitHub: explorar (árbol, archivo, README, commits) | 60 por min **y** 600 por hora | Usuario |
| GitHub: crear rama | 20 por min | Usuario |
| GitHub: sincronizar PRs | 1 cada 30 s (máx. 30 ramas por sincronización, reservando 20 solicitudes del presupuesto) | Usuario |
| GitHub: callback | 30 por min | IP |
| Presupuesto por instalación | 4 000 solicitudes/h (`GITHUB_INSTALLATION_HOURLY_BUDGET`; GitHub da 5 000/h) | Instalación |
| Recomendaciones de analytics (REST) | 10 por min | Usuario |
| Analytics por WebSocket | 10 por min | Usuario |
| Mensajes del chat | 4 000 caracteres, 20 por min | Usuario |
| Análisis del repositorio | 1 por min por usuario, 1 en curso por sesión, 1 simultáneo global en Python (espera en cola ≤ 20 s) | Usuario / global |
| Planes pendientes | 5 por sesión, expiran a los 30 min | Sesión |
| Petición a Python | Timeout de 90 s en Node; plazo de 80 s en Python | Petición |
| Archivos del explorador | 1 MB; árbol ≤ 5 000 entradas; commits ≤ 30 | Petición |

Detrás de un proxy inverso, `TRUST_PROXY` debe ser el número de saltos (normalmente `1`) o una lista de confianza; **no** `true`, que permitiría falsificar `X-Forwarded-For` y esquivar los límites por IP.

### A.9 WebSocket

- Autenticación y `Origin` verificados antes del *upgrade* (401 sin token válido, 403 con otro origen, 404 en rutas desconocidas, 400 si la URL no se puede interpretar; antes, una URL mal formada tumbaba el proceso).
- Mensajes de máximo **64 KB** (el servidor cierra con 1009 si se excede; antes el límite era el de `ws`, 100 MiB).
- Cierre `4001` al expirar el token; *heartbeat* cada 30 s que termina conexiones que no responden.
- No se registra el ID de usuario por conexión en los logs.
- Los errores de Python nunca llegan al cliente como texto: solo códigos conocidos (`LLM_TIMEOUT`, `LLM_RATE_LIMIT`, …) con mensajes en español.

### A.10 Servidor de IA (Python)

- Escucha solo en **`127.0.0.1`** (antes `0.0.0.0`).
- Exige `X-MCP-Secret` (comparación con `hmac.compare_digest`) y **rechaza cualquier conexión con cabecera `Origin`** (los navegadores siempre la envían; Node no). Sin secreto válido responde 403. No arranca sin `MCP_SHARED_SECRET` fuerte (`MCP_ALLOW_NO_SECRET=1` existe solo para pruebas).
- Topes: mensajes de hasta 1 MiB (`MCP_MAX_MESSAGE_CHARS`; uno mayor recibe un error sin cortar la conexión compartida), 4 MiB a nivel de uvicorn, 1 000 sesiones (`MCP_MAX_SESSIONS`) con TTL de 2 h, información de proyecto y mensajes de usuario ≤ 4 000 caracteres.
- Una tarea por mensaje, lock por sesión (orden dentro de la sesión, concurrencia entre sesiones) y lock global de envío; **toda** respuesta lleva `sessionId` y `requestId`, así una sesión nunca recibe respuestas de otra (verificado en el E2E).

### A.11 Otras defensas

- `helmet`; CORS limitado a `FRONTEND_URL`; 404 y manejador de errores con el sobre `{success: false, error, code}`: los errores desconocidos responden 500 `INTERNAL_ERROR` sin texto de la BD o del driver.
- Validación de entrada (`middleware/validate.js` y validaciones por ruta): textos con la longitud de su columna, enteros y fechas reales, color de rol en hex y ícono como nombre de ícono Material; entrada inválida → 400 (antes, 500). Violaciones de UNIQUE/FK se traducen a 409/400.
- Explorador: `path` sin `..`, rutas absolutas, `\` ni caracteres de control (con doble decodificación contra `%2e%2e`); `ref` con las reglas de `git check-ref-format`; solo se llama al host de la API de GitHub.
- Frontend: markdown del chat con `rehype-sanitize` después de `rehype-raw`; README con sanitize y **sin** `rehype-raw`, imágenes solo de hosts de GitHub (`referrerPolicy="no-referrer"`); build de producción sin *source maps*.
- Contraseñas con bcrypt (coste 10); se rechazan contraseñas de más de 72 bytes (bcrypt las truncaría).
- Higiene: `taskmate-api/node_modules` fuera de Git, `*.pem` ignorado, dependencias vulnerables actualizadas (`9917d37`).

### A.12 Resultado de las revisiones

- **Revisión de seguridad** tras la integración: 2 hallazgos altos, 2 medios y 5 bajos; todos atendidos en `349aa02..c1489f8`.
- **Re-verificación de seguridad:** 15 hallazgos corregidos por completo; los parciales/bajos restantes se cerraron en `a931a1a`.
- **E2E en vivo** sobre un contenedor nuevo creado con la imagen reconstruida: todos los escenarios en verde, incluidos IDOR entre grupos, ciclo de vida atómico con rollbacks forzados, texto Unicode de ida y vuelta, sucesión del admin por antigüedad, que el login de la app **no** puede ejecutar DDL, que el mismo cuerpo firmado con otro `delivery id` se trata como duplicado, y que Python rechaza secreto ausente/incorrecto y conexiones con `Origin`.

---

## Parte B — Diseño de la base de datos

### B.1 Qué se agregó

| Objeto | Migración | Propósito |
|--------|-----------|-----------|
| `GitHubInstallations` | 002 | Instalaciones de la App (cuenta dueña, tipo, suspensión) |
| `GitHubRepositories` | 002 | Repositorios conocidos (nombre, rama por defecto, privacidad) |
| `GroupRepositories` | 002 (+005) | Vínculo grupo → repositorio y permiso de IA por grupo |
| `TaskBranches` | 002 | Rama de cada tarea |
| `PullRequests` | 002 | Estado de los PRs (sin FK a `TaskBranches`) |
| `GitHubWebhookDeliveries` | 002 (+005) | Bitácora e idempotencia de webhooks |
| `AnalyticsConfig` | 001 | Configuración de analytics por grupo (el código ya la usaba y no existía) |
| `SchemaMigrations` | runner | Registro de migraciones aplicadas |
| `UserGroups.joined_at` | 005 | Antigüedad del miembro (sucesión del admin) |
| `DeleteTask.percentage` | 001 | Solo si faltaba (BD creadas con un esquema viejo) |
| Índices en todas las FKs, UNIQUE faltantes, FKs compuestas | 001 | Integridad y rendimiento |
| Textos visibles `VARCHAR → NVARCHAR` | 005 | Unicode sin pérdida |
| Triggers de porcentaje de nodos | 003 | Única definición versionada |

Resultado: de 14 a 22 tablas. El diagrama entidad-relación está en el [README](README.md#diagrama-5-modelo-entidad-relación-de-las-tablas-nuevas).

### B.2 3FN tabla por tabla

| Tabla | Claves candidatas | Dependencias funcionales | Por qué cumple 3FN |
|-------|-------------------|--------------------------|--------------------|
| `GitHubInstallations` | `installation_id` | `installation_id → account_login, account_type, created_at, suspended_at` | Todo depende de la instalación. `account_login` también identifica la cuenta (una App se instala una vez por cuenta), así que su dependencia hacia `account_type` es hacia una clave candidata; no se declara UNIQUE porque GitHub permite renombrar cuentas y el login se actualiza en cada *upsert* |
| `GitHubRepositories` | `repo_id` | `repo_id → installation_id, name, default_branch, is_private, updated_at` | El **dueño no se guarda**: sería transitivo (`repo → instalación → account_login`). `fullName` se arma al leer con un JOIN |
| `GroupRepositories` | `gid` | `gid → repo_id, connected_by, connected_at, ai_analysis_enabled` | Un repositorio por grupo (PK = `gid`); el mismo repo puede estar en varios grupos (`repo_id` sin UNIQUE, con índice). `ai_analysis_enabled` es una decisión del grupo sobre ese repo, no un atributo del repo; por eso vive aquí y se reinicia al cambiar de repo |
| `TaskBranches` | `tid`; `(repo_id, branch_name)` | `tid → repo_id, branch_name, base_sha, created_by, created_at`; `(repo_id, branch_name) → tid` | Todos los determinantes son claves candidatas (BCNF). `branch_name` usa collation `Latin1_General_100_BIN2` porque los refs de Git distinguen mayúsculas |
| `PullRequests` | `pr_id`; `(repo_id, number)` | `pr_id → repo_id, number, head_branch, base_branch, title, is_draft, opened_at, closed_at, merged_at, gh_updated_at` | `state` **no se persiste**: se deriva de `merged_at`/`closed_at` (guardarlo sería una dependencia entre atributos no clave). `CK: merged_at ⇒ closed_at`. Sin FK a `TaskBranches`: el vínculo es `(repo_id, head_branch)` (indexado), porque un PR puede existir antes o después de la fila de la rama y su historia sobrevive cuando la tarea se completa (la rama cae en cascada) |
| `GitHubWebhookDeliveries` | `delivery_id`; `payload_sha256` (único cuando no es NULL) | `delivery_id → event, action, installation_id, received_at, processed_at, status, error, payload_sha256` | Es una bitácora: **sin FKs a propósito** (registra también lo que llega de instalaciones desconocidas). `CK` de estados y coherencia `status ↔ processed_at` |
| `AnalyticsConfig` | `gid` | `gid → analytics_enabled, track_*, data_retention_days, privacy_mode, updated_at` | Una fila por grupo; `CK` de rango y valores permitidos |
| `SchemaMigrations` | `version` | `version → name, applied_at` | — |

**Redundancia controlada (fuera de las tablas nuevas):**
- `gid` en `UserGroupRoles` y en `Edges` es derivable (de `gr_id` y de los nodos). En sentido estricto es una dependencia transitiva; se conserva por compatibilidad y consultas, y la migración 001 la hace **imposible de contradecir** con FKs compuestas `(gr_id, gid) → GroupRoles`, `(uid, gid) → UserGroups` (un rol solo lo tiene un miembro), `(sourceId, gid)` y `(targetId, gid) → Nodes(nid, gid)`.
- `TaskBranches.repo_id` coincide con el repo actual del grupo mientras el vínculo exista; se guarda porque la unicidad de la rama es por repositorio y el webhook busca por `(repo_id, head_branch)`. La coherencia la mantienen `linkGroupRepository`/`unlinkGroupRepository` (borran ramas de otro repo en la misma transacción) y `findTaskByBranch` solo sigue ramas del repo vinculado hoy.
- `Complete` y `DeleteTask` copian datos de la tarea: son **archivo histórico** del momento en que se completó o se borró (la fila original desaparece en la misma transacción).
- `TaskAnalytics` es una **tabla de hechos** histórica: ya no tiene FK a `Tasks` (antes, borrar una tarea borraba su historia); completar marca `completed`, borrar marca `failed`.

**Convenciones:** restricciones con nombre (`PK_`, `FK_`, `UQ_`, `CK_`, `DF_`, `IX_`); fechas nuevas en `DATETIMEOFFSET(0)` con `SYSDATETIMEOFFSET()` (tedious las lee como instante UTC); IDs de GitHub en `BIGINT` (tedious los devuelve como texto y los modelos los normalizan con `Number()`); SHA en `CHAR(40)` con `CK` hexadecimal; FKs hacia `Users` en `NO ACTION`. Cascadas: instalación → repositorios → {vínculos, ramas, PRs}; grupo → vínculo y `AnalyticsConfig`; tarea → rama.

### B.3 Helper de transacciones

`helpers/transaction.js` — `withTransaction(async (tx) => {...}, {retries = 2, lockTimeoutMs = 5000, isolationLevel})`:
- Una sola conexión del pool; `SET XACT_ABORT ON; SET LOCK_TIMEOUT n` en un lote simple; `beginTransaction`.
- `tx.read → rows`, `tx.write → rowCount`, `tx.query → {rows, rowCount}`. Las sentencias pasan por una **cola FIFO**, así que `Promise.all` dentro de la transacción es seguro (tedious ejecuta una petición a la vez por conexión).
- Tras el primer error, todo lo encolado se rechaza sin llegar al servidor (con `XACT_ABORT` el servidor ya revirtió; seguir enviando correría en modo *autocommit*). Si el callback se tragó un error, igual se hace rollback.
- Rollback solo si `conn.inTransaction`; luego `pool.release(conn, {reset: true})` → `conn.reset()` (`sp_reset_connection`): la conexión vuelve limpia (sin transacción, `XACT_ABORT` apagado, `READ COMMITTED`, `LOCK_TIMEOUT` por defecto). Si el *reset* falla, la conexión se cierra y no se reutiliza.
- *Deadlock* (1205): se reintenta el callback completo (2 veces); agotado, o `LOCK_TIMEOUT` (1222) → `AppError('DB_BUSY', 503)`.
- `useTransaction(options, fn)`: las funciones de modelo aceptan `{tx}` para sumarse a la transacción del llamador; sin él abren la suya.
- Dentro de una transacción **no** se llama a GitHub ni al LLM (los datos externos se leen antes, para no retener bloqueos).
- Exporta `isUniqueViolation` (2627/2601), `isFkViolation` (547 de FK), `isCheckViolation`, `isDeadlock`, `violatedConstraint`.

Pruebas específicas (`tests/db/transaction.dbtest.js`): commit, rollback por excepción y a mitad de lote, cola tras un fallo, `Promise.all`, conexión devuelta limpia, `DB_BUSY` por *lock timeout*, reintento de *deadlock*, y **sin fuga de conexiones tras 50 transacciones fallidas**.

### B.4 Operaciones atómicas

| Operación | Dónde | Qué va en una sola transacción |
|-----------|-------|--------------------------------|
| Completar tarea (UI, webhook, sync) | `tasks.model.completeTask` | Bloquea la fila (`UPDLOCK, HOLDLOCK`); inserta/actualiza `Complete` al 100 %; cierra hechos pendientes de `TaskAnalytics`; borra `UserTask` y `Tasks` (`TaskBranches` en cascada). Dos completados concurrentes se serializan: uno `completed`, el otro `already_completed` |
| Webhook de PR | `webhookHandler` | *Upsert* del repositorio, `applyPullRequest`, `completeTask` (si corresponde) y `finishDelivery('processed')` |
| Enviar a papelera | `trashTask` | Copia en `DeleteTask`, hechos → `failed`, borra asignaciones y tarea |
| Borrar lista | `deleteTasksByList` | Bloqueo de rango + hechos → `failed` + asignaciones + tareas |
| Borrar grupo | `deleteGroup` / `deleteGroupCascade` | Todas las tablas hijas |
| Salir del grupo | `leaveGroup` | Traspaso del admin al miembro más antiguo, o borrado del grupo si era el último |
| Quitar miembro | `removeMemberFromGroup` | Roles del miembro + membresía + traspaso del admin si aplica |
| Registro | `registerUserWithPersonalGroup` | Usuario + grupo personal + membresía |
| Crear grupo | `createGroupWithAdmin` | Grupo + membresía del admin |
| Proyecto desde el chat | `ProjectService.createProjectFromPlan` | Grupo, membresía, roles, tareas, hitos y aristas |
| Plan del repositorio | `ProjectService.addPlanToGroup` | Re-verificación de membresía + hitos + tareas |
| Poblar asignaciones | `usertask.model.populateAssignmentsForGroup` | Asignaciones + hechos de analytics |
| Desasignar | `deleteUsertask` | Asignación + hecho pendiente → `reassigned` |
| Borrar nodo / rol | `deleteNode`, `deleteGroupRole` | Aristas + nodo / asignaciones + rol |
| Vincular / desvincular repo | `installFlow.linkRepository`, `unlinkGroupRepository` | Instalación + repositorio + vínculo + limpieza de ramas de otro repo |
| Registrar entrega de webhook | `beginDelivery` | Verificación de duplicado + alta/reclamo con `UPDLOCK, HOLDLOCK` |
| Migración | `runner.js`, `run-migrations.sh` | El archivo completo + su fila en `SchemaMigrations` |

**Lo que no es atómico (a propósito o por imposibilidad):**
- **Crear rama:** GitHub y SQL Server no comparten transacción. Orden: ref en GitHub → fila en BD; si la fila falla se borra solo el ref creado en esa petición; un ref existente se adopta solo si ninguna tarea lo reclama.
- **Hooks de analytics** tras completar: se ejecutan después del commit, sin bloquear la respuesta.
- **Revocación del token OAuth**: *best effort* (se registra el fallo, nunca el token).
- **Repos agregados a una instalación** (webhook): se leen de la API antes de la transacción; si alguno falla se omite y se vuelve a registrar cuando un grupo lo vincule.

### B.5 Migraciones 001–006

| Versión | Qué hace | Reversa (`.down.sql`) |
|---------|----------|------------------------|
| `001_schema_fixes` | Índices en todas las FKs; UNIQUE `UserGroupRoles(uid, gr_id)`, `GroupRoles(gid, gr_name)`, `Edges(sourceId, targetId)`, `UserTask(utid)` **sin borrar datos** (si hay duplicados: `WARNING` y se omite, dejando un índice simple); FKs compuestas de `gid`; `TaskAnalytics` sin FK a `Tasks`; `DeleteTask.percentage` si faltaba; `AnalyticsConfig` | Quita lo agregado; la FK `TaskAnalytics → Tasks` vuelve `WITH NOCHECK` (hay historia de tareas borradas); `percentage` se conserva |
| `002_github` | Las 6 tablas de GitHub | Borra las tablas (y sus datos) |
| `003_triggers` | `UpdateTargetNodePercentage` y `UpdateTargetOnPrerequisiteChange` (`CREATE OR ALTER`, cursores `LOCAL`, `TRIGGER_NESTLEVEL()` acotado); única definición en el repo | Borra los triggers |
| `004_repair_group_admins` | Arreglo de datos único: grupos cuyo admin ya no es miembro (lo que antes corría en cada `getGroupsByUserId`) | No-op |
| `005_unicode_membership_github` | `NVARCHAR` en textos visibles; `UserGroups.joined_at` y reparación por antigüedad; `gr_icon` de 40; `GroupRepositories.ai_analysis_enabled` (0 por defecto); `payload_sha256` con índice único filtrado | Con pérdida: lo que no cabe en el *code page* vuelve a `?`; íconos recortados a 20 |
| `006_bfs_progress_triggers` | Reemplaza los triggers de 003 por la versión BFS por conjuntos que ya corría en la BD de desarrollo (nunca estuvo en el repo): propaga el avance por toda la cadena de aristas «progressor» en un solo disparo, con conjunto de visitados (los ciclos terminan) y tope de 20 niveles | Reinstala la versión de 003 |

Todas son idempotentes (guardas con `OBJECT_ID`, `COL_LENGTH`, `sys.indexes`), usan lotes separados por `GO` y corren en **una transacción cada una** junto con su registro.

```bash
cd taskmate-api
# Credenciales de DDL (en Docker: SA). El login de la app no puede cambiar el esquema.
export MIGRATION_DB_USERNAME=sa MIGRATION_DB_PASSWORD='<SA>'

npm run db:migrate                          # = node migrations/runner.js up
node migrations/runner.js status            # [x]/[ ] por versión
node migrations/runner.js up --to 3         # hasta una versión
node migrations/runner.js up --with-base    # BD vacía: crea antes las tablas base (taskmate_tables.sql)
node migrations/runner.js down --steps 1    # revierte la última
node migrations/runner.js down --to 2       # revierte todo lo que esté por encima de 2
node migrations/runner.js reapply 1         # re-ejecuta 001 (p. ej. tras limpiar duplicados)
```

- **Gemelo con sqlcmd:** `migrations/run-migrations.sh` aplica los mismos archivos con `sqlcmd -b` en la misma sesión que `_begin.sql` y `_record.sql` (variables: `SQLCMDPASSWORD`, `DB_HOST`, `DB_NAME`, `MIGRATE_USER`, `SQLCMD`, `SQLCMD_EXTRA_OPTS`, p. ej. `-C` con mssql-tools18).
- **Contenedor:** `setup-db.sh` (entrypoint de la imagen de `taskmate-api/Dockerfile`) es idempotente: crea la BD, el login y el usuario de la app, las tablas base si faltan, aplica las migraciones pendientes como SA y ajusta permisos. Se puede ejecutar en cada arranque.

### B.6 Logins de mínimo privilegio

| Login | Permisos | Uso |
|-------|----------|-----|
| App (`DB_USERNAME`, p. ej. `sqladmin`) | `db_datareader` + `db_datawriter`; `DENY INSERT, UPDATE, DELETE` sobre `dbo.SchemaMigrations` | La API. No puede ejecutar DDL (verificado en el E2E) ni falsear el registro de migraciones |
| Migraciones (`MIGRATION_DB_USERNAME`) | SA en el Docker de desarrollo; en producción, un login dedicado con `db_ddladmin` | `npm run db:migrate`, `run-migrations.sh`, pruebas de BD |

`setup-db.sh` también **retira** privilegios de imágenes anteriores (`db_owner` y `CONTROL` que daba el antiguo `setup.sql`). Solo aplica a contenedores que arrancan con el nuevo script: el contenedor de desarrollo `taskmate-sql` se creó con la imagen anterior (ver [Pendientes](README.md#pendientes)). Las pruebas de BD reproducen la separación: la app se conecta con el login limitado y las migraciones con `TEST_DB_MIGRATION_*` o SA.

### B.7 Pruebas de la base de datos

`npm run test:db` (8 suites, 81 pruebas) contra un SQL Server desechable en Docker: transacciones (ver B.3), migraciones (arriba/arriba/abajo/arriba, UNIQUE omitidas sin perder datos y agregadas al corregir, FKs compuestas, trigger, reparaciones 004/005, columnas de 005), tareas (`completeTask` concurrente, papelera, borrar lista, filas del flujo viejo), grupos (borrado en cascada, sucesión por antigüedad), proyecto (todo o nada, `x = 250·i`), GitHub (cascadas, cambio de repo, ramas sensibles a mayúsculas, orden de eventos, duplicados y *replay*, entregas atascadas, purga), analytics (contexto de equipo acotado al grupo) y Unicode. Cómo levantar el contenedor: [README → Cómo Reproducir](README.md#cómo-reproducir--verificar).

---

## Parte C — Riesgos residuales

| Riesgo | Impacto | Mitigación actual | Siguiente paso |
|--------|---------|-------------------|----------------|
| **Estado en memoria**: nonces y selecciones del flujo de instalación, planes pendientes, límites del chat/analytics/análisis, contadores de `express-rate-limit`, tokens y presupuesto de GitHub | Solo una instancia de la API; reiniciarla invalida flujos a medias y reinicia contadores | TTLs cortos, topes de tamaño (`TtlStore`) y mensajes claros («el enlace expiró») | Redis o BD si se escala horizontalmente |
| **Rama no atómica** entre GitHub y la BD | Puede quedar un ref huérfano en GitHub | Compensación: se borra el ref creado en la misma petición; un reintento lo adopta | — |
| **Membresía sin invitación/aceptación**: el admin agrega usuarios directamente | Un admin puede meter a cualquiera en su grupo | Todos los datos se acotan por grupo (el contexto de IA solo usa la actividad de ese grupo) | Flujo de invitación |
| **Triggers de la BD de desarrollo** | ✅ Resuelto: la versión BFS que la BD de desarrollo tenía instalada a mano ahora está en la migración 006 | Pruebas de BD de propagación en cadena, ciclos y cambio de tipo de arista | La BD de desarrollo se respaldó (`~/taskmate-backups/`) y se migró el 11 sep 2026 |
| `uuid@8.3.2` anidado bajo `tedious → @azure/msal-node` y bajo `node-cron` | Aviso de `npm audit` | No explotable aquí (Azure AD no se usa) | Actualizar cuando lo hagan las dependencias |
| Avisos de la cadena de build de CRA (`react-scripts` 5) y de `react-router` | Avisos de `npm audit` | No explotables en esta app | Migrar el build (p. ej. Vite) en una fase futura |
| Límites de Groq (plan gratuito) | `LLM_RATE_LIMIT` con uso intenso | Mensajes con reintento y 1 análisis simultáneo | Plan de pago o cola |
| smee.io en desarrollo | Quien conozca la URL del canal ve los eventos | HMAC obligatorio; canal propio | Endpoint HTTPS real en producción |
| Tareas completadas se mueven a `Complete` | Dos tablas para la misma entidad según su estado | Movimiento atómico | Columna `completed_at` en `Tasks` |
| Contenedor de desarrollo con la imagen anterior | Sin login de mínimo privilegio en esa BD | Contenedores nuevos ya lo aplican | Reconstruir la imagen conservando los datos o aplicar los `ALTER ROLE`/`DENY` a mano |

---

**Documento generado:** 11 sep 2026
**Autor:** Pablo Pineda

# Guía técnica de TaskMate

**En una frase:** la referencia técnica de TaskMate tal como está en el código de la rama `test/e2e` (`50f77da`, 25 nov 2026): arquitectura, carpetas, módulos, API, base de datos, variables, puertos, pruebas y convenciones.

## Resumen
- Tres procesos propios (React en `:3000`, API Express en `:9000` y el servicio Python del chat, FastAPI en `127.0.0.1:MCP_PORT`, 8001) más SQL Server 2019 en un contenedor (Docker o Podman).
- Opcional: el **servidor de IA local** de Christian (`taskmate-ai-server`, repo aparte), FastAPI en `127.0.0.1:8000` con Ollama (`:11434`) y Postgres 17 + pgvector (`:5432`). Sirve para auditar la rama de una tarea, generar pruebas, revisar el PR y dar conocimiento al chat.
- La API es la única que habla con la BD y con GitHub. El servicio Python usa Groq (`openai/gpt-oss-20b`, valor por defecto) u Ollama (`gemma4:e2b-it-qat`) según `LLM_PROVIDER`.
- 110 rutas REST, 3 WebSockets (`/chat`, `/insights`, `/events`) y 29 tablas (migraciones 001–011).
- La línea de Pablo cerró el 3 nov 2026 con las Fases 1–4 (`master` sigue en `ea25733`). La de Christian siguió: monitoreo de Vercel, archivos por tarea, IA sobre el código y chat con modelo local. Todo eso vive en `test/e2e` y todavía no está en `master`.
- 2087 pruebas en verde (25 nov 2026). Esta guía se escribió desde el código: si algo no coincide, manda el código.

**Limitaciones conocidas y TODO pendiente:** viven en un solo lugar, el [cierre de la línea de Pablo y estado](../01-proyecto/cierre-del-proyecto.md#limitaciones-conocidas). Aquí solo se mencionan.

---

## 1. Qué es el proyecto

**TaskMate** es una plataforma colaborativa de gestión de proyectos con IA integrada. Un equipo crea grupos con roles, gestiona listas de tareas, ve las fechas en un calendario, organiza hitos en un diagrama (React Flow) cuyo avance se propaga solo, consulta analytics del equipo y chatea con un asistente de IA. El asistente conversa sobre el proyecto del grupo elegido en la barra de navegación y arma un plan solo cuando se le pide. El modelo es Groq (`openai/gpt-oss-20b`) o, en local, Gemma 4 en Ollama.

Desde la Fase 3 el grupo conecta **su** repositorio de GitHub (GitHub App): explorador, rama por tarea, tarea completada al fusionar el PR y tareas propuestas por la IA a partir del repositorio. Desde la Fase 4 el grupo opera el **CI/CD de su repositorio** sin salir de TaskMate: pipeline propuesto por TaskMate o por la IA, ejecuciones y logs en vivo, ejecutar/re-ejecutar/cancelar, staging automático y producción con aprobación del admin en GitHub Pages, rollback y notificaciones.

| Fase | Estado | Integración en `master` |
|---|---|---|
| 1 · Entornos, repositorio y CI inicial | ✅ Hecha (el «CI» son scripts de prueba locales; el repo de TaskMate no tiene workflow propio) | PR #2 (`7e1610f`) |
| 2 · Optimización del rendimiento | ✅ Hecha (las mejoras son **estimaciones, no mediciones**) | PR #2 (`7e1610f`) |
| 3 · Integración con GitHub (GitHub App) | ✅ Hecha | PR #4 (`183f1cb`) |
| 4 · Pipeline CI/CD gestionado desde TaskMate | ✅ Hecha (22 oct 2026) | PR #5 (`56f7136`) |
| 5 · Testing automático por tarea | No se realizará en la línea de Pablo (cerrada el 3 nov 2026). «Generate tests», de la línea de Christian, propone pruebas pero no las ejecuta | — |
| 6 · SonarQube | Cancelada en la etapa de plan (SonarQube Cloud, sin código) | — |
| 7 · Algoritmo de colisión de archivos (con Christian Martínez) | No se realizará en la línea de Pablo. En la de Christian quedó pospuesta con la base hecha (`TaskFiles`, `findTasksTouchingPaths`, `GET …/overlaps`) | — |
| 8 · Pruebas finales | No se realizará en la línea de Pablo. Las de Christian (su punto 9) siguen pendientes | — |

**Línea de Christian** (puntos 1–7 completos; en `test/e2e` del 18 al 25 nov 2026, sin fusionar en `master`):
- **Chat:** modelo local opcional (`LLM_PROVIDER=ollama`), respuestas en streaming, asistente del proyecto con su contexto (equipo, tareas, hitos y asignaciones) y plan solo si se pide → [Chat con IA](../02-arquitectura/05-chat-ia.md).
- **Archivos por tarea:** diálogo «Task files» con los archivos del PR y las otras tareas que tocan las mismas rutas → [GitHub](../02-arquitectura/07-github.md).
- **Monitoreo de Vercel:** pestaña «Vercel (monitoring)» y webhook firmado → [CI/CD](../02-arquitectura/08-cicd.md).
- **IA sobre el código:** auditar la rama, generar pruebas y revisar el PR con el servidor de IA local → [IA sobre el código](../02-arquitectura/10-ia-sobre-el-codigo.md).
- **Interfaz en inglés** desde el 19 nov 2026 (`d148763`), con el selector de grupo en la barra de navegación.

Fechas planificadas y reales: [calendarización](../01-proyecto/calendarizacion.md) (con la [línea de Christian](../01-proyecto/calendarizacion.md#línea-de-trabajo-de-christian-martínez)) y [capítulos de las fases](../08-fases/README.md).

**Monorepo** `proyecto-is-cc6` con un workspace npm, `taskmate-api`. El servidor de IA local es otro repositorio (`taskmate-ai-server`, privado) que se clona al lado, en `../ai-server`.

### Stack (versiones instaladas)
| Capa | Tecnología |
|---|---|
| Frontend | React 18.3, MUI 6.1, React Flow 12.3 (`@xyflow/react`), react-big-calendar 1.15, react-router-dom 6.30, react-markdown 10 con rehype-sanitize 6; Create React App (react-scripts 5.0.1) |
| API | Node.js (desarrollada con Node 24), Express 4.22, tedious 18.6 (SQL Server), ws 8.21, helmet 8.3, express-rate-limit 8.7, jsonwebtoken 9, bcryptjs 2.4, node-cron 3 |
| Servicio Python del chat | Python 3.9+, FastAPI 0.128, uvicorn 0.39, websockets 15, groq 1.0 (Groq), httpx 0.28 (Ollama), pydantic 2.12 |
| Servidor de IA local (repo aparte) | Python 3.12+, FastAPI, uvicorn, httpx, psycopg, pypdf; Ollama con `gemma4:e2b-it-qat` y `embeddinggemma:300m`; Postgres 17 + pgvector |
| Base de datos | SQL Server 2019 en Docker o Podman (`mcr.microsoft.com/mssql/server:2019-latest`) |
| Pruebas | Jest 30 + supertest 7 (API), Jest 27 de react-scripts + React Testing Library 13 (frontend), pytest 8.4 + pytest-asyncio 1.2 (servicio Python) |

---

## 2. Arquitectura

Tres procesos propios más SQL Server en un contenedor, y el servidor de IA local como pieza opcional. La API es la única que habla con la BD y con GitHub. El servicio Python no tiene acceso a la BD. El servidor de IA local lo llaman la API (comandos) y el servicio Python (búsqueda).

```mermaid
flowchart LR
    FE["Frontend React 18 + MUI 6<br/>CRA :3000"]
    subgraph API["API Node.js + Express :9000"]
        REST["REST /api/*<br/>JWT, helmet, CORS, rate limit"]
        WSS["WebSocketServer<br/>/chat, /insights, /events"]
        HOOK["POST /api/github/webhook<br/>HMAC SHA-256"]
        VHOOK["POST /api/deploy/webhook/vercel<br/>HMAC SHA-1"]
        GHS["services/github<br/>GitHub App"]
        AIC["services/aiServer<br/>audit, pruebas, revisión"]
        LLMS["LLMService<br/>un WebSocket compartido"]
        DATA["models + helpers/pool<br/>tedious"]
    end
    subgraph PY["Servicio Python del chat 127.0.0.1:MCP_PORT"]
        ORCH["OrchestratorAgent /ws"]
        AG["Agentes: recommendations,<br/>analytics, repo_analysis, pipeline"]
        KN["knowledge.py"]
    end
    subgraph AIS["Servidor de IA local 127.0.0.1:8000"]
        CMD["/commands y /search"]
        PG[("Postgres 17 + pgvector<br/>:5432")]
    end
    DB[("SQL Server 2019<br/>contenedor taskmate-sql :1433")]
    GROQ["Groq API<br/>openai/gpt-oss-20b"]
    OLL["Ollama :11434<br/>gemma4:e2b-it-qat"]
    GH["GitHub: REST, GraphQL,<br/>Actions y Pages"]
    SMEE["smee.io<br/>solo desarrollo"]
    VER["Vercel"]

    FE -->|"HTTP con Bearer JWT"| REST
    FE -->|"WebSocket con ?token="| WSS
    WSS --> LLMS
    REST --> LLMS
    LLMS -->|"WebSocket con X-MCP-Secret"| ORCH
    ORCH --> AG
    ORCH -->|"LLM_PROVIDER=groq"| GROQ
    ORCH -->|"LLM_PROVIDER=ollama"| OLL
    ORCH --> KN
    KN -->|"POST /search, solo sin proyecto"| CMD
    REST --> AIC
    HOOK -->|"revisión del PR en segundo plano"| AIC
    AIC -->|"HTTP con X-AI-Server-Secret"| CMD
    CMD --> OLL
    CMD --> PG
    REST --> GHS
    AIC -->|"review COMMENT"| GHS
    GHS --> GH
    GH -->|"webhooks"| SMEE
    SMEE --> HOOK
    HOOK -->|"eventos CI/CD"| WSS
    VER -->|"webhook firmado, túnel público"| VHOOK
    REST --> DATA
    HOOK --> DATA
    VHOOK --> DATA
    DATA --> DB
```

Puntos clave:
- **REST** para todo el CRUD. Todas las rutas piden JWT salvo registro, login, el callback de GitHub (lo autentica su `state` firmado) y los dos webhooks (los autentica su firma HMAC: SHA-256 con prefijo `sha256=` en GitHub, SHA-1 en hexadecimal sin prefijo en Vercel).
- **Tiempo real** solo en tres canales WebSocket: `/chat` (chat con IA, con respuestas en streaming), `/insights` (recomendaciones de asignación del dashboard) y `/events` (eventos de CI/CD: ejecuciones, jobs, deploys y solicitudes de producción). Los cambios de tareas, nodos y aristas **no** se difunden a otros clientes, y los despliegues de Vercel tampoco: se ven al recargar o con «Refresh».
- **Servicio Python del chat** (`taskmate-api/mcp/`): FastAPI con un único WebSocket `/ws` y un protocolo JSON propio (`{sessionId, requestId, method, params}`). La carpeta se llama `mcp/` por el diseño inicial, pero **no** implementa el Model Context Protocol (no hay SDK de MCP, JSON-RPC ni `tools/list`).
- **Servidor de IA local** (`taskmate-ai-server`): API HTTP aparte, opcional. Sin `AI_SERVER_URL`, las rutas de IA sobre el código responden 503 `AI_SERVER_DISABLED` y el chat funciona sin la búsqueda de conocimiento. Comparación con el servicio Python en la [sección 4](#servicio-python-del-chat-vs-servidor-de-ia-local).
- **Una sola instancia de la API**: guarda estado en memoria (sesiones de chat y su contexto del proyecto, planes pendientes, flujos de instalación de GitHub en `ttlStore`, contadores de `express-rate-limit`, suscripciones de `/events`).

Diagramas completos: [arquitectura](../02-arquitectura/00-general.md), [IA sobre el código](../02-arquitectura/10-ia-sobre-el-codigo.md), y los de las Fases 3 y 4 en sus capítulos ([Fase 3](../08-fases/fase-03-integracion-github/README.md), [Fase 4](../08-fases/fase-04-pipeline-cicd/README.md)).

---

## 3. Estructura de carpetas

Archivos versionados (`git ls-files`), sin `node_modules`, `taskmate-api/mcp/venv/`, `.local/` (pids y logs de `local-up.sh`, ignorada) ni los entregables PDF/DOCX sin versionar de la raíz.

```
proyecto-is-cc6/
├── package.json                  ← workspaces ["taskmate-api"]; scripts start, build, test, start:api
├── start.sh                      ← arranca SQL Server (Podman si responde, si no Docker), el servicio Python y la API (pensado para macOS)
├── scripts/
│   ├── local-up.sh               ← Linux + Podman: IA local, SQL Server + migraciones, servicio Python, API y web; genera o completa la .env
│   └── local-down.sh             ← lo detiene sin borrar datos (--all también apaga el servidor de IA local)
├── .env.production               ← solo GENERATE_SOURCEMAP (no es secreto)
├── README.md                     ← inicio rápido
├── documentacion/                ← toda la documentación (índice en documentacion/README.md)
│   ├── 01-proyecto/              ← documento del proyecto, calendarización y cierre
│   ├── 02-arquitectura/ … 06-flujos/   ← arquitectura, BD, casos de uso, interfaz y flujos (páginas 00-* generales y una por módulo, 01–10)
│   ├── 07-guias/                 ← primer arranque, uso, pruebas, Docker, GitHub App, CI/CD y esta guía
│   ├── 08-fases/                 ← plantilla y un capítulo por fase (01–04)
│   └── 09-linea-christian/       ← la línea de Christian: chatbot local y entorno local
├── public/                       ← index.html, manifest.json, robots.txt
├── src/                          ← Frontend React (CRA)
│   ├── App.js                    ← rutas (React.lazy + Suspense), ThemeProvider, GroupProvider, RealtimeProvider
│   ├── index.js · config.js      ← API_BASE / WS_BASE (REACT_APP_API_URL / REACT_APP_WS_URL; si no, el host de la página en :9000)
│   ├── api/                      ← client.js (apiFetch, ApiError) · github.js (una función por ruta /api/github) · deploy.js (/api/deploy)
│   ├── components/
│   │   ├── Login, Register, HomePage, Navbar, NavGroupSelector, GroupContext
│   │   ├── Recordatorios, ListaRecordatorios, BarraLateral, Dialogos, SeleccionarPersona   ← tareas
│   │   ├── CalendarView · BlockDiagram (hitos) · AnalyticsDashboard · ChatPage
│   │   ├── GroupsView, GroupRolesPanel, RoleForm, AssignRolesDialog, UserRolesChips
│   │   ├── flow/                 ← Flow, CustomNode, FloatingEdge, CustomConnectionLine, utils
│   │   ├── github/               ← GitHubPage, RepositoryPanel, RepoSelection, RepoExplorer, FileViewer,
│   │   │   │                       CommitList, TaskGitHubActions, TaskFilesDialog, TaskAiPanel, BranchToastMessage,
│   │   │   │                       ChatProjectInfo, RepoPlanCard, useTaskLinks, githubUtils
│   │   │   └── cicd/             ← CicdPanel, PipelineCard, PipelineSetup, RunList, RunDetail, JobLog,
│   │   │                           DeployPanel, cicdUtils, useVisibleInterval
│   │   ├── deploy/               ← DeploymentPanel (pestaña «Vercel (monitoring)»)
│   │   ├── realtime/             ← RealtimeContext (WS /events), CicdNotifications
│   │   ├── hooks/useGroupRoles.js
│   │   └── ui/                   ← Button, Card, TextField (design system)
│   ├── hooks/useWebSocket.js     ← reconexión exponencial 1 s → 30 s (5 intentos), heartbeat 30 s
│   ├── theme/                    ← ThemeProvider, theme.js, themeUtils, useTheme, globalStyles.css
│   ├── constants/                ← limits.js (límites de formularios = validación del servidor), ws.js (códigos de cierre)
│   └── utils/ids.js              ← comparación de GUID sin distinguir mayúsculas
└── taskmate-api/                 ← API Node.js + servicio Python del chat
    ├── server.js                 ← carga .env, valida JWT_SECRET, crea HTTP + WebSocketServer, pool, jobs
    ├── app.js                    ← createApp(): helmet, CORS, los 2 webhooks (raw), express.json, routers, errores
    ├── controllers/  (14)        ← user, tasks, group, nodes, edges, complete, delete, usertask,
    │                               groupRoles, userGroupRoles, analytics, utils, github, deploy
    ├── models/       (16)        ← access, aiReview, cicd, complete, delete, deployment, edges, github, group,
    │                               groupRoles, nodes, tasks, user, userGroup, userGroupRoles, usertask
    ├── helpers/                  ← pool.js, execQuery.js, transaction.js (withTransaction), tokens.js, errors.js (AppError)
    ├── middleware/               ← auth.middleware.js, groupAccess.js, rateLimit.js, cors.js, validate.js, errorHandler.js
    ├── services/                 ← WebSocketServer, SessionManager, UserSession, LLMService, ProjectService,
    │   │                           AnalyticsService, AnalyticsIntegration, AnalyticsBatchJob, analyticsContext, realtime
    │   ├── github/   (20)        ← githubApp, oauth, installFlow, ttlStore, repoService, repoSnapshot, repoPlan,
    │   │                           branchName, branchService, pullRequestProcessor, syncService, taskFileService,
    │   │                           webhookHandler, webhookSignature, cicdEvents, pipelineSpec, pipelineService,
    │   │                           pipelineAi, actionsService, deployService
    │   ├── aiServer/ (3)         ← client (HTTP al servidor de IA local), taskAi (audit, generate-tests, review), prReview
    │   └── deploy/   (3)         ← deploySignature (HMAC SHA-1), deployWebhookHandler, vercelEvents
    ├── taskmate_tables.sql       ← esquema base (versión 0, 14 tablas)
    ├── migrations/               ← 001–011 (+ .down.sql), runner.js, run-migrations.sh, _schema_migrations.sql, _begin/_record.sql
    ├── Dockerfile · setup-db.sh  ← imagen SQL Server 2019 y arranque idempotente (BD, login sqladmin, esquema, migraciones)
    ├── jest.config.js · jest.db.config.js
    ├── start-mcp-server.sh       ← heredado: fija el puerto 8001 e ignora MCP_PORT; usar start.sh o local-up.sh
    ├── .env.example              ← plantilla de variables (solo marcadores)
    ├── tests/                    ← Jest: raíz, api/, github/, deploy/, aiServer/, middleware/, integration/, db/ (*.dbtest.js), README.md
    └── mcp/                      ← servicio Python del chat
        ├── server.py             ← FastAPI, WebSocket /ws, X-MCP-Secret
        ├── llm_service.py        ← Groq (AsyncGroq) u Ollama (httpx) según LLM_PROVIDER; errores tipados (LLM_TIMEOUT, LLM_RATE_LIMIT, …)
        ├── knowledge.py          ← POST /search al servidor de IA local (conocimiento del chat sin proyecto)
        ├── schemas.py            ← modelos pydantic (analyze_repository, propose_pipeline, ProjectContext del chat)
        ├── agents/               ← orchestrator, recommendations_agent, analytics_agent, repo_analysis_agent, pipeline_agent
        ├── tests/                ← pytest (server, orchestrator, analytics, repo_analysis, pipeline, llm_service, knowledge, local_provider)
        └── requirements.txt · requirements-dev.txt · pytest.ini
```

No existen (las mencionaban versiones anteriores de esta guía): `helpers/getConnection.js`, `middleware/analytics-access.middleware.js`, `taskmate-api/utils/`, `taskmate-api/__tests__/`, `migrations/add_percentage_to_deletetask.sql`, `create_analytics_tables.sql`, `taskmate_triggers.sql`, `taskmate_edge_trigger.sql`, `src/context/` y `src/components/github/ChatProjectSelector.jsx` (se borró el 19 nov 2026, `d148763`). Tampoco están instaladas `axios` (API) ni `google-generativeai` (Python).

---

## 4. Módulos principales por capa

### Frontend (`src/`)
| Módulo | Qué hace |
|---|---|
| `App.js` | 10 pantallas: `/`, `/register`, `/home`, `/tasks`, `/calendar`, `/block-diagram`, `/groups`, `/analytics`, `/chat`, `/github`. Redirecciones: `/` y `/register` → `/home` con sesión; `/flow` → `/block-diagram` y `/create-group` → `/groups` (direcciones antiguas, `/` sin sesión); `*` → `/home` o `/`. `CicdNotifications` se carga bajo demanda |
| `GroupContext.jsx` · `NavGroupSelector.jsx` | Grupo activo (`selectedGroupId`, `selectedGroupName`, guardado en `localStorage`) compartido por todas las vistas. Se elige en el menú de la barra de navegación, junto al logo («Select a group», «Manage groups») |
| `api/client.js` | `apiFetch`: añade el Bearer, normaliza errores en `ApiError {status, code}`, emite `taskmate:unauthorized` en 401 |
| `api/github.js` | 37 funciones, una por ruta autenticada de `/api/github` |
| `api/deploy.js` | 4 funciones, una por ruta de `/api/deploy` |
| `Recordatorios.jsx` | Listas de tareas: crear, editar, completar (`POST /tasks/:tid/complete`), papelera (`POST /tasks/:tid/trash`), asignar, historial de completadas y papelera |
| `BlockDiagram.jsx` + `flow/` | Diagrama de hitos (React Flow `@xyflow/react` 12): nodos, aristas prerrequisito/progresor, % y completado |
| `CalendarView.jsx` | Calendario mensual (`react-big-calendar`) con tareas e hitos |
| `AnalyticsDashboard.jsx` | Panel solo para líderes (REST `dashboard/:gid`) y recomendaciones por WS `/insights` |
| `ChatPage.jsx` | Chat por WS `/chat` sobre el grupo de la barra de navegación (`ChatProjectInfo`, solo lectura): respuestas en streaming (`assistant_chunk`), plan solo si se pide, botón «Propose tasks» (análisis del repositorio) |
| `github/GitHubPage.jsx` | Página `/github` con pestañas «Repository», «Files», «Commits», «CI/CD» (`?tab=cicd`) y «Vercel (monitoring)» |
| `github/TaskGitHubActions.jsx` · `TaskFilesDialog.jsx` · `TaskAiPanel.jsx` | En cada tarea, con repositorio conectado: «Create branch on GitHub» si aún no tiene rama; con rama, el chip de la rama, «View task files» y el chip del PR. El diálogo «Task files» lista los archivos del PR («Also changed by» si otra tarea los toca) y, dentro, el panel «AI on the branch» trae «Audit», «Generate tests» y «Review PR» |
| `github/cicd/*` | Pipeline (propuesta, vista previa, aplicar), ejecuciones, logs, anotaciones, entornos y solicitudes |
| `deploy/DeploymentPanel.jsx` | Pestaña «Vercel (monitoring)»: el admin vincula el Vercel Project ID; todos ven los despliegues y los recargan con «Refresh». No necesita repositorio conectado |
| `realtime/*` | Un WS `/events` por pestaña; refresco en vivo de CI/CD y avisos globales |
| `theme/` | Tema MUI: primario `#3b82f6`, secundario `#f59e0b`, éxito `#10b981`, error `#ef4444`; fuente Inter |

### API (`taskmate-api/`)
| Módulo | Qué hace |
|---|---|
| `app.js` | Monta helmet, CORS, los dos webhooks con `express.raw` de 1 MB (antes de `express.json`), los routers y `notFoundHandler` / `errorHandler` |
| `middleware/auth.middleware.js` | Valida `Authorization: Bearer` (HS256, `typ: 'access'`) → `req.user = {userId, username}` |
| `middleware/groupAccess.js` | `requireGroupMember`, `requireGroupAdmin`, `requireResourceMember` (tarea, nodo, arista, rol…), `requireUuids`; lee el `gid` de params, query o body |
| `middleware/rateLimit.js` | `authLimiter` (10 / 15 min por IP), `apiLimiter` (300 / min por usuario) y `createLimiter` para límites por ruta |
| `middleware/cors.js` | `isAllowedOrigin`: los orígenes de `FRONTEND_URL` (se relee en cada petición) y, con `ALLOW_LAN_ORIGINS=true`, los `http://` de IPv4 privada. Decide CORS y el handshake de los WebSockets |
| `helpers/pool.js` | Pool propio sobre tedious: mín. 2, máx. `DB_POOL_MAX` (10), espera de 10 s, `useUTC: false` |
| `helpers/execQuery.js` | `execReadCommand` / `execWriteCommand` con parámetros tipados |
| `helpers/transaction.js` | `withTransaction(fn, {retries: 2, lockTimeoutMs: 5000})`: reintenta en deadlock, `DB_BUSY` 503 si no se libera; clasificadores de errores SQL |
| `services/WebSocketServer.js` | Upgrade con token y Origin; `/chat`, `/insights`, `/events`; heartbeat 30 s; cierra con 4001 al vencer el token |
| `services/SessionManager.js` · `UserSession.js` | Sesión de chat por usuario (se conserva 1 h desconectada, historial de 100 mensajes); límites de 4000 caracteres y 20 mensajes/min. Arma y guarda en caché el contexto del proyecto, reenvía el streaming y atiende `plan_request` |
| `services/LLMService.js` | Cliente WS único hacia Python con `X-MCP-Secret`; reconexión de 5 s a 5 min; enruta respuestas por `requestId` |
| `services/ProjectService.js` | Crea grupo, membresía, roles, tareas e hitos desde el plan de la IA en **una transacción**; también guarda en un grupo existente las tareas e hitos que la IA propone a partir del repositorio (Fase 3) |
| `services/Analytics*.js` · `analyticsContext.js` | Métricas, expertise y carga; hooks no bloqueantes; job batch opcional; contexto real del equipo para el agente |
| `services/realtime.js` | Hub de `/events`: suscripción por grupo con revalidación de membresía |
| `services/github/*` | GitHub App (JWT RS256 + tokens de instalación de 1 h), instalación/OAuth, explorador, ramas, PRs, webhooks, pipeline, Actions y deploys. `taskFileService.js` guarda y recupera la lista de archivos del PR de cada tarea |
| `services/aiServer/*` | `client.js`: `POST {AI_SERVER_URL}/commands/{name}` con `x-ai-server-secret`. `taskAi.js`: audit, generate-tests y la revisión manual sobre el diff de la rama (compare de GitHub). `prReview.js`: revisión del PR disparada por el webhook, una por commit en `AiReviews`, publicada en GitHub como `COMMENT` |
| `controllers/deploy.controller.js` · `services/deploy/*` · `models/deployment.model.js` | Router `/api/deploy` (vincular el proyecto de Vercel y listar despliegues) y webhook de Vercel: firma HMAC SHA-1, idempotencia por entrega y traducción de los eventos `deployment.*` |

### Servicio Python del chat (`taskmate-api/mcp/`)
| Módulo | Qué hace |
|---|---|
| `server.py` | FastAPI, WebSocket `/ws`; rechaza con 403 sin `X-MCP-Secret` (mín. 32 caracteres) y toda conexión con `Origin` |
| `agents/orchestrator.py` | Clasifica cada mensaje en PLAN, CHAT o fuera de tema (`_route`: frases disparadoras o una llamada corta al modelo). CHAT responde en streaming (`response_chunk`); PLAN con proyecto emite `plan_request`, y sin proyecto arma un plan nuevo. Métodos `handle_user_message`, `save_plan_result`, `analyze_repository`, `propose_pipeline` y mensajes `type: analytics` |
| `agents/recommendations_agent.py` | Genera el plan JSON de un proyecto nuevo (mínimo 8 tareas y 3 roles; exactamente 4 hitos) |
| `agents/analytics_agent.py` | Recomendaciones de asignación con el `team_context` real que envía Node |
| `agents/repo_analysis_agent.py` | Propone tareas e hitos a partir de un snapshot del repositorio (Fase 3) y convierte el contexto del proyecto del chat en texto para el prompt |
| `agents/pipeline_agent.py` | Elige valores del pipeline entre opciones detectadas; Node revalida y renderiza desde plantilla fija (Fase 4) |
| `knowledge.py` | `POST {AI_SERVER_URL}/search` al servidor de IA local, solo en el chat sin proyecto; si falla, sigue sin conocimiento |
| `llm_service.py` | Groq (`groq` 1.0, `openai/gpt-oss-20b`, `LLM_REASONING_EFFORT=low`) u Ollama (`/api/chat`, `gemma4:e2b-it-qat`, `think` apagado) según `LLM_PROVIDER`. Todos los agentes pasan por aquí |

### Servicio Python del chat vs servidor de IA local
| | Servicio Python del chat | Servidor de IA local |
|---|---|---|
| Dónde | `taskmate-api/mcp/`, en este repo | `taskmate-ai-server`, repo aparte de Christian (privado), clonado en `../ai-server` |
| Proceso | FastAPI + uvicorn en `127.0.0.1:MCP_PORT` (8001) | FastAPI + uvicorn en `127.0.0.1:8000` |
| Protocolo | Un WebSocket `/ws` con JSON propio | HTTP: `/health`, `/ingest`, `/search`, `/chat`, `/chat/stream`, `/commands`, `/commands/{name}`, `/commands/runs`, `/commands/runs/{run_id}` |
| Secreto | `X-MCP-Secret` (`MCP_SHARED_SECRET`) | `X-AI-Server-Secret` (`AI_SERVER_SECRET`, 32+ caracteres; sin él solo responden `/health`, `/docs`, `/redoc` y `/openapi.json`) |
| Quién lo llama | Solo la API (`LLMService`) | La API (`/commands/audit`, `/commands/generate-tests`, `/commands/review-pr`) y el servicio Python (`/search`) |
| Modelo | Groq `openai/gpt-oss-20b` (por defecto) u Ollama `gemma4:e2b-it-qat` | Ollama: `gemma4:e2b-it-qat` para generar y `embeddinggemma:300m` para embeddings (768 dimensiones) |
| Datos | Sin BD; sesiones en memoria | Postgres 17 + pgvector (contenedor `taskmate-ai-db`, `127.0.0.1:5432`), 7 tablas propias |
| Para qué | Chat, plan, análisis del repositorio, pipeline y analytics | Auditar la rama, generar pruebas, revisar el PR y búsqueda de conocimiento (RAG). Tiene 10 comandos; TaskMate usa 3 |
| ¿Hace falta? | Sí, para el chat y la IA de las Fases 3–4 | No: sin `AI_SERVER_URL` la IA sobre el código responde 503 `AI_SERVER_DISABLED` y el chat sigue sin conocimiento |
| Arranque | `start.sh` o `scripts/local-up.sh` | `../ai-server/scripts/up.sh` (lo llama `local-up.sh`); Linux con systemd y Podman |

Detalle: [IA sobre el código](../02-arquitectura/10-ia-sobre-el-codigo.md) y [chatbot con IA local](../09-linea-christian/CHATBOT-IA-LOCAL.md).

### Base de datos
SQL Server 2019 en el contenedor `taskmate-sql` (imagen de `taskmate-api/Dockerfile`). Detalle en la [sección 6](#6-base-de-datos).

---

## 5. Referencia de la API

### Autenticación
- **Registro** `POST /api/users`: bcrypt, crea usuario + grupo personal + membresía en una transacción.
- **Login** `POST /api/users/login`: JWT HS256 de 24 h con `userId`, `username` y `typ: 'access'`. El frontend lo guarda en `localStorage` (`token` y `user`).
- **REST**: `Authorization: Bearer <token>`. El usuario que actúa siempre sale del token; un `uid` en el body o el query es siempre el usuario **objetivo** (por ejemplo, a quién se asigna).
- **WebSocket**: `ws://<host>:9000/<canal>?token=<JWT>`; se valida también el `Origin` (`FRONTEND_URL` y, con `ALLOW_LAN_ORIGINS=true`, los `http://` de IPv4 privada).
- **Errores**: `{success: false, error, code}` con un `code` estable (`VALIDATION_ERROR`, `NOT_GROUP_MEMBER`, `NOT_GROUP_ADMIN`, `RATE_LIMITED`, `DB_BUSY`, `GITHUB_NOT_CONFIGURED`, `AI_ANALYSIS_DISABLED`, `TASK_NO_BRANCH`, `NO_OPEN_PR`, `AI_SERVER_*`, …).

### Niveles de acceso
| Nivel | Significado |
|---|---|
| **Público** | Sin token |
| **Auth** | JWT válido |
| **Miembro** | Miembro del grupo indicado, o del grupo dueño del recurso (tarea, nodo, arista, rol) |
| **Admin** | El admin del grupo (`Groups.adminId`) |
| **Líder** | El admin, o un miembro con un rol cuyo nombre contiene «leader» (`access.model.isGroupLeader`) |
| **Propio** | Solo el mismo usuario del `:userId` |

Todas las rutas salvo las públicas pasan por `requireAuth` + `apiLimiter`. **Sin UI** = ninguna pantalla la llama (20 rutas; quedan para la API y las pruebas). Las 10 rutas autenticadas nuevas de la línea de Christian sí tienen pantalla.

### 110 rutas REST

**`/api/users`** (3)
| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| POST | `/api/users` | Público (`authLimiter`) | Registro |
| POST | `/api/users/login` | Público (`authLimiter`) | Login → `{uid, token}` |
| GET | `/api/users/getuid?username=` | Auth | UID por nombre de usuario (para agregar miembros) |

**`/api/tasks`** (8)
| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/tasks?gid=` | Miembro | Tareas del grupo, la más antigua primero (`createdAt`, migración 008) |
| GET | `/api/tasks/:id` | Miembro | Una tarea · Sin UI |
| POST | `/api/tasks` | Miembro | Crear tarea |
| PUT | `/api/tasks/:id` | Miembro | Editar tarea (no cambia de grupo) |
| PUT | `/api/tasks/nodes/:id` | Miembro (tarea o nodo) | Edición reducida desde el diagrama de hitos |
| POST | `/api/tasks/:tid/complete` | Miembro | Completar de forma atómica (pasa a `Complete`, cierra analytics, limpia la rama de GitHub) |
| POST | `/api/tasks/:tid/trash` | Miembro | Mandar a la papelera de forma atómica (`DeleteTask` + borrado) |
| DELETE | `/api/tasks/list/:gid/:list` | Miembro | Borrar una lista completa |

**`/api/groups`** (8)
| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| POST | `/api/groups/group` | Auth | Crear grupo (el admin es quien llama) |
| GET | `/api/groups/:gid/members` | Miembro | Miembros |
| GET | `/api/groups/user-groups` | Auth | Grupos del usuario del token (el `?uid=` se ignora) |
| GET | `/api/groups/:gid/roles` | Miembro | Roles del grupo (duplica `/api/grouproles/...`) · Sin UI |
| POST | `/api/groups/join` | Admin | Agregar a otro usuario al grupo |
| DELETE | `/api/groups/remove-member` | Admin | Quitar a un miembro |
| DELETE | `/api/groups/leave` | Miembro | Salir del grupo (si sale el admin, lo sucede el miembro más antiguo; si sale el último, se borra el grupo) |
| DELETE | `/api/groups/delete` | Admin | Borrar el grupo en cascada |

**`/api/nodes`** — hitos del diagrama (9)
| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/nodes/tasks/:gid` | Miembro | Nodos + tareas del grupo (calendario) |
| GET | `/api/nodes/:id` | Miembro | Un nodo · Sin UI |
| GET | `/api/nodes/group/:gid` | Miembro | Nodos del grupo |
| POST | `/api/nodes` | Miembro | Crear nodo (`nid` opcional, no puede ser una tarea de otro grupo) |
| PUT | `/api/nodes/:id` | Miembro | Editar nombre, descripción y fecha |
| PUT | `/api/nodes/:id/coords` | Miembro | Mover |
| PUT | `/api/nodes/:id/percentage` | Miembro | Cambiar % (dispara el trigger de propagación) |
| PUT | `/api/nodes/:id/toggleComplete` | Miembro | Marcar o desmarcar completado |
| DELETE | `/api/nodes/:id` | Miembro | Borrar el nodo y sus aristas |

**`/api/edges`** — aristas (6)
| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| POST | `/api/edges` | Miembro | Crear arista (`prerequisite` 1 por defecto) |
| GET | `/api/edges/group/:gid` | Miembro | Aristas del grupo |
| GET | `/api/edges/:eid` | Miembro | Una arista · Sin UI |
| PUT | `/api/edges/:eid` | Miembro | Cambiar prerrequisito (1) ↔ progresor (0) (dispara trigger) |
| DELETE | `/api/edges/source/:id` | Miembro | Borrar las aristas que salen de un nodo |
| DELETE | `/api/edges/:eid` | Miembro | Borrar una arista |

**`/api/completados` y `/api/delete`** — historiales (2 + 2)
| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/completados/:gid` | Miembro | Tareas completadas, en el mismo orden (`createdAt`) |
| DELETE | `/api/completados/:gid` | Miembro | Vaciar el historial (cualquier miembro puede) |
| GET | `/api/delete/:gid` | Miembro | Papelera, en el mismo orden (`createdAt`) |
| DELETE | `/api/delete/:gid` | Miembro | Vaciar la papelera (cualquier miembro puede) |

**`/api/usertask`** — asignaciones (3)
| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| POST | `/api/usertask` | Miembro (grupo de la tarea) | Asignar (idempotente) + hook de analytics |
| DELETE | `/api/usertask?tid=&uid=` | Miembro (grupo de la tarea) | Desasignar (cierra el hecho como `reassigned`) |
| GET | `/api/usertask?tid=` | Miembro (grupo de la tarea) | Asignados de una tarea |

**`/api/grouproles`** (4)
| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/grouproles/groups/:gid/roles` | Miembro | Listar roles |
| POST | `/api/grouproles/groups/:gid/roles` | Admin | Crear rol (nombre único por grupo, color, icono) |
| PUT | `/api/grouproles/groups/:gid/roles/:gr_id` | Admin | Editar rol |
| DELETE | `/api/grouproles/groups/:gid/roles/:gr_id` | Admin | Borrar rol |

**`/api/usergrouproles`** (9, todas bajo `/api/usergrouproles/groups/:gid`)
| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `…/userroles` | Miembro | Todas las asignaciones de roles · Sin UI |
| POST | `…/userroles` | Admin | Asignar un rol a un miembro |
| DELETE | `…/userroles/:ugr_id` | Admin | Quitar una asignación por id · Sin UI |
| DELETE | `…/userroles` (body `uid`, `gr_id`) | Admin | Quitar una asignación por claves |
| GET | `…/users/:uid/roles` | Miembro | Ids de roles de un miembro |
| GET | `…/roles/:gr_id/users` | Miembro | Miembros con un rol · Sin UI |
| GET | `…/users/:uid/roles/:gr_id` | Miembro | ¿Tiene ese rol? · Sin UI |
| GET | `…/roles/:gr_id/count` | Miembro | Cuántos tienen el rol · Sin UI |
| GET | `…/rolesmatrix` | Miembro | Matriz usuario × rol |

**`/api/analytics`** (11)
| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/analytics/user/:userId` | Propio, o Líder con `?groupId=` | Resumen individual (de otro miembro, solo el de ese grupo) · Sin UI |
| GET | `/api/analytics/team/:groupId` | Líder | Resumen del equipo · Sin UI |
| GET | `/api/analytics/workload/:groupId` | Líder | Distribución de carga · Sin UI |
| GET | `/api/analytics/trends/:userId?days=` | Propio | Tendencias de compleción (1–365 días, 30 por defecto) · Sin UI |
| GET | `/api/analytics/expertise/:groupId` | Líder | Ranking de expertise por categoría · Sin UI |
| GET | `/api/analytics/config/:groupId` | Líder | Config guardada en `dbo.AnalyticsConfig` (o valores por defecto) · Sin UI |
| PUT | `/api/analytics/config/:groupId` | Líder | Guardar config (MERGE; hoy no cambia el comportamiento) · Sin UI |
| GET | `/api/analytics/dashboard/:groupId` | Líder | Datos del panel (400 si el id no es UUID, 500 si falla la BD; sin mock) |
| POST | `/api/analytics/recommendations` | Miembro (10 / min) | Recomendaciones de asignación vía el agente de IA · Sin UI |
| POST | `/api/analytics/assignment` | Miembro | Registrar una asignación en `TaskAnalytics` · Sin UI |
| POST | `/api/analytics/completion` | Miembro | Registrar una compleción · Sin UI |

**`/api/utils`** (1)
| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| POST | `/api/utils/populate-assignments/:groupId` | Admin | Siembra asignaciones aleatorias de demo para analytics · Sin UI |

**`/api/github`** — Fase 3 (13 autenticadas)
| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| POST | `/api/github/groups/:gid/install` | Admin (10 / min) | URLs para instalar o autorizar la GitHub App |
| GET | `/api/github/selections/:id` | Auth (solo quien inició la instalación) | Repositorios elegibles tras el callback |
| POST | `/api/github/groups/:gid/repository` | Admin (10 / min) | Vincular el repositorio elegido |
| GET | `/api/github/groups/:gid/repository` | Miembro | Repositorio vinculado |
| DELETE | `/api/github/groups/:gid/repository` | Admin | Desvincular |
| PUT | `/api/github/groups/:gid/ai-analysis` | Admin | Permitir o no el análisis con IA («Allow AI analysis»): repositorio en el chat, auditoría, pruebas y revisión del PR |
| GET | `/api/github/groups/:gid/tree?ref=` | Miembro (60 / min, 600 / h) | Árbol de archivos |
| GET | `/api/github/groups/:gid/file?path=&ref=` | Miembro (60 / min, 600 / h) | Un archivo |
| GET | `/api/github/groups/:gid/readme?ref=` | Miembro (60 / min, 600 / h) | README |
| GET | `/api/github/groups/:gid/commits?ref=&perPage=` | Miembro (60 / min, 600 / h) | Commits recientes |
| POST | `/api/github/tasks/:tid/branch` | Miembro (grupo de la tarea, 20 / min) | Crear la rama de la tarea (`tm/<slug>-<tid8>`) |
| GET | `/api/github/groups/:gid/task-links` | Miembro | Ramas y PRs por tarea |
| POST | `/api/github/groups/:gid/sync` | Miembro (1 cada 30 s) | Reconciliar PRs con GitHub |

**`/api/github`** — Fase 4, CI/CD (18 autenticadas)
| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/github/groups/:gid/pipeline` | Miembro | Pipeline guardado, estado del workflow en la rama por defecto y estado de Pages |
| POST | `/api/github/groups/:gid/pipeline/proposal` | Admin (10 / min) | Propuesta del pipeline (determinista o con IA) |
| POST | `/api/github/groups/:gid/pipeline/preview` | Admin (60 / min) | Vista previa del YAML |
| PUT | `/api/github/groups/:gid/pipeline` | Admin (10 / min) | Aplicar: commit del workflow y activación de Pages |
| GET | `/api/github/groups/:gid/actions/workflows` | Miembro | Workflows del repositorio |
| GET | `/api/github/groups/:gid/actions/runs?branch=&status=&workflow=&page=` | Miembro | Ejecuciones con filtros |
| GET | `/api/github/groups/:gid/actions/runs/:runId` | Miembro | Detalle de una ejecución y sus jobs |
| GET | `/api/github/groups/:gid/actions/jobs/:jobId/logs` | Miembro | Log de un job |
| GET | `/api/github/groups/:gid/actions/jobs/:jobId/annotations` | Miembro | Anotaciones (archivo y línea) |
| POST | `/api/github/groups/:gid/actions/runs` | Miembro (10 / min) | Ejecutar el CI en una rama (`ref`) |
| POST | `/api/github/groups/:gid/actions/runs/:runId/rerun-failed` | Miembro; Admin si es un deploy (10 / min) | Re-ejecutar los jobs fallidos |
| POST | `/api/github/groups/:gid/actions/runs/:runId/cancel` | Miembro; Admin si es un deploy (10 / min) | Cancelar |
| GET | `/api/github/groups/:gid/deployments` | Miembro | Entornos y su historial |
| POST | `/api/github/groups/:gid/deployments` | Admin (10 / min) | Desplegar ya, o rollback, una versión que pasó el CI |
| POST | `/api/github/groups/:gid/deploy-requests` | Miembro (10 / min) | Solicitar producción |
| POST | `/api/github/groups/:gid/deploy-requests/:requestId/approve` | Admin (10 / min) | Aprobar (TaskMate lanza el deploy) |
| POST | `/api/github/groups/:gid/deploy-requests/:requestId/reject` | Admin (10 / min) | Rechazar con nota |
| POST | `/api/github/groups/:gid/deploy-requests/:requestId/cancel` | Miembro (solo el solicitante) | Retirar la solicitud propia |

Una ejecución cuenta como deploy (y solo el admin la re-ejecuta o cancela) si es de TaskMate, de `workflow_dispatch` y su título cumple `/^Deploy (a|to) /`: reconoce el nombre viejo en español y el nuevo en inglés («Deploy to production from TaskMate»).

**`/api/github`** — por tarea, línea de Christian (6 autenticadas, todas bajo `/api/github/tasks/:tid`)
| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `…/files?refresh=` | Miembro (grupo de la tarea, 60 / min, 600 / h) | Archivos del PR de la tarea (`path`, `status`, `+`/`−`). Si no hay lista y la rama tiene PR, la pide a GitHub en ese momento (`?refresh=false` lo evita) |
| GET | `…/overlaps` | Miembro (grupo de la tarea) | Otras tareas del grupo que tocan las mismas rutas (hasta 200 rutas) |
| POST | `…/audit` | Miembro + análisis con IA activado (5 / min entre las tres rutas de IA) | Audita el diff de la rama con el servidor de IA local (reglas + modelo; veredicto `pass`, `warn` o `fail`) |
| POST | `…/generate-tests` | Miembro + análisis con IA activado (5 / min compartidos) | Propone pruebas para el diff (pytest o Jest); no las ejecuta ni las sube |
| GET | `…/review` | Miembro (no pide el permiso de IA) | Última revisión guardada en `AiReviews`, o `null` |
| POST | `…/review` | Miembro + análisis con IA activado + PR abierto (5 / min compartidos) | Revisa el PR ahora y devuelve la última revisión. El webhook `pull_request` lo hace solo en segundo plano |

Errores propios: 409 `TASK_NO_BRANCH`, `AI_ANALYSIS_DISABLED`, `NOTHING_TO_REVIEW`, `NO_OPEN_PR`, `REPO_NOT_CONNECTED` o `INSTALLATION_SUSPENDED`; y los del servidor de IA local (ver el protocolo más abajo). Una revisión por commit (`UNIQUE (tid, head_sha)`).

**`/api/deploy`** — monitoreo de Vercel (4 autenticadas, todas bajo `/api/deploy/groups/:gid`)
| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| PUT | `…/target` | Admin (10 / min) | Vincular el proyecto (`{provider: vercel\|aws, projectRef}`; `projectRef` de 1 a 128 caracteres `[A-Za-z0-9_-]`). 409 `CONFLICT` si ya es de otro grupo |
| GET | `…/target?provider=` | Miembro | Proyecto vinculado, o `null` |
| DELETE | `…/target?provider=` | Admin | Desvincular (los despliegues guardados se quedan) |
| GET | `…/deployments?limit=` | Miembro | Despliegues del grupo, del más nuevo al más viejo (`limit` de 1 a 100, 20 por defecto) |

**Sin Bearer** (3)
| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/github/callback` | Público (`state` firmado de un solo uso, 30 / min por IP) | Vuelta de GitHub tras instalar o autorizar; redirige a `FRONTEND_URL/github` |
| POST | `/api/github/webhook` | Firma HMAC SHA-256 (`X-Hub-Signature-256`, `GITHUB_WEBHOOK_SECRET`), cuerpo crudo de hasta 1 MB | Recibe `installation`, `installation_repositories`, `pull_request`, `workflow_run`, `workflow_job`, `deployment_status` y `ping`; idempotente por id de entrega y hash del payload. `pull_request` además dispara la revisión con IA y, al fusionar, intenta registrar los archivos (según el código no llegan a guardarse; ver limitaciones) |
| POST | `/api/deploy/webhook/vercel` | Firma HMAC SHA-1 en hex sin prefijo (`x-vercel-signature`, `VERCEL_WEBHOOK_SECRET`), cuerpo crudo de hasta 1 MB, sin limitador | Recibe `deployment.*` (`created`, `building`, `succeeded`/`ready`/`promoted`, `error`, `canceled`); idempotente por `id` del evento o SHA-256 del cuerpo. 401 con firma inválida, 400 sin `type`; tras reclamar la entrega, siempre 200 con `duplicate`, `ignored`, `processed`, `failed` o `timeout` (plazo de 8 s) |

Conteo: users 3 · tasks 8 · groups 8 · nodes 9 · edges 6 · completados 2 · delete 2 · usertask 3 · grouproles 4 · usergrouproles 9 · analytics 11 · utils 1 · github 37 + callback + webhook · deploy 4 + webhook de Vercel = **110** (99 en `master`).

### 3 WebSockets (en el puerto de la API)
| Canal | Acceso | Mensajes del cliente | Mensajes del servidor |
|---|---|---|---|
| `/chat?token=` | Auth | `user`, `ping`, `analytics`, `set_context`, `repo_analysis`, `repo_plan_confirm`, `repo_plan_discard` | `assistant`, `assistant_chunk` (texto en streaming con `requestId`; no se guarda en el historial), `system` (p. ej. `project_created`), `history_restore`, `context`, `repo_analysis_status`, `repo_plan`, `repo_plan_saved`, `repo_plan_discarded`, `error` (con `kind: 'analysis'` si viene del análisis), `analytics_response`, `analytics_error`, `pong` |
| `/insights?token=` | Auth; acciones de equipo solo para Líder | `ping`, `analytics` (lista blanca de acciones; 10 / min) | `analytics_response`, `analytics_error`, `pong` |
| `/events?token=` | Auth; solo recibe eventos de grupos donde es miembro | `ping`, `subscribe` (lista de grupos; 20 / min, máx. 10 sockets por usuario) | `subscribed`, `event` con `ci_run`, `ci_job`, `deployment` o `deploy_request`, `pong` |

Rechazos del handshake: sin token o token inválido → 401; `Origin` no permitido → 403 (se permiten `FRONTEND_URL` y, con `ALLOW_LAN_ORIGINS=true`, los `http://` de IPv4 privada; solo desarrollo); ruta desconocida → 404. Mensajes de más de 64 KB cierran con 1009.

**Contexto del proyecto en `/chat`.** El proyecto es el grupo de la barra de navegación (el cliente manda `set_context`). En el primer mensaje, Node arma el contexto y lo guarda en caché: tareas, hitos, nombres de los miembros y asignaciones siempre, y el snapshot del repositorio solo si el admin activó el análisis con IA. En cada mensaje vuelve a comprobar la membresía. Con `LLM_PROVIDER=groq` ese contexto va a Groq; con `ollama` se queda en la máquina.

### Protocolo API ↔ servicio Python (`ws://127.0.0.1:MCP_PORT/ws`, cabecera `X-MCP-Secret`)
- **Node → Python:** `handle_user_message` (con `params.project`: el contexto del proyecto o `null`), `save_plan_result`, `analyze_repository`, `propose_pipeline` y `type: analytics` con las acciones del AnalyticsAgent.
- **Python → Node:** `response_chunk` (streaming del chat si `LLM_STREAM_CHAT=1`; Node lo reenvía como `assistant_chunk` mientras la petición siga viva), `response`, `save_plan` (plan de un proyecto nuevo), `plan_request` (el usuario pidió un plan con proyecto: Node lanza el análisis del repositorio con las mismas comprobaciones que `repo_analysis`: membresía, permiso de IA y 1 por minuto), `repo_analysis_plan` / `repo_analysis_error`, `pipeline_proposal` / `pipeline_proposal_error`, `analytics_response` / `analytics_error` y `error`.
- Node corta la espera del chat y del análisis del repositorio a los 90 s (`LLM_TIMEOUT`).

### Protocolo con el servidor de IA local (`http://127.0.0.1:8000`, cabecera `X-AI-Server-Secret`)
- **API → servidor:** `POST {AI_SERVER_URL}/commands/{audit|generate-tests|review-pr}` con `{project, args}` (`project` = `AI_SERVER_PROJECT`, el mismo para todos los grupos) y los parches del diff de la rama. Plazo `AI_SERVER_TIMEOUT_MS` (180 s).
- **Errores que devuelve la API:** 503 `AI_SERVER_DISABLED` (sin `AI_SERVER_URL`), 504 `AI_SERVER_TIMEOUT`, 502 `AI_SERVER_UNAVAILABLE` (sin conexión), 502 `AI_SERVER_AUTH` (el servidor respondió 401), 400 `AI_SERVER_BAD_REQUEST` (400 o 422), 501 `AI_SERVER_NOT_IMPLEMENTED` y 502 `AI_SERVER_ERROR` (el resto). La interfaz muestra para ellos un texto genérico («Could not audit the branch.», …).
- **Servicio Python → servidor:** `POST {AI_SERVER_URL}/search` con `{query, project, top_k}`, solo en el chat sin proyecto; plazo de 3 s y, si falla, sigue sin conocimiento.

Más detalle por fase: tablas de rutas en los capítulos de la [Fase 3](../08-fases/fase-03-integracion-github/README.md) y de la [Fase 4](../08-fases/fase-04-pipeline-cicd/README.md) (sección «API (rutas)»). Lo nuevo: [GitHub](../02-arquitectura/07-github.md), [CI/CD](../02-arquitectura/08-cicd.md) e [IA sobre el código](../02-arquitectura/10-ia-sobre-el-codigo.md).

---

## 6. Base de datos

**29 tablas** = 14 del esquema base (`taskmate_tables.sql`) + `AnalyticsConfig` (001) + 6 de GitHub (002) + 2 de CI/CD (007) + 3 de despliegues (009) + `TaskFiles` (010) + `AiReviews` (011) + `SchemaMigrations`.

| Grupo | Tablas |
|---|---|
| Núcleo | `Users`, `Groups`, `UserGroups` (con `joined_at`), `Tasks`, `UserTask`, `Nodes`, `Edges`, `Complete`, `DeleteTask`, `GroupRoles`, `UserGroupRoles` |
| Analytics | `TaskAnalytics` (tabla de hechos: `pending`, `completed`, `failed`, `reassigned`), `UserMetrics`, `UserExpertise`, `AnalyticsConfig` |
| GitHub (Fase 3) | `GitHubInstallations`, `GitHubRepositories`, `GroupRepositories`, `TaskBranches`, `PullRequests`, `GitHubWebhookDeliveries` |
| CI/CD (Fase 4) | `RepoPipelines` (un pipeline por repositorio, `spec` JSON), `DeployRequests` (máx. una pendiente por grupo y entorno) |
| Despliegues de Vercel (009) | `Deployments` (estado de cada despliegue; solo avanza con eventos más nuevos), `DeploymentWebhookDeliveries` (bitácora de entregas), `GroupDeployTargets` (un proyecto por grupo y proveedor; `UNIQUE (provider, project_ref)`) |
| Archivos por tarea (010) | `TaskFiles` (archivos del PR de la tarea; PK `(tid, path)`) |
| IA (011) | `AiReviews` (una revisión de PR por commit: `UNIQUE (tid, head_sha)`; `status` `pending`/`done`/`failed`; `posted` `posted`/`no_permission`/`failed`) |
| Control | `SchemaMigrations` |

| Migración | Qué hace |
|---|---|
| `001_schema_fixes` | Índice en cada FK, UNIQUE que faltaban, FKs compuestas que mantienen el `gid` coherente, `TaskAnalytics` como historial, `AnalyticsConfig` |
| `002_github` | Tablas de GitHub (los tokens de instalación nunca se guardan) |
| `003_triggers` | Primera versión versionada de los triggers de progreso (reemplazada por la 006) |
| `004_repair_group_admins` | Corrección única de grupos cuyo admin ya no es miembro |
| `005_unicode_membership_github` | Texto de usuario VARCHAR → NVARCHAR, `UserGroups.joined_at`, sucesión de admin por antigüedad |
| `006_bfs_progress_triggers` | Triggers en anchura (BFS) |
| `007_cicd` | `RepoPipelines` y `DeployRequests` |
| `008_task_created_at` | `created_at` y `created_seq` en `Tasks`, `Complete` y `DeleteTask` (orden estable de las listas) |
| `009_deployments` | `Deployments`, `DeploymentWebhookDeliveries` y `GroupDeployTargets` |
| `010_task_files` | `TaskFiles`, con el índice `IX_TaskFiles_Path` para buscar tareas que tocan las mismas rutas |
| `011_ai_reviews` | `AiReviews` |

Las 009–011 solo crean tablas e índices (sin triggers ni `ALTER`), y sus `.down.sql` borran esas tablas con los datos. Las FK nuevas hacen que un grupo arrastre sus `Deployments` y `GroupDeployTargets`, y una tarea sus `TaskFiles` y `AiReviews` (también al completarla, mandarla a la papelera o borrar su lista).

**Triggers** (006, los únicos 2): `UpdateTargetNodePercentage` (Nodes, AFTER UPDATE) pone en cada nodo destino el promedio redondeado del % de sus fuentes por aristas progresor (`prerequisite = 0`) y propaga hasta 20 niveles con conjunto de visitados; `UpdateTargetOnPrerequisiteChange` (Edges, AFTER UPDATE) recalcula el destino cuando una arista cambia de tipo (0 si ya no le quedan fuentes progresor).

**Login de mínimo privilegio**: la API usa `sqladmin` (solo `db_datareader` + `db_datawriter`); las migraciones usan otro login (`MIGRATION_DB_USERNAME`, `sa` en el contenedor). Montaje del contenedor: [SQL Server en Docker](base-de-datos-docker.md). ERD completo: [base de datos](../03-base-de-datos/00-general.md); diseño (3FN, transacciones): [seguridad y BD de la Fase 3](../08-fases/fase-03-integracion-github/SEGURIDAD-Y-BASE-DE-DATOS.md).

**Otra base, fuera de las 29:** el servidor de IA local guarda sus datos en Postgres 17 + pgvector (`taskmate_ai`, contenedor `taskmate-ai-db`), con 7 tablas: `projects`, `documents`, `chunks`, `chunk_embeddings` (`vector(768)`, índice HNSW por coseno), `conversations`, `messages` y `command_runs`. El resultado de una auditoría queda solo en `command_runs`; TaskMate guarda en SQL Server únicamente las revisiones de PR (`AiReviews`). Detalle: [IA sobre el código (BD)](../03-base-de-datos/10-ia-sobre-el-codigo.md).

---

## 7. Variables de entorno

**Una sola ubicación soportada: la `.env` de la raíz del repositorio.** `start.sh` y `scripts/local-up.sh` lanzan la API desde la raíz, y `server.js` y `helpers/pool.js` cargan esa `.env`; `taskmate-api/.env` solo se lee si la API se arranca desde `taskmate-api/` (`npm run start:api`). Python carga `mcp/.env`, `taskmate-api/.env` y la raíz, sin pisar lo ya definido (gana el primero que define la variable). Plantilla con marcadores: [taskmate-api/.env.example](../../taskmate-api/.env.example). Nunca se versionan valores reales.

`scripts/local-up.sh` genera la `.env` de la raíz si no existe (con `DB_PASSWORD` y `MIGRATION_DB_PASSWORD` aleatorias y `chmod 600`) y le agrega solo las claves que falten: `API_PORT=9000`, `JWT_SECRET`, `MCP_PORT=8001`, `MCP_SHARED_SECRET`, `LLM_WEBSOCKET_URL=ws://127.0.0.1:8001/ws`, `LLM_PROVIDER=ollama`, `OLLAMA_MODEL`, `AI_SERVER_URL=http://127.0.0.1:8000`, `AI_SERVER_PROJECT=TaskMate` y `VERCEL_WEBHOOK_SECRET`. Además copia `AI_SERVER_SECRET` desde `../ai-server/.env`. No agrega `GROQ_API_KEY`, `GITHUB_*` ni `ALLOW_LAN_ORIGINS`.

### API (Node)
| Variable | Obligatoria | Por defecto / nota |
|---|---|---|
| `JWT_SECRET` | Sí | ≥ 32 caracteres aleatorios; la API no arranca con valores cortos o de ejemplo |
| `DB_SERVER`, `DB_NAME`, `DB_USERNAME`, `DB_PASSWORD` | Sí | `DB_USERNAME=sqladmin` en el contenedor; nunca `sa` |
| `MCP_SHARED_SECRET` | Sí | El mismo valor en Node y Python (≥ 32 caracteres) |
| `LLM_WEBSOCKET_URL` | No | `ws://localhost:8001/ws`; debe usar el mismo puerto que `MCP_PORT` |
| `API_PORT` | No | 9000 |
| `FRONTEND_URL` | No | `http://localhost:3000`; orígenes separados por comas (CORS, WebSocket y redirección del callback) |
| `ALLOW_LAN_ORIGINS` | No | Vacío. Solo cuenta si vale exactamente `true`: acepta además los orígenes `http://` de IPv4 privada (10.x, 172.16–31.x, 192.168.x) en CORS y en los WebSockets. Solo desarrollo, nunca en producción |
| `DB_PORT`, `DB_AUTH_TYPE`, `DB_INSTANCE`, `DB_ENCRYPT`, `DB_TRUST_SERVER_CERT` | No | `default`; en localhost: sin cifrado y certificado de confianza |
| `DB_POOL_MAX` | No | 10 |
| `MIGRATION_DB_USERNAME`, `MIGRATION_DB_PASSWORD` | Para `npm run db:migrate`; `local-up.sh` las exige | Login con permisos DDL (`sa`); con `local-up.sh`, `MIGRATION_DB_PASSWORD` es también la contraseña de SA al crear el contenedor |
| `AUTH_RATE_LIMIT_MAX`, `API_RATE_LIMIT_MAX`, `TRUST_PROXY` | No | 10, 300, vacío (sin proxy) |
| `LLM_CONNECT_TIMEOUT_MS` | No | 5000 |
| `ANALYTICS_ENABLED` | No | Activado salvo `false` |
| `ANALYTICS_BATCH_ENABLED`, `ANALYTICS_BATCH_SCHEDULE`, `TZ` | No | `false`, `0 2 * * *`, `UTC` |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY` (PEM en base64), `GITHUB_WEBHOOK_SECRET` | Solo para GitHub (Fases 3–4 y la IA sobre el código) | Sin ellas las rutas de GitHub responden 503 `GITHUB_NOT_CONFIGURED` |
| `GITHUB_APP_CALLBACK_URL`, `GITHUB_INSTALLATION_HOURLY_BUDGET`, `WEBHOOK_DELIVERY_RETENTION_DAYS` | No | vacío, 4000 / h, 90 días (mín. 30) |
| `VERCEL_WEBHOOK_SECRET` | Solo para el monitoreo de Vercel | Vacío: el webhook de Vercel responde 401 a todo. No está en `.env.example`; `local-up.sh` la genera (`openssl rand -hex 20`) y se copia en Vercel → Settings → Webhooks |
| `AI_SERVER_URL` | Solo para la IA sobre el código | Vacío = desactivado (503 `AI_SERVER_DISABLED`). `local-up.sh` pone `http://127.0.0.1:8000` |
| `AI_SERVER_SECRET` | Con `AI_SERVER_URL` | El mismo valor que en la `.env` del servidor de IA local (su `up.sh` lo genera) |
| `AI_SERVER_PROJECT` | No | `TaskMate` |
| `AI_SERVER_TIMEOUT_MS` | No | 180000 (180 s) |

### Servicio Python del chat
| Variable | Obligatoria | Por defecto / nota |
|---|---|---|
| `LLM_PROVIDER` | No | `groq` (valor del código y de `.env.example`) u `ollama` (`local-up.sh` lo pone si falta). Un valor desconocido avisa y usa `groq`. Cambia el modelo de todos los agentes |
| `GROQ_API_KEY` (alias `LLM_API_KEY`) | Solo con `LLM_PROVIDER=groq` | Clave de Groq |
| `MCP_SHARED_SECRET` | Sí | `MCP_ALLOW_NO_SECRET=1` solo en pruebas |
| `MCP_HOST`, `MCP_PORT` | No | `127.0.0.1`, 8001 |
| `LLM_MODEL`, `REPO_ANALYSIS_MODEL` | No | `openai/gpt-oss-20b` (el segundo hereda el primero; con Ollama se ignoran) |
| `LLM_REASONING_EFFORT`, `LLM_TEMPERATURE`, `LLM_TIMEOUT_SEC`, `LLM_MAX_RETRIES` | No | `low`, 0.7 (`.env.example` pone 0.2), 60, 2 |
| `LLM_MAX_TOKENS_CHAT`, `LLM_MAX_TOKENS_PLAN` | No | 1000, 8192 |
| `LLM_STREAM_CHAT` | No | `1`: el chat responde en streaming (`response_chunk`); `0` manda la respuesta entera |
| `OLLAMA_HOST`, `OLLAMA_MODEL` | No | `http://127.0.0.1:11434`, `gemma4:e2b-it-qat` |
| `OLLAMA_NUM_CTX`, `OLLAMA_THINK`, `OLLAMA_KEEP_ALIVE` | No | 8192, `0` (sin razonamiento: con él, Gemma 4 gasta los tokens pensando), `30m` |
| `AI_SERVER_URL`, `AI_SERVER_SECRET`, `AI_SERVER_PROJECT` | No | Las mismas de Node (misma `.env`). Sin `AI_SERVER_URL` no hay búsqueda de conocimiento; el secreto solo se manda si está definido |
| `AI_SERVER_TOP_K`, `AI_SERVER_MIN_SIMILARITY`, `AI_SERVER_TIMEOUT_SEC` | No | 4, 0.3, 3 s. `TOP_K` y `TIMEOUT_SEC` no están en `.env.example` |
| `MCP_LOG_LEVEL`, `MCP_SESSION_TTL_SEC`, `MCP_MAX_SESSIONS`, `MCP_PENDING_SAVE_TTL_SEC`, `MCP_MAX_MESSAGE_CHARS` | No | `INFO`, 7200, 1000, 60, 1 MiB |
| `REPO_ANALYSIS_TIMEOUT_SEC`, `REPO_ANALYSIS_DEADLINE_SEC`, `REPO_ANALYSIS_QUEUE_TIMEOUT_SEC` | No | 35, 80, 20 |
| `PIPELINE_AGENT_TIMEOUT_SEC`, `PIPELINE_AGENT_DEADLINE_SEC`, `PIPELINE_AGENT_QUEUE_TIMEOUT_SEC` | No | 25 (tope 30), 50, 15 |

### Frontend, contenedor, servidor de IA local y pruebas de BD
| Variable | Dónde | Nota |
|---|---|---|
| `REACT_APP_API_URL`, `REACT_APP_WS_URL` | `.env` de la raíz | Por defecto `http://<host de la página>:9000` y `ws://<host de la página>:9000` (el 9000 va fijo en `src/config.js`); CRA las lee al iniciar o compilar |
| `ACCEPT_EULA`, `SA_PASSWORD`, `DB_PASSWORD` | `docker run` / `podman run` del contenedor | `DB_PASSWORD` debe coincidir con la `.env` |
| `AI_SERVER_SECRET`, `GEN_MODEL`, `EMBED_MODEL`, `DATABASE_URL`, `AI_SERVER_ALLOW_NO_SECRET` | `.env` del servidor de IA local (`../ai-server/.env`) | Secreto de 32+ caracteres (sin él no arranca, salvo `AI_SERVER_ALLOW_NO_SECRET=1`); modelos `gemma4:e2b-it-qat` y `embeddinggemma:300m`; `DATABASE_URL=postgresql://taskmate:taskmate@127.0.0.1:5432/taskmate_ai` (obligatoria, sin valor por defecto) |
| `TEST_DB_SERVER`, `TEST_DB_PORT`, `TEST_DB_NAME`, `TEST_DB_USERNAME`, `TEST_DB_PASSWORD`, más `TEST_DB_SA_PASSWORD` (o `TEST_DB_MIGRATION_USERNAME` / `TEST_DB_MIGRATION_PASSWORD`) para las migraciones (o todo en el archivo de `TEST_DB_ENV_FILE`) | `npm run test:db` | Solo un SQL Server **desechable**; nunca `DB_*`. Van en la terminal o en un archivo fuera del repositorio, nunca en la `.env` |

`start.sh` toma `API_PORT`, `MCP_PORT` y `LLM_WEBSOCKET_URL` de la terminal o, si no están, de la `.env` de la raíz. Avisa si el puerto de `LLM_WEBSOCKET_URL` no es `MCP_PORT` y si falta `MCP_SHARED_SECRET`.

---

## 8. Puertos

| Puerto | Servicio | Nota |
|---|---|---|
| 3000 | Frontend (`npm start`) | Origen permitido por defecto (`FRONTEND_URL`). El servidor de CRA escucha en todas las interfaces |
| 9000 | API REST + WebSockets `/chat`, `/insights`, `/events` (`API_PORT`) | Escucha en todas las interfaces. El webhook de GitHub llega a `:9000/api/github/webhook` vía smee en desarrollo; el de Vercel necesita un túnel público hasta `:9000/api/deploy/webhook/vercel` |
| `MCP_PORT` (8001 por defecto) | Servicio Python del chat, solo `127.0.0.1`, ruta `/ws` | `local-up.sh` agrega `MCP_PORT=8001` si falta y se detiene si el puerto lo ocupa otro programa. Se puede usar otro (la máquina de Pablo usaba 8011), y `LLM_WEBSOCKET_URL` debe usar el mismo. Exige `X-MCP-Secret` y rechaza toda conexión con cabecera `Origin` (navegadores) |
| 8000 | Servidor de IA local (`taskmate-ai-server`), solo `127.0.0.1` | Exige `X-AI-Server-Secret`. Opcional |
| 11434 | Ollama, solo `127.0.0.1` | Lo comparten el servicio Python (con `LLM_PROVIDER=ollama`) y el servidor de IA local |
| 5432 | Postgres 17 + pgvector (`taskmate-ai-db`), solo `127.0.0.1` | Base del servidor de IA local, no de TaskMate |
| 1433 | SQL Server (`taskmate-sql`) | El `docker run` de las guías y `local-up.sh` lo publican solo en `127.0.0.1` |
| 14333 (sugerido) | BD de prueba desechable (`taskmate-sql-test`) | Solo para `npm run test:db` ([SQL Server en Docker, §6](base-de-datos-docker.md#6-bd-desechable-para-pruebas)) |

**Desde otro equipo de la red:** como la API y CRA escuchan en todas las interfaces y `src/config.js` usa el host de la página, la app se abre con `http://<IP de la máquina>:3000` si la API tiene `ALLOW_LAN_ORIGINS=true`. Los demás servicios quedan en `127.0.0.1`.

---

## 9. Cómo correr y probar

### Primera vez
Paso a paso, con cómo obtener cada secreto: [primer arranque](primer-arranque.md).
```bash
cd proyecto-is-cc6
npm install                                   # instala también el workspace taskmate-api
cd taskmate-api/mcp && python3 -m venv venv \
  && ./venv/bin/pip install -r requirements-dev.txt && cd ../..   # incluye requirements.txt
cp taskmate-api/.env.example .env             # y completar los marcadores (secretos con openssl rand)
# SQL Server: construir la imagen y crear el contenedor taskmate-sql → base-de-datos-docker.md §1–2
```
En Linux con Podman, `./scripts/local-up.sh` hace todo eso solo: genera la `.env`, construye la imagen, crea el contenedor, instala dependencias y crea el venv. Pide `podman`, `node`, `npm`, `python3`, `curl`, `ss`, `openssl` y Ollama (`~/.local/ollama/bin/ollama`), y el servidor de IA local clonado en `../ai-server` (sin él solo arranca Ollama). Detalle: [entorno local](../09-linea-christian/ENTORNO-LOCAL.md).

Una imagen construida antes de una migración no trae sus tablas: antes de la 007 faltan las de CI/CD, antes de la 008 falta `Tasks.created_at` (`/api/tasks` responde 500) y antes de las 009–011 (18 nov 2026) faltan las de despliegues, archivos y revisiones. Hay que reconstruirla o correr `cd taskmate-api && npm run db:migrate` (con `MIGRATION_DB_*`); `node migrations/runner.js status` debe listar 001–011. `local-up.sh` corre `db:migrate` en cada arranque; `start.sh` no.

### Día a día
```bash
# macOS (Docker Desktop, o Podman si está instalado y responde)
./start.sh       # SQL Server, servicio Python en MCP_PORT y API en API_PORT (logs en /tmp/taskmate-*.log)
npm start        # frontend en :3000 (otra terminal)

# Linux con Podman
./scripts/local-up.sh            # IA local (Ollama + servidor de IA local :8000), SQL Server + migraciones, Python, API y web (--no-web sin React)
./scripts/local-down.sh          # lo detiene sin borrar datos (--all también el servidor de IA local y Ollama)

npx smee-client --url https://smee.io/<canal> --target http://localhost:9000/api/github/webhook   # solo con GitHub
```
`start.sh` está pensado para macOS (usa `lsof` y `nc`; sin Podman ni Docker activos abre Docker Desktop con `open`, y si `open` no existe termina con error). Solo inicia el contenedor existente, no aplica migraciones, y siempre imprime «Todo listo»: si algo no responde, revisar `/tmp/taskmate-mcp.log` y `/tmp/taskmate-backend.log`. `local-up.sh` es idempotente, se detiene si otro programa ocupa un puerto y deja los logs en `.local/logs/` (`mcp`, `api`, `web`, `ai-server-up`, `migrate`…). `taskmate-api/start-mcp-server.sh` fija el puerto 8001 y no sirve si `MCP_PORT` es otro. Para el webhook de Vercel con una cuenta real hace falta un túnel público hasta `:9000` ([entorno local](../09-linea-christian/ENTORNO-LOCAL.md)).

### Pruebas (estado verificado el 25 nov 2026, en `test/e2e`)
Cómo correr cada suite y dónde vive cada prueba: [pruebas](pruebas.md).

| Capa | Comando | Resultado |
|---|---|---|
| API (Jest) | `cd taskmate-api && npm test` | 1322/1322, 54 suites (10 pruebas de rendimiento e integración retornan sin afirmar nada si no hay `NODE_ENV=integration-test`) |
| Frontend (CRA) | `CI=true npm test -- --watchAll=false` | 438/438, 36 suites |
| Servicio Python (pytest) | `cd taskmate-api/mcp && ./venv/bin/python -m pytest` | 210/210 |
| BD real | `cd taskmate-api && npm run test:db` (con `TEST_DB_*`) | 117/117, 10 suites (la nueva es `aiReview.dbtest.js`), en un contenedor SQL Server desechable |
| Rendimiento | `cd taskmate-api && npm run test:performance` | Requiere SQL Server real |
| Lint | `npx eslint src --ext .js,.jsx` | 1 error: `testing-library/render-result-naming-convention` en `src/components/__tests__/NavGroupSelector.test.jsx` (el 5 nov daba 0) |
| Build | `npm run build` | Compila |

**Total: 2087 pruebas**, frente a 1960 al 5 nov 2026 (1246 + 423 + 177 + 114) y 1353 al cerrar la Fase 3. Las suites nuevas cubren Vercel (`tests/deploy/`), el servidor de IA local (`tests/aiServer/`), CORS en la red local (`tests/middleware/`), los archivos por tarea, el streaming del chat, `NavGroupSelector`, `ChatProjectInfo`, `TaskAiPanel` y, en Python, el proveedor Ollama y la búsqueda de conocimiento. Ninguna prueba de BD ejecuta el SQL de `deployment.model.js` ni el de `TaskFiles`. El 3 nov 2026, sobre `master`, además: 0 respuestas HTTP 5xx en 50 llamadas GET de solo lectura y un smoke test de UI con Chrome headless sin excepciones no capturadas. El repositorio de TaskMate no tiene CI propio: el CI/CD de la Fase 4 corre en el repositorio de cada grupo.

---

## 10. Convenciones

- **Errores**: lanzar `AppError(code, message, status)` (`helpers/errors.js`); `sendError` responde `{success: false, error, code}` y nunca reenvía texto del driver (los errores no previstos son 500 `INTERNAL_ERROR`). `mapConstraintError` convierte UNIQUE → 409 y FK → 400. El `code` es el contrato: la UI muestra **mensajes en inglés** a partir de él (`ERROR_MESSAGES` en `src/components/github/githubUtils.js`, `CHAT_ERROR_MESSAGES` y `ANALYSIS_ERROR_MESSAGES` en `ChatPage.jsx`, `ERROR_MESSAGES` en `UserSession.js`), y los errores de Python solo llegan como códigos conocidos (`LLM_TIMEOUT`, `LLM_RATE_LIMIT`, …). Un código sin mensaje propio cae en el texto genérico de la acción.
- **Validación**: `middleware/validate.js` y `src/constants/limits.js` reflejan las columnas (25 caracteres para nombres de tarea, lista, grupo y nodo; 1000 para descripciones); la entrada inválida es 400 `VALIDATION_ERROR`, no un error del driver.
- **Autorización**: la identidad sale siempre del token; usar los guards de `groupAccess.js` en cada ruta nueva. Lo que manda datos del grupo a una IA exige además el permiso de IA del grupo (`aiAnalysisEnabled`).
- **Webhooks**: cuerpo crudo con `express.raw` montado antes de `express.json`, firma comparada en tiempo constante sobre los bytes exactos e idempotencia por id de entrega en su tabla de entregas.
- **SQL**: siempre `execReadCommand` / `execWriteCommand` con parámetros tipados (`{name, type: TYPES.*, value}`); nunca abrir conexiones a mano (solo `pool.js` crea `Connection`).
- **Transacciones**: toda operación de varios pasos va en `withTransaction` / `useTransaction` (`helpers/transaction.js`): registro; crear, abandonar o borrar un grupo; completar, mandar a la papelera o borrar una lista de tareas; crear el proyecto desde el plan; vincular un repositorio; aplicar un PR fusionado; solicitudes de deploy. Reintenta en deadlock y responde `DB_BUSY` 503 si el bloqueo no se libera en 5 s. Los modelos aceptan `{tx}` para sumarse a una transacción abierta.
- **Migraciones**: archivo `NNN_nombre.sql` idempotente con su `NNN_nombre.down.sql`; cada una corre en una transacción junto con su fila en `dbo.SchemaMigrations`. Se aplican con `npm run db:migrate` (`runner.js up|down|status`), al crear el contenedor (`setup-db.sh`) o en cada `local-up.sh`. Nunca editar una migración ya aplicada: agregar otra.
- **Analytics no bloqueante**: los hooks de `AnalyticsIntegration` corren después de responder y tienen `.catch()`. Lo mismo la revisión del PR y el registro de archivos que dispara el webhook: corren en segundo plano y solo registran el error.
- **IDs**: los GUID llegan en mayúsculas de SQL Server y en minúsculas de `uuid()`; comparar con `sameId` (`src/utils/ids.js`, `middleware/groupAccess.js`).
- **Pruebas**: cada cambio trae su prueba en la capa que toca (Jest en `taskmate-api/tests/{api,github,deploy,aiServer,middleware,db}`, React Testing Library junto al componente en `__tests__/`, pytest en `mcp/tests`). Las pruebas de BD solo contra un SQL Server desechable (`TEST_DB_*`), nunca la BD de desarrollo.
- **Commits**: Conventional Commits en inglés (`feat(cicd): …`, `fix(db): …`). El texto que ve el usuario va en inglés desde el 19 nov 2026 (`d148763`); quedan algunos restos en español (p. ej. «Proyecto "X" creado»). La documentación sigue en español.

---

## 11. Estado al cierre de la línea de Pablo

Estado, al 3 nov 2026, de los problemas que listaban las versiones anteriores de esta guía (marzo y septiembre de 2026), verificado contra el código de `master` (`56f7136`).

| # | Problema anterior | Estado | Evidencia |
|---|---|---|---|
| 1 | La config de analytics no persistía | **CORREGIDO** · `12ee245` (MERGE) y `285bf14` (tabla en la migración 001) | `analytics.controller.js:488-516`; `migrations/001_schema_fixes.sql`. Se guarda, pero ningún código la lee para cambiar el comportamiento (ver limitaciones) |
| 2 | Control de acceso de analytics desactivado | **CORREGIDO** · `12ee245`, `b56eef5`, `c3856e5` (JWT en todas las rutas), `aafc3c8` (solo líderes) | `_checkTeamAccess` → `access.model.isGroupLeader` |
| 3 | Mock en el dashboard con grupo inválido o error de BD | **CORREGIDO** · `12ee245`, `aafc3c8` (borra `_getMockDashboardData`), `8bc0701` (ids demo fuera del frontend) | `analytics.controller.js:255-285`: 400 o 500, sin mock |
| 4 | `JWT_SECRET` con valor de respaldo fijo | **CORREGIDO** · `12ee245`, `c1489f8` (`assertStrongJwtSecret`) | `server.js:10-30`; `helpers/tokens.js` |
| 5 | Una conexión por consulta, sin pool | **CORREGIDO** · `12ee245`, `e47c91e`; `getConnection.js` eliminado en `349aa02` | `helpers/pool.js` |
| 6 | AnalyticsAgent con subprocess y datos mock | **CORREGIDO** · `ddf7ca4` | Node envía `team_context` real (`analyticsContext.js`); el mock queda solo para ids demo `test-group-*` |
| 7 | El servicio Python del chat corre aparte y el chat falla sin él | **SIGUE PRESENTE** (es la arquitectura) | `start.sh` o `local-up.sh` lo arrancan; `LLMService` reconecta con backoff y el chat recibe `LLM_ERROR` en vez de colgarse; con `start.sh`, smee y el frontend se arrancan a mano |
| 8 | `onTaskDeletion` marcaba `failed` en vez de `reassigned` | **POR DISEÑO** desde `285bf14` | Borrar = `failed` (`tasks.model.js:209`); desasignar = `reassigned`. Efecto: borrar una tarea asignada baja la tasa de éxito |
| 9 | ProjectService sin rollback | **CORREGIDO** · `285bf14` | `ProjectService.js:206` (`withTransaction`) |
| 10 | Tres librerías de ReactFlow | **CORREGIDO** · `12ee245` | Solo `@xyflow/react` 12 en `package.json` |
| 11 | Fecha fija en los prompts | **CORREGIDO** · `12ee245` | `date.today()` en `orchestrator.py` y `recommendations_agent.py` |
| 12 | Archivos de depuración sueltos | **CORREGIDO** · `dab5d29`, `97041c5`, `5855bb3` | No queda ninguno; tampoco marcadores TODO/FIXME en el código versionado |
| 13 | Estado en memoria (flujos de GitHub, planes pendientes, límites) | **SIGUE PRESENTE** (por diseño) | La API debe correr como una sola instancia |

**Limitaciones conocidas y TODO pendiente**: configuración de analytics sin efecto, una sola instancia de la API, recomendaciones de respaldo del dashboard sin etiquetar, rutas sin UI, mocks de demo y código muerto residual, Python 3.9 sin soporte, avisos de `npm audit`, el proceso de IA recibe toda la `.env`, mejoras de la Fase 2 estimadas y Fases 5–8 no realizadas en la línea de Pablo. Las de la línea de Christian: la lista de archivos que no se guarda al fusionar el PR, el handler de Vercel sin `try/catch` en `beginDelivery`, la revisión fallida que bloquea ese commit, Vercel sin probar con una cuenta real, AWS sin implementar y la colisión de archivos pospuesta. Todas en el **[cierre de la línea de Pablo y estado](../01-proyecto/cierre-del-proyecto.md#limitaciones-conocidas)**.

---

## 12. Para saber más

| Documento | Para qué |
|---|---|
| [README de la raíz](../../README.md) | Inicio rápido |
| [Índice de la documentación](../README.md) | Mapa de todas las páginas y fases |
| [Cierre de la línea de Pablo y estado](../01-proyecto/cierre-del-proyecto.md) | Qué entregó la línea de Pablo, estado al 25 nov, limitaciones y TODO |
| [Calendarización](../01-proyecto/calendarizacion.md) | Fechas de la línea de Pablo y de la de Christian |
| [Primer arranque](primer-arranque.md) | Instalar desde cero, con tus propios secretos |
| [Guía de uso](guia-de-uso.md) | Qué hace cada rol en cada pantalla |
| [Pruebas](pruebas.md) | Correr las cuatro suites, el lint y el build |
| [Guía de la GitHub App](guia-github-app.md) | Registrar la GitHub App (permisos de las Fases 3 y 4, y `Pull requests: write` opcional para la revisión con IA), smee |
| [Guía de CI/CD](guia-cicd.md) | Uso del CI/CD para miembros y admins |
| [SQL Server en Docker](base-de-datos-docker.md) | Contenedor, migraciones y BD desechable |
| [IA sobre el código](../02-arquitectura/10-ia-sobre-el-codigo.md) | Servidor de IA local, auditoría, pruebas y revisión de PR |
| [Línea de Christian](../09-linea-christian/README.md) · [entorno local](../09-linea-christian/ENTORNO-LOCAL.md) · [chatbot con IA local](../09-linea-christian/CHATBOT-IA-LOCAL.md) | Lo que agregó Christian y cómo levantarlo en Linux con Podman |
| [taskmate-api/tests/README.md](../../taskmate-api/tests/README.md) | Organización de las pruebas de la API |
| [Documento del proyecto](../01-proyecto/documento-del-proyecto.md) | Documento académico del proyecto |

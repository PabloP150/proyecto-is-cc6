# CLAUDE_PROJECT_GUIDE.md
# Guía completa del proyecto TaskMate para Claude
# Lee este archivo al inicio de cada conversación para entender el proyecto al 100%

---

## 1. QUÉ ES EL PROYECTO

**TaskMate** — Plataforma colaborativa de gestión de proyectos con IA integrada.
Permite a equipos crear grupos, gestionar tareas, visualizar proyectos como grafos de nodos/milestones,
chatear con un asistente IA (Gemini) que genera planes completos, y ver analytics de rendimiento.

**Monorepo** en `/Users/pablopineda/Downloads/proyecto-is-cc6/`

---

## 2. ARQUITECTURA (3 servicios que deben correr juntos)

```
[React 18 :3000]  <── HTTP REST ──>  [Node.js Express :9000]  <── WebSocket ──>  [Python FastAPI :8001]
                  <── WebSocket ──>          │                                            │
                                     [SQL Server DB]                            [Google Gemini 2.5 Flash]
```

### Puertos
- **3000** → Frontend React (`npm start`)
- **9000** → Backend Node.js (`npm run start:api` desde raíz, o `node taskmate-api/server.js`)
- **8001** → Python MCP Server (`cd taskmate-api/mcp && uvicorn server:app --port 8001`)

---

## 3. ESTRUCTURA DE CARPETAS

```
proyecto-is-cc6/
├── src/                          ← Frontend React
│   ├── App.js                    ← Rutas + Auth + Providers
│   ├── index.js                  ← Entry point
│   ├── components/               ← Todos los componentes
│   │   ├── ChatPage.jsx          ← Chat con IA via WS /chat
│   │   ├── AnalyticsDashboard.jsx← Dashboard analytics via WS /insights + REST
│   │   ├── Flow.jsx (flow/)      ← Editor grafo ReactFlow
│   │   ├── GroupContext.jsx      ← Context: selectedGroupId
│   │   ├── Login.jsx / Register.jsx
│   │   ├── HomePage.jsx / Navbar.jsx / BarraLateral.jsx
│   │   ├── GroupsView.jsx / CreateGroup.jsx
│   │   ├── Recordatorios.jsx / CalendarView.jsx / BlockDiagram.jsx
│   │   ├── AssignRolesDialog.jsx / GroupRolesPanel.jsx / UserRolesChips.jsx / RoleForm.jsx
│   │   ├── Dialogos.jsx / SeleccionarPersona.jsx / ListaRecordatorios.jsx
│   │   ├── flow/                 ← CustomNode.jsx, FloatingEdge.jsx, CustomConnectionLine.jsx, utils.js
│   │   └── ui/                   ← Design System: Button.jsx, Card.jsx, TextField.jsx, index.js
│   ├── hooks/
│   │   └── useWebSocket.js       ← Hook WS con reconexión exponencial + heartbeat 30s
│   │   └── (components/hooks/useGroupRoles.js)
│   └── theme/                    ← ThemeProvider.jsx, theme.js, globalStyles.css, useTheme.js
│
├── taskmate-api/                 ← Backend Node.js + Python MCP
│   ├── server.js                 ← Entry point Express, monta rutas + WebSocketServer
│   ├── package.json              ← deps: express, tedious, ws, jwt, bcryptjs, uuid, axios
│   ├── jest.config.js            ← testEnvironment:node, coverage:services/**
│   ├── controllers/              ← Lógica de cada ruta
│   │   ├── user.controller.js
│   │   ├── tasks.controller.js
│   │   ├── group.controller.js
│   │   ├── nodes.controller.js
│   │   ├── edges.controller.js
│   │   ├── complete.controller.js
│   │   ├── delete.controller.js
│   │   ├── usertask.controller.js
│   │   ├── analytics.controller.js
│   │   ├── groupRoles.controller.js
│   │   └── userGroupRoles.controller.js
│   ├── models/                   ← Queries SQL
│   │   ├── user.model.js / group.model.js / tasks.model.js
│   │   ├── nodes.model.js / edges.model.js
│   │   ├── userGroup.model.js / usertask.model.js
│   │   ├── complete.model.js / delete.model.js
│   │   ├── groupRoles.model.js / userGroupRoles.model.js
│   ├── helpers/
│   │   ├── getConnection.js      ← Conexión SQL Server via tedious (1 conexión por query)
│   │   └── execQuery.js          ← execReadCommand / execWriteCommand
│   ├── services/
│   │   ├── WebSocketServer.js    ← Maneja /chat e /insights, auth JWT en upgrade
│   │   ├── SessionManager.js     ← Map<WebSocket,Session> + Map<userId,Session>, reconexión 1h
│   │   ├── UserSession.js        ← Sesión individual, historial chat max 100 msgs
│   │   ├── LLMService.js         ← EventEmitter, WS client a Python :8001, reconecta cada 5s
│   │   ├── ProjectService.js     ← Crea Group+Tasks+Nodes desde plan IA
│   │   ├── AnalyticsService.js   ← Queries analytics (singleton)
│   │   ├── AnalyticsIntegration.js ← Hooks no-bloqueantes para tracking
│   │   └── (otros: AnalyticsBatchJob, AnalyticsLogger, AnalyticsWebSocketServer, Simple/MinimalWebSocketServer)
│   ├── utils/                    ← analytics-cleanup, analytics-error-handler, analytics-health, analytics-logger, analytics-metrics
│   ├── tests/                    ← Jest tests (SessionManager, UserSession, LLMService, AnalyticsService, etc.)
│   ├── mcp/                      ← Python FastAPI server
│   │   ├── server.py             ← FastAPI, WS /ws endpoint, delega a orchestrator
│   │   ├── llm_service.py        ← Wrapper Gemini: generate(), generate_stream()
│   │   ├── requirements.txt      ← google-generativeai, fastapi, uvicorn, python-dotenv, websockets
│   │   └── agents/
│   │       ├── orchestrator.py   ← Router, historial 20 msgs, 3 fases conversación, save_plan
│   │       ├── recommendations_agent.py ← Genera plan JSON (4-6 milestones, 12-25 tasks)
│   │       └── analytics_agent.py       ← Recomendaciones asignación tareas, mock data fallback
│   └── SQL files:
│       ├── taskmate_tables.sql         ← TODAS las tablas (ver sección 6)
│       ├── create_analytics_tables.sql ← Tablas analytics + índices
│       ├── taskmate_triggers.sql       ← Triggers automáticos
│       ├── taskmate_edge_trigger.sql   ← Trigger para edges
│       └── insert_*.sql / add_*.sql   ← Datos de prueba
│
├── package.json                  ← workspaces:["taskmate-api"], scripts: start/build/test/start:api
├── CLAUDE_PROJECT_GUIDE.md       ← Este archivo
└── DOCUMENTACION_TASKMATE.md     ← Documentación del proyecto
```

---

## 4. AUTENTICACIÓN

- **Registro** (`POST /api/users`): bcrypt hash (salt 10), crea usuario + grupo personal automático
- **Login** (`POST /api/users/login`): bcrypt compare, JWT firmado (userId, username, 24h)
- **Almacenamiento frontend**: `localStorage.setItem('user', JSON.stringify({uid, token}))` + `localStorage.setItem('token', token)`
- **WebSocket auth**: token en query param `ws://localhost:9000/chat?token=<JWT>`
- **JWT_SECRET env**: fallback inseguro `'your-jwt-secret-key-change-in-production'` si no hay .env

---

## 5. TODOS LOS ENDPOINTS API

### Usuarios
```
POST   /api/users                    → Register (crea usuario + grupo personal)
POST   /api/users/login              → Login → {uid, token}
GET    /api/users/getuid?username=   → Obtener UID por username
```

### Tareas
```
GET    /api/tasks?gid=               → Tareas del grupo (normaliza datetime)
GET    /api/tasks/:id                → Una tarea
POST   /api/tasks                    → Crear (tid=uuid)
PUT    /api/tasks/:id                → Actualizar completo
PUT    /api/tasks/nodes/:id          → Actualizar desde nodo (solo name/desc/date)
DELETE /api/tasks/:id                → Eliminar + AnalyticsIntegration.onTaskDeletion()
DELETE /api/tasks/list/:gid/:list    → Eliminar lista completa
```

### Grupos
```
POST   /api/groups/group                → Crear grupo
GET    /api/groups/:gid/members         → Miembros del grupo
GET    /api/groups/user-groups?uid=     → Grupos del usuario
GET    /api/groups/:gid/roles           → Roles del grupo
POST   /api/groups/join                 → Unirse a grupo
DELETE /api/groups/remove-member        → Eliminar miembro (solo admin)
DELETE /api/groups/leave                → Abandonar grupo
DELETE /api/groups/delete               → Eliminar grupo (solo admin, cascada)
```

### Nodos (milestones del grafo)
```
GET    /api/nodes                   → Todos
GET    /api/nodes/tasks/:gid        → Nodos + tareas (UNION)
GET    /api/nodes/:id               → Uno
GET    /api/nodes/group/:gid        → Del grupo
POST   /api/nodes                   → Crear
PUT    /api/nodes/:id               → Actualizar
DELETE /api/nodes/:id               → Eliminar
```

### Aristas (conexiones del grafo)
```
POST   /api/edges                   → Crear
GET    /api/edges/:eid              → Una
GET    /api/edges/group/:gid        → Del grupo
PUT    /api/edges/:eid              → Actualizar prerequisite
DELETE /api/edges/:id               → Eliminar
DELETE /api/edges/source/:id        → Eliminar por source node
```

### Completadas / Eliminadas
```
POST   /api/completados             → Marcar completada + AnalyticsIntegration.onTaskCompletion()
GET    /api/completados/:gid        → Listar
DELETE /api/completados/:gid        → Limpiar tabla
POST   /api/delete                  → Mover a eliminadas
GET    /api/delete/:gid             → Listar eliminadas
DELETE /api/delete/:gid             → Limpiar tabla
```

### Asignaciones Usuario-Tarea
```
POST   /api/usertask                     → Asignar + AnalyticsIntegration.onTaskAssignment()
DELETE /api/usertask                     → Desasignar
GET    /api/usertask?tid=                → Usuarios asignados a tarea
GET    /api/usertask/getutid?tid=&uid=   → Obtener utid específico
```

### Roles de Grupo
```
GET    /api/grouproles/groups/:gid/roles            → Listar roles
POST   /api/grouproles/groups/:gid/roles            → Crear rol (gr_id=uuid)
PUT    /api/grouproles/groups/:gid/roles/:gr_id     → Actualizar
DELETE /api/grouproles/groups/:gid/roles/:gr_id     → Eliminar (cascada en UserGroupRoles)
```

### Asignación de Roles a Usuarios
```
GET    /api/usergrouproles/groups/:gid/userroles              → Matriz completa
POST   /api/usergrouproles/groups/:gid/userroles              → Asignar rol (ugr_id=uuid)
DELETE /api/usergrouproles/groups/:gid/userroles/:ugr_id      → Quitar rol
GET    /api/usergrouproles/groups/:gid/users/:uid/roles        → Roles del usuario
GET    /api/usergrouproles/groups/:gid/roles/:gr_id/users      → Usuarios con ese rol
```

### Analytics
```
GET    /api/analytics/user/:userId          → Resumen individual (workload+expertise+capacity)
GET    /api/analytics/team/:groupId         → Resumen del equipo
GET    /api/analytics/workload/:groupId     → Distribución de carga (users+roles+workload)
GET    /api/analytics/trends/:userId        → Tendencias compleción (últimos 30 días por defecto)
GET    /api/analytics/expertise/:groupId    → Rankings expertise por categoría
GET    /api/analytics/config/:groupId       → Config analytics (⚠️ NO persiste en DB, retorna defaults)
PUT    /api/analytics/config/:groupId       → Actualizar config (⚠️ NO persiste en DB)
GET    /api/analytics/dashboard/:groupId    → Dashboard completo (fallback a mock si falla DB)
POST   /api/analytics/recommendations       → Recomendaciones IA (llama Python via LLMService)
POST   /api/analytics/assignment            → Registrar asignación manual en TaskAnalytics
POST   /api/analytics/completion            → Registrar completado manual
POST   /api/analytics/batch-update          → Actualizar métricas de todos los usuarios activos
POST   /api/utils/populate-assignments/:groupId → Utility: poblar datos analytics para testing
```

### WebSocket
```
ws://localhost:9000/chat?token=<JWT>      → Chat con IA (SessionManager + UserSession)
ws://localhost:9000/insights?token=<JWT>  → Analytics en tiempo real
```

---

## 6. BASE DE DATOS — ESQUEMA COMPLETO

### Tablas Core
```sql
Users:        uid(UUID PK), username(VARCHAR 25 UNIQUE), password(VARCHAR 60)
Groups:       gid(UUID PK), adminId(FK→Users), name(VARCHAR 25)
UserGroups:   uid+gid(PK compuesto), FK ambas
Tasks:        tid(UUID PK), gid(FK), name(VARCHAR 25), description(VARCHAR 1000),
              list(VARCHAR 25), datetime(SMALLDATETIME), percentage(INT 0-100)
UserTask:     utid(UUID), uid+tid(PK compuesto), completed(BIT)
Nodes:        nid(UUID PK), gid(FK), name(VARCHAR 25), description(VARCHAR 1000),
              date(DATE), completed(BIT), x_pos(FLOAT), y_pos(FLOAT),
              percentage(INT 0-100), connections(INT DEFAULT 0)
Edges:        eid(UUID PK), gid(FK), sourceId(FK→Nodes), targetId(FK→Nodes), prerequisite(BIT DEFAULT 1)
Complete:     tid(UUID PK), gid(FK), name(25), description(1000), percentage, datetime(SMALLDATETIME)
DeleteTask:   tid(UUID PK), gid(FK), name(25), description(1000), datetime(SMALLDATETIME)
GroupRoles:   gr_id(UUID PK), gid(FK), gr_name(VARCHAR 40), gr_color(VARCHAR 20), gr_icon(VARCHAR 20)
UserGroupRoles: ugr_id(UUID PK), uid(FK), gid(FK), gr_id(FK), ugr_assigned_at(SMALLDATETIME DEFAULT GETDATE)
```

### Tablas Analytics
```sql
TaskAnalytics:
  id(UUID PK DEFAULT NEWID), tid(FK→Tasks), uid(FK→Users), gid(FK→Groups),
  task_category(VARCHAR 50 DEFAULT 'general'),
  assigned_at(DATETIME2 DEFAULT GETDATE), completed_at(DATETIME2 NULL),
  success_status(VARCHAR 20 DEFAULT 'pending')  → 'pending'|'completed'|'failed'|'reassigned'
  completion_time_hours(DECIMAL 10,2 NULL)
  CHECK: completed_at >= assigned_at, completion_time >= 0

UserMetrics:
  id(UUID PK DEFAULT NEWID), uid(FK), metric_date(DATE),
  active_tasks_count(INT DEFAULT 0), max_concurrent_tasks(INT DEFAULT 0),
  avg_completion_time_hours(DECIMAL 10,2 DEFAULT 0),
  success_rate_percentage(DECIMAL 5,2 DEFAULT 0)
  UNIQUE(uid, metric_date)

UserExpertise:
  id(UUID PK DEFAULT NEWID), uid(FK), task_category(VARCHAR 50),
  expertise_score(DECIMAL 5,2 DEFAULT 0)  → 0-100
  tasks_completed(INT DEFAULT 0),
  avg_completion_time_hours(DECIMAL 10,2 DEFAULT 0),
  success_rate_percentage(DECIMAL 5,2 DEFAULT 0),
  last_updated(DATETIME2 DEFAULT GETDATE)
  UNIQUE(uid, task_category)
  CHECK: task_category IN ('frontend','backend','database','testing','general')
```

### Índices
```sql
IX_TaskAnalytics_uid, IX_TaskAnalytics_gid, IX_TaskAnalytics_assigned_at, IX_TaskAnalytics_task_category
IX_UserExpertise_uid, IX_UserExpertise_task_category
IX_UserMetrics_uid, IX_UserMetrics_metric_date
```

### Triggers
- `taskmate_triggers.sql` → Actualiza porcentaje de nodos cuando cambian sus tareas
- `taskmate_edge_trigger.sql` → Gestiona el campo `connections` en Nodes al crear/borrar Edges

---

## 7. FLUJOS IMPORTANTES

### 7.1 Login completo
```
Login.jsx
→ POST /api/users/login {username, password}
→ bcrypt.compare + JWT sign(userId, username, 24h)
→ {uid, token}
→ GET /api/groups/user-groups?uid=
→ localStorage: user={uid, token}, selectedGroupId, token
→ navigate('/home')
```

### 7.2 Chat IA (flujo completo)
```
ChatPage.jsx → WS ws://localhost:9000/chat?token=JWT
→ WebSocketServer.handleUpgrade() → jwt.verify(token)
→ SessionManager.connect(ws, userId)
  → si userId ya tiene sesión: reconnect() + envía history_restore
  → si es nuevo: new UserSession(userId, ws)
→ UserSession.initialize() → llmService.on(sessionId, handler)
→ Usuario escribe → ws.send({type:'user', content:'...'})
→ UserSession.handleMessage() → llmService.send({sessionId, method:'handle_user_message', params:{message}})
→ LLMService.send() → ws :8001 (Python)
→ OrchestratorAgent.handle_message()
  → conversación 3 etapas: PROJECT_BASICS → FEATURES → TECHNICAL_DETAILS
  → si tiene suficiente info → RecommendationsAgent.handle() → JSON plan
  → pide confirmación al usuario
  → si "yes/ok/sure" → emite {event:'save_plan', data:{plan, original_message}}
→ Respuesta back → LLMService.emit(sessionId) → UserSession.forwardResponseToClient()
  → si event='save_plan': ProjectService.createProjectFromPlan(plan, msg, userId)
    → addGroup + addUserToGroup + addTask(×n) + addNode(×n milestones)
  → si event='response': ws.send({type:'assistant', content})
```

### 7.3 Analytics Dashboard
```
AnalyticsDashboard.jsx monta:
  1. GET /api/analytics/dashboard/:groupId (REST)
     → si groupId es GUID válido: DB real (team+workload+expertise)
     → si no: mock data hardcodeado (3 grupos: test-group-456/789/123)
  2. WS ws://localhost:9000/insights?token=JWT (para recommendations IA)
     → send {type:'analytics', action:'get_task_assignment_recommendations', data:{groupId,...}}
     → → Python AnalyticsAgent.handle() → Gemini → recommendations
     → respuesta: {event:'analytics_response', data:{recommendations:[...]}}
  3. Si WS falla/timeout: genera recomendaciones locales con datos del dashboard
```

### 7.4 Asignación de tarea con tracking
```
Frontend → POST /api/usertask {uid, tid, utid, completed}
→ usertask.controller → UserTaskModel.addUsertask()
→ AnalyticsIntegration.onTaskAssignment(taskId, userId, groupId, taskData) [no-blocking]
  → detectTaskCategory(taskData) → keyword scoring → 'frontend'|'backend'|'database'|'testing'|'general'
  → AnalyticsService.recordTaskAssignment() → INSERT TaskAnalytics (evita duplicados)
```

### 7.5 Completar tarea con tracking
```
Frontend → POST /api/completados {tid, gid, ...}
→ complete.controller → CompleteModel.addComplete()
→ AnalyticsIntegration.onTaskCompletion(taskId, success=true) [no-blocking]
  → AnalyticsService.recordTaskCompletion()
    → UPDATE TaskAnalytics SET completed_at=GETDATE(), success_status='completed',
      completion_time_hours=DATEDIFF(HOUR, assigned_at, GETDATE())
  → _updateUserExpertise() → UPSERT UserExpertise (score = successRate + timeBonus, max 100)
  → _updateDailyMetrics() → MERGE UPSERT UserMetrics
```

---

## 8. SERVICIOS CLAVE — DETALLES

### WebSocketServer.js
- `{noServer:true}` montado via `server.on('upgrade')`
- Autenticación JWT antes del upgrade (rechaza con HTTP 401 si falla)
- `/chat` → `SessionManager` → `UserSession`
- `/insights` → Map de insightsClients por clientId (uuid), escucha LLMService events
- Heartbeat: `setInterval(30000)` → ping a todos los clientes OPEN

### SessionManager.js
- `activeSessions: Map<WebSocket, UserSession>` (por conexión activa)
- `userSessions: Map<userId, UserSession>` (persiste aunque se desconecte)
- Reconexión: si userId ya tiene sesión → reutiliza, manda historial
- Timeout: 1 hora antes de limpiar sesión desconectada

### LLMService.js (singleton, EventEmitter)
- Se conecta a `ws://localhost:8001/ws` (LLM_WEBSOCKET_URL env)
- Reconexión automática cada 5s si se cae
- Enruta respuestas por `sessionId` via `this.emit(sessionId, response)`
- Si Python no está corriendo → chat no funciona (logs de error cada 5s)

### AnalyticsService.js (singleton)
- `getWorkloadDistribution()` usa JOIN con UserGroupRoles para incluir rol del usuario
- Expertise score = `Math.min(100, successRate + Math.max(0, 20 - avgTime/2))`
- Capacidad default = 3 tareas si no hay historial en UserMetrics
- `batchUpdateUserMetrics()` procesa usuarios activos en últimos 7 días

### ProjectService.js
- Trunca nombres a 25 chars (restricción DB): `name.substring(0, 22) + '...'`
- Soporta fechas ISO `YYYY-MM-DD` y duration strings `"2 weeks"`, `"1 month"`
- Si falla una task o milestone → lanza error (no rollback automático)

---

## 9. VARIABLES DE ENTORNO

### taskmate-api/.env
```env
# Base de datos SQL Server
DB_SERVER=localhost
DB_AUTH_TYPE=default          # 'default' para Windows Auth, 'sql' para SQL Auth
DB_USERNAME=sa
DB_PASSWORD=password
DB_NAME=TaskMate
DB_PORT=1433
DB_INSTANCE=                  # Para named instances (dejar vacío si no aplica)
DB_ENCRYPT=false              # true para Azure SQL
DB_TRUST_SERVER_CERT=true     # false para Azure SQL

# Servidor
API_PORT=9000
JWT_SECRET=tu-secreto-aqui    # ⚠️ CAMBIAR EN PRODUCCIÓN

# LLM / Python MCP
LLM_WEBSOCKET_URL=ws://localhost:8001/ws
LLM_API_KEY=tu-gemini-key    # También usado por Python

# Analytics
ANALYTICS_ENABLED=true
```

### taskmate-api/mcp/.env (Python)
```env
GOOGLE_API_KEY=tu-gemini-key  # Principal
LLM_API_KEY=tu-gemini-key     # Fallback
LLM_MODEL=gemini-2.5-flash    # Modelo Gemini
LLM_TEMPERATURE=0.7
LLM_PROVIDER=google
```

---

## 10. COMANDOS PARA CORRER EL PROYECTO

```bash
# Terminal 1 — Frontend (puerto 3000)
cd /Users/pablopineda/Downloads/proyecto-is-cc6
npm start

# Terminal 2 — Backend Node.js (puerto 9000)
cd /Users/pablopineda/Downloads/proyecto-is-cc6
npm run start:api
# o directamente:
node taskmate-api/server.js

# Terminal 3 — Python MCP Server (puerto 8001) — REQUERIDO para el chat con IA
cd /Users/pablopineda/Downloads/proyecto-is-cc6/taskmate-api/mcp
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
# o: sh taskmate-api/start-mcp-server.sh

# Tests del backend
cd taskmate-api && npm test
cd taskmate-api && npm test -- --coverage

# Tests del frontend
npm test
```

---

## 11. PROBLEMAS CONOCIDOS Y LIMITACIONES

| # | Problema | Archivo | Impacto |
|---|---------|---------|---------|
| 1 | **Analytics config NO persiste en DB** | analytics.controller.js `_getGroupAnalyticsConfig` | Siempre retorna defaults hardcodeados |
| 2 | **Access control DESACTIVADO** | analytics.controller.js `getDashboardData`, `getTaskRecommendations` | Cualquiera puede ver cualquier grupo |
| 3 | **Mock data hardcodeado** | analytics.controller.js `_getMockDashboardData` | Solo 3 grupos fake: test-group-456, test-group-789, test-group-123 |
| 4 | **Una conexión por query** | helpers/getConnection.js | Sin connection pool, posible cuello de botella bajo carga |
| 5 | **3 librerías ReactFlow** | package.json | `reactflow` + `@xyflow/react` + `react-flow-renderer` (duplicadas) |
| 6 | **JWT_SECRET con fallback** | user.controller.js, WebSocketServer.js | 'your-jwt-secret-key-change-in-production' si no hay .env |
| 7 | **Fecha hardcodeada en prompts** | orchestrator.py, recommendations_agent.py | "December 11, 2025" en lugar de fecha dinámica |
| 8 | **onTaskDeletion marca 'failed'** | AnalyticsIntegration.js | Llama `recordTaskCompletion(false)` en lugar de marcar 'reassigned' |
| 9 | **Python MCP debe correr manual** | — | Si no está activo, el chat falla. LLMService reintenta cada 5s |
| 10 | **AnalyticsAgent usa subprocess** | mcp/agents/analytics_agent.py | Intenta llamar Node.js via subprocess, con fallback a mock |

---

## 12. TEMA Y DISEÑO

```javascript
// Colores principales (theme.js)
primary:   { main: '#3b82f6', dark: '#1e3a8a', light: '#93c5fd' }  // Azul
secondary: { main: '#f59e0b', dark: '#d97706', light: '#fbbf24' }  // Naranja/Oro
success:   '#10b981'  // Verde esmeralda
warning:   '#f59e0b'
error:     '#ef4444'

// Fondo de la app (App.js)
background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)'
+ radial gradients azul (20% 80%) y naranja (80% 20%)

// Font: Inter, Roboto, Helvetica, Arial
```

---

## 13. RELACIONES ENTRE ARCHIVOS CLAVE

```
server.js
  ├── imports: WebSocketServer, todos los controllers
  ├── WebSocketServer → SessionManager → UserSession → LLMService
  ├── UserSession → ProjectService (para save_plan)
  └── analytics.controller → AnalyticsService, LLMService (para recommendations)

tasks.controller + usertask.controller + complete.controller
  └── → AnalyticsIntegration (hooks no-bloqueantes)
       └── → AnalyticsService
            └── → execReadCommand / execWriteCommand
                 └── → getConnection (tedious SQL Server)

ChatPage.jsx
  └── → useWebSocket('/chat') → WS :9000 → UserSession → LLMService → Python :8001
       └── OrchestratorAgent → llm_service.generate() → Gemini
            └── si 'save_plan' → ProjectService.createProjectFromPlan()

AnalyticsDashboard.jsx
  ├── → REST GET /api/analytics/dashboard/:groupId → AnalyticsController → AnalyticsService → DB
  └── → useWebSocket('/insights') → WS :9000 → LLMService → Python :8001
       └── AnalyticsAgent → Gemini → recommendations
```

---

## 14. NOTAS DE DESARROLLO

- **Patrón tedious**: Cada `execQuery` abre y cierra una conexión nueva. No hay pool.
- **Patrón singleton**: AnalyticsService, AnalyticsIntegration, LLMService son singletons (module.exports = new Class())
- **Parámetros preparados**: Todos los queries usan `{name, type: TYPES.*, value}` — sin SQL injection
- **Fechas**: getConnection tiene `useUTC: false` — usa zona horaria local del servidor
- **Nombres DB**: máximo 25 chars en Users.username, Groups.name, Tasks.name, Nodes.name
- **Analytics no-bloqueante**: todos los hooks de AnalyticsIntegration tienen `.catch()` y nunca bloquean la operación principal
- **Frontend sessionStorage**: al abrir nueva pestaña/tab, limpia localStorage (nueva sesión forzada)
- **Chat history**: persiste en memoria del servidor (UserSession.chatHistory, max 100 msgs, 1h timeout)

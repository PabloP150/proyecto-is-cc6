# Código Antes vs. Después — Lado a Lado

**Comparación visual del código que cambió en Fase 2 (corregida al cierre con los diffs reales)**

> **Nota de cierre (3 nov 2026).**
> - Los extractos siguen los diffs reales de los commits, pero están **resumidos** (`// …` marca lo omitido); el código exacto se ve con `git show <hash>`.
> - **Las cifras de mejora son estimaciones con tiempos supuestos, no mediciones.** La única medición de la fase no evalúa estos cambios ([README, Medición real](README.md#-medición-real-benchmarks)).
> - La Fase 3 reemplazó las secciones 1 y 3.2 (ver las notas): los DELETE en un solo roundtrip y las inserciones en paralelo ahora son transacciones.
>
> Lo que quedó sin hacer está en [cierre del proyecto](../../01-proyecto/cierre-del-proyecto.md).

---

## 1️⃣ `deleteTask()` — Batchear Roundtrips

### ANTES (2 roundtrips)
```javascript
const deleteTask = async (tid) => {
    const param = [{ name: 'tid', type: TYPES.UniqueIdentifier, value: tid }];
    // Clear FK-constrained rows before deleting the task

    // Roundtrip 1
    await execWriteCommand(`DELETE FROM dbo.TaskAnalytics WHERE tid=@tid`, param);

    // Roundtrip 2
    return execWriteCommand(`DELETE FROM dbo.Tasks WHERE tid=@tid`, param);
};
```

**Problema:** Dos `await` secuenciales = dos viajes de red (más un tercero en el controller: `UsertaskModel.deleteAllByTid(tid)`)

---

### DESPUÉS (1 roundtrip)
```javascript
const deleteTask = async (tid) => {
    const param = [{ name: 'tid', type: TYPES.UniqueIdentifier, value: tid }];
    // Clear FK-constrained rows and delete task in a single batch
    return execWriteCommand(
        `DELETE FROM dbo.TaskAnalytics WHERE tid=@tid; DELETE FROM dbo.Tasks WHERE tid=@tid`,
        param
    );
};
// a04a576 agrega "DELETE FROM dbo.UserTask WHERE tid=@tid;" al principio del batch
// y quita deleteAllByTid del controller: el borrado completo queda en 1 roundtrip.
```

**Mejora:** Una sola `await` = un viaje de red  
**Impacto estimado:** -50% roundtrips en esta función

> **Nota (estado al cierre, 3 nov 2026):** reemplazado en la Fase 3 (`349aa02`). Hoy el «borrar» es `POST /api/tasks/:tid/trash` → `trashTask(tid)`, una transacción con varias sentencias (bloqueo, copia en `DeleteTask`, hechos pendientes de `TaskAnalytics` a `'failed'`, `DELETE` de `UserTask` y de `Tasks`). `deleteNode()` y `deleteGroupRole()` (commit `a4148dd`) también son transacciones de 2 sentencias.

---

## 2️⃣ `recordTaskAssignment()` — INSERT Condicional (Una Sola Sentencia)

### ANTES (ventana de carrera + 2 roundtrips)
```javascript
// AnalyticsService.recordTaskAssignment(taskId, userId, groupId, category)
// Roundtrip 1: SELECT
const existing = await execReadCommand(
    `SELECT id FROM dbo.TaskAnalytics
     WHERE tid = @tid AND uid = @uid AND success_status = 'pending'`,
    existingParams
);
if (existing && existing.length > 0) {
    return { success: true, message: 'Assignment already recorded' };
}

// ⚠️ VENTANA DE CARRERA AQUÍ
// Otra petición podría insertar entre SELECT e INSERT

// Roundtrip 2: INSERT
await execWriteCommand(
    `INSERT INTO dbo.TaskAnalytics (tid, uid, gid, task_category, assigned_at)
     VALUES (@tid, @uid, @gid, @category, GETDATE())`,
    insertParams
);
```

**Problemas:** 
- 2 roundtrips
- Race condition (posible hecho `'pending'` duplicado)

---

### DESPUÉS (1 roundtrip)
```javascript
// Insert only if no pending assignment already exists (single roundtrip)
const rowsInserted = await execWriteCommand(
    `INSERT INTO dbo.TaskAnalytics (tid, uid, gid, task_category, assigned_at)
     SELECT @tid, @uid, @gid, @category, GETDATE()
     WHERE NOT EXISTS (
         SELECT 1 FROM dbo.TaskAnalytics
         WHERE tid = @tid AND uid = @uid AND success_status = 'pending'
     )`,
    insertParams
);
if (rowsInserted === 0) {
    return { success: true, message: 'Assignment already recorded' };
}
```

**Mejoras:**
- 1 roundtrip (vs. 2)
- Chequeo e insert en la misma sentencia: la ventana de carrera es mucho menor. No queda cerrada del todo, porque no hay índice único ni `UPDLOCK, HOLDLOCK`
- 0 filas insertadas → `'Assignment already recorded'`, igual que antes

> **Nota (estado al cierre, 3 nov 2026):** vigente; hoy además exige `AND EXISTS (SELECT 1 FROM dbo.Tasks WHERE tid = @tid)` y tiene una prueba de BD.

---

## 3️⃣ Paralelización — `Promise.all`

### ANTES (Secuencial)
```javascript
async _updateUserMetrics(taskId) {
    // … lee uid, task_category, completion_time_hours y success_status de la tarea …
    // Espera a que termine, luego ejecuta siguiente
    await this._updateUserExpertise(uid, task_category, completion_time_hours, success_status);  // ~50ms (supuesto)
    await this._updateDailyMetrics(uid);                                                        // ~50ms (supuesto)
    
    // Total: ~100ms (ilustrativo)
}
```

**Timeline (tiempos supuestos):**
```
T=0ms    ├─ _updateUserExpertise()
T=50ms   │  (completa)
         └─ _updateDailyMetrics()
T=100ms     (ambas completas)
```

---

### DESPUÉS (Paralelo)
```javascript
async _updateUserMetrics(taskId) {
    // … igual …
    // Run both updates in parallel — they write to different tables
    await Promise.all([
        this._updateUserExpertise(uid, task_category, completion_time_hours, success_status),  // ~50ms (paralelo)
        this._updateDailyMetrics(uid)                                                         // ~50ms (paralelo)
    ]);
    
    // Total: ~50ms (max de las dos, ilustrativo)
}
```

**Timeline (tiempos supuestos):**
```
T=0ms    ├─ _updateUserExpertise()  (paralelo)
         └─ _updateDailyMetrics()   (paralelo)
T=50ms   (ambas completas)
```

**Mejora estimada:** ~-50% latencia (100ms → 50ms con los tiempos supuestos)

El mismo patrón se aplicó en `batchUpdateUserMetrics()` (`a04a576`: `for...of` → `Promise.all(activeUsers.map(...))`), que sigue vigente.

### 3.2 `createProjectFromPlan()` y populate-assignments

```javascript
// ANTES (d7bf277^)                          // DESPUÉS (d7bf277)
for (let i = 0; i < tasks.length; i++) {     await Promise.all(tasks.map(async (task, i) => {
    // … arma taskData …                         // … igual …
    await taskModel.addTask(taskData);           await taskModel.addTask(taskData);
}                                            }));
// … y lo mismo para los milestones (nodeModel.addNode) …
```

> **Nota (estado al cierre, 3 nov 2026):** reemplazado en la Fase 3. `createProjectFromPlan()` corre dentro de una sola `withTransaction()`, y `populateAssignmentsForGroup()` también. Los `Promise.all` se encolan en orden (FIFO) en la única conexión de la transacción, así que los INSERT van en serie. A cambio, todo se crea completo o no se crea.

---

## 4️⃣ N+1 Query — getWorkloadDistribution()

### ANTES (Subqueries correlacionadas)
```sql
SELECT
    u.uid,
    u.username,
    MIN(gr.gr_name) as role_name,
    (SELECT COUNT(*) FROM dbo.UserTask WHERE uid = u.uid AND completed = 0) as current_workload,
    (SELECT MAX(max_concurrent_tasks) FROM dbo.UserMetrics WHERE uid = u.uid) as capacity
FROM dbo.Users u
INNER JOIN dbo.UserGroupRoles ugr ON u.uid = ugr.uid
INNER JOIN dbo.GroupRoles gr ON gr.gr_id = ugr.gr_id
WHERE ugr.gid = @gid
GROUP BY u.uid, u.username
ORDER BY u.username;
```

**Ejecución (modelo conceptual; no se capturaron planes de ejecución):**
```
Recorrido de los miembros del grupo (1 operación)
├─ Miembro 1: subconsulta 1 + subconsulta 2 (2 ops)
├─ Miembro 2: subconsulta 1 + subconsulta 2 (2 ops)
├─ Miembro 3: subconsulta 1 + subconsulta 2 (2 ops)
...
└─ Miembro 100: subconsulta 1 + subconsulta 2 (2 ops)

Total: 1 + (100 × 2) = 201 operaciones
```

---

### DESPUÉS (Pre-agregación)
```sql
SELECT
    u.uid,
    u.username,
    MIN(gr.gr_name) as role_name,
    ISNULL(wl.cnt, 0) as current_workload,
    cap.max_cap as capacity
FROM dbo.Users u
INNER JOIN dbo.UserGroupRoles ugr ON u.uid = ugr.uid
INNER JOIN dbo.GroupRoles gr ON gr.gr_id = ugr.gr_id
LEFT JOIN (
    SELECT uid, COUNT(*) as cnt
    FROM dbo.UserTask
    WHERE completed = 0
    GROUP BY uid
) wl ON wl.uid = u.uid
LEFT JOIN (
    SELECT uid, MAX(max_concurrent_tasks) as max_cap
    FROM dbo.UserMetrics
    GROUP BY uid
) cap ON cap.uid = u.uid
WHERE ugr.gid = @gid
GROUP BY u.uid, u.username, wl.cnt, cap.max_cap
ORDER BY u.username;
```

**Ejecución (mismo modelo):**
```
Recorrido de los miembros con sus roles (1 operación)
Agregación wl sobre toda UserTask (1 operación)
Agregación cap sobre toda UserMetrics (1 operación)
LEFT JOIN wl (1 operación)
LEFT JOIN cap (1 operación)

Total: 5 operaciones
```

**Mejora estimada:** 201 → 5 operaciones en el modelo = **-97.5%**. Las agregaciones recorren tablas enteras, así que el costo sigue creciendo con su tamaño.

> **Nota (estado al cierre, 3 nov 2026):** vigente; desde `349aa02` `wl` cuenta `UserTask` unida a `Tasks`, sin el filtro `completed = 0`.

---

## 5️⃣ Row Explosion — getTeamAnalyticsSummary()

### ANTES (Fan-out en LEFT JOIN)
```sql
SELECT
    u.uid,
    u.username,
    COUNT(CASE WHEN ta.success_status = 'pending' THEN 1 END) as active_tasks,
    COUNT(CASE WHEN ta.success_status = 'completed' THEN 1 END) as completed_tasks,
    COUNT(CASE WHEN ta.success_status = 'failed' THEN 1 END) as failed_tasks,
    AVG(CASE WHEN ta.completion_time_hours IS NOT NULL THEN ta.completion_time_hours END) as avg_completion_time,
    MAX(um.max_concurrent_tasks) as historical_capacity
FROM dbo.Users u
JOIN dbo.UserGroups ug ON u.uid = ug.uid
LEFT JOIN dbo.TaskAnalytics ta ON u.uid = ta.uid AND ta.gid = @gid
LEFT JOIN dbo.UserMetrics um ON u.uid = um.uid  -- ← FAN-OUT!
WHERE ug.gid = @gid
GROUP BY u.uid, u.username
ORDER BY u.username
```

**Con datos:**
- Usuario: 1 fila
- TaskAnalytics (hechos pendientes del usuario en el grupo): 5 filas
- **UserMetrics (histórico 3 días): 5 × 3 = 15 filas** ← MULTIPLICACIÓN
- `active_tasks` = **15** (debería ser 5): los conteos salían ×M, con M = filas del usuario en `UserMetrics`

---

### DESPUÉS (Pre-agregación)
```sql
SELECT
    u.uid,
    u.username,
    COUNT(CASE WHEN ta.success_status = 'pending' THEN 1 END) as active_tasks,
    -- … completed_tasks, failed_tasks y avg_completion_time, igual …
    um_max.max_cap as historical_capacity
FROM dbo.Users u
JOIN dbo.UserGroups ug ON u.uid = ug.uid
LEFT JOIN dbo.TaskAnalytics ta ON u.uid = ta.uid AND ta.gid = @gid
LEFT JOIN (
    SELECT uid, MAX(max_concurrent_tasks) as max_cap
    FROM dbo.UserMetrics
    GROUP BY uid  -- ← Pre-agregar a 1 fila por usuario
) um_max ON u.uid = um_max.uid  -- ← Sin fan-out (siempre 1 fila)
WHERE ug.gid = @gid
GROUP BY u.uid, u.username, um_max.max_cap
ORDER BY u.username
```

**Con datos:**
- Usuario: 1 fila
- TaskAnalytics: 5 filas
- **um_max (pre-agregado): 1 fila** ← Sin multiplicación
- `active_tasks` = 5 ✅

Intermediate result: 5 filas (no 15)

**Mejora:** corrección de los conteos + -67% filas intermedias en el ejemplo (M veces menos en general). El SQL no tiene prueba contra la BD.

---

## 6️⃣ Code-Splitting Frontend — React.lazy()

### ANTES (12 imports estáticos + 2 de desarrollo)
```javascript
// src/App.js
import AnalyticsDashboard from './components/AnalyticsDashboard';
import BlockDiagram from './components/BlockDiagram';
import CalendarView from './components/CalendarView';
import ChatPage from './components/ChatPage';
import CreateGroup from './components/CreateGroup';
import Flow from './components/flow/Flow';
import GroupsView from './components/GroupsView';
import HomePage from './components/HomePage';
import Login from './components/Login';
import Navbar from './components/Navbar';
import Recordatorios from './components/Recordatorios';
import Register from './components/Register';
import WebSocketTest from './components/WebSocketTest';   // ruta de desarrollo
import ThemeTest from './theme/ThemeTest';                // ruta de desarrollo

// …
<Routes>
  <Route path="/" element={user ? <Navigate to="/home" /> : <Login onLogin={handleLogin} />} />
  <Route path="/register" element={<Register />} />
  {/* … todas las rutas, más /websocket-test y /theme-test … */}
</Routes>
```

**Webpack output:**
```
bundle inicial
├─ Todas las páginas (Home, Calendar, Flow, Chat, Analytics, …)
├─ WebSocketTest y ThemeTest
└─ (TODO en el bundle inicial; tamaño no medido)
```

---

### DESPUÉS (lazy + Suspense)
```javascript
// src/App.js
import { lazy, Suspense, useEffect, useState } from 'react';
import { Box, CircularProgress } from '@mui/material';

const AnalyticsDashboard = lazy(() => import('./components/AnalyticsDashboard'));
const BlockDiagram = lazy(() => import('./components/BlockDiagram'));
const CalendarView = lazy(() => import('./components/CalendarView'));
const ChatPage = lazy(() => import('./components/ChatPage'));
const CreateGroup = lazy(() => import('./components/CreateGroup'));
const Flow = lazy(() => import('./components/flow/Flow'));
const GroupsView = lazy(() => import('./components/GroupsView'));
const HomePage = lazy(() => import('./components/HomePage'));
const Login = lazy(() => import('./components/Login'));
const Navbar = lazy(() => import('./components/Navbar'));
const Recordatorios = lazy(() => import('./components/Recordatorios'));
const Register = lazy(() => import('./components/Register'));

const PageLoader = () => (
  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
    <CircularProgress />
  </Box>
);

// …
<Suspense fallback={<PageLoader />}>
  {user && <Navbar user={user} onLogout={handleLogout} />}
  <Routes>
    {/* … las mismas rutas, sin las de desarrollo; los componentes se cargan bajo demanda */}
  </Routes>
</Suspense>
```

**Webpack output:**
```
main.js (App + librerías comunes)
└─ (sin las páginas)

un chunk por página   ← cargado la primera vez que se visita
```

**Mejora:** bundle inicial más chico y primera carga más rápida (ninguna de las dos se midió). Referencia al cierre: el build del 3 nov 2026 da `main.js` de 373 KB minificado (119 KB gzip) más 24 chunks; incluye las Fases 3 y 4 y no se compara con marzo. Las páginas siguen cargándose con `React.lazy()` (la Fase 3 agregó `GitHubPage`).

---

## 7️⃣ Logging Removal — I/O en el Hot Path

### ANTES (console.log en middleware)
```javascript
// taskmate-api/server.js

// Middleware que se ejecuta en CADA request
app.use((req, res, next) => {
    console.log(`Request client URL: ${req.get('host')}${req.originalUrl} >>>> ${SERVER_TAG}`);
    // ⚠️ escribir en stdout puede ser síncrono (p. ej. si la salida va a un archivo)
    next();
});
```

```javascript
// taskmate-api/controllers/analytics.controller.js — POST /api/analytics/recommendations
// 18 líneas console.* en este flujo, por ejemplo:
console.log('📥 Analytics recommendations request received:', req.body);
console.log('✅ Received recommendations from agent:', recommendations);
console.error('❌ Error stack:', error.stack);
console.log('📨 Received response from MCP server:', response);
```

**Impact:**
```
Cada request:
├─ 1 escritura a stdout (costo no medido)
└─ En recomendaciones, varias más con objetos completos
```

---

### DESPUÉS (sin logging por request)
```javascript
// taskmate-api/server.js

// Middleware de logging ELIMINADO
// (ya no hay console.log en hot path)
```

```javascript
// taskmate-api/controllers/analytics.controller.js
// Solo logging de error esencial:
console.error('Error getting task recommendations:', error.message);
```

**Impact:**
```
Cada request:
├─ Sin escrituras a stdout
└─ Logs legibles, sin volcados de objetos
```

**Mejora:** -100% escrituras de log en el hot path (el efecto en la latencia no se midió)

---

## 📊 Resumen Comparativo

Mejoras estimadas, no medidas.

| Cambio | Antes | Después | Mejora estimada | Al cierre |
|--------|-------|---------|--------|--------|
| deleteTask | 2 `await` | 1 `await` | -50% roundtrips | Transacción (`trashTask`) |
| recordTaskAssignment | SELECT + INSERT | INSERT...WHERE NOT EXISTS | -50% roundtrips + ventana de carrera menor | Vigente |
| Promise.all (2 ops) | `await op1; await op2` | `Promise.all([op1, op2])` | ~-50% latencia | Vigente |
| createProjectFromPlan | `for…await` | `Promise.all` | -88% con tiempos supuestos | En serie dentro de una transacción |
| N+1 query | 1 + N×2 sub-ejecuciones (modelo) | 5 operaciones | -97.5% ops (modelo) | Vigente |
| Row explosion | Fan-out en LEFT JOIN, conteos ×M | Pre-agregación `um_max` | Conteos correctos, -67% filas en el ejemplo | Vigente |
| Code-splitting | 12 imports estáticos | `lazy(() => import(...))` | Bundle inicial menor (no medido) | Vigente |
| Logging | `console.log` cada request | Eliminado | -100% escrituras en hot path | Vigente |

---

**Generado:** 28 ago 2026 (corregido al cierre: 3 nov 2026)  
**Commits:** `d7bf277`, `a04a576`, `a4148dd`, `2589b55`, `4969894`

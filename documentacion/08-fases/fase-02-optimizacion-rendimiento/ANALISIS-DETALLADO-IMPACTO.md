# Análisis Detallado de Impacto — Fase 2 de Optimización

**Documento:** Comparación línea por línea de los cambios de código y estimación de mejora en cada uno  
**Fecha:** 28 ago 2026 (corregido al cierre del proyecto, 3 nov 2026)  
**Commits analizados:** `d7bf277`, `a04a576`, `a4148dd`, `2589b55`, `4969894`

> **Nota de cierre (3 nov 2026).**
> - **Todas las cifras de mejora de este documento son estimaciones ilustrativas, no mediciones:** milisegundos, porcentajes, timelines y conteos de operaciones. Salen de tiempos supuestos (por ejemplo, ~10 ms por roundtrip). Nadie midió el «antes» ni el «después»; la única medición de la fase no evalúa estos cambios ([README, Medición real](README.md#-medición-real-benchmarks)).
> - **Los extractos de código** se corrigieron al cierre para seguir los diffs reales. Son resúmenes: el código exacto se ve con `git show <hash>`.
> - **La Fase 3 (`285bf14`, `349aa02`) reemplazó** las secciones 1 y 3 (ejemplo 2) y los borrados de nodos y roles: ahora son transacciones de varias sentencias, que cambian roundtrips por atomicidad. Cada sección lo indica con una «Nota (estado al cierre)».
>
> Lo que quedó sin hacer está en [cierre del proyecto](../../01-proyecto/cierre-del-proyecto.md).

---

## Resumen Ejecutivo de Mejoras

| Cambio | Tipo | Mejora estimada (no medida) | Impacto | Estado al cierre |
|--------|------|--------|--------|--------|
| **1. deleteTask() — batch de DELETEs** | I/O | -50% roundtrips (2 → 1); el borrado completo, 3 → 1 | Alto: operación crítica | Reemplazado: `trashTask()` en una transacción |
| **2. recordTaskAssignment() — INSERT condicional** | Concurrency | -50% roundtrips + ventana de carrera mucho menor | Alto: evita duplicados | Vigente |
| **3. Paralelización (Promise.all)** | Concurrency | ~-50% latencia en operaciones independientes | Alto: afecta 4 operaciones | 2 vigentes, 2 reemplazadas por transacciones |
| **4. N+1 en getWorkloadDistribution()** | Query Optimization | Sin subconsultas por fila; número fijo de agregaciones | Alto: analytics por grupo | Vigente |
| **5. Row explosion en getTeamAnalyticsSummary()** | Data Accuracy + Performance | Conteos ×M → correctos; resultado intermedio M veces menor | Crítico: corrección de bug | Vigente |
| **6. Code-splitting frontend (React.lazy)** | Bundle | Carga bajo demanda (bundle no medido) | Medio: carga inicial | Vigente |
| **7. Eliminación del logging por request** | I/O | Una escritura a stdout menos por request | Medio: hot path | Vigente |

---

## 1. `deleteTask()` — De 2 Roundtrips a 1 Roundtrip

### Antes (Commit d7bf277^)

```javascript
const deleteTask = async (tid) => {
    const param = [{ name: 'tid', type: TYPES.UniqueIdentifier, value: tid }];
    // Clear FK-constrained rows before deleting the task
    await execWriteCommand(`DELETE FROM dbo.TaskAnalytics WHERE tid=@tid`, param);   // Roundtrip 1
    return execWriteCommand(`DELETE FROM dbo.Tasks WHERE tid=@tid`, param);          // Roundtrip 2
};
```

**Problema:**
- 2 llamadas separadas a `execWriteCommand()`
- Cada llamada es un roundtrip de red (aunque sea local, hay overhead de conexión)
- Operaciones son **secuenciales**: no puede empezar la segunda hasta que termina la primera
- Además, el controller llamaba antes a `UsertaskModel.deleteAllByTid(tid)`: el borrado completo eran 3 roundtrips
- Tiempo total (supuesto ilustrativo de ~10 ms por roundtrip): `latencia_network × 2 = ~20ms`

### Después (Commit d7bf277)

```javascript
const deleteTask = async (tid) => {
    const param = [{ name: 'tid', type: TYPES.UniqueIdentifier, value: tid }];
    // Clear FK-constrained rows and delete task in a single batch
    return execWriteCommand(
        `DELETE FROM dbo.TaskAnalytics WHERE tid=@tid; DELETE FROM dbo.Tasks WHERE tid=@tid`,
        param
    );
};
```

**Mejora:**
- SQL Server recibe UNA sola query con 2 comandos separados por `;`
- SQL Server los ejecuta secuencialmente en el motor (no hay overhead de red entre ellos)
- 1 roundtrip en lugar de 2
- El commit `a04a576` agregó `DELETE FROM dbo.UserTask` al mismo batch y quitó la llamada del controller: el borrado completo quedó en 1 roundtrip
- **Mejora estimada: -50% de roundtrips en esta función**
- Tiempo total (mismo supuesto): `latencia_network × 1 = ~10ms`

### Impacto (ilustrativo)

Suponiendo que `deleteTask()` se llama 100 veces en un ciclo de trabajo:
- **Antes:** 100 × 2 roundtrips = 200 roundtrips
- **Después:** 100 × 1 roundtrip = 100 roundtrips
- **Ahorro:** 100 roundtrips eliminados

> **Nota (estado al cierre, 3 nov 2026):** reemplazado en la Fase 3 (`349aa02`). `deleteTask()` y `DELETE /api/tasks/:id` ya no existen. El «borrar» de la UI es `POST /api/tasks/:tid/trash` → `trashTask(tid)`. Corre en una transacción con una petición por sentencia: lectura con `UPDLOCK, HOLDLOCK`, copia en `DeleteTask`, cierre de los hechos pendientes de `TaskAnalytics` como `'failed'`, `DELETE` de `UserTask`, lectura de la rama vinculada y `DELETE` de `Tasks`. Son más roundtrips que en marzo, pero el borrado ahora es atómico.

---

## 2. `recordTaskAssignment()` — De Check-Then-Insert a INSERT...WHERE NOT EXISTS

### Antes (Commit d7bf277^)

```javascript
// En AnalyticsService.js — recordTaskAssignment(taskId, userId, groupId, category)
// Check if assignment already exists (prevent duplicates)
const existingQuery = `
    SELECT id FROM dbo.TaskAnalytics
    WHERE tid = @tid AND uid = @uid AND success_status = 'pending'
`;
// Roundtrip 1: SELECT — verifica si ya existe un hecho pendiente
const existing = await execReadCommand(existingQuery, existingParams);
if (existing && existing.length > 0) {
    return { success: true, message: 'Assignment already recorded' };
}

// ⚠️ VENTANA DE CARRERA AQUÍ (entre SELECT e INSERT)

// Roundtrip 2: INSERT
const insertQuery = `
    INSERT INTO dbo.TaskAnalytics (tid, uid, gid, task_category, assigned_at)
    VALUES (@tid, @uid, @gid, @category, GETDATE())
`;
await execWriteCommand(insertQuery, insertParams);
```

**Problemas:**
1. **2 roundtrips:** SELECT + INSERT = 2 viajes de red
2. **Race condition:** Entre SELECT e INSERT hay una ventana de tiempo donde otra petición podría:
   - Petición A: SELECT → no existe
   - Petición B: SELECT → no existe, e INSERT
   - Petición A: INSERT → **dos hechos `'pending'`** para la misma tarea y el mismo usuario (no hay restricción UNIQUE que lo impida)

### Después (Commit d7bf277)

```javascript
// Insert only if no pending assignment already exists (single roundtrip)
const insertQuery = `
    INSERT INTO dbo.TaskAnalytics (tid, uid, gid, task_category, assigned_at)
    SELECT @tid, @uid, @gid, @category, GETDATE()
    WHERE NOT EXISTS (
        SELECT 1 FROM dbo.TaskAnalytics
        WHERE tid = @tid AND uid = @uid AND success_status = 'pending'
    )
`;
const rowsInserted = await execWriteCommand(insertQuery, insertParams);
if (rowsInserted === 0) {
    return { success: true, message: 'Assignment already recorded' };
}
```

**Mejoras:**
1. **1 roundtrip:** Una sola sentencia que contiene chequeo + insert
2. **Ventana de carrera mucho menor:** el `WHERE NOT EXISTS` y el `INSERT` van en la misma sentencia. No queda cerrada del todo: sin un índice único sobre los hechos `'pending'` de `(tid, uid)` ni pistas `UPDLOCK, HOLDLOCK`, dos sentencias simultáneas con el aislamiento por defecto todavía podrían insertar las dos
3. **Respuesta igual que antes:** si no se inserta nada (0 filas), devuelve `'Assignment already recorded'`

### Impacto (estimado)

- **Mejora de latencia:** -50% de roundtrips (2 → 1)
- **Mejora de exactitud:** muchos menos duplicados posibles (no se midió ni se probó con concurrencia)

> **Nota (estado al cierre, 3 nov 2026):** vigente. Además exige que la tarea exista (`AND EXISTS (SELECT 1 FROM dbo.Tasks WHERE tid = @tid)`, porque `TaskAnalytics` ya no tiene FK a `Tasks`), y la prueba de BD `tests/db/analytics.dbtest.js` cubre el dedupe en secuencia.

---

## 3. Paralelización con `Promise.all` — De Secuencial a Paralelo

### Ejemplo 1: `_updateUserExpertise()` + `_updateDailyMetrics()`

#### Antes (Commit d7bf277^)

```javascript
async _updateUserMetrics(taskId) {
    // … lee uid, task_category, completion_time_hours y success_status de la tarea …

    // Update or create UserExpertise record
    await this._updateUserExpertise(uid, task_category, completion_time_hours, success_status);  // (~50ms supuestos)

    // Update daily UserMetrics
    await this._updateDailyMetrics(uid);   // LUEGO ejecuta esto (~50ms supuestos)

    // Tiempo total = 50 + 50 = ~100ms (ilustrativo)
}
```

**Timeline (tiempos supuestos, no medidos):**
```
T=0ms    ┌─ _updateUserExpertise()
         │  ├─ Query DB UserExpertise: 30ms
         │  └─ Update table: 20ms
T=50ms   │  (esperando...)
         │
         └─ _updateDailyMetrics()
            ├─ Query DB UserMetrics: 30ms
            └─ Update table: 20ms
T=100ms     (listo)
```

#### Después (Commit d7bf277)

```javascript
async _updateUserMetrics(taskId) {
    // … igual …

    // Run both updates in parallel — they write to different tables
    await Promise.all([
        this._updateUserExpertise(uid, task_category, completion_time_hours, success_status),
        this._updateDailyMetrics(uid)
    ]);

    // Tiempo total = max(50, 50) = ~50ms (ilustrativo)
}
```

**Timeline (tiempos supuestos, no medidos):**
```
T=0ms    ┌─ _updateUserExpertise()
         │  ├─ Query DB UserExpertise: 30ms
         │  └─ Update table: 20ms
         │
         └─ _updateDailyMetrics()
            ├─ Query DB UserMetrics: 30ms
            └─ Update table: 20ms
T=50ms   (ambas listas al mismo tiempo)
```

**Mejora estimada:** latencia de ~100ms a ~50ms = **~-50%** (con los tiempos supuestos)

> **Nota (estado al cierre, 3 nov 2026):** vigente. Lo mismo vale para `batchUpdateUserMetrics()` (sin argumentos; recorre todos los usuarios activos), que en `a04a576` pasó de un `for...of` a `Promise.all(activeUsers.map(...))` y sigue en paralelo.

### Ejemplo 2: `createProjectFromPlan()`

#### Antes (Commit d7bf277^)

```javascript
// ProjectService.createProjectFromPlan(recommendations, originalMessage, userId)
// Crear tareas SECUENCIALMENTE
for (let i = 0; i < projectData.tasks.length; i++) {
    const task = projectData.tasks[i];
    // … calcula la fecha y arma taskData …
    await taskModel.addTask(taskData);  // ~100ms por tarea (supuesto)
}

// Crear milestones SECUENCIALMENTE (Nodes)
for (let i = 0; i < projectData.milestones.length; i++) {
    // … arma milestoneData …
    await nodeModel.addNode(milestoneData);  // ~50ms por milestone (supuesto)
}

// Ejemplo: 10 tareas + 5 milestones
// Tiempo total = (10 × 100) + (5 × 50) = 1000 + 250 = ~1250ms (ilustrativo)
```

**Timeline (tiempos supuestos, no medidos):**
```
Tareas:
T=0ms    Tarea 1: 100ms ┐
T=100ms  Tarea 2: 100ms │ Secuenciales
T=200ms  Tarea 3: 100ms │
...      ...            │
T=900ms  Tarea 10: 100ms ┘

Milestones:
T=1000ms Milestone 1: 50ms ┐
T=1050ms Milestone 2: 50ms │ Secuenciales
...      ...               │
T=1200ms Milestone 5: 50ms ┘

Total: ~1250ms
```

#### Después (Commit d7bf277)

```javascript
// Crear tareas EN PARALELO
await Promise.all(projectData.tasks.map(async (task, i) => {
    // … igual …
    await taskModel.addTask(taskData);
}));

// Crear milestones EN PARALELO
await Promise.all(projectData.milestones.map(async (milestone, i) => {
    // … igual …
    await nodeModel.addNode(milestoneData);
}));

// Ejemplo: 10 tareas + 5 milestones (pool de 10 conexiones, fijo en marzo; hoy configurable con DB_POOL_MAX)
// Tiempo total = max(tareas) + max(milestones) = 100 + 50 = ~150ms (ilustrativo)
```

**Timeline (tiempos supuestos, no medidos):**
```
Tareas (todas en paralelo):
T=0ms    Tarea 1: 100ms ┐
T=0ms    Tarea 2: 100ms │ 10 conexiones simultáneas
T=0ms    Tarea 3: 100ms │ (limitadas por pool)
...      ...            │
T=0ms    Tarea 10: 100ms ┘
T=100ms  (todas listas)

Milestones (todas en paralelo):
T=100ms  Milestone 1: 50ms ┐
T=100ms  Milestone 2: 50ms │ 5 conexiones simultáneas
...      ...               │
T=100ms  Milestone 5: 50ms ┘
T=150ms  (todas listas)

Total: ~150ms
```

**Mejora estimada:** de ~1250ms a ~150ms = **-88%** con los tiempos supuestos; no se midió.

**Nota:** El speedup depende del pool de conexiones (10 conexiones; hoy configurable con `DB_POOL_MAX`, 10 por defecto). Con 10 tareas y pool de 10, se ejecutan todas en paralelo. Si hay 100 tareas, se hacen en tandas de 10.

> **Nota (estado al cierre, 3 nov 2026):** reemplazado en la Fase 3. `createProjectFromPlan()` crea ahora el grupo, el creador, los roles, las tareas y los hitos dentro de una sola `withTransaction()`. El `Promise.all` se conserva, pero las sentencias se encolan en orden (FIFO) sobre la única conexión de la transacción (`helpers/transaction.js`), así que vuelven a ir en serie. Lo mismo pasó con *populate-assignments* (`populateAssignmentsForGroup()`). Se cambió el paralelismo por un proyecto que se crea completo o no se crea.

---

## 4. N+1 en `getWorkloadDistribution()` — Subconsultas Correlacionadas → Pre-agregación

### Antes (Commit d7bf277^)

```sql
SELECT
    u.uid,
    u.username,
    MIN(gr.gr_name) as role_name, -- Use MIN to get a single representative role
    (SELECT COUNT(*) FROM dbo.UserTask WHERE uid = u.uid AND completed = 0) as current_workload,
    (SELECT MAX(max_concurrent_tasks) FROM dbo.UserMetrics WHERE uid = u.uid) as capacity
FROM dbo.Users u
INNER JOIN dbo.UserGroupRoles ugr ON u.uid = ugr.uid
INNER JOIN dbo.GroupRoles gr ON gr.gr_id = ugr.gr_id
WHERE ugr.gid = @gid
GROUP BY u.uid, u.username
ORDER BY u.username;
```

**Problema N+1 (modelo conceptual):**

Con 100 miembros con rol en el grupo:

```
1. SQL Server recorre los miembros del grupo: 100 filas
2. Para cada fila (N iteraciones):
   - Evalúa subconsulta 1: SELECT COUNT(*) FROM UserTask WHERE uid=u.uid AND completed=0
   - Evalúa subconsulta 2: SELECT MAX(max_concurrent_tasks) FROM UserMetrics WHERE uid=u.uid

Total conceptual: 1 recorrido + (100 × 2) evaluaciones de subconsulta = 201 operaciones
```

El optimizador de SQL Server puede reescribir algunas subconsultas correlacionadas como joins; no se capturaron planes de ejecución, así que el conteo anterior es un modelo, no lo que ejecutaba el motor.

**Timeline (tiempos supuestos, no medidos):**
```
Recorrido de miembros (1 operación):  ~5ms
Para cada miembro (100 × 2):
  └─ Subconsulta 1: ~1ms
  └─ Subconsulta 2: ~1ms
Total: ~5 + (100 × 2) = ~205ms
```

### Después (Commit d7bf277)

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

**Mejora — Pre-agregación (mismo modelo conceptual, tiempos supuestos):**

```
1. Recorrido de miembros con sus roles: 1 operación (~5ms)
2. Agregación wl (GROUP BY uid sobre UserTask): 1 operación (~10ms)
3. Agregación cap (GROUP BY uid sobre UserMetrics): 1 operación (~10ms)
4. LEFT JOIN wl: 1 operación (~2ms)
5. LEFT JOIN cap: 1 operación (~2ms)

Total: ~5 operaciones = ~29ms
```

**Comparativa (ilustrativa, no medida):**

| Métrica | Antes | Después | Mejora |
|---------|-------|---------|--------|
| Operaciones (modelo conceptual, 100 miembros) | 201 | 5 | **-97.5%** (estimado) |
| Tiempo (supuestos de arriba) | ~205ms | ~29ms | **-85.9%** (estimado) |
| Cómo crece el costo | Una subconsulta por miembro | Las 2 tablas derivadas agregan **toda** `UserTask` y **toda** `UserMetrics` (sin filtro por grupo) | Crece con el tamaño de esas tablas; **no es O(1)** |

Con 1000 miembros, el mismo modelo daría 2001 operaciones antes y 5 después; las agregaciones serían más caras, porque las tablas tendrían más filas.

> **Nota (estado al cierre, 3 nov 2026):** vigente. Desde `349aa02` (Fase 3) la tabla derivada `wl` cuenta todas las asignaciones de tareas existentes (`UserTask` unida a `Tasks`), sin el filtro `completed = 0`, porque `UserTask.completed` no indica si la tarea se completó. Una prueba de BD lo cubre (`tests/db/analytics.dbtest.js`).

---

## 5. Row Explosion en `getTeamAnalyticsSummary()` — Bug + Performance

### El Bug: Fan-out en LEFT JOIN

**Antes (Commit a4148dd^):**

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
LEFT JOIN dbo.UserMetrics um ON u.uid = um.uid  -- ← PROBLEMA
WHERE ug.gid = @gid
GROUP BY u.uid, u.username
ORDER BY u.username
```

**Escenario problemático:**
- El usuario tiene 5 hechos `'pending'` en `TaskAnalytics`
- El usuario tiene 3 filas en `UserMetrics` (una por día: histórico de 3 días)

**Resultado del LEFT JOIN:**

```
Usuario (en el grupo):  1 fila
LEFT JOIN ta:           5 filas (hechos del usuario en el grupo)
LEFT JOIN um:           5 × 3 = 15 filas (FAN-OUT: cada hecho multiplicado por 3 métricas)

Intermediate result: 15 filas (en lugar de 5)
```

**Después del GROUP BY:**
```
COUNT(CASE WHEN ta.success_status = 'pending' THEN 1 END) = 15  ❌ (debería ser 5)
AVG(completion_time_hours)                                 = correcto (todas las filas se repiten igual)
MAX(um.max_concurrent_tasks)                               = correcto
```

**El problema:**
1. Los tres conteos (`active_tasks`, `completed_tasks`, `failed_tasks`) salían **multiplicados por M**, el número de filas del usuario en `UserMetrics`, y M crece un día a la vez
2. El intermediate result es **M veces más grande** de lo necesario (15 vs 5 filas)
3. Con muchos usuarios, esto es T × M filas por usuario en vez de T

### La Solución: Pre-agregación

**Después (Commit a4148dd):**

```sql
SELECT
    u.uid,
    u.username,
    COUNT(CASE WHEN ta.success_status = 'pending' THEN 1 END) as active_tasks,
    COUNT(CASE WHEN ta.success_status = 'completed' THEN 1 END) as completed_tasks,
    COUNT(CASE WHEN ta.success_status = 'failed' THEN 1 END) as failed_tasks,
    AVG(CASE WHEN ta.completion_time_hours IS NOT NULL THEN ta.completion_time_hours END) as avg_completion_time,
    um_max.max_cap as historical_capacity
FROM dbo.Users u
JOIN dbo.UserGroups ug ON u.uid = ug.uid
LEFT JOIN dbo.TaskAnalytics ta ON u.uid = ta.uid AND ta.gid = @gid
LEFT JOIN (
    SELECT uid, MAX(max_concurrent_tasks) as max_cap
    FROM dbo.UserMetrics
    GROUP BY uid  -- ← Pre-agregar a 1 fila por usuario
) um_max ON u.uid = um_max.uid
WHERE ug.gid = @gid
GROUP BY u.uid, u.username, um_max.max_cap
ORDER BY u.username
```

**Resultado después de agregar:**

```
Usuario (en el grupo):  1 fila
LEFT JOIN ta:           5 filas (hechos del usuario en el grupo)
LEFT JOIN um_max:       5 filas (1 fila agregada por usuario, NO fan-out)

Intermediate result: 5 filas (no multiplicadas)
COUNT(... 'pending' ...) = 5  ✅
```

**Comparativa (caso de ejemplo):**

| Métrica | Antes | Después | Mejora |
|---------|-------|---------|--------|
| `active_tasks` del ejemplo | 15 | 5 | **Corrección** |
| Intermediate rows (caso mostrado) | 15 | 5 | **-67%** |
| Filas intermedias por usuario | T × M | T | M veces menos |

Con 100 usuarios × 10 filas históricas cada uno, cada conteo salía ×10 y había 10 veces más filas intermedias; después no queda multiplicación.

**Validación:** el SQL no tiene una prueba contra la BD. El test unitario (`tests/AnalyticsService.test.js`) simula `execQuery`, así que no ejecuta la consulta.

> **Nota (estado al cierre, 3 nov 2026):** vigente; es la consulta de hoy. La Fase 3 (`285bf14`) cambió `TaskAnalytics`: sus hechos se cierran como `'completed'` o `'failed'` en vez de borrarse.

---

## 6. Code-Splitting Frontend — `React.lazy()` + `Suspense`

### Antes (Commit 2589b55^)

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
  <Route path="/home" element={user ? <HomePage /> : <Navigate to="/" />} />
  {/* … calendar, block-diagram, flow, tasks, create-group, groups, chat, analytics … */}
  <Route path="/websocket-test" element={<WebSocketTest />} />
  <Route path="/theme-test" element={<ThemeTest />} />
</Routes>
```

**Problema:**
- **12 componentes importados estáticamente** (11 páginas y el `Navbar`), más los 2 de desarrollo
- Webpack agrupa **todo el código** de todas las páginas en el bundle inicial
- El usuario descarga el código de todas las páginas aunque solo vea el login

No se midió el tamaño del bundle antes de este commit.

### Después (Commit 2589b55)

```javascript
// src/App.js
import { lazy, Suspense, useEffect, useState } from 'react';
import { Box, CircularProgress } from '@mui/material';

const AnalyticsDashboard = lazy(() => import('./components/AnalyticsDashboard'));
const BlockDiagram = lazy(() => import('./components/BlockDiagram'));
// … los otros 10 componentes, igual …

const PageLoader = () => (
  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
    <CircularProgress />
  </Box>
);

// …
<Suspense fallback={<PageLoader />}>
  {user && <Navbar user={user} onLogout={handleLogout} />}
  <Routes>
    {/* … las mismas 11 rutas, sin /websocket-test ni /theme-test … */}
  </Routes>
</Suspense>
```

**Mejora:**
- **Code-splitting automático:** Webpack divide el bundle en chunks
- El bundle inicial lleva App, las librerías comunes y lo que no es lazy
- Cada página se descarga la primera vez que se visita
- Las rutas de desarrollo desaparecen del build

**Comparativa (cualitativa; no hay medición):**

| Métrica | Antes | Después | Mejora |
|---------|-------|---------|--------|
| Bundle inicial | Todas las páginas | App + librerías comunes | Menor (no medido) |
| Primera carga | Descarga todo | Descarga lo necesario para la primera página | Más rápida (no medida) |
| Cambio de página | Instantáneo | Descarga del chunk la primera vez | **Tradeoff** |

**Referencia al cierre (3 nov 2026):** el build de producción genera `main.js` de 373 KB minificado (119 KB gzip) más 24 chunks bajo demanda. Incluye todo lo agregado en las Fases 3 y 4, así que no sirve para comparar con marzo.

> **Nota (estado al cierre, 3 nov 2026):** vigente: las páginas siguen cargándose con `React.lazy()` (la Fase 3 agregó `GitHubPage`).

---

## 7. Eliminación del Logging por Request — I/O en el Hot Path

### Antes (Commit 4969894^)

```javascript
// taskmate-api/server.js
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
    console.log(`Request client URL: ${req.get('host')}${req.originalUrl} >>>> ${SERVER_TAG}`);
    next();
});
```

```javascript
// taskmate-api/controllers/analytics.controller.js — POST /api/analytics/recommendations
// (18 líneas console.* en el flujo de recomendaciones; algunas de ellas:)
console.log('📥 Analytics recommendations request received:', req.body);
console.log('🤖 Calling analytics agent for recommendations...');
console.log('✅ Received recommendations from agent:', recommendations);
console.error('❌ Error stack:', error.stack);
console.log('📋 Request data prepared:', requestData);
console.log('📨 Received response from MCP server:', response);
```

**Problema de `console.log()`:**

En Node, escribir en stdout puede ser síncrono: lo es, por ejemplo, cuando la salida va a un archivo, como hace `start.sh` con el log de la API. En ese caso el proceso espera a que el sistema operativo acepte la escritura antes de seguir. Con un log en cada request, el trabajo crece con el tráfico. Los logs de analytics además volcaban objetos completos (el body, los datos enviados al servidor de IA, la respuesta).

El costo por request no se midió.

### Después (Commit 4969894)

```javascript
// taskmate-api/server.js
app.use(cors());
app.use(express.json());
// Middleware de logging ELIMINADO
```

```javascript
// taskmate-api/controllers/analytics.controller.js
// Las 18 líneas se eliminaron; solo queda el error esencial:
console.error('Error getting task recommendations:', error.message);
```

**Mejora:**
- Una escritura a stdout menos en cada request
- Logs sin volcados de objetos completos
- El mismo commit hizo que `getTaskRecommendations` use el usuario del JWT en lugar de un `requesterId` del body

**Comparativa (cualitativa; no hay medición):**

| Métrica | Antes | Después | Mejora |
|---------|-------|---------|--------|
| Escrituras a stdout por request | 1 (+ varias en recomendaciones) | 0 (caso normal) | **-100%** |
| Latencia por request | No medida | No medida | — |
| Ruido en los logs | Alto (objetos completos) | Bajo | Logs legibles |

> **Nota (estado al cierre, 3 nov 2026):** vigente.

---

## Resumen Comparativo Global

Todas las mejoras de esta sección son estimaciones (modelos y tiempos supuestos); ninguna se midió.

### Mejoras por Categoría

#### **I/O (Reducción de Roundtrips)**

| Operación | Antes | Después (Fase 2) | Mejora estimada | Al cierre |
|-----------|-------|---------|--------|--------|
| Borrar una tarea | 3 roundtrips | 1 roundtrip | **-67%** | Transacción (`trashTask`) |
| deleteNode() | 2 roundtrips | 1 roundtrip | **-50%** | Transacción (2 sentencias) |
| deleteGroupRole() | 2 roundtrips | 1 roundtrip | **-50%** | Transacción (2 sentencias) |
| recordTaskAssignment() | 2 roundtrips | 1 roundtrip | **-50%** | Vigente |
| Logging por request | 1 escritura por request | Eliminado | **-100% escrituras** | Vigente |

**Impacto acumulado (estimado):** menos tráfico de red en 4 operaciones. Las tres de borrado volvieron a varias sentencias en la Fase 3, a cambio de atomicidad.

#### **Paralelización (Operaciones Independientes)**

| Operación | Antes | Después (Fase 2) | Mejora estimada | Al cierre |
|-----------|-------|---------|--------|--------|
| _updateUserExpertise + _updateDailyMetrics | Secuencial | Promise.all | **~-50% latencia** | Vigente |
| createProjectFromPlan (10 + 5) | ~1250ms | ~150ms | **-88%** (tiempos supuestos) | En serie dentro de una transacción |
| batchUpdateUserMetrics (N usuarios) | ~N×t | ~t (limitado por el pool) | **Menos que lineal** | Vigente |
| populate-assignments (2N inserts) | ~2N×t | ~t (limitado por el pool) | **Menos que lineal** | En serie dentro de una transacción |

**Impacto (estimado):** las operaciones masivas pasaban a escalar con el pool de conexiones. Al cierre, solo las dos de métricas siguen en paralelo.

#### **Query Optimization (Estructura de Datos)**

| Query | Antes | Después | Mejora estimada |
|-------|-------|---------|--------|
| getWorkloadDistribution (N+1) | 1 + N×2 operaciones (modelo conceptual) | 5 operaciones | **-97.5% ops** con 100 miembros; el costo sigue creciendo con el tamaño de las tablas |
| getTeamAnalyticsSummary (row explosion) | T×M filas por usuario, conteos ×M | T filas, conteos correctos | **Corrección + factor M** |

**Impacto (estimado):** menos trabajo por consulta en grupos grandes y conteos correctos. La aceleración real no se midió.

#### **Frontend (Bundle Size)**

| Métrica | Antes | Después | Mejora |
|---------|-------|---------|--------|
| Bundle inicial | Todas las páginas | App + librerías comunes | Menor (no medido) |
| Primera carga | — | — | Más rápida (no medida) |

**Impacto:** la carga inicial descarga menos código; no hay números de antes ni de después.

---

## Conclusión: Impacto Total Estimado

**Escenario ilustrativo con tiempos supuestos; no es una medición.** Además se apoya en tiempos de bundle que nunca se midieron, y en el paralelismo de `createProjectFromPlan()`, que la Fase 3 volvió serie.

### En el Happy Path (usuario típico)

**Antes de optimizaciones (supuesto):**
- Load dashboard: 2000ms (bundle) + 100ms (analytics queries) = **2100ms**
- Crear proyecto (10 tareas): 1250ms (secuencial) = **1250ms**
- Asignar 50 tareas: 50 × 10ms = **500ms**
- **Total típico: ~3850ms**

**Después de optimizaciones (supuesto):**
- Load dashboard: 700ms (bundle) + 15ms (batch queries) = **715ms**
- Crear proyecto (10 tareas): 150ms (paralelo) = **150ms**
- Asignar 50 tareas: 50 × 5ms = **250ms**
- **Total típico: ~1115ms**

**Mejora global: -71% estimado, no medido** (3850 → 1115 ms en este escenario ilustrativo). Es la única cifra «global» de la documentación de la Fase 2; la carga del dashboard sola daría -66%.

### En escala (sistema con muchos usuarios)

Con 1000 miembros en un grupo, según el modelo conceptual de la sección 4:
- **Antes:** hasta 2001 evaluaciones de subconsulta por request
- **Después:** 5 operaciones por request, sobre tablas que también crecen
- **Mejora estimada:** muchas menos operaciones (-99.75% en el modelo), no una latencia constante

---

**Documento generado:** 28 ago 2026  
**Corregido al cierre del proyecto:** 3 nov 2026  
**Análisis basado en:** Commits `d7bf277`, `a04a576`, `a4148dd`, `2589b55`, `4969894`

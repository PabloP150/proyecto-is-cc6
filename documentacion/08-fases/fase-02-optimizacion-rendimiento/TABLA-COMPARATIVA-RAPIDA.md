# Tabla Comparativa Rápida — Antes vs. Después

**Referencia visual de todas las optimizaciones realizadas en Fase 2**  
**Generado:** 28 ago 2026 (corregido al cierre del proyecto: 3 nov 2026)

> **Nota de cierre (3 nov 2026).**
> - **Todas las mejoras de esta tabla son estimaciones con tiempos supuestos, no mediciones.** Nadie midió el «antes» ni el «después»; la única medición de la fase no evalúa estos cambios ([README, Medición real](README.md#-medición-real-benchmarks)).
> - La Fase 3 (`285bf14`, `349aa02`) reemplazó los cambios 1, 3.2, 3.4, 6 y 7: ahora son transacciones, que cambian roundtrips o paralelismo por atomicidad. Ver la columna «Al cierre» del resumen y la sección [Estado al cierre](#-estado-al-cierre-3-nov-2026).
>
> Lo que quedó sin hacer está en [cierre del proyecto](../../01-proyecto/cierre-del-proyecto.md).

---

## 🎯 Resumen Ejecutivo (90 segundos)

| Aspecto | Antes | Después | Mejora (estimada, no medida) | Impacto |
|--------|-------|---------|--------|---------|
| **Latencia típica (usuario) 🏃** | ~3850ms | ~1115ms | **-71%** (escenario ilustrativo) | Alto |
| **Roundtrips BD (operaciones críticas)** | 2 cada | 1 cada | **-50%** | Alto: menos tráfico de red (3 de las 4 son transacciones desde la Fase 3) |
| **Queries N+1 (analytics)** | 201 ops | 5 ops | **-97.5%** (modelo conceptual) | Alto: sin subconsultas por fila |
| **Bundle inicial (React)** | Todas las páginas | App + librerías comunes | Menor (no medido) | Medio: carga inicial |
| **Operaciones paralelo** | Secuenciales | Promise.all | **~-50% latencia** | Alto (2 de 4 siguen en paralelo al cierre) |

---

## 📊 Detalle por Cambio

### 1️⃣ `deleteTask()` — Batchear DELETEs

```
ANTES (d7bf277^):                           DESPUÉS (a04a576):
controller: DELETE UserTask (rt1)       →   1 llamada: DELETE UserTask; TaskAnalytics; Tasks (rt1)
model:      DELETE TaskAnalytics (rt2)  →
model:      DELETE Tasks (rt3)          →

Roundtrips: 3                               Roundtrips: 1
Latencia: ~30ms (supuesto)                  Latencia: ~10ms (supuesto)
```

**Mejora estimada:** `-2 roundtrips` | **Impacto:** Alto (operación frecuente)

**Al cierre:** reemplazado por `trashTask()` (`POST /api/tasks/:tid/trash`), una transacción con varias sentencias.

---

### 2️⃣ `recordTaskAssignment()` — INSERT Condicional

```
ANTES:                                  DESPUÉS:
SELECT (race condition window)      →   INSERT...SELECT WHERE NOT EXISTS
INSERT (if not exists)              →   (una sola sentencia)

Roundtrips: 2                           Roundtrips: 1
Risk: Race condition (duplicados)       Risk: mucho menor (sin índice único ni UPDLOCK, no es cero)
```

**Mejora estimada:** `-50% roundtrips` + **ventana de carrera mucho menor** | **Impacto:** Alto (exactitud de datos)

---

### 3️⃣ Paralelización — `Promise.all`

#### 3.1 `_updateUserExpertise` + `_updateDailyMetrics` (dentro de `_updateUserMetrics`)

```
ANTES:                              DESPUÉS:
await _updateUserExpertise()   →    Promise.all([
await _updateDailyMetrics()    →      _updateUserExpertise(),
                                      _updateDailyMetrics()
Secuencial: ~100ms (supuesto)     ])
                                    Paralelo: ~50ms (supuesto)
```

**Mejora estimada:** `~-50% latencia` | **Impacto:** Medio (operación de analytics) | **Al cierre:** vigente

#### 3.2 `createProjectFromPlan()` (10 tareas + 5 milestones)

```
ANTES:                                  DESPUÉS:
for (tarea) { await create }       →    Promise.all(tasks.map(create))
for (milestone) { await create }   →    Promise.all(milestones.map(create))

Secuencial: 1000 + 250 = 1250ms        Paralelo: 100 + 50 = 150ms
(tiempos supuestos)
```

**Mejora estimada:** `-88% latencia` (tiempos supuestos) | **Impacto:** Alto (creación de proyectos)

**Al cierre:** reemplazado. Todo corre en una `withTransaction()` y los INSERT se encolan en serie en su única conexión.

#### 3.3 `batchUpdateUserMetrics()` (N usuarios activos)

```
ANTES:                              DESPUÉS:
for (user) {                    →    Promise.all(users.map(u =>
  await _updateDailyMetrics()   →      _updateDailyMetrics(u)
}                               →    ))

Tiempo: N × t                       Tiempo: ~t (el pool limita la concurrencia)
```

**Mejora estimada:** `-50% a -90% latencia` (depende de N y del tamaño del pool) | **Impacto:** Alto (escala) | **Al cierre:** vigente

#### 3.4 `populate-assignments/:groupId` (2N inserts)

```
ANTES:                                  DESPUÉS:
for (task) {                       →    Promise.all(tasks.map(t =>
  await INSERT UserTask           →      Promise.all([
  await INSERT TaskAnalytics      →        INSERT UserTask,
}                                 →        INSERT TaskAnalytics
                                  →      ])
Secuencial: 2N × t                     Paralelo: ~t (limitado por el pool)
```

**Mejora estimada:** `-N factor` | **Impacto:** Alto (operación de batch)

**Al cierre:** reemplazado por `populateAssignmentsForGroup()`: una transacción con bloqueo del grupo, en serie, con los 2 INSERT de cada tarea en un batch.

---

### 4️⃣ `getWorkloadDistribution()` — Eliminar N+1

```
ANTES (Subqueries correlacionadas):
SELECT u.uid, u.username, MIN(gr.gr_name) AS role_name,
  (SELECT COUNT(*) FROM UserTask WHERE uid=u.uid AND completed=0),   -- Subquery 1 (carga)
  (SELECT MAX(max_concurrent_tasks) FROM UserMetrics WHERE uid=u.uid) -- Subquery 2 (capacidad)
FROM Users u JOIN UserGroupRoles ugr ... JOIN GroupRoles gr ...
WHERE ugr.gid = @gid
→ Con 100 miembros: 1 recorrido + 200 subqueries = 201 operaciones (modelo; ~205ms supuestos)

DESPUÉS (Pre-agregación en tablas derivadas):
SELECT u.uid, u.username, MIN(gr.gr_name) AS role_name,
  ISNULL(wl.cnt, 0) AS current_workload, cap.max_cap AS capacity
FROM Users u JOIN UserGroupRoles ugr ... JOIN GroupRoles gr ...
LEFT JOIN (SELECT uid, COUNT(*) AS cnt FROM UserTask WHERE completed = 0 GROUP BY uid) wl ON ...
LEFT JOIN (SELECT uid, MAX(max_concurrent_tasks) AS max_cap FROM UserMetrics GROUP BY uid) cap ON ...
WHERE ugr.gid = @gid
→ 3 recorridos + 2 joins = 5 operaciones (modelo; ~29ms supuestos)
```

**Mejora estimada:** `-97.5% operaciones` | `-85.9% latencia` (modelo y tiempos supuestos) | **Impacto:** Alto (analytics por grupo)

**Escalabilidad (modelo conceptual):**
- 100 miembros: 201 → 5 operaciones (-97.5%)
- 1000 miembros: 2001 → 5 operaciones (-99.75%)
- Las tablas derivadas agregan **toda** `UserTask` y **toda** `UserMetrics`: el costo de esas 5 operaciones crece con el tamaño de las tablas (no es O(1))

**Al cierre:** vigente; desde `349aa02` la carga cuenta `UserTask` unida a `Tasks`, sin el filtro `completed = 0`.

---

### 5️⃣ `getTeamAnalyticsSummary()` — Eliminar Row Explosion

```
ANTES (Fan-out en LEFT JOIN):
Users (1) → LEFT JOIN TaskAnalytics (5 hechos 'pending')
         → LEFT JOIN UserMetrics (3 filas histórico) = 5×3 = 15 filas
         → COUNT(CASE WHEN success_status = 'pending' ...) = 15  ❌ (conteos ×M)

Intermediate result: 15 filas por usuario

DESPUÉS (Pre-agregación):
LEFT JOIN (
  SELECT uid, MAX(max_concurrent_tasks) AS max_cap FROM UserMetrics GROUP BY uid  -- 1 fila por usuario
) um_max
Users (1) → LEFT JOIN TaskAnalytics (5)
         → LEFT JOIN um_max (1) = 5×1 = 5 filas
         → COUNT(...) = 5  ✅

Intermediate result: 5 filas por usuario
```

**Mejora:** **corrección de bug (conteos multiplicados por M)** + `-67% intermediate result size` en el ejemplo | **Impacto:** Crítico | **Al cierre:** vigente; el SQL no tiene prueba contra la BD

---

### 6️⃣ `deleteNode()` — Batchear DELETEs

```
ANTES:                              DESPUÉS:
await deleteEdgesByNode(nid) →      1 await DELETE FROM Edges; DELETE FROM Nodes (batch)
await deleteNode(nid)        →

Roundtrips: 2                       Roundtrips: 1
Latencia: ~20ms (supuesto)          Latencia: ~10ms (supuesto)
```

**Mejora estimada:** `-50% roundtrips` | **Al cierre:** transacción con 2 sentencias (`285bf14`)

---

### 7️⃣ `deleteGroupRole()` — Batchear DELETEs

```
ANTES:                                  DESPUÉS:
await DELETE UserGroupRoles (rt1)  →    1 await DELETE UserGroupRoles; DELETE GroupRoles (batch)
await DELETE GroupRoles (rt2)      →

Roundtrips: 2                           Roundtrips: 1
Latencia: ~20ms (supuesto)              Latencia: ~10ms (supuesto)
```

**Mejora estimada:** `-50% roundtrips` | **Al cierre:** transacción con 2 sentencias (`285bf14`)

---

### 8️⃣ Code-Splitting Frontend — `React.lazy()`

```
ANTES:                              DESPUÉS:
12 imports estáticos            →   lazy(() => import(...)) + Suspense (PageLoader)
Webpack bundlea las 12          →   Code-splitting: un chunk por página
Bundle inicial: no medido       →   Bundle inicial: no medido
```

**Mejora:** bundle inicial menor y primera carga más rápida (ninguna de las dos se midió) | **Impacto:** Medio (carga inicial)

**Trade-off:** la primera visita a otra página descarga su chunk

**Referencia al cierre:** build del 3 nov 2026 → `main.js` 373 KB minificado (119 KB gzip) + 24 chunks; las páginas siguen siendo lazy (la Fase 3 agregó `GitHubPage`). Incluye las Fases 3 y 4, así que no se compara con marzo.

---

### 9️⃣ Logging — Eliminación de I/O en el Hot Path

```
ANTES:                                   DESPUÉS:
console.log() en middleware          →   Eliminado (1 console.error solo en errores)
18 console.* en recomendaciones      →   Eliminados
1 escritura a stdout por request     →   0 en el hot path
```

**Mejora:** `-100% escrituras de log en hot path` (efecto en latencia no medido) | **Impacto:** Medio

---

### 🔟 WebSocket — Conexiones Zombie

```
ANTES:                              DESPUÉS:
Cliente se cuelga                →   Heartbeat con isAlive flag
Conexión se queda abierta       →   pong() actualiza isAlive
Acumulación indefinida          →   El siguiente tick (≤60s) termina la conexión
```

**Mejora:** previene la acumulación de conexiones zombie (cierre en ≤60 s, por diseño). No se observó ni se midió un leak de memoria, y no hay prueba de carga. | **Impacto:** Medio (servidor long-running) | **Al cierre:** vigente

---

## 📈 Impacto Acumulado — Escenarios Ilustrativos

Escenarios con tiempos supuestos, no medidos. Los de bundle nunca se midieron.

### Escenario 1: Usuario Típico (Load Dashboard)

| Fase | Antes | Después | Mejora |
|------|-------|---------|--------|
| Bundle descargar + parsear (supuesto) | 2000ms | 700ms | **-65%** |
| Analytics queries (supuesto) | 100ms | 15ms | **-85%** |
| **Total** | **2100ms** | **715ms** | **-66%** (carga del dashboard, estimado) |

### Escenario 2: Crear Proyecto (10 tareas + 5 milestones)

| Fase | Antes | Después | Mejora |
|------|-------|---------|--------|
| 10 tareas secuencial | 1000ms | 100ms | **-90%** |
| 5 milestones secuencial | 250ms | 50ms | **-80%** |
| **Total** | **1250ms** | **150ms** | **-88%** (estimado) |

Al cierre este escenario ya no aplica: la Fase 3 metió la creación en una transacción y los INSERT van en serie.

### Escenario 3: Asignar 50 Tareas

| Operación | Antes | Después | Mejora |
|-----------|-------|---------|--------|
| 50 × recordTaskAssignment() | 50×10ms = 500ms | 50×5ms = 250ms | **-50%** (estimado) |
| (menos roundtrips) | (2 roundtrips each) | (1 roundtrip each) | |

### Escenario 4: Analytics en un Grupo Grande (1000 miembros)

| Query | Antes | Después | Mejora |
|-------|-------|---------|--------|
| getWorkloadDistribution | 2001 ops | 5 ops | **-99.75%** (modelo conceptual) |
| Latencia (supuesta) | ~2000ms | ~29ms | **-98.6%** (estimado; las agregaciones también crecen con las tablas) |

La cifra «global» de la Fase 2 es **-71% (estimado, no medido)**: suma la carga del dashboard, crear un proyecto y asignar 50 tareas (3850 → 1115 ms; ver [ANALISIS-DETALLADO-IMPACTO.md](ANALISIS-DETALLADO-IMPACTO.md#conclusión-impacto-total-estimado)).

---

## 🎯 Ranking de Impacto

### Por Importancia / Valor (estimado)

1. **🔴 CRÍTICO:** N+1 query fix (getWorkloadDistribution)
   - Ahorro: -97.5% operaciones de BD en el modelo (100 miembros; -99.75% con 1000)
   - Sin subconsultas por fila; el costo sigue creciendo con el tamaño de las tablas (no es O(1))

2. **🔴 CRÍTICO:** Paralelización (createProjectFromPlan, etc.)
   - Ahorro: -50% a -90% latencia en operaciones masivas (tiempos supuestos)
   - Al cierre, `createProjectFromPlan` y populate-assignments van en serie dentro de transacciones

3. **🟠 ALTO:** Batchear roundtrips (borrar tarea, recordTaskAssignment, etc.)
   - Ahorro: -50% roundtrips en 4 operaciones
   - Al cierre, los 3 borrados son transacciones

4. **🟠 ALTO:** Row explosion fix (getTeamAnalyticsSummary)
   - Ahorro: -67% intermediate result size en el ejemplo
   - Corrección: los conteos salían multiplicados por M

5. **🟡 MEDIO:** Code-splitting frontend
   - Ahorro: bundle inicial menor (no medido)

6. **🟡 MEDIO:** Eliminación del logging por request
   - Ahorro: -100% escrituras de log en hot path

7. **🟢 BAJO/MEDIO:** WebSocket cleanup
   - Prevención de conexiones zombie (no se observó un leak)
   - Importa sobre todo en servidores long-running

---

## 📊 Resumen de Números

Todos son estimaciones; ninguno se midió.

| Métrica | Valor estimado | Contexto |
|---------|-------|---------|
| **Latencia global reducida** | -71% | Escenario ilustrativo (3850 → 1115 ms) |
| **Roundtrips críticos reducidos** | -50% (4 operaciones) | borrar tarea, recordTaskAssignment, deleteNode, deleteGroupRole |
| **Operaciones BD reducidas** | -97.5% (N+1 fix) | 201 → 5 operaciones (modelo, 100 miembros) |
| **Bundle inicial** | No medido | Code-splitting real (vigente al cierre) |
| **Paralelización mejorada** | -88% (caso mejor) | 1250ms → 150ms (createProjectFromPlan, tiempos supuestos; en serie desde la Fase 3) |
| **Escrituras de log en hot path** | -100% | Logging por request removido |
| **Row explosion reducida** | -67% | 15 → 5 filas por usuario en el ejemplo; conteos correctos |
| **Conexiones zombie (WS)** | Acotadas a ≤60s | Por diseño; sin prueba de carga |

---

## ✅ Verificación (Estado al 28 ago 2026)

- ✅ Todos los cambios de código implementados
- ✅ `npm run test:performance` ejecutado contra SQL Server local
- ⚠️ Tiempos absolutos capturados (30ms, 17ms, 10ms, 4.39MB): miden `getUserAnalyticsSummary()` y `getCurrentWorkload()`, que la Fase 2 no cambió, con IDs sintéticos y sin línea base «antes». No evalúan estas mejoras.
- ✅ Documentación completa (README + este análisis)
- ✅ Commits historificados (`d7bf277`, `a04a576`, `a4148dd`, `2589b55`, `4969894`)

## 🏁 Estado al Cierre (3 nov 2026)

| Cambio | Al cierre |
|---|---|
| 1 `deleteTask()` | Reemplazado: `trashTask()` en una transacción (`349aa02`) |
| 2 `recordTaskAssignment()` | Vigente; además exige que la tarea exista; prueba de BD |
| 3.1 `_updateUserMetrics()` y 3.3 `batchUpdateUserMetrics()` | Vigentes, en paralelo |
| 3.2 `createProjectFromPlan()` y 3.4 populate-assignments | Reemplazados: transacciones, en serie |
| 4 `getWorkloadDistribution()` | Vigente; sin filtro `completed = 0` (`349aa02`) |
| 5 `getTeamAnalyticsSummary()` | Vigente |
| 6 `deleteNode()` y 7 `deleteGroupRole()` | Reemplazados: transacciones de 2 sentencias (`285bf14`) |
| 8 Code-splitting | Vigente |
| 9 Logging | Vigente |
| 10 Heartbeat WebSocket | Vigente |

Además, el código muerto que dejaron estos cambios (`deleteAllByTid`, `deleteEdgesByNode`) se borró en `2c9673e` (31 ago 2026), y los commits llegaron a `master` con el PR #2 (merge `7e1610f`).

---

**Documento:** Referencia rápida para entender el impacto (estimado) de la Fase 2  
**Para más detalle:** Ver `ANALISIS-DETALLADO-IMPACTO.md` con code snippets y timelines

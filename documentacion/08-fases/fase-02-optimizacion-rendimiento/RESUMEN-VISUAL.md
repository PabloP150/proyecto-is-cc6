# Resumen Visual — Fase 2 Optimización

**Antes vs. Después a través de diagramas y gráficos**  
**28 ago 2026** (corregido al cierre del proyecto: 3 nov 2026)

> **Nota de cierre (3 nov 2026).**
> - **Ningún gráfico de este documento muestra mediciones.** Las barras, los tiempos, los porcentajes y los conteos son estimaciones con tiempos supuestos o modelos conceptuales. Nadie midió el «antes» ni el «después»; la única medición de la fase no evalúa estos cambios ([README, Medición real](README.md#-medición-real-benchmarks)).
> - La Fase 3 (`285bf14`, `349aa02`) reemplazó los borrados en un solo roundtrip (gráfico 2) y la creación de proyectos en paralelo (gráfico 4): ahora son transacciones, que cambian roundtrips o paralelismo por atomicidad.
>
> Lo que quedó sin hacer está en [cierre del proyecto](../../01-proyecto/cierre-del-proyecto.md).

---

## 📊 Gráfico 1: Carga del Dashboard (escenario ilustrativo)

```
Usuario típico carga el Dashboard (tiempos supuestos, no medidos)

ANTES (Antes de optimizaciones):
┌─────────────────────────────────────────────────┐
│ Bundle Download + Parse    ████████████████ 2000ms
│ Analytics Queries          ████ 100ms
└─────────────────────────────────────────────────┘
                        TOTAL: 2100ms

DESPUÉS (Después de optimizaciones):
┌──────────────────────────────┐
│ Bundle Download + Parse ████ 700ms
│ Analytics Queries      ██ 15ms
└──────────────────────────────┘
              TOTAL: 715ms

┌────────────────────────────────────┐
│    MEJORA ESTIMADA: -66%           │
│    (2100ms → 715ms, no medido)     │
└────────────────────────────────────┘
```

Los tiempos de bundle nunca se midieron. La cifra «global» de la Fase 2, **-71% (estimado, no medido)**, suma además crear un proyecto y asignar 50 tareas (ver la Conclusión).

---

## 📊 Gráfico 2: Roundtrips de BD — Operaciones Críticas

```
Operaciones en una sesión de usuario típica (cantidades supuestas)

ANTES:
DELETE Task          ▓▓ 2 roundtrips × 100 ops  = 200 roundtrips   (deleteTask; con el controller eran 3)
DELETE Node          ▓▓ 2 roundtrips × 50 ops   = 100 roundtrips
DELETE GroupRole     ▓▓ 2 roundtrips × 20 ops   = 40 roundtrips
Assign Tasks         ▓▓ 2 roundtrips × 100 ops  = 200 roundtrips   (recordTaskAssignment)
                                      TOTAL: 540 roundtrips

DESPUÉS:
DELETE Task          ▓ 1 roundtrip × 100 ops   = 100 roundtrips
DELETE Node          ▓ 1 roundtrip × 50 ops    = 50 roundtrips
DELETE GroupRole     ▓ 1 roundtrip × 20 ops    = 20 roundtrips
Assign Tasks         ▓ 1 roundtrip × 100 ops   = 100 roundtrips
                                      TOTAL: 270 roundtrips

┌──────────────────────────────┐
│ MEJORA ESTIMADA: -50%        │
│ (540 → 270 roundtrips)       │
│ 270 viajes de red ahorrados  │
└──────────────────────────────┘
```

**Al cierre (3 nov 2026):** los tres DELETE son transacciones desde la Fase 3. Borrar una tarea es `trashTask()`, con varias sentencias; borrar un nodo o un rol, 2 sentencias. Assign Tasks sigue en 1 roundtrip.

---

## 📊 Gráfico 3: Query N+1 — Operaciones de BD

```
Obtener el workload de 100 miembros de un grupo (modelo conceptual, tiempos supuestos)

ANTES (Subqueries correlacionadas):
┌──────────────────────────────────────────┐
│ Recorrer miembros                    ▓ 1 op
│ Para cada miembro (×100):            ░░░░░░░░░░░░░░░░░░░░░░░░ 200 ops
│   ├─ SELECT COUNT(*) FROM UserTask   (subquery 1: carga actual)
│   └─ SELECT MAX(max_concurrent_tasks) FROM UserMetrics (subquery 2: capacidad)
└──────────────────────────────────────────┘
                    TOTAL: 201 operaciones (~205ms supuestos)

DESPUÉS (Pre-agregación en tablas derivadas):
┌──────────────────────────────────────────┐
│ Recorrer miembros                    ▓ 1 op
│ Agregar UserTask (wl)                ▓ 1 op (GROUP BY uid)
│ Agregar UserMetrics (cap)            ▓ 1 op (GROUP BY uid)
│ LEFT JOIN wl                         ▓ 1 op
│ LEFT JOIN cap                        ▓ 1 op
└──────────────────────────────────────────┘
                      TOTAL: 5 operaciones (~29ms supuestos)

┌──────────────────────────────────────────┐
│ MEJORA ESTIMADA: -97.5%                  │
│ (201 → 5 operaciones en el modelo)       │
│ Sin subconsultas por fila                │
│ Con 1000 miembros: 2001 → 5 (-99.75%)    │
└──────────────────────────────────────────┘
```

Las tablas derivadas agregan **toda** `UserTask` y **toda** `UserMetrics`, así que el costo sigue creciendo con el tamaño de esas tablas (no es O(1)). No se capturaron planes de ejecución.

---

## 📊 Gráfico 4: Paralelización — Crear Proyecto

```
Crear proyecto con 10 tareas y 5 milestones (tiempos supuestos, no medidos)

ANTES (Secuencial):
┌─────────────────────────────────────────────────────────────────┐
│ Tarea 1   ████████████████ 100ms
│ Tarea 2   ████████████████ 100ms
│ Tarea 3   ████████████████ 100ms
│ ...
│ Tarea 10  ████████████████ 100ms
│ Milestone 1 ████████ 50ms
│ Milestone 2 ████████ 50ms
│ ...
│ Milestone 5 ████████ 50ms
└─────────────────────────────────────────────────────────────────┘
T=0ms ────────────────────────────────────── T=1250ms
                (10×100) + (5×50) = 1250ms

DESPUÉS (Paralelo con pool de conexiones):
┌──────────────────────────────────────────────────┐
│ Tareas (1-10 paralelo) ████████████████ 100ms
│ Milestones (1-5 paralelo)               ████████ 50ms
│                         (dos tandas, una tras otra)
└──────────────────────────────────────────────────┘
T=0ms ─────────────────────────────── T=150ms
        100 + 50 = 150ms

┌──────────────────────────────┐
│ MEJORA ESTIMADA: -88%        │
│ (1250ms → 150ms = 8.3x)      │
│ De 1.25 segundos a 150ms     │
└──────────────────────────────┘
```

**Al cierre (3 nov 2026):** reemplazado en la Fase 3. `createProjectFromPlan()` corre dentro de una sola transacción y sus INSERT se encolan en serie en la única conexión de la transacción. A cambio, el proyecto se crea completo o no se crea.

---

## 📊 Gráfico 5: Bundle Size — Code-Splitting Frontend

```
ANTES (Todos los componentes en el bundle inicial):
┌────────────────────────────────────────────────────────────┐
│ ██████████████████████████████████████████ (no medido)     │
│ HomePage Login Register CalendarView BlockDiagram Flow     │
│ Recordatorios CreateGroup GroupsView ChatPage              │
│ AnalyticsDashboard Navbar WebSocketTest ThemeTest          │
│                                                            │
│ El usuario descarga TODO aunque solo vea el login          │
└────────────────────────────────────────────────────────────┘

DESPUÉS (Code-splitting con React.lazy):
┌─────────────────┐      El usuario descarga incrementalmente
│ Bundle Inicial  │
│ ███████████     │      ┌──────────────────────────┐
│ (no medido)     │      │ Login: su chunk          │
│ (App + libs)    │      │ al abrir la app          │
│                 │      └──────────────────────────┘
│ + Chunks        │
│ (bajo demanda)  │      ┌──────────────────────────┐
└─────────────────┘      │ Dashboard: su chunk      │
                         │ la primera vez que se ve │
                         └──────────────────────────┘

┌──────────────────────────────┐
│ MEJORA:                      │
│ Bundle inicial: menor        │
│ Primera carga: más rápida    │
│ (ninguna de las dos medida)  │
└──────────────────────────────┘
```

**Referencia al cierre (3 nov 2026):** el build de producción genera `main.js` de 373 KB minificado (119 KB gzip) más 24 chunks; las páginas siguen cargándose con `React.lazy()` (la Fase 3 agregó `GitHubPage`). Incluye todo lo de las Fases 3 y 4, así que no sirve para comparar con marzo.

---

## 📊 Gráfico 6: Logging por Request — I/O en el Hot Path

```
Esquema conceptual (sin datos medidos)

ANTES (con console.log() en cada request):
┌────────────────────────────────────────────────────────────┐
│ Tiempo: ▓ Request → ▓ console.log (I/O) → ▓ DB            │
│         └─ 1 escritura a stdout por request, que puede    │
│            ser síncrona (p. ej. si va a un archivo)       │
│                                                            │
│ Recomendaciones: 18 console.* más, con objetos completos  │
└────────────────────────────────────────────────────────────┘

DESPUÉS (sin logging por request):
┌────────────────────────────────────────────────────────────┐
│ Tiempo: ▓ Request → ▓ Procesa → ▓ DB → ▓ Response        │
│         └─ Sin escrituras de log en el hot path           │
│                                                            │
│ Recomendaciones: 1 console.error solo en errores          │
└────────────────────────────────────────────────────────────┘

┌──────────────────────────────┐
│ MEJORA:                      │
│ Escrituras en hot path: -100%│
│ Efecto en latencia: no medido│
└──────────────────────────────┘
```

---

## 📊 Gráfico 7: Row Explosion — Intermediate Result Size

```
Analytics de 100 usuarios con histórico (ejemplo)

ANTES (LEFT JOIN a UserMetrics sin agregar):
┌────────────────────────────────────────────────────────────┐
│ Users     ▓ 1 fila
│ LEFT JOIN TaskAnalytics (5 hechos 'pending' por usuario)
│           ▓▓▓▓▓ 5 filas
│ LEFT JOIN UserMetrics (3 filas de histórico por usuario)
│           ▓▓▓▓▓×▓▓▓ = 15 filas por usuario (FAN-OUT!)
│                                                            │
│ COUNT('pending') = 15 por usuario ❌ (conteos ×3)          │
│ Intermediate result: 100 usuarios × 15 filas = 1500 filas │
└────────────────────────────────────────────────────────────┘

DESPUÉS (Pre-agregación de UserMetrics en um_max):
┌────────────────────────────────────────────────────────────┐
│ Users     ▓ 1 fila
│ LEFT JOIN TaskAnalytics (5 hechos por usuario)
│           ▓▓▓▓▓ 5 filas
│ LEFT JOIN um_max (1 fila agregada por usuario)
│           ▓▓▓▓▓ 5 filas (sin multiplicación)
│                                                            │
│ COUNT('pending') = 5 por usuario ✅                        │
│ Intermediate result: 100 usuarios × 5 filas = 500 filas   │
└────────────────────────────────────────────────────────────┘

┌──────────────────────────────┐
│ MEJORA:                      │
│ Corrección de bug: los       │
│ conteos salían ×M            │
│ Intermediate result: -66.7%  │
│ (1500 → 500 filas)           │
└──────────────────────────────┘
```

---

## 📈 Gráfico 8: Impacto Acumulado — Sistema Escalando

```
Esquema conceptual de getWorkloadDistribution: latencia vs. tamaño de los datos
(sin datos medidos; las curvas solo muestran la forma esperada)

ANTES (subconsultas por fila):
Latencia
     │
     │                                    ╱╱╱╱ Query N+1
     │                                  ╱╱╱╱
     │                              ╱╱╱╱
     │                            ╱╱╱╱
     │                        ╱╱╱╱
     │                      ╱╱╱╱
     │                  ╱╱╱╱
     │              ╱╱╱╱
     └─────────────────────────────────────────── Miembros / filas

DESPUÉS (pre-agregación):
Latencia
     │
     │
     │
     │
     │
     │                                ___________ Crece más despacio
     │              _________________/            (agrega tablas enteras)
     │ ____________/
     └─────────────────────────────────────────── Miembros / filas

VENTAJA (estimada):
- Antes: una subconsulta por miembro
- Después: un número fijo de agregaciones; el costo crece con el tamaño
  de UserTask y UserMetrics, pero no con una subconsulta por fila
```

---

## 🎯 Tabla de Impacto por Tipo de Usuario

Valores ilustrativos, no salen de ninguna medición.

```
┌─────────────────────────┬────────────┬────────────┬──────────┐
│ Tipo de Usuario         │   Antes    │   Después  │ Mejora   │
├─────────────────────────┼────────────┼────────────┼──────────┤
│ Usuario Casual          │            │            │          │
│ (1-2 operaciones/min)   │ ~500ms     │ ~250ms     │ -50%     │
├─────────────────────────┼────────────┼────────────┼──────────┤
│ Usuario Activo          │            │            │          │
│ (10+ operaciones/min)   │ ~2500ms    │ ~800ms     │ -68%     │
├─────────────────────────┼────────────┼────────────┼──────────┤
│ Power User              │            │            │          │
│ (crear proyectos)       │ ~4000ms    │ ~600ms     │ -85%     │
├─────────────────────────┼────────────┼────────────┼──────────┤
│ Sistema con 1000 usuarios│            │            │          │
│ (analytics queries)     │ ~3000ms    │ ~150ms     │ -95%     │
└─────────────────────────┴────────────┴────────────┴──────────┘
```

---

## 📊 Ranking Final — ¿Cuál fue el cambio más importante?

```
Impacto estimado (en orden de valor)

1. 🏆 N+1 Query Fix (getWorkloadDistribution)
   ████████████████████████████████████ -99.75% ops (modelo, 1000 miembros)
   Impacto: CRÍTICO — Escalabilidad del sistema

2. 🥈 Paralelización (Promise.all)
   ████████████████████████████████ -88% latencia (tiempos supuestos)
   Impacto: ALTO — Operaciones masivas (en serie desde la Fase 3)

3. 🥉 Code-Splitting (React.lazy)
   ████████████████████████ bundle inicial menor (no medido)
   Impacto: MEDIO-ALTO — UX inicial

4.    Row Explosion Fix (UserMetrics)
   ██████████████████████ conteos correctos + -66% intermediate rows
   Impacto: ALTO — Exactitud + perf

5.    Roundtrips (-50% cada)
   ████████████████ -50% × 4 operaciones críticas
   Impacto: ALTO — Red traffic (3 son transacciones desde la Fase 3)

6.    Logging Removal (hot path)
   ████████████ -100% escrituras de log en hot path
   Impacto: MEDIO — Throughput (no medido)

7.    WebSocket Cleanup
   ████ Conexiones zombie acotadas a ≤60 s
   Impacto: BAJO-MEDIO — Prevención (no se observó un leak)
```

---

## ✨ Conclusión

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  ANTES (Marzo 2026, antes de la Fase 2; estimado):          │
│  Dashboard cargaba en ~2 segundos                           │
│  Crear proyecto: ~1.25 segundos                            │
│  Escala: una subconsulta por miembro (queries N+1)         │
│                                                              │
│  DESPUÉS (12 mar 2026; documentado en agosto; estimado):    │
│  Dashboard carga en ~0.7 segundos                          │
│  Crear proyecto: ~0.15 segundos                           │
│  Escala: sin subconsultas por fila                        │
│                                                              │
│  ═════════════════════════════════════════════════════════ │
│                                                              │
│  RESULTADO: -71% latencia global (estimado, no medido)     │
│                                                              │
│  ✅ Menos roundtrips y menos trabajo por consulta          │
│  ✅ Carga inicial más liviana                              │
│  ✅ Bug de conteos inflados corregido                      │
│  ✅ Conexiones zombie acotadas (≤60 s)                     │
│                                                              │
│  AL CIERRE (3 nov 2026): los borrados y la creación de     │
│  proyectos son transacciones (Fase 3); el resto sigue      │
│  vigente.                                                  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

**Visualización generada:** 28 ago 2026 (corregida al cierre: 3 nov 2026)  
**Referencia:** Commits `d7bf277`, `a04a576`, `a4148dd`, `2589b55`, `4969894`

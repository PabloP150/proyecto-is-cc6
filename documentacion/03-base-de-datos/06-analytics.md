# Analytics: base de datos

**En una frase:** cuatro tablas guardan el historial de asignaciones (`TaskAnalytics`), las métricas que salen de ese historial (`UserMetrics` y `UserExpertise`) y una configuración por grupo que hoy no tiene efecto (`AnalyticsConfig`).

```mermaid
erDiagram
    direction LR
    Users ||--o{ TaskAnalytics : "uid"
    Groups ||--o{ TaskAnalytics : "gid"
    Tasks |o..o{ TaskAnalytics : "tid, sin FK desde la 001"
    Users ||--o{ UserMetrics : "uid"
    Users ||--o{ UserExpertise : "uid"
    Groups ||--o| AnalyticsConfig : "gid, ON DELETE CASCADE"

    Users {
        UNIQUEIDENTIFIER uid PK
    }
    Groups {
        UNIQUEIDENTIFIER gid PK
    }
    Tasks {
        UNIQUEIDENTIFIER tid PK
    }
    TaskAnalytics {
        UNIQUEIDENTIFIER id PK "DEFAULT NEWID()"
        UNIQUEIDENTIFIER tid "NOT NULL, sin FK"
        UNIQUEIDENTIFIER uid FK "NOT NULL"
        UNIQUEIDENTIFIER gid FK "NOT NULL"
        VARCHAR(50) task_category "DEFAULT general"
        DATETIME2 assigned_at "NOT NULL, DEFAULT GETDATE()"
        DATETIME2 completed_at "NULL, no antes de assigned_at"
        VARCHAR(20) success_status "DEFAULT pending"
        DECIMAL(10,2) completion_time_hours "NULL, mayor o igual a 0"
        DATETIME2 created_at "DEFAULT GETDATE()"
    }
    UserMetrics {
        UNIQUEIDENTIFIER id PK "DEFAULT NEWID()"
        UNIQUEIDENTIFIER uid FK, UK "NOT NULL, UQ con metric_date"
        DATE metric_date UK "NOT NULL"
        INT active_tasks_count "DEFAULT 0"
        INT max_concurrent_tasks "DEFAULT 0"
        DECIMAL(10,2) avg_completion_time_hours "DEFAULT 0"
        DECIMAL(5,2) success_rate_percentage "DEFAULT 0, de 0 a 100"
        DATETIME2 updated_at "DEFAULT GETDATE()"
    }
    UserExpertise {
        UNIQUEIDENTIFIER id PK "DEFAULT NEWID()"
        UNIQUEIDENTIFIER uid FK, UK "NOT NULL, UQ con task_category"
        VARCHAR(50) task_category UK "NOT NULL"
        DECIMAL(5,2) expertise_score "DEFAULT 0, de 0 a 100"
        INT tasks_completed "DEFAULT 0"
        DECIMAL(10,2) avg_completion_time_hours "DEFAULT 0"
        DECIMAL(5,2) success_rate_percentage "DEFAULT 0, de 0 a 100"
        DATETIME2 last_updated "DEFAULT GETDATE()"
    }
    AnalyticsConfig {
        UNIQUEIDENTIFIER gid PK, FK "migración 001"
        BIT analytics_enabled "NOT NULL, DEFAULT 1"
        BIT track_completion_time "NOT NULL, DEFAULT 1"
        BIT track_success_rate "NOT NULL, DEFAULT 1"
        BIT track_workload "NOT NULL, DEFAULT 1"
        BIT track_expertise "NOT NULL, DEFAULT 1"
        BIT track_capacity "NOT NULL, DEFAULT 1"
        INT data_retention_days "NOT NULL, DEFAULT 365"
        VARCHAR(30) privacy_mode "NOT NULL, DEFAULT team_leader_only"
        DATETIMEOFFSET(0) updated_at "NOT NULL, DEFAULT SYSDATETIMEOFFSET()"
    }
```

`Users`, `Groups` y `Tasks` solo muestran su clave; sus campos están en el [modelo general](00-general.md). `UK` marca las dos columnas de cada restricción única.

## Tablas

| Tabla | Para qué sirve | Campos clave |
|-------|----------------|--------------|
| `TaskAnalytics` | Historial: una fila (un «registro») por cada vez que se asigna una tarea a una persona, y cómo terminó | `tid`, `uid`, `gid`, `task_category`, `success_status`, `assigned_at`, `completed_at`, `completion_time_hours` |
| `UserMetrics` | Una fila por persona y día: tareas abiertas y el máximo de tareas a la vez | `uid` + `metric_date`, `active_tasks_count`, `max_concurrent_tasks` |
| `UserExpertise` | Una fila por persona y categoría: puntaje de experiencia de 0 a 100 | `uid` + `task_category`, `expertise_score`, `tasks_completed`, `success_rate_percentage` |
| `AnalyticsConfig` | Interruptores, retención y modo de privacidad por grupo. Se guardan, pero ningún código los lee | `gid`, `analytics_enabled`, `track_*`, `data_retention_days`, `privacy_mode` |

Valores de `success_status`:
- `pending`: la tarea sigue asignada y abierta.
- `completed`: la tarea se completó. Solo en este caso se calcula `completion_time_hours` (horas desde `assigned_at`).
- `failed`: la tarea fue a la papelera o se borró su lista.
- `reassigned`: se quitó a la persona de la tarea.

Las categorías son `frontend`, `backend`, `database`, `testing` y `general`. Al asignar, la API elige una buscando palabras clave en el nombre, la descripción y la lista de la tarea (`AnalyticsIntegration.detectTaskCategory`); si ninguna coincide, usa `general`.

## Reglas

- **Restricciones de `TaskAnalytics`:**
  - `success_status` solo puede ser `pending`, `completed`, `failed` o `reassigned`.
  - `completion_time_hours` es mayor o igual a 0.
  - `completed_at` es nulo o no es anterior a `assigned_at`; el código ajusta la hora de cierre para cumplirlo.
- **Restricciones de `UserMetrics`:** una fila por `(uid, metric_date)`; los conteos y el tiempo medio son mayores o iguales a 0; la tasa de éxito va de 0 a 100.
- **Restricciones de `UserExpertise`:** una fila por `(uid, task_category)`; la categoría está en la lista de 5; puntaje y tasa de éxito van de 0 a 100; los conteos y el tiempo medio son mayores o iguales a 0.
- **Restricciones de `AnalyticsConfig`:** `data_retention_days` va de 1 a 3650; `privacy_mode` es `team_leader_only`, `team` o `private`.
- **Sin FK a `Tasks`:** la migración 001 quitó la FK de `TaskAnalytics.tid`, para que el historial sobreviva cuando la tarea se completa o se borra. Por eso `recordTaskAssignment` comprueba en el mismo `INSERT` que la tarea exista.
- **Sin duplicados pendientes, a medias:** el `INSERT … WHERE NOT EXISTS` evita un segundo registro `pending` del mismo `(tid, uid)`, pero no hay índice único que lo garantice (ver [limitaciones](../01-proyecto/cierre-del-proyecto.md#analytics)).
- **Índices (migración 001):** `IX_TaskAnalytics_Tid (tid, success_status)`, `IX_TaskAnalytics_Uid (uid, success_status)` e `IX_TaskAnalytics_Gid (gid)`.
- **Cascadas:**
  - Solo `AnalyticsConfig` cae sola al borrar el grupo (`ON DELETE CASCADE`).
  - Los `TaskAnalytics` del grupo los borra `group.model.deleteGroupCascade`, dentro de la misma transacción que borra el grupo.
  - `UserMetrics` y `UserExpertise` son por persona, no por grupo: no se borran con el grupo.
  - Las FK a `Users` y a `Groups` no tienen cascada. La API no borra usuarios.
- **Triggers:** ninguno. Los dos triggers de TaskMate (migración 006) están en `Nodes` y `Edges`.
- **Columnas que nadie escribe:** `UserMetrics.avg_completion_time_hours` y `UserMetrics.success_rate_percentage` se quedan en su valor por defecto, 0. Ningún código las lee.
- **Cómo se calcula la experiencia:** `expertise_score` = mínimo(100, tasa de éxito + bono). El bono es 10 sin tiempos medidos; si no, máximo(0, 20 − horas medias / 2). La tasa de éxito usa los registros `completed` contra los `completed` + `failed`.
  - Pese a su nombre, `tasks_completed` cuenta los registros cerrados: `completed` + `failed`. Sin ninguno, el puntaje es 0.
  - `UserExpertise` no tiene `gid`: suma lo de todos los grupos de la persona, y solo lo usan sus propios analytics (`GET /user/:userId`).
  - Las vistas de equipo (el ranking de «Category Expertise» y el `team_context` de la IA) recalculan la experiencia con la misma fórmula, pero solo con los registros cerrados de `TaskAnalytics` del grupo (`gid`).
- **Capacidad:**
  - En sus propios analytics: la mayor `max_concurrent_tasks` de la persona en `UserMetrics` (todos sus grupos), o 3 si no tiene historial.
  - En las vistas de equipo (barras de carga, resumen del equipo y `team_context`): lo máximo que la persona tuvo abierto a la vez en el grupo, contado sobre los registros de `TaskAnalytics` de ese `gid` (`GROUP_CAPACITY_SQL`, `services/analyticsContext.js`), o 3 si ahí no tiene historial. No se usa `UserMetrics`, que es por persona.
- **Carga en las vistas de equipo:** las asignaciones (`UserTask`) de la persona en tareas abiertas del grupo (`Tasks.gid`). Las barras listan a todos los miembros (`UserGroups`), tengan o no un rol en el grupo.

## Quién escribe cada tabla

| Acción | Efecto en la base | Código |
|--------|-------------------|--------|
| Asignar una persona a una tarea (`POST /api/usertask`) | nuevo `TaskAnalytics` en `pending` | `AnalyticsService.recordTaskAssignment` |
| Quitar a la persona (`DELETE /api/usertask`) | su registro pasa a `reassigned` | `models/usertask.model.js` |
| Completar la tarea, a mano o por un PR fusionado | registros a `completed`; luego se recalculan `UserExpertise` y `UserMetrics` | `models/tasks.model.js`, `AnalyticsService.recordTaskCompletion` |
| Mandar la tarea a la papelera | registros a `failed`; luego el mismo recálculo | `models/tasks.model.js` |
| Borrar una lista entera | registros de sus tareas a `failed` (sin recálculo) | `models/tasks.model.js` |
| Sembrar asignaciones de demo | `UserTask` y `TaskAnalytics` al azar | `usertask.model.populateAssignmentsForGroup` |
| Job de métricas (si está activo) | `UserMetrics` de quien tuvo actividad en los últimos 7 días; `expertise_score` de las filas de `UserExpertise` sin cambios en la última hora | `AnalyticsService.batchUpdateUserMetrics` |
| `PUT /api/analytics/config/:groupId` | `MERGE` en `AnalyticsConfig` | `analytics.controller.js` |

## Dónde se usa

No hay un archivo en `models/` para analytics. El SQL está en:

| Archivo | Tablas |
|---------|--------|
| `taskmate-api/services/AnalyticsService.js` | lee y escribe `TaskAnalytics`, `UserMetrics` y `UserExpertise` |
| `taskmate-api/services/analyticsContext.js` | lee `TaskAnalytics`, `UserTask` y `Tasks` (solo el grupo) para el `team_context`; define la capacidad por grupo (`GROUP_CAPACITY_SQL`) |
| `taskmate-api/controllers/analytics.controller.js` | lee y escribe `AnalyticsConfig` |
| `taskmate-api/models/tasks.model.js` | cierra registros al completar, al mandar a la papelera o al borrar una lista |
| `taskmate-api/models/usertask.model.js` | `reassigned` y asignaciones de demo |
| `taskmate-api/models/group.model.js` | borra los `TaskAnalytics` del grupo |
| `taskmate-api/taskmate_tables.sql`, `migrations/001_schema_fixes.sql` | definición de las tablas |
| `taskmate-api/tests/db/analytics.dbtest.js` | pruebas contra un SQL Server desechable |

## Para saber más

- Arquitectura del módulo: [02-arquitectura/06-analytics.md](../02-arquitectura/06-analytics.md)
- Cómo nace y se cierra un registro: [06-flujos/06-analytics.md](../06-flujos/06-analytics.md)
- Las 24 tablas: [00-general.md](00-general.md)
- Limitaciones: [cierre del proyecto](../01-proyecto/cierre-del-proyecto.md#analytics)

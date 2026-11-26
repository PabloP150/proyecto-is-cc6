# GitHub: base de datos

**En una frase:** seis tablas guardan qué instalación de la App y qué repositorio tiene cada grupo, la rama de cada tarea, los pull requests de esas ramas y el registro de los webhooks recibidos; una séptima, `TaskFiles`, guarda qué archivos tocó cada tarea según su PR. Los tokens de GitHub nunca se guardan.

```mermaid
erDiagram
    GitHubInstallations ||--o{ GitHubRepositories : "installation_id, CASCADE"
    GitHubRepositories ||--o{ GroupRepositories : "repo_id, CASCADE"
    Groups ||--o| GroupRepositories : "gid, CASCADE"
    Users ||--o{ GroupRepositories : "connected_by"
    Tasks ||--o| TaskBranches : "tid, CASCADE"
    GitHubRepositories ||--o{ TaskBranches : "repo_id, CASCADE"
    Users ||--o{ TaskBranches : "created_by"
    GitHubRepositories ||--o{ PullRequests : "repo_id, CASCADE"
    TaskBranches |o..o{ PullRequests : "repo_id + head_branch, sin FK"
    Tasks ||--o{ TaskFiles : "tid, CASCADE"

    Users {
        UNIQUEIDENTIFIER uid PK "módulo Usuarios"
    }
    Groups {
        UNIQUEIDENTIFIER gid PK "módulo Grupos"
    }
    Tasks {
        UNIQUEIDENTIFIER tid PK "módulo Tareas"
    }
    GitHubInstallations {
        BIGINT installation_id PK "id de GitHub"
        NVARCHAR(39) account_login "NOT NULL, dueño de los repos"
        VARCHAR(12) account_type "NOT NULL, User u Organization"
        DATETIMEOFFSET(0) created_at "NOT NULL, DEFAULT SYSDATETIMEOFFSET"
        DATETIMEOFFSET(0) suspended_at "NULL = activa"
    }
    GitHubRepositories {
        BIGINT repo_id PK "id de GitHub"
        BIGINT installation_id FK "NOT NULL"
        NVARCHAR(100) name "NOT NULL"
        NVARCHAR(255) default_branch "NOT NULL, collation BIN2"
        BIT is_private "NOT NULL"
        DATETIMEOFFSET(0) updated_at "NOT NULL, DEFAULT SYSDATETIMEOFFSET"
    }
    GroupRepositories {
        UNIQUEIDENTIFIER gid PK, FK "un repo por grupo"
        BIGINT repo_id FK "NOT NULL"
        UNIQUEIDENTIFIER connected_by FK "NOT NULL"
        DATETIMEOFFSET(0) connected_at "NOT NULL, DEFAULT SYSDATETIMEOFFSET"
        BIT ai_analysis_enabled "NOT NULL, DEFAULT 0, 005"
    }
    TaskBranches {
        UNIQUEIDENTIFIER tid PK, FK "una rama por tarea"
        BIGINT repo_id FK, UK "UQ con branch_name"
        NVARCHAR(255) branch_name UK "NOT NULL, collation BIN2"
        CHAR(40) base_sha "NOT NULL, solo hexadecimal"
        UNIQUEIDENTIFIER created_by FK "NOT NULL"
        DATETIMEOFFSET(0) created_at "NOT NULL, DEFAULT SYSDATETIMEOFFSET"
    }
    PullRequests {
        BIGINT pr_id PK "id de GitHub"
        BIGINT repo_id FK, UK "UQ con number"
        INT number UK "NOT NULL, mayor que 0"
        NVARCHAR(255) head_branch "NOT NULL, collation BIN2"
        NVARCHAR(255) base_branch "NOT NULL, collation BIN2"
        NVARCHAR(256) title "NOT NULL"
        BIT is_draft "NOT NULL, DEFAULT 0"
        DATETIMEOFFSET(0) opened_at "NOT NULL"
        DATETIMEOFFSET(0) closed_at "NULL"
        DATETIMEOFFSET(0) merged_at "NULL, exige closed_at"
        DATETIMEOFFSET(0) gh_updated_at "NOT NULL, ordena los eventos"
        VARCHAR(6) state "calculada: open, closed o merged"
    }
    GitHubWebhookDeliveries {
        UNIQUEIDENTIFIER delivery_id PK "X-GitHub-Delivery"
        VARCHAR(50) event "NOT NULL"
        VARCHAR(50) action "NULL"
        BIGINT installation_id "NULL, sin FK"
        DATETIMEOFFSET(0) received_at "NOT NULL, DEFAULT SYSDATETIMEOFFSET"
        DATETIMEOFFSET(0) processed_at "NULL solo mientras processing"
        VARCHAR(10) status "NOT NULL, DEFAULT processing"
        NVARCHAR(1000) error "NULL"
        CHAR(64) payload_sha256 UK "NULL, único si no es NULL, 005"
    }
    TaskFiles {
        UNIQUEIDENTIFIER tid PK, FK "PK con path, 010"
        NVARCHAR(400) path PK "collation BIN2"
        VARCHAR(10) status "NOT NULL, estado de GitHub"
        INT additions "NOT NULL, DEFAULT 0"
        INT deletions "NOT NULL, DEFAULT 0"
        INT pr_number "NULL, sin FK"
        CHAR(40) head_sha "NULL, solo hexadecimal"
        DATETIMEOFFSET(0) recorded_at "NOT NULL, DEFAULT SYSDATETIMEOFFSET"
    }
```

`PK` = llave primaria · `FK` = llave foránea · `UK` = valor único (sola o en pareja) · `||--o{` = uno a muchos · `||--o|` = uno a cero o uno · línea punteada = relación sin FK.

`Users`, `Groups` y `Tasks` son de otros módulos; aquí solo aparece su llave. `GitHubWebhookDeliveries` no tiene relaciones a propósito: registra lo que GitHub mandó, aunque sea de una instalación desconocida.

## Tablas

| Tabla | Para qué sirve | Campos clave |
|---|---|---|
| `GitHubInstallations` | Una instalación de la TaskMate App en una cuenta u organización de GitHub | `installation_id` (PK, id de GitHub), `account_login`, `suspended_at` |
| `GitHubRepositories` | Un repositorio al que la App tiene acceso; su dueño es la cuenta de la instalación | `repo_id` (PK, id de GitHub), `installation_id` → `GitHubInstallations`, `default_branch` |
| `GroupRepositories` | El vínculo grupo ↔ repositorio: uno por grupo; un repo puede estar en varios grupos | `gid` (PK) → `Groups`, `repo_id` → `GitHubRepositories`, `ai_analysis_enabled` |
| `TaskBranches` | La rama de GitHub de una tarea (`tm/<slug>-<8 caracteres del tid>`) | `tid` (PK) → `Tasks`, (`repo_id`, `branch_name`) único, `base_sha` |
| `PullRequests` | Copia mínima de los PRs del repositorio (no de forks) que llegan por webhook o por «Sync PRs» | `pr_id` (PK), (`repo_id`, `number`) único, `head_branch`, `merged_at`, `state` |
| `GitHubWebhookDeliveries` | Registro de cada webhook: evita procesar dos veces la misma entrega | `delivery_id` (PK), `payload_sha256` (único), `status` |
| `TaskFiles` | Los archivos que tocó una tarea, sacados del PR de su rama (`pulls/{n}/files`): uno por fila, con su estado y sus líneas | (`tid`, `path`) (PK), `tid` → `Tasks`, `status`, `additions`, `deletions`, `pr_number`, `head_sha` |

Origen: migración `002_github.sql`. La `005` agregó `GroupRepositories.ai_analysis_enabled` y `GitHubWebhookDeliveries.payload_sha256` con su índice único filtrado. La `010_task_files.sql` creó `TaskFiles` (línea de Christian; su `.down.sql` borra la tabla con los datos).

Del mismo módulo cuelgan otras dos tablas que se documentan aparte: `AiReviews` (011, revisiones de PR con IA, [módulo 10](10-ia-sobre-el-codigo.md)) y `Deployments` (009, despliegues de Vercel, [CI/CD](08-cicd.md)), que guarda el `repo_id` del repositorio vinculado.

## Reglas

**Restricciones (CHECK y UNIQUE)**
- `account_type` solo acepta `User` u `Organization`.
- `base_sha`, `payload_sha256` y `TaskFiles.head_sha` solo aceptan caracteres hexadecimales.
- `PullRequests.number` debe ser mayor que 0, y `merged_at` con valor exige `closed_at` con valor (`CK_PullRequests_MergedClosed`).
- `status` de una entrega solo puede ser `processing`, `processed`, `ignored` o `failed`. `processed_at` es NULL solo mientras está en `processing`.
- `TaskFiles.status` solo acepta `added`, `modified`, `removed`, `renamed`, `copied` o `changed` (los estados de GitHub).
- Únicos: (`repo_id`, `branch_name`) en `TaskBranches`, (`repo_id`, `number`) en `PullRequests`, `payload_sha256` cuando no es NULL, y (`tid`, `path`) en `TaskFiles` (su PK).
- `PullRequests.state` es una columna calculada: `merged` si hay `merged_at`, `closed` si hay `closed_at`, si no `open`. Nunca se escribe.
- `default_branch`, `branch_name`, `head_branch`, `base_branch` y `TaskFiles.path` usan la collation `Latin1_General_100_BIN2`: en Git, `Main` y `main` son ramas distintas, y `README.md` y `readme.md` son archivos distintos.
- `TaskFiles.pr_number` no tiene FK a `PullRequests`: guarda solo el número del PR del que salió la lista.

**Cascadas (`ON DELETE CASCADE`)**
- Borrar una instalación borra sus repositorios.
- Borrar un repositorio borra sus vínculos con grupos, sus ramas de tarea y sus PRs. También borra su pipeline y sus solicitudes de deploy ([CI/CD](08-cicd.md)).
- Excepción: `Deployments.repo_id` apunta a `GitHubRepositories` **sin** cascada. Según el código, si un despliegue de Vercel apunta al repo, borrar ese repo o su instalación choca con la FK; el webhook marca la entrega `ignored` y el repo se queda en la BD ([limitaciones](../01-proyecto/cierre-del-proyecto.md#limitaciones-conocidas)).
- Borrar un grupo borra su vínculo. Borrar una tarea borra su rama en `TaskBranches`, su lista en `TaskFiles` y sus revisiones en `AiReviews`. Los PRs se quedan: no tienen FK a la rama.
- Las FK hacia `Users` (`connected_by`, `created_by`) no tienen cascada.

**Reglas que aplica la API**
- **Vincular otro repo o desvincular** borra, en la misma transacción, las ramas de tareas del grupo que apuntan a otro repositorio y las solicitudes de deploy pendientes. Cambiar de repo vuelve a poner `ai_analysis_enabled` en 0.
- **Completar, mandar a la papelera o borrar una lista de tareas** primero bloquea la fila de `TaskBranches` (`UPDLOCK, HOLDLOCK`, por `PK_TaskBranches`) y la lee. Así una rama creada al mismo tiempo no se cuela, y la API sabe qué rama limpiar en GitHub después del commit. Como las tres operaciones borran la fila de `Tasks`, la cascada se lleva también su `TaskFiles`: una tarea completada no conserva su lista de archivos.
- **Orden de los eventos de un PR.** Manda `gh_updated_at`: un evento más viejo no cambia nada, salvo que traiga la fusión. `merged_at` nunca se borra. En un empate al segundo, `closed_at` no se pierde.
- **Lista de archivos.** `replaceTaskFiles` borra la lista de la tarea y la vuelve a escribir entera desde el PR, en una transacción; un estado desconocido se guarda como `modified`. Se llama después de fusionar el PR (según el código, falla: al repo que pasa el webhook le falta el dueño y la tarea ya salió de `Tasks`, así que la FK rechaza el INSERT) y al abrir «Task files» si la tarea no tiene lista y su rama tiene PR; ese segundo camino deja `head_sha` en NULL. GitHub da una sola página de 100 archivos, así que un PR más grande queda incompleto.
- **Archivos compartidos.** `findTasksTouchingPaths` cruza hasta 200 rutas con las de otras tareas del mismo grupo, uniendo con `Tasks`: solo encuentra tareas activas.
- **Entregas.** Una entrega se salta si su id, o su `payload_sha256` en otra entrega, ya está `processed`, `ignored` o `processing`. Se reintenta si quedó `failed` o lleva más de 10 min en `processing`.
- **Purga.** La API borra cada día las entregas más viejas que `WEBHOOK_DELIVERY_RETENTION_DAYS`: un entero de 30 o más; si falta, es menor o no es entero, se usan 90.

**Triggers:** ninguno. Los dos triggers de la migración 006 son de los hitos (`Nodes` y `Edges`).

**Índices:** `IX_GitHubRepositories_InstallationId`, `IX_GroupRepositories_RepoId`, `IX_GroupRepositories_ConnectedBy`, `IX_TaskBranches_CreatedBy`, `IX_PullRequests_Repo_HeadBranch`, `IX_GitHubWebhookDeliveries_ReceivedAt`, `IX_GitHubWebhookDeliveries_PayloadSha256` (único, filtrado) e `IX_TaskFiles_Path` (`path`, con `tid` y `status` incluidos), pensado para la detección de colisiones de archivos, que quedó pospuesta.

## Dónde se usa

| Modelo | Qué hace con estas tablas |
|---|---|
| `taskmate-api/models/github.model.js` | Todo el módulo: guardar instalación y repositorio, vincular y desvincular, opción de IA, ramas de tareas, vínculos tarea ↔ rama ↔ PR, aplicar un PR, registrar, cerrar y purgar entregas, y la lista de archivos (`replaceTaskFiles`, `getTaskFiles`, `findTasksTouchingPaths`) |
| `taskmate-api/models/tasks.model.js` | Al completar, mandar a la papelera o borrar una lista: bloquea y lee la rama de la tarea antes de que la cascada borre su `TaskBranches`, su `TaskFiles` y su `AiReviews` |
| `taskmate-api/models/group.model.js` | Al borrar un grupo, `GroupRepositories` se va por cascada, y `TaskBranches`, `TaskFiles` y `AiReviews` por la cascada desde `Tasks` |
| `taskmate-api/models/cicd.model.js` | Bloquea la fila de `GroupRepositories` antes de crear o reabrir una solicitud de deploy (mismo orden de bloqueos que vincular) |

## Para saber más

- Todas las tablas de TaskMate: [00-general.md](00-general.md)
- Revisiones de PR con IA (`AiReviews`): [10-ia-sobre-el-codigo.md](10-ia-sobre-el-codigo.md)
- Arquitectura del módulo: [02-arquitectura/07-github.md](../02-arquitectura/07-github.md)
- Diseño 3FN y operaciones atómicas: [Fase 3, parte B](../08-fases/fase-03-integracion-github/SEGURIDAD-Y-BASE-DE-DATOS.md#parte-b--diseño-de-la-base-de-datos)
- Migrar la BD: [guía de la BD en Docker](../07-guias/base-de-datos-docker.md)
- Limitaciones conocidas: [cierre de la línea de Pablo y estado](../01-proyecto/cierre-del-proyecto.md#limitaciones-conocidas)

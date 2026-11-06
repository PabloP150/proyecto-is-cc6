# Tablas y campos

**En una frase:** referencia completa de las 24 tablas de TaskMate, con todos sus campos, tipos, llaves y restricciones, tal como quedan con el esquema base más las migraciones 001–008.

Fuente: `taskmate-api/taskmate_tables.sql` (esquema base), `taskmate-api/migrations/001`–`008` y `_schema_migrations.sql`. El diagrama con solo las llaves está en [00-general.md](00-general.md).

**Cómo leer los diagramas:** `PK` = llave primaria · `FK` = llave foránea · `UK` = parte de un valor único · `||--o{` = uno a muchos · `||--o|` = uno a cero o uno · `|o--o{` = FK que admite `NULL` · línea punteada = relación sin FK en la base. Una tabla de otra área aparece solo con su llave.

## Usuarios, grupos y roles

```mermaid
erDiagram
    Users ||--o{ Groups : "adminId"
    Users ||--o{ UserGroups : "uid"
    Groups ||--o{ UserGroups : "gid"
    Groups ||--o{ GroupRoles : "gid"
    GroupRoles ||--o{ UserGroupRoles : "gr_id + gid"
    UserGroups ||--o{ UserGroupRoles : "uid + gid"

    Users {
        UNIQUEIDENTIFIER uid PK
        NVARCHAR(25) username UK
        VARCHAR(60) password
    }
    Groups {
        UNIQUEIDENTIFIER gid PK
        UNIQUEIDENTIFIER adminId FK
        NVARCHAR(25) name
    }
    UserGroups {
        UNIQUEIDENTIFIER uid PK, FK
        UNIQUEIDENTIFIER gid PK, FK
        DATETIMEOFFSET(0) joined_at
    }
    GroupRoles {
        UNIQUEIDENTIFIER gr_id PK
        UNIQUEIDENTIFIER gid FK
        NVARCHAR(40) gr_name UK
        VARCHAR(20) gr_color
        VARCHAR(40) gr_icon
    }
    UserGroupRoles {
        UNIQUEIDENTIFIER ugr_id PK
        UNIQUEIDENTIFIER uid FK
        UNIQUEIDENTIFIER gid FK
        UNIQUEIDENTIFIER gr_id FK
        SMALLDATETIME ugr_assigned_at
    }
```

## Tareas e hitos

```mermaid
erDiagram
    Groups ||--o{ Tasks : "gid"
    Groups ||--o{ Complete : "gid"
    Groups ||--o{ DeleteTask : "gid"
    Groups ||--o{ Nodes : "gid"
    Tasks ||--o{ UserTask : "tid"
    Users ||--o{ UserTask : "uid"
    Nodes ||--o{ Edges : "sourceId + gid"
    Nodes ||--o{ Edges : "targetId + gid"

    Groups {
        UNIQUEIDENTIFIER gid PK
    }
    Users {
        UNIQUEIDENTIFIER uid PK
    }
    Tasks {
        UNIQUEIDENTIFIER tid PK
        UNIQUEIDENTIFIER gid FK
        NVARCHAR(25) name
        NVARCHAR(1000) description
        NVARCHAR(25) list
        SMALLDATETIME datetime
        INT percentage
        DATETIMEOFFSET(7) created_at
        BIGINT created_seq
    }
    UserTask {
        UNIQUEIDENTIFIER utid UK
        UNIQUEIDENTIFIER uid PK, FK
        UNIQUEIDENTIFIER tid PK, FK
        BIT completed
    }
    Complete {
        UNIQUEIDENTIFIER tid PK
        UNIQUEIDENTIFIER gid FK
        NVARCHAR(25) name
        NVARCHAR(1000) description
        INT percentage
        SMALLDATETIME datetime
        DATETIMEOFFSET(7) created_at
        BIGINT created_seq
    }
    DeleteTask {
        UNIQUEIDENTIFIER tid PK
        UNIQUEIDENTIFIER gid FK
        NVARCHAR(25) name
        NVARCHAR(1000) description
        SMALLDATETIME datetime
        INT percentage
        DATETIMEOFFSET(7) created_at
        BIGINT created_seq
    }
    Nodes {
        UNIQUEIDENTIFIER nid PK
        UNIQUEIDENTIFIER gid FK
        NVARCHAR(25) name
        NVARCHAR(1000) description
        DATE date
        BIT completed
        FLOAT x_pos
        FLOAT y_pos
        INT percentage
        INT connections
    }
    Edges {
        UNIQUEIDENTIFIER eid PK
        UNIQUEIDENTIFIER gid FK
        UNIQUEIDENTIFIER sourceId FK
        UNIQUEIDENTIFIER targetId FK
        BIT prerequisite
    }
```

## Analytics

```mermaid
erDiagram
    Users ||--o{ TaskAnalytics : "uid"
    Groups ||--o{ TaskAnalytics : "gid"
    Tasks |o..o{ TaskAnalytics : "tid, sin FK"
    Users ||--o{ UserMetrics : "uid"
    Users ||--o{ UserExpertise : "uid"
    Groups ||--o| AnalyticsConfig : "gid, CASCADE"

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
        UNIQUEIDENTIFIER id PK
        UNIQUEIDENTIFIER tid
        UNIQUEIDENTIFIER uid FK
        UNIQUEIDENTIFIER gid FK
        VARCHAR(50) task_category
        DATETIME2 assigned_at
        DATETIME2 completed_at
        VARCHAR(20) success_status
        DECIMAL(10,2) completion_time_hours
        DATETIME2 created_at
    }
    UserMetrics {
        UNIQUEIDENTIFIER id PK
        UNIQUEIDENTIFIER uid FK
        DATE metric_date
        INT active_tasks_count
        INT max_concurrent_tasks
        DECIMAL(10,2) avg_completion_time_hours
        DECIMAL(5,2) success_rate_percentage
        DATETIME2 updated_at
    }
    UserExpertise {
        UNIQUEIDENTIFIER id PK
        UNIQUEIDENTIFIER uid FK
        VARCHAR(50) task_category
        DECIMAL(5,2) expertise_score
        INT tasks_completed
        DECIMAL(10,2) avg_completion_time_hours
        DECIMAL(5,2) success_rate_percentage
        DATETIME2 last_updated
    }
    AnalyticsConfig {
        UNIQUEIDENTIFIER gid PK, FK
        BIT analytics_enabled
        BIT track_completion_time
        BIT track_success_rate
        BIT track_workload
        BIT track_expertise
        BIT track_capacity
        INT data_retention_days
        VARCHAR(30) privacy_mode
        DATETIMEOFFSET(0) updated_at
    }
```

## GitHub y CI/CD

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
    GitHubRepositories ||--o| RepoPipelines : "repo_id, CASCADE"
    Users ||--o{ RepoPipelines : "configured_by"
    Groups ||--o{ DeployRequests : "gid, CASCADE"
    GitHubRepositories ||--o{ DeployRequests : "repo_id, CASCADE"
    Users ||--o{ DeployRequests : "requested_by"
    Users |o--o{ DeployRequests : "decided_by"

    Users {
        UNIQUEIDENTIFIER uid PK
    }
    Groups {
        UNIQUEIDENTIFIER gid PK
    }
    Tasks {
        UNIQUEIDENTIFIER tid PK
    }
    GitHubInstallations {
        BIGINT installation_id PK
        NVARCHAR(39) account_login
        VARCHAR(12) account_type
        DATETIMEOFFSET(0) created_at
        DATETIMEOFFSET(0) suspended_at
    }
    GitHubRepositories {
        BIGINT repo_id PK
        BIGINT installation_id FK
        NVARCHAR(100) name
        NVARCHAR(255) default_branch
        BIT is_private
        DATETIMEOFFSET(0) updated_at
    }
    GroupRepositories {
        UNIQUEIDENTIFIER gid PK, FK
        BIGINT repo_id FK
        UNIQUEIDENTIFIER connected_by FK
        DATETIMEOFFSET(0) connected_at
        BIT ai_analysis_enabled
    }
    TaskBranches {
        UNIQUEIDENTIFIER tid PK, FK
        BIGINT repo_id FK, UK
        NVARCHAR(255) branch_name UK
        CHAR(40) base_sha
        UNIQUEIDENTIFIER created_by FK
        DATETIMEOFFSET(0) created_at
    }
    PullRequests {
        BIGINT pr_id PK
        BIGINT repo_id FK, UK
        INT number UK
        NVARCHAR(255) head_branch
        NVARCHAR(255) base_branch
        NVARCHAR(256) title
        BIT is_draft
        DATETIMEOFFSET(0) opened_at
        DATETIMEOFFSET(0) closed_at
        DATETIMEOFFSET(0) merged_at
        DATETIMEOFFSET(0) gh_updated_at
        VARCHAR(6) state
    }
    GitHubWebhookDeliveries {
        UNIQUEIDENTIFIER delivery_id PK
        VARCHAR(50) event
        VARCHAR(50) action
        BIGINT installation_id
        DATETIMEOFFSET(0) received_at
        DATETIMEOFFSET(0) processed_at
        VARCHAR(10) status
        NVARCHAR(1000) error
        CHAR(64) payload_sha256 UK
    }
    RepoPipelines {
        BIGINT repo_id PK, FK
        NVARCHAR(255) workflow_path
        NVARCHAR(4000) spec
        CHAR(40) commit_sha
        UNIQUEIDENTIFIER configured_by FK
        DATETIMEOFFSET(0) configured_at
    }
    DeployRequests {
        UNIQUEIDENTIFIER request_id PK
        UNIQUEIDENTIFIER gid FK
        BIGINT repo_id FK
        VARCHAR(10) environment
        CHAR(40) version_sha
        UNIQUEIDENTIFIER requested_by FK
        DATETIMEOFFSET(0) requested_at
        VARCHAR(10) status
        UNIQUEIDENTIFIER decided_by FK
        DATETIMEOFFSET(0) decided_at
        NVARCHAR(500) note
    }
```

`GitHubWebhookDeliveries` no tiene FKs a propósito: registra lo que manda GitHub aunque la instalación no exista en la base.

## Control

```mermaid
erDiagram
    SchemaMigrations {
        INT version PK
        NVARCHAR(200) name
        DATETIMEOFFSET(0) applied_at
    }
```

## Diccionario de datos

Todos los campos son `NOT NULL` salvo los marcados **NULL**. «005», «007» u «008» indica la migración que agregó o cambió el campo. Los `UNIQUEIDENTIFIER` del núcleo los genera la API (uuid v4); los `BIGINT` de GitHub son los ids que da GitHub.

### Users
| Campo | Tipo | Nota |
|---|---|---|
| `uid` | UNIQUEIDENTIFIER | PK |
| `username` | NVARCHAR(25) | Único (`UQ_Users_Username`, 005; antes `noDuplicates` y `VARCHAR`) |
| `password` | VARCHAR(60) | Hash bcrypt, nunca la contraseña |

### Groups
| Campo | Tipo | Nota |
|---|---|---|
| `gid` | UNIQUEIDENTIFIER | PK |
| `adminId` | UNIQUEIDENTIFIER | FK → `Users.uid`; el único admin del grupo |
| `name` | NVARCHAR(25) | `NVARCHAR` desde 005 |

### UserGroups
| Campo | Tipo | Nota |
|---|---|---|
| `uid` | UNIQUEIDENTIFIER | PK (`uid`, `gid`); FK → `Users` |
| `gid` | UNIQUEIDENTIFIER | PK; FK → `Groups` |
| `joined_at` | DATETIMEOFFSET(0) | DEFAULT `SYSDATETIMEOFFSET()` (005); ordena la sucesión del admin |

### GroupRoles
| Campo | Tipo | Nota |
|---|---|---|
| `gr_id` | UNIQUEIDENTIFIER | PK; único con `gid` (`UQ_GroupRoles_GrId_Gid`, destino de la FK compuesta) |
| `gid` | UNIQUEIDENTIFIER | FK → `Groups` |
| `gr_name` | NVARCHAR(40) | Único por grupo (`UQ_GroupRoles_Gid_Name`); si contiene «leader», el miembro es líder |
| `gr_color` | VARCHAR(20) | **NULL** |
| `gr_icon` | VARCHAR(40) | **NULL**; ampliado de 20 a 40 en 005 |

### UserGroupRoles
| Campo | Tipo | Nota |
|---|---|---|
| `ugr_id` | UNIQUEIDENTIFIER | PK |
| `uid` | UNIQUEIDENTIFIER | FK → `Users`; único con `gr_id` (`UQ_UserGroupRoles_Uid_GrId`) |
| `gid` | UNIQUEIDENTIFIER | FK → `Groups`; (`uid`, `gid`) → `UserGroups`: solo miembros; (`gr_id`, `gid`) → `GroupRoles`: rol del mismo grupo |
| `gr_id` | UNIQUEIDENTIFIER | FK → `GroupRoles` |
| `ugr_assigned_at` | SMALLDATETIME | DEFAULT `GETDATE()` |

### Tasks
| Campo | Tipo | Nota |
|---|---|---|
| `tid` | UNIQUEIDENTIFIER | PK |
| `gid` | UNIQUEIDENTIFIER | FK → `Groups` |
| `name` | NVARCHAR(25) | `NVARCHAR` desde 005 |
| `description` | NVARCHAR(1000) | |
| `list` | NVARCHAR(25) | Nombre de la lista; las listas no tienen tabla propia |
| `datetime` | SMALLDATETIME | Fecha y hora límite (minutos, hasta 2079) |
| `percentage` | INT | **NULL**; CHECK 0–100 |
| `created_at` | DATETIMEOFFSET(7) | DEFAULT `SYSDATETIMEOFFSET()` (008): cuándo se creó la tarea; ordena la lista («Creation Date») |
| `created_seq` | BIGINT | `IDENTITY(1, 1)` (008): orden de inserción. Desempata `created_at` cuando dos tareas se crean en el mismo instante (las de un plan de la IA se insertan en la misma transacción) |

### UserTask
| Campo | Tipo | Nota |
|---|---|---|
| `utid` | UNIQUEIDENTIFIER | Único (`UQ_UserTask_Utid`, 001) |
| `uid` | UNIQUEIDENTIFIER | PK (`uid`, `tid`); FK → `Users` |
| `tid` | UNIQUEIDENTIFIER | PK; FK → `Tasks` |
| `completed` | BIT | La interfaz envía 1 al asignar; no es un avance |

### Complete
| Campo | Tipo | Nota |
|---|---|---|
| `tid` | UNIQUEIDENTIFIER | PK; el `tid` que tenía la tarea, sin FK |
| `gid` | UNIQUEIDENTIFIER | FK → `Groups` |
| `name` | NVARCHAR(25) | |
| `description` | NVARCHAR(1000) | |
| `percentage` | INT | **NULL**; CHECK 0–100; se guarda 100 al completar |
| `datetime` | SMALLDATETIME | |
| `created_at` | DATETIMEOFFSET(7) | DEFAULT `SYSDATETIMEOFFSET()` (008); al completar se copia el de la tarea |
| `created_seq` | BIGINT | **NULL** (008); al completar se copia el de la tarea |

### DeleteTask
| Campo | Tipo | Nota |
|---|---|---|
| `tid` | UNIQUEIDENTIFIER | PK; el `tid` que tenía la tarea, sin FK |
| `gid` | UNIQUEIDENTIFIER | FK → `Groups` |
| `name` | NVARCHAR(25) | |
| `description` | NVARCHAR(1000) | |
| `datetime` | SMALLDATETIME | |
| `percentage` | INT | DEFAULT 0; CHECK 0–100 (la 001 lo agrega a bases viejas) |
| `created_at` | DATETIMEOFFSET(7) | DEFAULT `SYSDATETIMEOFFSET()` (008); al mandarla a la papelera se copia el de la tarea |
| `created_seq` | BIGINT | **NULL** (008); al mandarla a la papelera se copia el de la tarea |

### Nodes
| Campo | Tipo | Nota |
|---|---|---|
| `nid` | UNIQUEIDENTIFIER | PK; único con `gid` (`UQ_Nodes_Nid_Gid`) |
| `gid` | UNIQUEIDENTIFIER | FK → `Groups` |
| `name` | NVARCHAR(25) | |
| `description` | NVARCHAR(1000) | |
| `date` | DATE | Fecha del hito; sale en el calendario |
| `completed` | BIT | |
| `x_pos`, `y_pos` | FLOAT | Posición en el diagrama |
| `percentage` | INT | **NULL**; CHECK 0–100; lo recalculan los triggers |
| `connections` | INT | **NULL**; DEFAULT 0; ningún código lo usa |

### Edges
| Campo | Tipo | Nota |
|---|---|---|
| `eid` | UNIQUEIDENTIFIER | PK |
| `gid` | UNIQUEIDENTIFIER | FK → `Groups` |
| `sourceId` | UNIQUEIDENTIFIER | FK → `Nodes`; único con `targetId` (`UQ_Edges_Source_Target`); (`sourceId`, `gid`) → `Nodes (nid, gid)` |
| `targetId` | UNIQUEIDENTIFIER | FK → `Nodes`; (`targetId`, `gid`) → `Nodes (nid, gid)` |
| `prerequisite` | BIT | **NULL**; DEFAULT 1 = prerrequisito; 0 = progresor (mueve porcentajes) |

### TaskAnalytics
| Campo | Tipo | Nota |
|---|---|---|
| `id` | UNIQUEIDENTIFIER | PK; DEFAULT `NEWID()` |
| `tid` | UNIQUEIDENTIFIER | Sin FK desde 001: el historial sobrevive a la tarea |
| `uid` | UNIQUEIDENTIFIER | FK → `Users` |
| `gid` | UNIQUEIDENTIFIER | FK → `Groups` |
| `task_category` | VARCHAR(50) | **NULL**; DEFAULT `'general'` |
| `assigned_at` | DATETIME2 | DEFAULT `GETDATE()` |
| `completed_at` | DATETIME2 | **NULL**; no puede ser anterior a `assigned_at` |
| `success_status` | VARCHAR(20) | **NULL**; DEFAULT `'pending'`; `pending`, `completed`, `failed` o `reassigned` |
| `completion_time_hours` | DECIMAL(10,2) | **NULL**; ≥ 0 |
| `created_at` | DATETIME2 | **NULL**; DEFAULT `GETDATE()` |

### UserMetrics
| Campo | Tipo | Nota |
|---|---|---|
| `id` | UNIQUEIDENTIFIER | PK; DEFAULT `NEWID()` |
| `uid` | UNIQUEIDENTIFIER | FK → `Users`; único con `metric_date` (`UQ_UserMetrics_UID_Date`) |
| `metric_date` | DATE | Un registro por usuario y día |
| `active_tasks_count` | INT | **NULL**; DEFAULT 0; ≥ 0 |
| `max_concurrent_tasks` | INT | **NULL**; DEFAULT 0; ≥ 0 |
| `avg_completion_time_hours` | DECIMAL(10,2) | **NULL**; DEFAULT 0; ≥ 0 |
| `success_rate_percentage` | DECIMAL(5,2) | **NULL**; DEFAULT 0; 0–100 |
| `updated_at` | DATETIME2 | **NULL**; DEFAULT `GETDATE()` |

### UserExpertise
| Campo | Tipo | Nota |
|---|---|---|
| `id` | UNIQUEIDENTIFIER | PK; DEFAULT `NEWID()` |
| `uid` | UNIQUEIDENTIFIER | FK → `Users`; único con `task_category` (`UQ_UserExpertise_UID_Category`) |
| `task_category` | VARCHAR(50) | `frontend`, `backend`, `database`, `testing` o `general` |
| `expertise_score` | DECIMAL(5,2) | **NULL**; DEFAULT 0; 0–100 |
| `tasks_completed` | INT | **NULL**; DEFAULT 0; ≥ 0 |
| `avg_completion_time_hours` | DECIMAL(10,2) | **NULL**; DEFAULT 0; ≥ 0 |
| `success_rate_percentage` | DECIMAL(5,2) | **NULL**; DEFAULT 0; 0–100 |
| `last_updated` | DATETIME2 | **NULL**; DEFAULT `GETDATE()` |

### AnalyticsConfig (001)
| Campo | Tipo | Nota |
|---|---|---|
| `gid` | UNIQUEIDENTIFIER | PK; FK → `Groups` con `ON DELETE CASCADE` |
| `analytics_enabled` | BIT | DEFAULT 1 |
| `track_completion_time`, `track_success_rate`, `track_workload`, `track_expertise`, `track_capacity` | BIT | DEFAULT 1 cada uno |
| `data_retention_days` | INT | DEFAULT 365; 1–3650 |
| `privacy_mode` | VARCHAR(30) | DEFAULT `'team_leader_only'`; `team_leader_only`, `team` o `private` |
| `updated_at` | DATETIMEOFFSET(0) | DEFAULT `SYSDATETIMEOFFSET()` |

Se lee y se guarda, pero hoy no cambia lo que se registra ni lo que se muestra ([cierre](../01-proyecto/cierre-del-proyecto.md#analytics)).

### GitHubInstallations (002)
| Campo | Tipo | Nota |
|---|---|---|
| `installation_id` | BIGINT | PK; id de GitHub |
| `account_login` | NVARCHAR(39) | Cuenta dueña de los repositorios |
| `account_type` | VARCHAR(12) | `User` u `Organization` |
| `created_at` | DATETIMEOFFSET(0) | DEFAULT `SYSDATETIMEOFFSET()` |
| `suspended_at` | DATETIMEOFFSET(0) | **NULL** |

### GitHubRepositories (002)
| Campo | Tipo | Nota |
|---|---|---|
| `repo_id` | BIGINT | PK; id de GitHub |
| `installation_id` | BIGINT | FK → `GitHubInstallations`, CASCADE |
| `name` | NVARCHAR(100) | |
| `default_branch` | NVARCHAR(255) | Collation `Latin1_General_100_BIN2` |
| `is_private` | BIT | |
| `updated_at` | DATETIMEOFFSET(0) | DEFAULT `SYSDATETIMEOFFSET()` |

### GroupRepositories (002)
| Campo | Tipo | Nota |
|---|---|---|
| `gid` | UNIQUEIDENTIFIER | PK (un repositorio por grupo); FK → `Groups`, CASCADE |
| `repo_id` | BIGINT | FK → `GitHubRepositories`, CASCADE; un repo puede estar en varios grupos |
| `connected_by` | UNIQUEIDENTIFIER | FK → `Users` |
| `connected_at` | DATETIMEOFFSET(0) | DEFAULT `SYSDATETIMEOFFSET()` |
| `ai_analysis_enabled` | BIT | DEFAULT 0 (005); el admin lo activa antes de mandar datos a la IA |

### TaskBranches (002)
| Campo | Tipo | Nota |
|---|---|---|
| `tid` | UNIQUEIDENTIFIER | PK (una rama por tarea); FK → `Tasks`, CASCADE |
| `repo_id` | BIGINT | FK → `GitHubRepositories`, CASCADE; único con `branch_name` |
| `branch_name` | NVARCHAR(255) | Collation BIN2 |
| `base_sha` | CHAR(40) | Solo hexadecimal |
| `created_by` | UNIQUEIDENTIFIER | FK → `Users` |
| `created_at` | DATETIMEOFFSET(0) | DEFAULT `SYSDATETIMEOFFSET()` |

### PullRequests (002)
| Campo | Tipo | Nota |
|---|---|---|
| `pr_id` | BIGINT | PK; id de GitHub |
| `repo_id` | BIGINT | FK → `GitHubRepositories`, CASCADE; único con `number` |
| `number` | INT | > 0 |
| `head_branch`, `base_branch` | NVARCHAR(255) | Collation BIN2; `head_branch` une el PR con la rama de la tarea (sin FK) |
| `title` | NVARCHAR(256) | |
| `is_draft` | BIT | DEFAULT 0 |
| `opened_at` | DATETIMEOFFSET(0) | |
| `closed_at` | DATETIMEOFFSET(0) | **NULL** |
| `merged_at` | DATETIMEOFFSET(0) | **NULL**; exige `closed_at` |
| `gh_updated_at` | DATETIMEOFFSET(0) | Fecha de GitHub; ordena las actualizaciones |
| `state` | VARCHAR(6) | Columna calculada: `merged`, `closed` u `open` |

### GitHubWebhookDeliveries (002)
| Campo | Tipo | Nota |
|---|---|---|
| `delivery_id` | UNIQUEIDENTIFIER | PK; cabecera `X-GitHub-Delivery` |
| `event` | VARCHAR(50) | |
| `action` | VARCHAR(50) | **NULL** |
| `installation_id` | BIGINT | **NULL**; sin FK |
| `received_at` | DATETIMEOFFSET(0) | DEFAULT `SYSDATETIMEOFFSET()`; la purga diaria borra las viejas |
| `processed_at` | DATETIMEOFFSET(0) | **NULL** solo mientras `status = 'processing'` |
| `status` | VARCHAR(10) | DEFAULT `'processing'`; `processing`, `processed`, `ignored` o `failed` |
| `error` | NVARCHAR(1000) | **NULL** |
| `payload_sha256` | CHAR(64) | **NULL** (005); hexadecimal; único cuando no es NULL (contra repeticiones) |

### RepoPipelines (007)
| Campo | Tipo | Nota |
|---|---|---|
| `repo_id` | BIGINT | PK (un pipeline por repositorio); FK → `GitHubRepositories`, CASCADE |
| `workflow_path` | NVARCHAR(255) | Ruta del workflow en el repo |
| `spec` | NVARCHAR(4000) | JSON válido (`ISJSON`); con él se reabre la configuración |
| `commit_sha` | CHAR(40) | Solo hexadecimal |
| `configured_by` | UNIQUEIDENTIFIER | FK → `Users` |
| `configured_at` | DATETIMEOFFSET(0) | DEFAULT `SYSDATETIMEOFFSET()` |

### DeployRequests (007)
| Campo | Tipo | Nota |
|---|---|---|
| `request_id` | UNIQUEIDENTIFIER | PK; DEFAULT `NEWID()` |
| `gid` | UNIQUEIDENTIFIER | FK → `Groups`, CASCADE |
| `repo_id` | BIGINT | FK → `GitHubRepositories`, CASCADE |
| `environment` | VARCHAR(10) | `staging` o `production` |
| `version_sha` | CHAR(40) | Solo hexadecimal |
| `requested_by` | UNIQUEIDENTIFIER | FK → `Users` |
| `requested_at` | DATETIMEOFFSET(0) | DEFAULT `SYSDATETIMEOFFSET()` |
| `status` | VARCHAR(10) | DEFAULT `'pending'`; `pending`, `approved`, `rejected` o `cancelled`; una sola `pending` por grupo y entorno |
| `decided_by` | UNIQUEIDENTIFIER | **NULL** si y solo si `pending`; FK → `Users` |
| `decided_at` | DATETIMEOFFSET(0) | **NULL** si y solo si `pending` |
| `note` | NVARCHAR(500) | **NULL** |

### SchemaMigrations
| Campo | Tipo | Nota |
|---|---|---|
| `version` | INT | PK; número de la migración |
| `name` | NVARCHAR(200) | Nombre del archivo sin número |
| `applied_at` | DATETIMEOFFSET(0) | DEFAULT `SYSDATETIMEOFFSET()` |

## Para saber más

- Diagrama de las 24 tablas y tablas por módulo: [00-general.md](00-general.md)
- Migraciones, triggers e índices: [00-migraciones-y-triggers.md](00-migraciones-y-triggers.md)
- Reglas de cada módulo: [usuarios](01-usuarios-y-acceso.md), [grupos y roles](02-grupos-y-roles.md), [tareas](03-tareas.md), [hitos](04-hitos-y-calendario.md), [chat IA](05-chat-ia.md), [analytics](06-analytics.md), [GitHub](07-github.md), [CI/CD](08-cicd.md)

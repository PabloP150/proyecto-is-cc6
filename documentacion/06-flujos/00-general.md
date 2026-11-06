# Flujos: visión general

**En una frase:** el camino completo de un proyecto en TaskMate, desde que la IA lo crea hasta que una versión llega a producción (y vuelve atrás si hace falta).

```mermaid
flowchart TB
    subgraph R1["Planear y preparar"]
        direction LR
        F1["1 · Plan con IA<br/>crea el proyecto"] --> F2["2 · Equipo<br/>y tareas"] --> F3["3 · Repo y<br/>pipeline"] --> F4["4 · Rama de<br/>la tarea"] --> F5["5 · Push<br/>y PR"]
    end
    subgraph R2["Integrar y publicar"]
        direction LR
        F6["6 · CI en<br/>GitHub Actions"] --> F7["7 · Merge<br/>completa la tarea"] --> F8["8 · Staging<br/>automático"] --> F9["9 · Producción<br/>con aprobación"] --> F10["10 · Rollback<br/>si hace falta"]
    end
    R1 --> R2
```

## El recorrido completo

```mermaid
sequenceDiagram
    autonumber
    actor AD as Admin
    actor MI as Miembro
    participant TM as TaskMate (web y API)
    participant IA as Servidor de IA y Groq
    participant GH as GitHub (repositorio)
    participant GA as GitHub Actions y Pages

    rect rgb(232, 240, 254)
    Note over AD,IA: 1. El chat crea el proyecto
    AD->>TM: describe el proyecto en AI Bot
    TM->>IA: handle_user_message
    IA-->>TM: plan con roles, tareas e hitos
    AD->>TM: confirma el plan
    TM->>TM: crea grupo, roles, tareas e hitos en una transacción
    end
    rect rgb(236, 253, 243)
    Note over AD,TM: 2. Equipo y tareas
    AD->>TM: Add User para sumar miembros
    AD->>TM: asigna tareas con Assign user
    end
    rect rgb(255, 247, 237)
    Note over AD,GA: 3. Repositorio y pipeline (una sola vez)
    AD->>TM: Conectar repositorio
    AD->>GH: instala la GitHub App y vuelve a TaskMate
    AD->>TM: Vincular repositorio
    AD->>TM: Configurar pipeline y Subir al repositorio
    TM->>GH: commit de taskmate-ci.yml y activa Pages
    end
    rect rgb(232, 240, 254)
    Note over MI,GA: 4 a 6. Rama, PR y CI
    MI->>TM: Crear rama en GitHub desde la tarea
    TM->>GH: crea tm/tarea-id desde la rama principal
    MI->>GH: push y abre el PR
    GH->>GA: el CI corre en cada push y cada PR
    GA-->>TM: webhook workflow_run
    TM-->>MI: aviso en vivo si el CI falla
    end
    rect rgb(236, 253, 243)
    Note over MI,GA: 7 y 8. Merge y staging
    MI->>GH: fusiona el PR en la rama principal
    GH-->>TM: webhook pull_request fusionado
    TM->>TM: completa la tarea de esa rama
    TM->>GH: borra la rama si ya no hace falta
    GH->>GA: el push a la rama principal pasa el CI
    GA->>GA: build y deploy a /staging/
    GA-->>TM: webhook deployment_status
    TM-->>MI: aviso Staging se actualizó
    end
    rect rgb(255, 247, 237)
    Note over AD,GA: 9. Producción con aprobación
    MI->>TM: Solicitar producción de la versión de staging
    TM-->>AD: aviso de solicitud pendiente
    AD->>TM: Aprobar
    TM->>GA: workflow_dispatch a producción con esa versión
    GA->>GA: build y deploy a la raíz del sitio
    GA-->>TM: webhook deployment_status
    TM-->>MI: aviso Producción se actualizó
    end
    rect rgb(254, 242, 242)
    Note over AD,GA: 10. Rollback
    AD->>TM: Rollback a una versión anterior
    TM->>GA: workflow_dispatch a producción con esa versión
    GA-->>TM: webhook deployment_status
    end
```

## Paso a paso
1. **Plan con IA:** al confirmar el plan del chat se crea un grupo nuevo; quien lo pidió queda como admin.
2. **Equipo:** el admin agrega miembros por nombre de usuario; cualquier miembro asigna tareas.
3. **Repo y pipeline:** el admin conecta el repositorio y sube `.github/workflows/taskmate-ci.yml`.
4. **Rama:** desde la tarea, un miembro crea `tm/<nombre>-<8 caracteres del id>`.
5. **Push y PR:** se hacen en GitHub; TaskMate no abre PRs, solo los muestra.
6. **CI:** corre en cada push y cada PR; un fallo llega como aviso en vivo.
7. **Merge:** el PR fusionado en la rama principal completa la tarea y, si no hace falta, borra la rama.
8. **Staging:** el push a la rama principal que pasa el CI se publica solo en `/staging/`.
9. **Producción:** un miembro pide la versión de staging y el admin aprueba (o publica directo).
10. **Rollback:** el admin vuelve producción a una versión anterior.

- **Webhook:** aviso que GitHub manda a la API. Llega al navegador por el WebSocket `/events` (canal en vivo).
- **`workflow_dispatch`:** pedirle a GitHub que corra el workflow con un entorno y una versión.
- Solo se publican versiones que pasaron el CI de TaskMate en la rama principal.

## Todos los flujos, por módulo

| Módulo | Flujos que documenta |
|---|---|
| [Usuarios y acceso](01-usuarios-y-acceso.md) | Crear cuenta, iniciar sesión y usar el token, ciclo de la sesión |
| [Grupos y roles](02-grupos-y-roles.md) | Agregar un miembro y darle un rol, ciclo de vida de un grupo, salir del grupo |
| [Tareas](03-tareas.md) | Completar una tarea, ciclo de vida de una tarea, guardar una edición |
| [Hitos y calendario](04-hitos-y-calendario.md) | Conectar dos hitos y propagar el avance, vida de un hito y de una flecha, cómo propaga el avance el trigger |
| [Chat IA](05-chat-ia.md) | De la idea al proyecto guardado, vida del plan, cómo decide el orquestador qué responder |
| [Analytics](06-analytics.md) | Pedir recomendaciones de asignación por `/insights`, vida de un registro de `TaskAnalytics`, qué muestra el panel |
| [GitHub](07-github.md) | Conectar el repositorio, un webhook que llega a la API, vida de la rama de una tarea |
| [CI/CD](08-cicd.md) | Del pipeline a producción, jobs de cada caso, solicitudes de producción |
| [Tiempo real y avisos](09-tiempo-real-y-avisos.md) | De GitHub al aviso, ciclo de la conexión `/events`, qué decide el hub con cada evento |

## Dónde está en el código

| Archivo | Qué hace en este recorrido |
|---|---|
| `taskmate-api/services/UserSession.js` y `ProjectService.js` | Chat, confirmación del plan y creación del proyecto |
| `taskmate-api/services/github/installFlow.js` | Conexión del repositorio (instalación y callback) |
| `taskmate-api/services/github/pipelineService.js` y `pipelineSpec.js` | Propuesta, YAML y commit del workflow |
| `taskmate-api/services/github/branchService.js` | Crear y limpiar la rama de una tarea |
| `taskmate-api/services/github/webhookHandler.js` y `pullRequestProcessor.js` | Webhooks: PR fusionado, ejecuciones y deploys |
| `taskmate-api/services/github/deployService.js` | Solicitudes, aprobación, deploy y rollback |
| `taskmate-api/services/realtime.js` y `src/components/realtime/CicdNotifications.jsx` | Avisos en vivo por `/events` |

## Para saber más
- Quién puede hacer cada paso: [permisos por rol](../04-casos-de-uso/00-permisos-por-rol.md). Desde cada persona: [recorridos de usuario](../04-casos-de-uso/00-recorridos-de-usuario.md).
- Uso detallado: [guía de CI/CD](../07-guias/guia-cicd.md) y [guía de la GitHub App](../07-guias/guia-github-app.md). Componentes: [arquitectura](../02-arquitectura/00-general.md).
- Limitaciones conocidas: [cierre del proyecto](../01-proyecto/cierre-del-proyecto.md#limitaciones-conocidas).

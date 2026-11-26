# GitHub: casos de uso

**En una frase:** el admin del grupo conecta y gobierna el repositorio; cualquier miembro lo explora, crea la rama de sus tareas, ve qué archivos tocó cada tarea y pide propuestas a la IA; GitHub, por webhooks, mantiene al día los PRs, completa las tareas fusionadas y dispara la revisión de PR con IA.

```mermaid
flowchart LR
    A(["👤 Admin del grupo"])
    M(["👤 Miembro del grupo"])
    G(["🐙 GitHub: webhooks"])

    subgraph SYS["TaskMate: GitHub"]
        uc1(["Conectar repositorio: instalar o autorizar la App"])
        uc2(["Elegir y vincular el repositorio"])
        uc3(["Desconectar el repositorio"])
        uc4(["Permitir o quitar el análisis con IA"])
        uc5(["Ver el repositorio conectado"])
        uc6(["Explorar archivos y README"])
        uc7(["Ver los commits recientes"])
        uc8(["Crear la rama de una tarea"])
        uc9(["Ver la rama y el estado del PR en la tarea"])
        uc10(["Sincronizar PRs"])
        uc11(["Analizar el repositorio con IA"])
        uc12(["Confirmar o descartar el plan de la IA"])
        uc13(["Registrar los cambios de un PR"])
        uc14(["Completar la tarea al fusionar su PR"])
        uc15(["Reflejar desinstalación, suspensión y repos quitados"])
        uc16(["Borrar la rama si es seguro"])
        uc17(["Ver los archivos de la tarea y quién más los toca"])
        uc18(["Registrar los archivos del PR"])
        uc19(["Auditar, generar pruebas o revisar el PR con IA"])
        uc20(["Revisar el PR con IA en segundo plano"])
    end

    A --> uc1
    A --> uc3
    A --> uc4
    A -.->|"también es miembro"| M
    uc1 -.->|"sigue con"| uc2
    M --> uc5
    M --> uc6
    M --> uc7
    M --> uc8
    M --> uc9
    M --> uc10
    M --> uc11
    M --> uc17
    M --> uc19
    uc11 -.->|"termina en"| uc12
    G --> uc13
    G --> uc15
    uc13 -.->|"si se fusionó"| uc14
    uc10 -.->|"si se fusionó"| uc14
    uc14 -.->|"después del commit"| uc16
    uc14 -.->|"después del commit"| uc18
    uc17 -.->|"si falta la lista"| uc18
    uc13 -.->|"PR abierto de una tarea"| uc20
    uc4 -.->|"habilita"| uc19
```

## Casos de uso

| Caso | Quién puede | Qué pasa |
|---|---|---|
| Conectar repositorio | Admin (pestaña Repository) | «Connect repository» abre GitHub para instalar la App; «I already installed the App» solo pide autorizar. Al volver, TaskMate muestra los repos donde tu cuenta de GitHub puede escribir |
| Elegir y vincular el repositorio | Admin que empezó la conexión | Elige un repo de la lista y pulsa «Link repository». Si el grupo tenía otro, se cambia y se borran las ramas de tareas del repo anterior |
| Desconectar el repositorio | Admin | «Disconnect» quita el vínculo, las ramas de tareas guardadas y las solicitudes de deploy pendientes. La App sigue instalada en GitHub |
| Permitir o quitar el análisis con IA | Admin | Activa o apaga «Allow AI analysis». Empieza apagado y se apaga solo al cambiar de repo. Lo exigen el análisis del repositorio y la IA sobre la rama de la tarea |
| Ver el repositorio conectado | Miembro | Nombre, rama por defecto, cuenta de la instalación y quién lo conectó |
| Explorar archivos y README | Miembro | Árbol filtrable, archivos de texto de hasta 1 MB y el README como Markdown seguro |
| Ver los commits recientes | Miembro | Hasta 30 commits de la rama por defecto |
| Crear la rama de una tarea | Miembro del grupo de la tarea | «Create branch on GitHub» crea `tm/<slug>-<8 caracteres del tid>` desde la rama por defecto. Si ya existe y no es de otra tarea, la adopta |
| Ver la rama y el estado del PR | Miembro | Chips en la tarea: la rama (copia `git checkout`) y «PR #N open», «draft», «closed» o «merged» |
| Ver los archivos de la tarea | Miembro del grupo de la tarea | El icono «View task files» (tarea activa con rama y repo conectado) abre «Task files»: cada archivo con su estado, +/− y «Open on GitHub». Si la tarea no tiene lista y su rama tiene PR, se pide a GitHub al abrir (chip «recovered from GitHub») |
| Ver quién más toca esos archivos | Miembro | En el mismo diálogo, «Also changed by: …» marca los archivos que otra tarea activa del grupo también tocó. Es la base de la detección de colisiones, que quedó pospuesta |
| Sincronizar PRs | Miembro | «Sync PRs» consulta en GitHub los PRs de hasta 30 ramas y aplica lo que los webhooks no trajeron. Una vez cada 30 s por usuario |
| Analizar el repositorio con IA | Miembro, si el admin lo permitió | Desde «Analyze with AI» en `/github`, con «Propose tasks» en el chat o pidiendo un plan en el chat (que usa el grupo del navbar). La IA propone hasta 12 tareas y 5 hitos. Uno por minuto por usuario |
| Confirmar o descartar el plan | Miembro del grupo | «Confirm» crea las tareas y los hitos en el grupo; «Discard» lo olvida. El plan vence a los 30 min |
| Auditar, generar pruebas o revisar el PR con IA | Miembro, si el admin lo permitió | Botones «Audit», «Generate tests» y «Review PR» del panel «AI on the branch», dentro de «Task files». Detalle en [IA sobre el código](10-ia-sobre-el-codigo.md) |
| Registrar los cambios de un PR | GitHub (webhook `pull_request`) | Guarda o actualiza el PR. Los PRs desde forks se ignoran |
| Revisar el PR con IA en segundo plano | GitHub (webhook `pull_request`) | Si el PR de la rama de una tarea se abre, recibe commits, sale de borrador o se reabre, y el grupo permitió la IA, el servidor de IA local lo revisa y TaskMate publica una revisión `COMMENT` en GitHub (una por commit). Detalle en [IA sobre el código](10-ia-sobre-el-codigo.md) |
| Completar la tarea al fusionar su PR | GitHub o «Sync PRs» | Si el PR se fusionó en la rama por defecto desde la rama de una tarea, la tarea pasa a completada |
| Registrar los archivos del PR | El sistema | Después de que el webhook completa la tarea, pide la lista de archivos del PR para guardarla. Según el código no llega a guardarse ([limitaciones](../01-proyecto/cierre-del-proyecto.md#limitaciones-conocidas)); «Sync PRs» no lo intenta |
| Reflejar cambios de la instalación | GitHub (webhooks `installation` e `installation_repositories`) | Desinstalar borra la instalación y, en cascada, sus vínculos. Suspender bloquea el uso. Un repo quitado se borra; uno agregado se registra |
| Borrar la rama si es seguro | El sistema | Después de completar la tarea (a mano o por PR), mandarla a la papelera o borrar su lista. Solo la borra si no tiene commits sin fusionar ni PRs abiertos |

## Reglas de permiso

Verificadas en `taskmate-api/controllers/github.controller.js`, `app.js`, `services/github/installFlow.js`, `services/aiServer/taskAi.js`, `services/aiServer/prReview.js` y `services/UserSession.js`. Todas las rutas van bajo `/api/github` y, salvo el callback y el webhook, piden JWT (`requireAuth`).

| Qué | Guardia | Quién pasa |
|---|---|---|
| `POST /groups/:gid/install` | `requireGroupAdmin` + 10 por minuto | Admin del grupo |
| `GET /callback` | Sin JWT: `state` firmado, de un solo uso y de 10 min; 30 por minuto por IP | El admin que pidió el `state`; se vuelve a comprobar que sigue siendo admin |
| `GET /selections/:id` | `requireAuth` | Solo el usuario que hizo la conexión |
| `POST /groups/:gid/repository` | `requireGroupAdmin` + 10 por minuto | Admin, con una selección suya y de ese grupo. En GitHub debe tener push, maintain o admin sobre el repo |
| `GET /groups/:gid/repository` | `requireGroupMember` | Miembro |
| `DELETE /groups/:gid/repository` | `requireGroupAdmin` | Admin |
| `PUT /groups/:gid/ai-analysis` | `requireGroupAdmin` | Admin |
| `GET /groups/:gid/tree`, `file`, `readme`, `commits` | `requireGroupMember` + 60 por minuto y 600 por hora | Miembro |
| `POST /tasks/:tid/branch` | `requireResourceMember('task')` + 20 por minuto | Miembro del grupo dueño de la tarea |
| `GET /tasks/:tid/files` | `requireResourceMember('task')` + 60 por minuto y 600 por hora | Miembro del grupo dueño de la tarea. Solo tareas activas: una completada responde 404 `TASK_NOT_FOUND`. `?refresh=false` evita pedir la lista a GitHub |
| `GET /tasks/:tid/overlaps` | `requireResourceMember('task')` | Miembro del grupo dueño de la tarea |
| `POST /tasks/:tid/audit`, `generate-tests` y `review` | `requireResourceMember('task')` + `ai_analysis_enabled` + 5 por minuto entre las tres | Miembro, si el admin lo permitió. `audit` y `generate-tests` exigen que la rama de la tarea tenga cambios; `review`, un PR abierto |
| `GET /tasks/:tid/review` | `requireResourceMember('task')` | Miembro (no pide el permiso de IA) |
| `GET /groups/:gid/task-links` | `requireGroupMember` | Miembro |
| `POST /groups/:gid/sync` | `requireGroupMember` + 1 cada 30 s | Miembro |
| `POST /webhook` | Sin JWT: firma HMAC `X-Hub-Signature-256` con `GITHUB_WEBHOOK_SECRET` | Solo GitHub. Una entrega `pull_request` procesada también dispara la revisión de IA, que solo corre si el grupo la permitió |
| WebSocket `/chat`: `repo_analysis` | Miembro del grupo + `ai_analysis_enabled` + 1 por minuto | Miembro, si el admin lo permitió. Pedir un plan en el chat (`plan_request` de Python) pasa por las mismas comprobaciones |
| WebSocket `/chat`: `repo_plan_confirm` | Miembro del grupo al confirmar | Miembro |

Notas:
- **Admin** es el usuario de `Groups.adminId`. Un rol con «leader» en el nombre no da permisos de admin en GitHub.
- Los límites son por usuario, salvo el del callback.
- La interfaz esconde los botones de admin a los miembros, pero quien decide es la API.
- Publicar la revisión de IA en GitHub necesita que la App tenga *Pull requests: Read and write* ([guía de la App](../07-guias/guia-github-app.md#4-registrar-la-github-app)). Sin ese permiso la revisión se guarda en TaskMate como `no_permission` y no se publica.
- Una revisión fallida o que quedó a medias no se repite sobre el mismo commit, ni pidiéndola a mano: hace falta un commit nuevo ([limitaciones](../01-proyecto/cierre-del-proyecto.md#limitaciones-conocidas)).

## Para saber más

- Todos los actores y permisos de TaskMate: [00-general.md](00-general.md)
- Arquitectura del módulo: [02-arquitectura/07-github.md](../02-arquitectura/07-github.md)
- Pantallas: [05-interfaz/07-github.md](../05-interfaz/07-github.md)
- Paso a paso y mensajes de error: [06-flujos/07-github.md](../06-flujos/07-github.md)
- IA sobre la rama y el PR: [10-ia-sobre-el-codigo.md](10-ia-sobre-el-codigo.md)
- Limitaciones conocidas: [cierre de la línea de Pablo y estado](../01-proyecto/cierre-del-proyecto.md#limitaciones-conocidas)

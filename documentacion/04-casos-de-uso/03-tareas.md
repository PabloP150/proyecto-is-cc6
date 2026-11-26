# Tareas: casos de uso

**En una frase:** las tareas no tienen dueño: cualquier miembro del grupo activo (el admin incluido) crea, edita, completa, asigna y borra cualquier tarea del grupo; GitHub también puede completarla cuando se fusiona su PR.

```mermaid
flowchart LR
    M(["👤 Miembro del grupo"])
    A(["👤 Admin del grupo"])
    G(["🤖 GitHub"])

    subgraph SYS["TaskMate: tareas"]
        uc1(["Ver las listas y filtrar por fecha"])
        uc2(["Crear una lista"])
        uc3(["Crear una tarea"])
        uc4(["Editar una tarea: datos, avance y lista"])
        uc5(["Completar una tarea"])
        uc6(["Mandar una tarea a la papelera"])
        uc7(["Borrar una lista entera"])
        uc8(["Asignar o quitar personas"])
        uc9(["Ver completadas y papelera"])
        uc10(["Vaciar completadas o papelera"])
        uc11(["Completar la tarea al fusionar su PR"])
        uc12(["Ver los archivos de la tarea y usar la IA de su rama"])
    end

    A -.->|"es también miembro"| M
    M --> uc1
    M --> uc2
    M --> uc3
    M --> uc4
    M --> uc5
    M --> uc6
    M --> uc7
    M --> uc8
    M --> uc9
    M --> uc10
    M --> uc12
    uc4 -.->|"al llegar a 100 % incluye"| uc5
    G --> uc11

    classDef ext fill:#f3f4f6,stroke:#6b7280,color:#111827
    class uc12 ext
```

En gris, un caso que se abre desde la tarjeta de la tarea pero se explica en [GitHub](07-github.md) (archivos) y en [IA sobre el código](10-ia-sobre-el-codigo.md) (IA de la rama).

## Casos de uso

| Caso | Quién puede | Qué pasa |
|---|---|---|
| Ver las listas y filtrar | Miembro | Ve las tareas activas del grupo activo, agrupadas por lista. Filtra por hoy, esta semana o este mes y ordena por creación, fecha límite o prioridad (menos avance primero) |
| Crear una lista | Miembro | La lista aparece al instante, pero solo en su navegador. Se guarda en la base cuando recibe su primera tarea |
| Crear una tarea | Miembro | Nombre, fecha límite y lista son obligatorios; descripción y hora no (la hora por defecto es 00:00). Empieza en 0 % |
| Editar una tarea | Miembro | Cambia nombre, descripción, fecha, hora, avance (en pasos de 5 %) y lista. No se puede mover a otro grupo |
| Completar una tarea | Miembro | La tarea pasa al archivo de completadas con 100 %, se quitan sus asignaciones y, si tenía rama de GitHub, se intenta borrar. También se borran su lista de archivos y sus revisiones de IA |
| Mandar a la papelera | Miembro | La tarea pasa a la papelera con su avance; se quitan sus asignaciones, su rama, sus archivos y sus revisiones de IA, igual que al completar. No hay forma de restaurarla |
| Borrar una lista entera | Miembro | Borra todas las tareas de la lista sin pasarlas a la papelera, con sus ramas, archivos y revisiones de IA. No pide confirmación |
| Asignar o quitar personas | Miembro | Elige miembros del grupo con interruptores. Solo se puede asignar a alguien que es miembro del grupo de la tarea |
| Ver completadas y papelera | Miembro | Filtros «Completed» y «Deleted» del panel lateral. Son de solo lectura |
| Vaciar completadas o papelera | Miembro | Borra para siempre todas las completadas o toda la papelera del grupo. No pide confirmación |
| Completar al fusionar el PR | GitHub (webhook firmado) | Un PR fusionado en la rama principal, cuya rama es la de una tarea, la completa por el mismo camino. Después intenta guardar la lista de archivos del PR, pero según el código no llega a guardarse: al repositorio del webhook le falta `owner` y, además, la tarea ya se borró de `Tasks` ([limitaciones](../01-proyecto/cierre-del-proyecto.md#limitaciones-conocidas)). Ver [GitHub](07-github.md) |
| Ver los archivos de la tarea y usar la IA de su rama | Miembro, con repositorio conectado y la tarea con rama | Ícono «View task files» de la tarjeta activa: abre «Task files» con los archivos del PR y las otras tareas que tocan los mismos. Debajo, «Audit», «Generate tests» y, solo con el PR abierto, «Review PR»; estos tres piden además que el admin haya activado el análisis con IA. Ver [GitHub](07-github.md) e [IA sobre el código](10-ia-sobre-el-codigo.md) |

El [plan del chat](05-chat-ia.md) también crea tareas, en el grupo nuevo o en el proyecto, que es el grupo elegido en la navbar. Los chips de rama y PR y el ícono de archivos de cada tarea son parte de [GitHub](07-github.md).

## Reglas de permiso

Verificadas en `controllers/tasks.controller.js`, `complete.controller.js`, `delete.controller.js`, `usertask.controller.js` y `middleware/groupAccess.js`. Todas las rutas pasan antes por `requireAuth` (JWT válido) y `apiLimiter` (300 peticiones por minuto por usuario).

| Ruta | Guardia | Quién pasa |
|---|---|---|
| `GET /api/tasks?gid=` | `requireGroupMember('gid')` | Miembro del grupo |
| `GET /api/tasks/:id` | `requireResourceMember('task')` | Miembro del grupo de la tarea. Solo API: la interfaz no la usa |
| `POST /api/tasks` | `requireGroupMember('gid')`, con `gid` en el cuerpo | Miembro del grupo |
| `PUT /api/tasks/:id` | `requireResourceMember('task')` | Miembro del grupo de la tarea. El `gid` del cuerpo debe ser el de la tarea, si no responde 400 |
| `PUT /api/tasks/nodes/:id` | `requireResourceMember(['task', 'node'])` | Miembro del grupo. La usa el editor de [hitos](04-hitos-y-calendario.md) |
| `POST /api/tasks/:tid/complete` | `requireResourceMember(['task', 'completed'])` | Miembro del grupo. Si ya estaba completada responde `already_completed` |
| `POST /api/tasks/:tid/trash` | `requireResourceMember('task')` | Miembro del grupo de la tarea |
| `DELETE /api/tasks/list/:gid/:list` | `requireGroupMember('gid')` | Miembro del grupo |
| `GET` y `DELETE /api/completados/:gid` | `requireGroupMember('gid')` | Miembro del grupo (cualquiera puede vaciar) |
| `GET` y `DELETE /api/delete/:gid` | `requireGroupMember('gid')` | Miembro del grupo (cualquiera puede vaciar) |
| `GET`, `POST` y `DELETE /api/usertask` | `requireResourceMember('task', 'tid')` | Miembro del grupo de la tarea. `POST` además exige que la persona asignada (`uid`) sea miembro |

Cómo deciden las guardias:
- `requireGroupMember` lee el `gid` de la ruta, la query o el cuerpo. Si llega en dos lugares con valores distintos, responde 400.
- `requireResourceMember` busca la tarea y usa su grupo. Si no la encuentra responde 404 `TASK_NOT_FOUND`; si no es miembro, 403 `NOT_GROUP_MEMBER`.
- Ninguna ruta de este módulo es solo para el admin.
- Las rutas que usa la tarjeta para GitHub y la IA (`/api/github/tasks/:tid/branch`, `files`, `overlaps`, `audit`, `generate-tests` y `review`) pasan por la misma `requireResourceMember('task')`. Como solo buscan en `Tasks`, una tarea completada o en la papelera responde 404. Sus límites y errores están en [GitHub](07-github.md) e [IA sobre el código](10-ia-sobre-el-codigo.md).

## Para saber más

- Pantalla y botones: [05-interfaz/03-tareas.md](../05-interfaz/03-tareas.md)
- Qué pasa paso a paso y qué ve el usuario si falla: [06-flujos/03-tareas.md](../06-flujos/03-tareas.md)
- Casos de uso de todo el sistema: [00-general.md](00-general.md)
- Limitaciones conocidas (por ejemplo, quién puede vaciar el historial): [cierre de la línea de Pablo y estado](../01-proyecto/cierre-del-proyecto.md#limitaciones-conocidas)

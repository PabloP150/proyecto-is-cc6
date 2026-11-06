# Hitos y calendario: flujos

**En una frase:** el lienzo carga los hitos y las flechas del grupo, guarda cada cambio con una llamada REST y, cuando cambia un porcentaje o el tipo de una flecha, SQL Server recalcula los hitos que dependen de él y el lienzo se vuelve a cargar.

## Flujo principal: conectar dos hitos y propagar el avance

```mermaid
sequenceDiagram
    autonumber
    actor U as Miembro
    participant FE as Flow y CustomNode
    participant API as API Express
    participant DB as SQL Server
    participant TR as Triggers BFS de la 006

    U->>FE: abre /block-diagram con un grupo activo
    FE->>API: GET /api/nodes/group/:gid y GET /api/edges/group/:gid
    API->>API: requireAuth y requireGroupMember
    API->>DB: SELECT de Nodes y Edges del grupo
    API-->>FE: 200 con hitos y flechas
    FE-->>U: dibuja tarjetas y flechas y ajusta la vista

    U->>FE: arrastra del hito A al hito C
    FE->>API: POST /api/edges con gid, sourceId y targetId
    API->>DB: INSERT en Edges, prerequisite = 1
    API-->>FE: 200 con el eid
    U->>FE: clic en la etiqueta Prerequisite
    FE->>API: PUT /api/edges/:eid con prerequisite = 0
    API->>DB: UPDATE Edges
    DB->>TR: UpdateTargetOnPrerequisiteChange
    TR->>DB: C = promedio de sus fuentes progresoras, y sigue hacia abajo
    API-->>FE: 200
    FE->>API: vuelve a pedir hitos y flechas, 100 ms después

    U->>FE: escribe 80 en Progress de A y sale del campo
    FE->>API: PUT /api/nodes/:id/percentage con 80
    API->>DB: UPDATE Nodes SET percentage
    DB->>TR: UpdateTargetNodePercentage
    TR->>DB: BFS por las flechas progresoras, hasta 20 niveles
    API-->>FE: 200
    FE->>API: vuelve a pedir hitos y flechas
    FE-->>U: C y los hitos que dependen de C muestran su nuevo %
```

## Ciclo de vida de un hito y de una flecha

```mermaid
stateDiagram-v2
    state "Hito" as HITO {
        [*] --> EnAvance: Add Milestone o Import Task
        EnAvance --> EnAvance: nuevo %, a mano o por trigger
        EnAvance --> Completado: el % llega a 100
        Completado --> EnAvance: el % baja de 100
        EnAvance --> [*]: Backspace
        Completado --> [*]: Backspace
    }
    state "Flecha" as FLECHA {
        [*] --> Prerrequisito: arrastrar de un hito a otro
        Prerrequisito --> Progresor: clic en la etiqueta
        Progresor --> Prerrequisito: clic en la etiqueta
        Prerrequisito --> [*]: Backspace o borrar uno de sus hitos
        Progresor --> [*]: Backspace o borrar uno de sus hitos
    }
```

- «Completado» es lo que se ve: la tarjeta verde con «✓ Completed» cuando `percentage = 100`, lo ponga el usuario o un trigger.
- Un **prerrequisito** solo dibuja la dependencia. Un **progresor** hace que el destino tome el promedio de sus fuentes progresoras.

## Cómo propaga el avance el trigger

```mermaid
flowchart TD
    S["UPDATE de Nodes.percentage"] --> C1{"¿Algún % cambió de verdad?"}
    C1 -->|"no"| FIN(["Fin"])
    C1 -->|"sí"| V["Visitados = los hitos que cambiaron"]
    V --> N1["Nivel 1 = sus destinos por flechas progresoras"]
    N1 --> L{"¿Hay hitos en el nivel<br/>y van menos de 20 niveles?"}
    L -->|"no"| FIN
    L -->|"sí"| U["Cada destino = ROUND(AVG(%)) de todas<br/>sus fuentes progresoras, solo si cambia"]
    U --> NX["Siguiente nivel = destinos progresores<br/>que aún no se visitaron"]
    NX --> L
```

Ejemplo: A (80 %) y B (40 %) apuntan a C como progresores → C = 60 %. Si C es progresor de D, D también queda en 60 %, en la misma sentencia.

## Paso a paso

1. **Abrir:** el lienzo pide hitos y flechas del grupo activo y ajusta la vista sin pasar de 100 % de zoom.
2. **Crear:** nombre y fecha → «Add Milestone» → `POST /api/nodes` → la tarjeta aparece con 0 %.
3. **Importar:** «Import Task» → elegir tarea → `POST /api/nodes` con el id de la tarea, su fecha y su %.
4. **Mover:** soltar la tarjeta → `PUT /api/nodes/:id/coords`.
5. **Editar:** «Edit» → «Save» → `PUT /api/nodes/:id` y `PUT /api/tasks/nodes/:id` a la vez → el lienzo se recarga.
6. **Conectar:** arrastrar → `POST /api/edges` → la flecha nace como «Prerequisite».
7. **Cambiar el tipo:** clic en la etiqueta → `PUT /api/edges/:eid` → trigger → recarga.
8. **Fijar el %:** escribir y salir del campo → `PUT /api/nodes/:id/percentage` → trigger → recarga.
9. **Completar:** escribir 100 → `PUT /api/nodes/:id/toggleComplete` con 1 y luego el % → la tarjeta se pone verde.
10. **Borrar:** Backspace. Hito: `DELETE /api/edges/source/:id` y `DELETE /api/nodes/:id`, que borra también las flechas que llegan. Flecha: `DELETE /api/edges/:eid`, sin recalcular porcentajes.
11. **Calendario:** `GET /api/nodes/tasks/:gid` une `Nodes` y `Tasks` del grupo; cada fila es un evento de un día.

- Editar desde el lienzo copia nombre, descripción y fecha a la tarea importada. Editar la tarea en «Tasks» no cambia el hito.
- Una tarea importada aparece dos veces en el calendario: como tarea y como hito. Al completarla o mandarla a la papelera sale de `Tasks` y solo queda el hito.

## Qué ve el usuario si algo falla

En «Milestones» el error sale en un aviso rojo abajo al centro (4 s). En «Calendar» sale un aviso rojo arriba del mes. El texto es el que manda la API.

| Situación | Código | Mensaje |
|---|---|---|
| Sesión vencida o sin JWT | 401 `UNAUTHENTICATED` | Ninguno: la app cierra la sesión y vuelve al login |
| No es miembro del grupo | 403 `NOT_GROUP_MEMBER` | «You are not a member of this group» |
| El hito o la flecha ya no existe | 404 `NOT_FOUND` o `TASK_NOT_FOUND` | «Node not found», «Edge not found» o, al usar «Save», «Task not found» |
| Nombre vacío o largo, fecha vacía o inválida | 400 `VALIDATION_ERROR` | «name is required», «name must be at most 25 characters», «date is required» o «date must be a date like YYYY-MM-DD…» |
| Conectar hitos o importar una tarea de otro grupo | 400 `VALIDATION_ERROR` | «sourceId and targetId must be nodes of the group» o «nid belongs to a task of another group» |
| Repetir una flecha con el mismo origen y destino | 409 `DUPLICATE_EDGE` | «These nodes are already connected» |
| Demasiados pedidos | 429 `RATE_LIMITED` | «Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.» |
| La API no responde o falla | `NETWORK_ERROR` o 500 `INTERNAL_ERROR` | «Could not reach the server. Check your connection.» o «Internal server error» |

- **Después del error:** si falla borrar, el lienzo se recarga y el elemento vuelve. Si falla el %, el tipo de flecha o completar, se deshace el cambio local. Si falla crear o conectar, no aparece nada nuevo.
- **Antes de llamar,** la interfaz evita algunos errores: «Add Milestone» se desactiva sin grupo, nombre o fecha, el nombre no deja escribir más de 25 caracteres y «Progress» solo acepta de 0 a 100.

## Para saber más
- Tablas y triggers: [03-base-de-datos/04-hitos-y-calendario.md](../03-base-de-datos/04-hitos-y-calendario.md)
- Pantallas: [05-interfaz/04-hitos-y-calendario.md](../05-interfaz/04-hitos-y-calendario.md)
- Permisos: [04-casos-de-uso/04-hitos-y-calendario.md](../04-casos-de-uso/04-hitos-y-calendario.md)
- Arquitectura: [02-arquitectura/04-hitos-y-calendario.md](../02-arquitectura/04-hitos-y-calendario.md)
- Limitaciones conocidas: [cierre del proyecto](../01-proyecto/cierre-del-proyecto.md#limitaciones-conocidas)

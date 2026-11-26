# Chat con IA: flujos

**En una frase:** cada mensaje se clasifica como pedido de plan, conversación o fuera de tema; la conversación se responde en streaming (con los datos del grupo elegido en la barra, o en un proyecto nuevo con los documentos del servidor de IA local), y el plan solo se arma cuando el usuario lo pide: con un grupo con datos, como análisis del repositorio; con «New project», sin grupo o en un grupo sin usar, como un proyecto nuevo que la API guarda en una sola transacción al responder «sí» (en ese grupo sin usar o como grupo nuevo). Cada proyecto tiene su propia conversación.

## Diagrama 1: proyecto nuevo, de la idea al proyecto guardado

```mermaid
sequenceDiagram
    autonumber
    actor U as Usuario
    participant FE as ChatPage
    participant API as API /chat (UserSession)
    participant PS as ProjectService
    participant DB as SQL Server
    participant PY as Servicio Python (Orquestador)
    participant KN as Servidor de IA local
    participant LLM as Modelo local (Gemma 4 en Ollama)

    U->>FE: abre /chat sin proyecto, o pulsa New project
    FE->>API: WebSocket /chat?token=JWT
    API-->>FE: history_restore, solo si la sesión ya existía
    U->>FE: describe su proyecto
    FE->>API: type user
    API->>PY: handle_user_message con project null, o el de un grupo sin usar
    PY->>LLM: clasificación PLAN, CHAT u OFF, si no hay frase disparadora
    LLM-->>PY: CHAT
    PY->>KN: POST /search con el mensaje
    KN-->>PY: fragmentos de documentos, o nada
    PY->>LLM: respuesta de chat en streaming
    loop por cada trozo
        LLM-->>PY: trozo de texto
        PY-->>API: response_chunk
        API-->>FE: assistant_chunk, la burbuja crece
    end
    PY-->>API: response con el texto completo
    API-->>FE: assistant, reemplaza la burbuja
    Note over U,LLM: el plan solo se arma si el usuario lo pide
    U->>FE: genera el plan
    FE->>API: type user
    API->>PY: handle_user_message
    PY->>LLM: plan en JSON (RecommendationsAgent), sin clasificar y sin streaming
    LLM-->>PY: plan
    PY-->>API: response con el resumen y awaiting_confirmation
    API-->>FE: assistant, la API abre la compuerta de guardado
    U->>FE: sí
    FE->>API: type user
    API->>PY: handle_user_message
    PY-->>API: save_plan, sin llamar al modelo
    API->>PS: createProjectFromPlan, o fillEmptyGroupFromPlan en un grupo sin usar
    PS->>DB: una transacción en Groups, UserGroups, GroupRoles, Tasks y Nodes
    DB-->>PS: commit
    API-->>FE: system project_created
    FE->>FE: recarga la lista de grupos
    API->>PY: save_plan_result con success true
```

## Diagrama 2: vida del plan de un proyecto nuevo

```mermaid
stateDiagram-v2
    [*] --> Conversando
    Conversando --> PlanMostrado: el usuario pidió el plan y el modelo devolvió uno válido
    PlanMostrado --> Guardando: el usuario confirma
    PlanMostrado --> Conversando: «no» o un cambio, se conserva la idea
    PlanMostrado --> [*]: «descarta» o «empezar de nuevo», se borra todo
    Guardando --> [*]: la API guardó el grupo, conversación nueva
    Guardando --> PlanMostrado: falló la transacción, o 60 s sin resultado
```

Si el usuario cambia de proyecto (otro grupo en la barra, «New project» o «Back to …»), el siguiente mensaje llega con otro proyecto: Python guarda la conversación y el plan de este y recupera los del otro. Al volver, el plan sigue donde quedó.

## Diagrama 3: cómo decide el orquestador qué responder

```mermaid
flowchart TD
    M["Llega un mensaje"] --> G{"¿Es de otro proyecto que el anterior?"}
    G -->|"sí"| GR["Guarda la conversación y el plan del anterior y recupera los de este"]
    G -->|"no"| P{"¿Hay un guardado en curso?"}
    GR --> P
    P -->|"sí, menos de 60 s"| W["«I'm still saving your project plan»"]
    P -->|"sí, más de 60 s"| R2["Vuelve a pedir confirmación del plan"]
    P -->|"no"| C{"¿Hay un plan esperando confirmación?"}
    C -->|"sí"| K{"¿Qué respondió el usuario?"}
    K -->|"confirma"| S["Envía save_plan a la API"]
    K -->|"descarta"| D["Borra el plan, la idea y la conversación"]
    K -->|"solo «no»"| Q["Pregunta qué cambiar"]
    K -->|"otro texto"| X["Retira el plan y conserva la idea"]
    C -->|"no"| T{"¿Trae una frase como «genera el plan» o «propón tareas»?"}
    X --> T
    T -->|"sí"| PL{"¿Hay un grupo con datos?"}
    T -->|"no"| Y{"El modelo clasifica: PLAN, CHAT u OFF"}
    Y -->|"PLAN"| PL
    Y -->|"OFF"| O["Respuesta fija: solo ayuda con software o con el proyecto"]
    Y -->|"CHAT, o ante la duda"| CH{"¿Hay un grupo con datos?"}
    PL -->|"sí"| PR["plan_request: la API analiza el repositorio"]
    PL -->|"no"| G2["El modelo arma el plan en JSON"]
    G2 --> PM["Resumen del plan y «¿lo guardo?»"]
    CH -->|"sí"| A1["Respuesta en streaming con los datos del proyecto"]
    CH -->|"no"| NP{"¿Ya describió la idea y pide «create the project» o «crea el proyecto», sin pregunta ni negación?"}
    NP -->|"sí"| G2
    NP -->|"no"| A2["Respuesta en streaming con los documentos del servidor de IA local, si hay"]
```

## Diagrama 4: con un grupo con datos, el asistente del proyecto

```mermaid
sequenceDiagram
    autonumber
    actor U as Miembro
    participant NAV as Barra de navegación
    participant FE as ChatPage
    participant API as API /chat (UserSession)
    participant DB as SQL Server
    participant GH as GitHub
    participant PY as Servicio Python (Orquestador)
    participant LLM as Modelo local (Gemma 4 en Ollama)

    U->>NAV: elige un grupo
    NAV->>FE: grupo activo en GroupContext
    FE->>API: set_context con groupId
    API->>DB: membresía, nombre y repo del grupo
    API-->>FE: context con el repo o null
    U->>FE: pregunta sobre el proyecto
    FE->>API: type user
    API->>DB: primer mensaje, tareas, hitos, equipo y asignaciones
    API->>GH: resumen del repo, solo con repo y «Allow AI analysis»
    Note over API,GH: guarda el contexto en caché, sin refrescarlo hasta cambiar de grupo
    API->>PY: handle_user_message con project
    PY->>LLM: clasificación PLAN, CHAT u OFF
    LLM-->>PY: CHAT
    PY->>LLM: respuesta con los datos del proyecto, en streaming
    PY-->>API: response_chunk y al final response
    API-->>FE: assistant_chunk y al final assistant
    U->>FE: propón tareas
    FE->>API: type user
    API->>DB: solo vuelve a revisar la membresía y el permiso
    API->>PY: handle_user_message con project
    PY-->>API: plan_request, frase disparadora sin llamar al modelo
    API-->>FE: repo_analysis_status, fetching_repo y luego analyzing
    API->>PY: analyze_repository con el resumen del repo en caché
    PY->>LLM: plan de tareas en JSON
    LLM-->>PY: plan
    PY-->>API: repo_analysis_plan
    API-->>FE: repo_plan, tarjeta con Confirm y Discard
    U->>FE: Confirm
    FE->>API: repo_plan_confirm
    API->>DB: membresía y addPlanToGroup en una transacción, Tasks y Nodes
    API-->>FE: repo_plan_saved
    Note over FE,PY: el botón «Propose tasks» manda repo_analysis directo, sin pasar por Python para clasificar
```

## Paso a paso

**Proyecto nuevo: «New project», sin grupo o con un grupo sin usar** (Diagramas 1, 2 y 3)
1. `ChatPage` abre `/chat?token=<JWT>`; la API revisa el `Origin` y el JWT antes de aceptar.
2. `SessionManager` busca la sesión del usuario. Si existe (otra pestaña o menos de 60 min desconectado), la reutiliza y manda `history_restore`; si no, crea una y el navegador muestra un saludo local a los 1,5 s.
3. El usuario escribe. La API valida el largo (4000) y el ritmo (20 por minuto), guarda el mensaje en el historial de ese proyecto, lo manda a Python con `project` en `null` (o el contexto del grupo sin usar, con `isEmpty`) y arranca un plazo de 90 s.
4. El orquestador decide qué hacer (Diagrama 3). Si el mensaje no trae una frase disparadora, una llamada corta al modelo lo clasifica (PLAN, CHAT u OFF; ante la duda, CHAT). Así, un mensaje normal cuesta dos llamadas: clasificar y responder.
5. CHAT: pide al servidor de IA local (`POST /search`) los fragmentos de documentos parecidos al mensaje y responde en streaming, con contenido concreto (nunca describiendo lo que puede hacer). Si ya describió la idea y pide «create the project» o «crea el proyecto» (sin ser pregunta ni negación), pasa a PLAN. OFF: respuesta fija, en español o en inglés según el mensaje.
6. PLAN: `RecommendationsAgent` pide el plan en JSON (con Ollama, con `repeat_penalty` 1.1). El prompt pide 4 hitos (Setup, Development, Testing, Launch), al menos 8 tareas (`MIN_TASKS`, con los dos proveedores) y al menos 3 roles. Si el plan sale inválido o el modelo falla, se reintenta una vez si quedan al menos 20 s de un presupuesto de 80 s; un timeout o un límite de uso no se reintenta.
7. Python lo resume en una tabla Markdown y marca `awaiting_confirmation`. La API abre su compuerta de guardado.
8. El usuario confirma («sí», «ok», «guardar», «dale», «listo»…). Python responde `save_plan` con el plan, sin llamar al modelo; en un grupo sin usar, con `target_group_id`.
9. La API comprueba la compuerta. Con `target_group_id` llama a `ProjectService.fillEmptyGroupFromPlan`: si el usuario es el admin del grupo y este sigue sin usar (se comprueba con bloqueo), el grupo toma el nombre del proyecto y recibe roles, tareas e hitos en una transacción (los roles con el mismo nombre no se duplican). Si no, o sin `target_group_id`, `createProjectFromPlan` crea grupo, membresía, roles, tareas e hitos en una transacción.
10. La API manda `project_created` al navegador: «Proyecto "X" creado en este grupo»; «Proyecto "X" creado como un grupo nuevo (…)», con el motivo («solo el admin del grupo puede guardarlo en él» o «el grupo ya no estaba vacío»); o, sin `target_group_id`, «Proyecto "X" creado». El navegador recarga sus grupos: un grupo nuevo no se selecciona solo (hay que elegirlo en la barra); el grupo llenado sigue elegido, con su nombre nuevo. Python recibe `save_plan_result` y empieza una conversación nueva.

**Con un grupo con datos** (Diagrama 4)
1. El grupo se elige en la barra de navegación. `ChatPage` manda `set_context` (también en cada reconexión); la API comprueba la membresía y responde `context` con el repo o `null` (y `empty` y `fillable`), además de `history_restore` con la conversación de ese grupo. Si el grupo cambió, descarta el contexto anterior.
2. Con el primer mensaje, la API arma el contexto: tareas, hitos, nombres del equipo, quién tiene cada tarea y, si hay repo, la instalación está activa y el admin activó «Allow AI analysis», el resumen del repo. Lo guarda en caché y no lo refresca mientras el grupo no cambie.
3. En los mensajes siguientes solo vuelve a revisar la membresía y, si el contexto tiene el resumen del repo, que siga permitido.
4. Python recibe el contexto con cada mensaje. Si es de otro proyecto que el anterior, guarda la conversación y el plan del anterior y recupera los de este.
5. CHAT: responde en streaming con los datos del proyecto (sin los documentos del servidor de IA local). Si algo no está en esos datos, dice que no lo ve.
6. PLAN: Python devuelve `plan_request` y la API lanza el análisis del repositorio con el mensaje como instrucciones (hasta 500 caracteres) y las mismas reglas que «Propose tasks»: uno a la vez, uno por minuto y 90 s de plazo. Reutiliza el resumen del repo en caché.
7. Llega la tarjeta del plan: «Confirm» guarda las tareas y los hitos en el grupo con `addPlanToGroup`; «Discard» la descarta. El plan vence a los 30 min.

**Streaming:**
- Python manda cada trozo como `response_chunk`; la API lo reenvía como `assistant_chunk` solo si el pedido sigue pendiente, con el mismo `requestId` que llevará el `assistant` final.
- El navegador junta los trozos y pinta una vez por cuadro de pantalla. El `assistant` final reemplaza la burbuja; si llega un error o se corta la conexión, la burbuja se congela con lo que tenía.
- Los trozos no reinician los plazos de 90 s (API) y 100 s (navegador), y no se guardan en el historial.

**Sesiones y memoria:**
- Una sesión por usuario: si abres el chat en otra pestaña, la nueva toma la sesión y la anterior deja de recibir respuestas.
- Cada proyecto (y «sin proyecto») tiene su conversación. La API guarda hasta 100 mensajes por proyecto y las conversaciones de hasta 20 proyectos además de la que se ve (`stashedChats`). Al cambiar de proyecto manda `history_restore` con la de ese proyecto y `chatOf`; el navegador solo la muestra bajo ese proyecto y, si está vacía, pone el saludo. Antes, la pantalla seguía con la conversación anterior aunque la IA ya la había olvidado.
- Lo que llega para un proyecto que el usuario dejó (respuestas, `LLM_TIMEOUT`, análisis, el resultado del guardado) va al chat de ese proyecto y se ve al volver. Un `plan_request` de ese proyecto no lanza el análisis; un `save_plan` que llega cuando ya se cambió de proyecto no guarda nada: deja «Could not create the project.» en ese chat y el plan vuelve a esperar confirmación.
- Python guarda su propio contexto: las últimas 16 líneas, por 2 h, y el de hasta 20 proyectos más (`saved_groups`). Todo está en memoria: reiniciar la API o Python lo borra.

## Qué ve el usuario si algo falla

Los errores aparecen como un aviso rojo centrado, con `Code: <código>` debajo. Los fallos del modelo, en cambio, llegan como una respuesta normal del asistente.

| Situación | Código | Qué ve el usuario |
|---|---|---|
| Token inválido o vencido, u `Origin` no permitido | HTTP 401 o 403 al conectar | «Connection problem: WebSocket connection error» y el botón «🔌 Connect»; tras 5 reintentos, «Maximum reconnection attempts reached» |
| El token vence con el chat abierto | cierre 4001 | Vuelve a la pantalla de inicio de sesión |
| Más de 20 mensajes en un minuto | `RATE_LIMITED` | «You are going too fast: wait a moment before trying again. You can retry in N s.» |
| Mensaje de más de 4000 caracteres | `MESSAGE_TOO_LONG` | El cuadro no deja escribir más; si llega, «The message is too long: the limit is 4000 characters.» |
| Python apagado, no conecta en 5 s o se corta el enlace | `LLM_ERROR` | «The AI service is not available right now.» |
| Python no responde en 90 s | `LLM_TIMEOUT` | «The AI took too long to answer. Please try again.» |
| El modelo falla: demora, Ollama apagado o modelo sin instalar (o, solo si se usa Groq de respaldo, su límite de uso) | sin código | Respuesta normal del asistente: «The AI assistant took too long to respond. Please try again.» o «The AI assistant is temporarily unavailable. Please try again in a moment.»; solo con Groq (respaldo), «The AI assistant is receiving too many requests right now. Please try again in 20s.». El detalle de Ollama («is Ollama running?», «ollama pull …») solo queda en el log de Python |
| El modelo devuelve un plan inválido (JSON roto o sin tareas), también en el reintento | sin código | «I had trouble generating the project plan. Could you provide a bit more detail about what you want to build?» |
| Falla la transacción al guardar el proyecto nuevo | `SAVE_FAILED` | «Could not create the project.» No se guarda nada |
| Plan pedido en un proyecto que el usuario dejó antes de la respuesta | `PROJECT_CHANGED` | En el chat de ese proyecto: «The plan was not started because the chat switched to another project.» |
| Pedir un plan con un grupo con datos pero sin repo | `REPO_NOT_CONNECTED` | «The project has no GitHub repository connected.» |
| Pedir un plan sin «Allow AI analysis» | `AI_ANALYSIS_DISABLED` | «AI analysis is turned off for this project. A group admin can turn it on from the GitHub page (“Allow AI analysis”).» |
| Más de un análisis por minuto | `RATE_LIMITED` | «You can only ask for one analysis per minute. You can retry in N s.» |
| Ya hay un análisis en curso | `ANALYSIS_IN_PROGRESS` | «An analysis is already running.» |
| El análisis falla en Python | `ANALYSIS_FAILED` | «Could not complete the analysis.» |
| La tarjeta del plan venció (30 min) o ya se usó | `REPO_PLAN_EXPIRED` o `REPO_PLAN_NOT_FOUND` | La tarjeta pasa a «Plan expired: ask for the analysis again to get a new one.» y aparece «The plan expired; analyze the repository again.» o «The plan is no longer available.» |
| Falla el guardado del plan del análisis | `SAVE_FAILED` | «Could not save the plan.»; la tarjeta se puede volver a confirmar mientras no venza |
| No llega ninguna respuesta en 100 s | sin código | «No answer arrived in time. If it arrives later it will show up here; you can also try again.» |
| El socket está cerrado al enviar | sin código | «Failed to send message. Please check your connection.» |
| El mensaje supera el tamaño que acepta el socket | cierre 1009 | «The message is too large to send. Shorten it and try again.» |
| Error inesperado en la API | `INTERNAL_ERROR` | «An unexpected error occurred.» |

El análisis también puede terminar con códigos de GitHub (`INSTALLATION_SUSPENDED`, `REPO_EMPTY`, `GITHUB_RATE_LIMITED`…): qué significa cada uno, en [07-github](07-github.md).

**Reintentar después de `SAVE_FAILED`:** Python vuelve a dejar el plan esperando confirmación, pero la API ya cerró su compuerta. Si el usuario escribe «sí» otra vez, la API rechaza el guardado (`PLAN_NOT_EXPECTED`) sin avisar y a los 100 s aparece «No answer arrived in time…». Para reintentar, hay que escribir «genera el plan»: la IA arma el plan de nuevo y la compuerta se vuelve a abrir ([limitaciones conocidas](../01-proyecto/cierre-del-proyecto.md#chat-con-ia)).

## Para saber más
- El análisis del repositorio, que usa el mismo socket: [07-github](07-github.md)
- Piezas y conexiones: [02-arquitectura/05-chat-ia.md](../02-arquitectura/05-chat-ia.md)
- Tablas que se leen y se escriben: [03-base-de-datos/05-chat-ia.md](../03-base-de-datos/05-chat-ia.md)
- La pantalla: [05-interfaz/05-chat-ia.md](../05-interfaz/05-chat-ia.md)
- El servidor de IA local: [10-ia-sobre-el-codigo](10-ia-sobre-el-codigo.md)
- Limitaciones conocidas: [cierre de la línea de Pablo y estado](../01-proyecto/cierre-del-proyecto.md#limitaciones-conocidas)

# Chat con IA: casos de uso

**En una frase:** cualquier usuario con sesión puede conversar con la IA; el chat sigue al grupo elegido en la barra de navegación: con grupo, el miembro pregunta sobre su proyecto y pide tareas nuevas; sin grupo, la IA ayuda a dar forma a un proyecto nuevo y, si el usuario lo pide, arma el plan y crea el grupo.

```mermaid
flowchart LR
    U(["👤 Usuario con sesión"])
    M(["👤 Miembro del grupo"])
    A(["👤 Admin del grupo"])

    subgraph SYS["TaskMate · Chat con IA en /chat"]
        uc1(["Abrir el chat y recuperar el historial"])
        uc2(["Conversar sobre un proyecto nuevo, sin grupo"])
        uc3(["Pedir el plan del proyecto nuevo"])
        uc4(["Confirmar el plan y crear el grupo"])
        uc5(["Pedir cambios o descartar el plan"])
        uc6(["Elegir el grupo en la barra de navegación"])
        uc9(["Preguntar sobre el proyecto seleccionado"])
        uc7(["Pedir tareas al repositorio y guardarlas o descartarlas"])
        uc8(["Permitir el análisis con IA, en /github"])
    end

    U --> uc1
    U --> uc2
    U --> uc3
    U --> uc4
    U --> uc5
    M --> uc6
    M --> uc9
    M --> uc7
    A --> uc8
    uc8 -.->|"habilita"| uc7
    uc8 -.->|"suma el repo al contexto"| uc9
```

Un admin también es miembro de su grupo, y un miembro también es un usuario con sesión: cada actor puede hacer lo de los actores de arriba.

## Casos de uso

| Caso | Quién puede | Qué pasa |
|---|---|---|
| Abrir el chat y recuperar el historial | Usuario con sesión | Se abre el WebSocket `/chat`. Si ya tenía una sesión (otra pestaña o menos de 60 min desconectado), vuelve el historial; si no, aparece un saludo |
| Elegir el grupo en la barra de navegación | Miembro de ese grupo | El chat no tiene selector propio: usa el grupo activo de la barra. La API confirma la membresía y responde si el grupo tiene repositorio y si el análisis con IA está permitido |
| Preguntar sobre el proyecto seleccionado | Miembro del grupo | La IA responde con las tareas, los hitos, el equipo y quién tiene cada tarea; si hay repo y «Allow AI analysis» está activo, también con el resumen del repo (nunca el código). Lo que no está en esos datos, dice que no lo ve |
| Pedir tareas al repositorio y guardarlas o descartarlas | Miembro del grupo, con repositorio conectado y análisis permitido | Con el botón «Propose tasks» o pidiendo un plan en el chat («make a plan», «propón tareas»…) se lanza el análisis del repositorio; llega una tarjeta con «Confirm» y «Discard». Sin repo o sin permiso, el botón no aparece y pedir un plan termina en error. Detalle en [07-github](07-github.md) |
| Conversar sobre un proyecto nuevo | Usuario con sesión, sin grupo seleccionado | El modelo (Groq u Ollama) da recomendaciones concretas, solo pregunta si hace falta y puede apoyarse en los documentos del servidor de IA local |
| Pedir el plan del proyecto nuevo | Usuario con sesión, sin grupo seleccionado | Solo si lo pide de forma explícita («generate the plan», «crea un plan»…, o si el clasificador del modelo lo entiende así): la IA arma roles, 4 hitos y al menos 8 tareas, y pregunta si se guarda |
| Confirmar el plan y crear el grupo | Usuario con sesión | Al responder «sí», «ok», «guardar»…, la API crea un **grupo nuevo** en una transacción; el usuario queda como su admin y la lista de grupos se recarga (el grupo nuevo no se selecciona solo) |
| Pedir cambios o descartar el plan | Usuario con sesión | «no» pregunta qué cambiar; otro texto retira el plan y sigue la conversación con la misma idea (el plan solo se rehace si se vuelve a pedir); «descarta» o «empezar de nuevo» borra todo |
| Permitir el análisis con IA | Solo el admin del grupo | Interruptor «Allow AI analysis» en `/github`. Decide si se pueden pedir tareas al repositorio y si el chat ve el resumen del repo. Detalle en [07-github](07-github.md) |

**Cuándo no hay grupo seleccionado:** según el código, casi nunca. Al registrarse se crea un grupo personal, el login activa el primer grupo y el selector de la barra no tiene opción «ninguno». El modo sin grupo queda para quien no tiene grupos, salió del grupo activo o tuvo un fallo al cargar sus grupos. En ese modo el chat muestra «Project: none (select a group in the navbar)».

## Reglas de permiso (verificadas en el código)
- **Ruta `/chat`:** sin sesión, `src/App.js` redirige a `/`. En el menú es «AI Bot» y la ven todos.
- **Conexión:** `WebSocketServer.js` exige un JWT de acceso válido en `?token=` (si no, 401) y un `Origin` permitido (si no, 403). Si el JWT vence con el chat abierto, cierra con el código 4001 y el navegador vuelve al login.
- **Chat sin grupo y plan nuevo:** no piden ningún rol ni grupo. El proyecto se crea siempre como grupo nuevo, con `adminId` = quien confirmó.
- **Guardar solo lo confirmado:** `UserSession.saveProjectPlan` acepta un `save_plan` solo si la respuesta anterior de la IA mostró un plan esperando confirmación; si no, lo rechaza y no escribe nada.
- **Elegir el grupo:** `set_context` llama a `access.model.isGroupMember`; quien no es miembro recibe `NOT_GROUP_MEMBER` («You are not a member of that project.»). Esa negativa no se guarda en el historial.
- **Revalidación en cada mensaje:** con el contexto en caché, la API vuelve a comprobar la membresía; si el usuario ya no es miembro, borra el contexto y el mensaje sigue sin proyecto. Si la caché tiene el resumen del repo, también comprueba que el repo siga conectado, sin suspender y con permiso; si no, lo quita.
- **Qué ve la IA sin permiso:** las tareas, los hitos, los nombres del equipo y las asignaciones van siempre en el contexto; «Allow AI analysis» solo decide el resumen del repo. Con `LLM_PROVIDER=groq` (por defecto) ese contexto se manda a Groq.
- **Pedir tareas (botón o plan en el chat):** el mismo análisis y las mismas reglas: miembro del grupo, repositorio conectado, instalación no suspendida, `ai_analysis_enabled` activo, uno a la vez y uno por minuto. Al guardar se vuelve a comprobar la membresía. El permiso lo cambia solo el admin (`requireGroupAdmin` en `PUT /api/github/groups/:gid/ai-analysis`).
- **Fuera de tema:** lo que no es de software recibe una respuesta fija, en español o en inglés según el mensaje, con el nombre del proyecto si hay uno; el modelo no la escribe.
- **Límites por usuario** (no por pestaña): mensajes de hasta 4000 caracteres, 20 mensajes por minuto y un análisis del repositorio por minuto.
- **Analytics por este socket:** `/chat` también acepta pedidos `analytics` con la regla de líder, pero `ChatPage` no los usa. Ver [06-analytics](06-analytics.md).

## Para saber más
- Pasos y mensajes de error: [06-flujos/05-chat-ia.md](../06-flujos/05-chat-ia.md)
- Todos los actores y permisos de TaskMate: [00-general.md](00-general.md)
- La pantalla: [05-interfaz/05-chat-ia.md](../05-interfaz/05-chat-ia.md)
- Limitaciones conocidas: [cierre de la línea de Pablo y estado](../01-proyecto/cierre-del-proyecto.md#limitaciones-conocidas)
- Qué es el servidor de IA local: [02-arquitectura/10-ia-sobre-el-codigo.md](../02-arquitectura/10-ia-sobre-el-codigo.md)

# Chat con IA: arquitectura

**En una frase:** el navegador conversa con la API por un WebSocket (`/chat`); la API le suma el contexto del grupo elegido en la barra de navegación y reenvía cada mensaje al servicio Python del chat, que responde en streaming con Groq o con el modelo local (Ollama) según `LLM_PROVIDER`; cuando el usuario confirma un plan, la API lo guarda en SQL Server.

![Arquitectura del chat con IA](imagenes/05-chat-ia.png)

Fuente del diagrama: [fuentes/05-chat-ia.mmd](fuentes/05-chat-ia.mmd).

| Desde | Hacia | Qué viaja |
|---|---|---|
| Grupo del navbar (`NavGroupSelector`) | ChatPage | el grupo activo de `GroupContext`; al cambiar, ChatPage manda `set_context` |
| ChatPage | WebSocket `/chat` | `?token=<JWT>` al conectar; después, mensajes JSON (`user`, `set_context`, `repo_analysis`, `repo_plan_confirm`, `repo_plan_discard`, `analytics`, `ping`) |
| WebSocket `/chat` | SessionManager y UserSession | el socket ya autenticado; una sesión por usuario |
| UserSession | Modelos y SQL Server | el contexto del proyecto: membresía, nombre del grupo, repo, tareas, hitos, equipo y asignaciones |
| UserSession | `repoSnapshot` → GitHub | el resumen del repo (descripción, árbol, README, manifiestos, commits e issues; nunca código), solo con repo conectado, instalación activa y «Allow AI analysis» |
| UserSession | LLMService | `handle_user_message` con `sessionId`, `requestId` y `project` (el contexto, o `null` sin grupo) |
| LLMService | Ruta `/ws` | un solo WebSocket compartido por todos los usuarios, con el encabezado `X-MCP-Secret` |
| Ruta `/ws` | Orquestador | cada pedido; los de una misma sesión, en orden |
| Orquestador | llm_service.py | la clasificación PLAN / CHAT / fuera de tema (`_route`) y las respuestas de chat |
| Orquestador | knowledge.py → servidor de IA local | `POST /search` en `AI_SERVER_URL` (`127.0.0.1:8000`), con `X-AI-Server-Secret` si hay `AI_SERVER_SECRET`; **solo sin grupo seleccionado** |
| Orquestador | Agente del plan | la idea del proyecto acumulada en la conversación (solo sin grupo) |
| Agente del plan | llm_service.py | el pedido del plan en modo JSON |
| llm_service.py | Groq | HTTPS con `GROQ_API_KEY`, modelo `openai/gpt-oss-20b` (`LLM_PROVIDER=groq`, el valor por defecto) |
| llm_service.py | Ollama | `POST /api/chat` en `OLLAMA_HOST` (`127.0.0.1:11434`), modelo `gemma4:e2b-it-qat`, sin `think` (`LLM_PROVIDER=ollama`) |
| Orquestador | UserSession | `response_chunk` (trozos de la respuesta), `response`, `save_plan` o `plan_request` |
| UserSession | ChatPage | `assistant_chunk` por cada trozo y al final `assistant` con el texto completo, los dos con el mismo `requestId` |
| UserSession | ProjectService | sin grupo, el plan confirmado (`save_plan`); con grupo, el plan del análisis del repo (`repo_plan_confirm`) |
| ProjectService | SQL Server 2019 | `createProjectFromPlan`: una transacción con `Groups`, `UserGroups`, `GroupRoles`, `Tasks` y `Nodes`; `addPlanToGroup`: `Tasks` y `Nodes` en el grupo existente |

Términos:
- **WebSocket:** conexión que queda abierta y por la que ambos lados mandan mensajes cuando quieren.
- **JWT:** el token firmado que entrega el login; dura 24 h.
- **LLM:** modelo de lenguaje. Aquí, Groq (en la nube) u Ollama (en la misma máquina).
- **Streaming:** la respuesta llega en trozos mientras el modelo la escribe.
- **Transacción:** grupo de escrituras que se guarda completo o no se guarda nada.

## Piezas

| Pieza | Tecnología | Archivo |
|---|---|---|
| Pantalla del chat | React 18 + MUI, `react-markdown` con `rehype-sanitize` | `src/components/ChatPage.jsx` |
| Proyecto del chat (solo lectura) | MUI `Typography` y `Chip` | `src/components/github/ChatProjectInfo.jsx` |
| Selector de grupo de la barra | MUI `Menu` | `src/components/NavGroupSelector.jsx` |
| Conexión del navegador | WebSocket con reconexión y `ping` cada 30 s | `src/hooks/useWebSocket.js` |
| Servidor WebSocket | librería `ws`, en el mismo puerto que Express | `taskmate-api/services/WebSocketServer.js` |
| Sesiones y contexto del proyecto | Node.js, en memoria | `taskmate-api/services/SessionManager.js`, `taskmate-api/services/UserSession.js` |
| Resumen del repositorio | API de GitHub con la GitHub App | `taskmate-api/services/github/repoSnapshot.js` |
| Enlace con Python | cliente `ws` y `EventEmitter` | `taskmate-api/services/LLMService.js` |
| Guardar el plan | `tedious` y `withTransaction` | `taskmate-api/services/ProjectService.js`, `taskmate-api/helpers/transaction.js` |
| Servicio Python del chat | FastAPI + uvicorn | `taskmate-api/mcp/server.py` |
| Orquestador | Python (`OrchestratorAgent`) | `taskmate-api/mcp/agents/orchestrator.py` |
| Agente del plan | Python (`RecommendationsAgent`, `MIN_TASKS = 8`) | `taskmate-api/mcp/agents/recommendations_agent.py` |
| Contexto del proyecto en Python | Pydantic (`ProjectContext`) y `project_context_json` | `taskmate-api/mcp/schemas.py`, `taskmate-api/mcp/agents/repo_analysis_agent.py` |
| Conocimiento del servidor de IA local | `httpx` | `taskmate-api/mcp/knowledge.py` |
| Cliente del modelo | SDK `groq` (`AsyncGroq`) o `httpx` hacia Ollama | `taskmate-api/mcp/llm_service.py` |
| Base de datos | SQL Server 2019 en Docker | `taskmate-api/taskmate_tables.sql` y `taskmate-api/migrations/` |

## Cómo se conectan
- El navegador abre `ws://<host de la página>:9000/chat?token=<JWT>` (`WS_BASE`; se cambia con `REACT_APP_WS_URL`). Antes de aceptar, la API revisa el `Origin` (el sitio que abre la conexión: si no está en `FRONTEND_URL`, responde 403; con `ALLOW_LAN_ORIGINS=true` también acepta `http` desde IPv4 privadas, solo para desarrollo) y el JWT (sin token o vencido, 401).
- Hay **una sesión por usuario**, no por pestaña. Vive en la memoria de la API y se conserva 60 min después de desconectarse.
- **El proyecto del chat es el grupo de la barra de navegación.** El chat no tiene selector propio: al cambiar de grupo (y en cada reconexión) ChatPage manda `set_context`; la API comprueba la membresía y responde `context` con el repo o `null`.
- **El contexto se arma una sola vez.** Con el primer mensaje tras elegir el grupo, `UserSession` lee el equipo, las tareas, los hitos, las asignaciones y, si hay permiso, el resumen del repo, y lo guarda en caché. No se refresca mientras el grupo no cambie. En cada mensaje solo vuelve a comprobar la membresía y, si la caché tiene el resumen del repo, que siga conectado, sin suspender y con permiso. Si falla la lectura del repo, no se guarda en caché y se reintenta en el siguiente mensaje.
- Todos los usuarios comparten **un solo WebSocket** de Node a Python (`LLMService`). Cada pedido lleva `sessionId` y `requestId`, y la respuesta vuelve a la sesión correcta por el `sessionId`.
- El servicio Python escucha solo en `127.0.0.1`, en `MCP_PORT` (8001 por defecto; esta máquina usa 8011). Rechaza conexiones sin `X-MCP-Secret` o que traen `Origin`. **No es el Model Context Protocol:** la carpeta se llama `mcp/` por historia, pero el protocolo es JSON propio.
- **Qué modelo responde:** `LLM_PROVIDER` elige `groq` (por defecto en el código y en `.env.example`) u `ollama` (lo agrega `scripts/local-up.sh` al `.env` de la raíz si falta). Vale para todos los agentes de Python: chat, clasificación, plan, análisis del repo, pipeline y analytics. Un valor desconocido usa Groq. Con Groq, el contexto del proyecto sale a la nube; con Ollama, se queda en la máquina.
- **Streaming:** con `LLM_STREAM_CHAT=1` (por defecto) las respuestas de chat salen en trozos. Los planes, la respuesta fija a lo que está fuera de tema y la clasificación llegan enteros.
- **Servidor de IA local:** solo sin grupo seleccionado, `knowledge.py` le pide a `taskmate-ai-server` los fragmentos de documentos más parecidos al mensaje (4 como máximo, similitud ≥ 0,3, 3 s de espera). Sin `AI_SERVER_URL`, o si falla, el chat sigue sin ellos.
- **Python no toca la base de datos.** Sin grupo, Python pide `save_plan` y Node escribe todo con `ProjectService` en una sola transacción. Con grupo, Python devuelve `plan_request` y Node lanza el análisis del repositorio por el mismo socket `/chat`: ver [07-github](07-github.md).

## Para saber más
- Paso a paso y errores: [06-flujos/05-chat-ia.md](../06-flujos/05-chat-ia.md)
- Tablas que lee y escribe: [03-base-de-datos/05-chat-ia.md](../03-base-de-datos/05-chat-ia.md)
- Quién puede hacer qué: [04-casos-de-uso/05-chat-ia.md](../04-casos-de-uso/05-chat-ia.md)
- La pantalla: [05-interfaz/05-chat-ia.md](../05-interfaz/05-chat-ia.md)
- El servidor de IA local (`taskmate-ai-server`): [10-ia-sobre-el-codigo](10-ia-sobre-el-codigo.md)
- Arquitectura de todo el sistema: [00-general.md](00-general.md)
- Limitaciones conocidas: [cierre de la línea de Pablo y estado](../01-proyecto/cierre-del-proyecto.md#limitaciones-conocidas)

# Chatbot sobre la IA local, con streaming

El chatbot de TaskMate llamaba a **Groq** (un servicio en la nube). Ahora funciona sobre el
**mismo modelo local** que el servidor de IA de `../ai-server` (Gemma 4, `gemma4:e2b-it-qat`, en
Ollama), consulta el conocimiento indexado de ese servidor y responde **token a token**. Groq queda
solo como respaldo en la nube.

> **Actualizado el 25 nov 2026** contra `test/e2e` (`50f77da`). Desde el 19 nov el chat es un
> asistente del proyecto, sigue el grupo elegido en la barra de navegación y la interfaz está en
> inglés ([README](README.md#chatbot-como-asistente-del-proyecto)). Documentación general del chat:
> módulo [5 · Chat con IA](../02-arquitectura/05-chat-ia.md); del servidor de IA local: módulo
> [10 · IA sobre el código](../02-arquitectura/10-ia-sobre-el-codigo.md). Límites:
> [limitaciones conocidas](../01-proyecto/cierre-del-proyecto.md#limitaciones-conocidas).

## Arquitectura

```
navegador ──ws──▶ API Node (/chat) ──ws──▶ servicio Python (:8001) ──▶ Ollama (:11434)
                                                       │                  (Groq solo como respaldo en la nube)
                                                       └──▶ servidor de IA (:8000) /search
                                                            (solo sin proyecto, con X-AI-Server-Secret)
```

Un mismo modelo en la GPU de 4 GB para los dos servicios, en lugar de dos compitiendo por ella.

## 1. Modelo local

`mcp/llm_service.py` tiene ahora dos proveedores, elegidos con `LLM_PROVIDER`. Todo el texto que
genera la IA dentro de TaskMate pasa por ahí: chat y plan del proyecto, analytics y recomendaciones
de asignación, análisis del repositorio y propuesta de pipeline.

| | `ollama` (el que usa TaskMate) | `groq` (respaldo en la nube) |
|---|---|---|
| Dónde corre | esta máquina (`127.0.0.1:11434`) | nube |
| Modelo | Gemma 4 (`gemma4:e2b-it-qat`) | `openai/gpt-oss-20b` |
| Necesita | Ollama con el modelo descargado | `GROQ_API_KEY` |
| Lo que pone `local-up.sh` | ✅ | |
| Por defecto en el código | | ✅ |

`local-up.sh` pone `LLM_PROVIDER=ollama`. Groq sigue siendo el valor por defecto del código solo
para no romper el entorno de quien no tenga Ollama.

Las tres funciones (`generate`, `generate_json`, `generate_stream`) tienen ruta local. Los errores
se traducen a los mismos tipos que con Groq (`LLMTimeoutError`, etc.), así que el resto del
chatbot no distingue el proveedor. Un modelo no instalado responde con el comando para instalarlo.

### El hallazgo importante: el modelo «pensaba»

La primera prueba tardó más de 60 s y agotó el tiempo. La causa: Gemma 4 es un modelo con
razonamiento, y `/api/chat` de Ollama lo activa por defecto. Medido con la misma pregunta:

| `think` | Tiempo | Tokens | Respuesta |
|---|---|---|---|
| activado | 2,2 s | 200 (todo el presupuesto) | `"Un"` |
| desactivado | 0,4 s | 34 | la frase completa |

El razonamiento se comía todo el presupuesto de tokens. El servidor de IA nunca lo sufrió porque
usa `/api/generate`. Ahora va desactivado (`OLLAMA_THINK=0`).

## 2. Conocimiento del proyecto (la fusión)

Antes de responder, el chatbot pregunta al servidor de IA qué fragmentos indexados (documentos,
código) son relevantes para el mensaje (`mcp/knowledge.py`) y los incluye en el prompt.

**Desde el 19 nov (`f152a9e`) esto solo pasa sin un proyecto seleccionado** (chat de proyecto
nuevo). Con proyecto, el prompt lleva el contexto que arma la API (equipo, tareas, hitos y, con
«Allow AI analysis», el repositorio). La consulta lleva la cabecera `X-AI-Server-Secret` cuando
`AI_SERVER_SECRET` está definido; el servidor de IA rechaza las que no la traen (salvo si arrancó
sin secreto y con `AI_SERVER_ALLOW_NO_SECRET=1`), y entonces el chat sigue sin ese contexto.

- **Umbral de similitud (0,3).** Casi todo el chat trata de *proyectos nuevos*, que no coinciden con
  nada indexado. Sin el umbral cada respuesta cargaría los fragmentos menos malos y el modelo los
  arrastraría a la conversación.
- **Nunca falla.** Sin `AI_SERVER_URL`, o con el servidor detenido, el chatbot funciona igual que
  antes; como mucho espera 3 s.
- **Los fragmentos son datos, no instrucciones**, y el prompt lo dice — la misma precaución contra
  inyección de prompt que en el servidor de IA.

Resultado, con «¿Qué se quitó del alcance del proyecto TaskMate?» (información que el chatbot
no tenía antes):

| | Responde desde los documentos |
|---|---|
| Sin la regla «responde primero» | 9/10, 18/20 |
| Con la regla | **20/20** |
| Chat de proyecto nuevo (no debe verse afectado) | 0/5 mencionan TaskMate, 5/5 hacen preguntas |

La regla solo se añade cuando hay fragmentos relevantes, así que no afecta a los chats nuevos.
Estas mediciones son del 9 oct, con el prompt anterior; el actual pide hacer una pregunta solo
cuando haga falta para responder.

## 3. Streaming

| Capa | Antes | Ahora |
|---|---|---|
| Python | nunca emitía fragmentos | `response_chunk` por fragmento, luego la `response` completa |
| Node | reenviaba sin `requestId`, **los guardaba en el historial** | los reenvía como `assistant_chunk` con el `requestId` del pedido (lo genera Node: el navegador no lo manda), nunca los guarda, descarta los que llegan tarde |
| Navegador | no los entendía | una burbuja por petición que crece; la respuesta final la reemplaza |

Decisiones:

- **La respuesta final sigue llevando el texto completo.** Un cliente que pierda fragmentos acaba
  igual con el texto exacto del servidor.
- **Los fragmentos no se guardan en el historial.** Antes sí: una respuesta de 200 fragmentos
  habría guardado 200 trozos, y al reconectar se habrían reproducido todos.
- **Un fragmento que llega después de un timeout se descarta**, para no pintar una burbuja debajo
  del mensaje de error.
- **El navegador agrupa los fragmentos por frame** (`requestAnimationFrame`): unos pocos renders por
  respuesta en vez de uno por token, y cada render re-procesa el Markdown.
- **Mientras llega el texto se oculta «Thinking...»** (antes «AI is typing...») y se ve el cursor ▍,
  pero el envío sigue bloqueado hasta la respuesta final.

Medido de extremo a extremo (navegador → Node → Python → Ollama): primer fragmento en **~0,2–1 s**,
respuesta completa en ~2 s, y los fragmentos reconstruyen exactamente el texto final.

Los planes de proyecto no se transmiten en streaming: son JSON y solo se resumen cuando están completos.

## Pruebas

Cifras de la rama al hacer este cambio (9 oct, sobre `fe9d87d`), no las actuales:

| | Antes | Ahora |
|---|---|---|
| Python (chatbot) | 106 | 122 |
| API | 882 | 885 |
| Frontend | 310 | 316 |

Lo que aportó este cambio (`921f8ed`): `test_local_provider.py` (8; hoy 9), `test_knowledge.py`
(6; hoy 7), `test_server.py` (+2), el streaming en las pruebas de `UserSession` (+4) y
`ChatPageStreaming.test.jsx` (6). Medido el 26 nov 2026, con los arreglos de ese día (todo en `master` desde el 26 nov): Python 210, API 1324 y
frontend 438, todas en verde.

Las pruebas de Python usan un transporte HTTP simulado: no necesitan Ollama. `tests/conftest.py`
fija `LLM_PROVIDER=groq`, `LLM_STREAM_CHAT=1` y deja vacío `AI_SERVER_URL` para que el `.env` local
no se cuele.

## Límite conocido

El proyecto de conocimiento es fijo (`AI_SERVER_PROJECT`, por defecto `TaskMate`). El chatbot no
traduce aún «el grupo seleccionado» a un proyecto del servidor de IA; por eso, desde el 19 nov, el
conocimiento solo se consulta en el chat sin proyecto. Los demás límites están en
[limitaciones conocidas](../01-proyecto/cierre-del-proyecto.md#limitaciones-conocidas).

## Rendimiento (19 nov 2026)

| Medida | Antes | Después |
|---|---|---|
| `main.js` (gzip), lo que baja la pantalla de login | 119.4 kB | **96.5 kB** (−19 %) |
| Chatbot local, primer token (modelo cargado) | — | **~30 ms** |
| Recarga del modelo tras 5 min sin uso | sí (varios s) | no (`OLLAMA_KEEP_ALIVE=30m`) |

- `CicdNotifications` y las pestañas CI/CD y Vercel se cargan bajo demanda (`React.lazy`).
- Un solo cliente HTTP hacia Ollama (conexiones reutilizadas) y `keep_alive` en cada pedido.
- Mismo `num_ctx` (8192) que el servidor de IA: los dos usan el mismo modelo cargado, sin recargas.

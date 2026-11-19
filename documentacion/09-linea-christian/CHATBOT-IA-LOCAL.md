# Chatbot sobre la IA local, con streaming

El chatbot de TaskMate llamaba a **Groq** (un servicio en la nube). Ahora puede funcionar sobre el
**mismo modelo local** que el servidor de IA de `../ai-server` (Gemma 4 en Ollama), consultar el
conocimiento indexado de ese servidor y responder **token a token**.

## Arquitectura

```
navegador ──ws──▶ API Node (/chat) ──ws──▶ servicio Python (:8001) ──▶ Ollama (:11434)
                                                       │
                                                       └──▶ servidor de IA (:8000) /search
```

Un mismo modelo en la GPU de 4 GB para los dos servicios, en lugar de dos compitiendo por ella.

## 1. Modelo local

`mcp/llm_service.py` tiene ahora dos proveedores, elegidos con `LLM_PROVIDER`:

| | `groq` | `ollama` |
|---|---|---|
| Dónde corre | nube | esta máquina |
| Necesita | `GROQ_API_KEY` | Ollama con el modelo descargado |
| Por defecto en el código | ✅ | |
| Lo que pone `local-up.sh` | | ✅ |

Groq sigue siendo el valor por defecto del código para no romper el entorno de quien no tenga
Ollama; el script de despliegue local elige `ollama`.

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

## 3. Streaming

| Capa | Antes | Ahora |
|---|---|---|
| Python | nunca emitía fragmentos | `response_chunk` por fragmento, luego la `response` completa |
| Node | reenviaba sin `requestId`, **los guardaba en el historial** | los reenvía con el `requestId` del navegador, nunca los guarda, descarta los que llegan tarde |
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
- **Mientras llega el texto se oculta «AI is typing…»**, pero la entrada sigue bloqueada hasta la
  respuesta final.

Medido de extremo a extremo (navegador → Node → Python → Ollama): primer fragmento en **~0,2–1 s**,
respuesta completa en ~2 s, y los fragmentos reconstruyen exactamente el texto final.

Los planes de proyecto no se transmiten en streaming: son JSON y solo se resumen cuando están completos.

## Pruebas

| | Antes | Ahora |
|---|---|---|
| Python (chatbot) | 106 | 122 |
| API | 882 | 885 |
| Frontend | 310 | 316 |

Las pruebas de Python usan un transporte HTTP simulado: no necesitan Ollama.

## Límite conocido

El proyecto de conocimiento es fijo (`AI_SERVER_PROJECT`, por defecto `TaskMate`). El chatbot no
traduce aún «el grupo seleccionado» a un proyecto del servidor de IA.

# TaskMate API Tests

Pruebas del backend (Node.js, Jest 30). Hay dos configuraciones:

| Configuración | Comando (desde `taskmate-api/`) | Qué corre | Necesita BD |
|---------------|----------------------------------|-----------|-------------|
| `jest.config.js` | `npm test` | Todos los `tests/**/*.test.js`: **54 suites / 1322 pruebas** | No: modelos, GitHub, servicio Python del chat y servidor de IA local simulados |
| `jest.db.config.js` | `npm run test:db` | Todos los `tests/db/**/*.dbtest.js`: **10 suites / 117 pruebas** | Sí: un SQL Server **desechable** |

Resultado al 25 nov 2026, en la rama `test/e2e` (`50f77da`): 1322/1322 y 117/117 pasando. Las otras capas: frontend 438/438 (36 suites) y Python 210/210; en total **2087 pruebas** (al 5 nov eran 1960 y al cerrar la Fase 3, 1353). Las nuevas son de la línea de Christian: `deploy/`, `aiServer/`, `middleware/`, `github/taskFileService` y `db/aiReview`.

## Estructura

```
tests/
├── *.test.js                    # 16 suites de servicios y modelos
│   ├── AnalyticsService, AnalyticsBatchJob, analyticsContext, analytics-api
│   ├── LLMService, llm-fallback          # WebSocket hacia el servicio Python del chat y su caída
│   ├── SessionManager, UserSession       # sesiones de /chat y /insights; streaming y contexto del proyecto elegido
│   ├── ProjectService                    # plan de la IA → grupo, roles, tareas e hitos
│   ├── realtime                          # hub de eventos CI/CD del WebSocket /events
│   ├── complete.model, delete.model, nodes.model, tasks.model, serverConfig
│   └── performance                       # solo con NODE_ENV=integration-test (ver abajo)
├── api/                         # 9 suites: la app Express con supertest
│   ├── app, auth, authorization          # cabeceras, CORS, JWT, acceso por grupo en cada ruta
│   ├── validation, modelErrors, rateLimit
│   ├── taskBranchCleanup                 # completar o borrar una tarea limpia su rama
│   ├── tasksCreatedAt                    # createdAt y orden de tareas, completadas y papelera (008)
│   ├── websocket                         # handshake de /chat, /insights y /events (token y Origin)
│   └── support/mocks.js
├── github/                      # 20 suites: Fases 3 y 4 con un GitHub falso (helpers/fakeGitHub.js)
│   ├── githubApp, installFlow, github.controller, githubModel
│   ├── repoService, repoSnapshot, repoPlan, branchName, branchService, syncService
│   ├── webhookHandler, webhookSignature
│   ├── taskFileService                   # archivos del PR de una tarea (línea de Christian)
│   └── pipelineSpec, pipelineSpec.scripts, pipelineService, pipelineAi,
│       actionsService, deployService, cicd.controller          # Fase 4: CI/CD
├── deploy/                      # 3 suites: monitoreo de Vercel (línea de Christian)
│   ├── deploySignature                   # HMAC-SHA1 en x-vercel-signature
│   ├── vercelEvents                      # evento de Vercel → fila de Deployments
│   └── deployWebhookHandler              # POST /api/deploy/webhook/vercel con supertest
├── aiServer/                    # 3 suites: IA sobre el código (línea de Christian)
│   ├── client                            # cliente HTTP del servidor de IA local y códigos AI_SERVER_*
│   ├── taskAi                            # auditar, generar pruebas y revisión manual
│   └── prReview                          # revisión de PR: COMMENT, una por commit, no_permission, webhook
├── middleware/                  # 1 suite
│   └── cors                              # FRONTEND_URL y ALLOW_LAN_ORIGINS
├── integration/
│   └── analytics-integration.test.js     # solo con NODE_ENV=integration-test (ver abajo)
└── db/
    ├── transaction.test.js               # withTransaction sin BD (corre con npm test)
    ├── *.dbtest.js                       # 10 suites contra SQL Server real (npm run test:db)
    │   ├── migrations                    # 001–011 arriba y abajo, triggers de porcentaje
    │   ├── transaction, tasks, groups, project, analytics, unicode
    │   ├── github                        # tablas de la Fase 3
    │   ├── cicd                          # RepoPipelines y DeployRequests (Fase 4)
    │   └── aiReview                      # AiReviews (migración 011)
    └── globalSetup.js, setupEnv.js, afterEnv.js, helpers.js
```

## Ejecutar

```bash
# Desde taskmate-api/
npm test                         # 54 suites / 1322 pruebas, sin BD
npm test -- --coverage           # con reporte de cobertura en taskmate-api/coverage/ (no está en .gitignore: no la subas)
npm test -- --watch              # modo watch (o npm run test:watch)
npm test -- UserSession          # solo los archivos que coinciden con el patrón
npm test -- tests/github         # solo una carpeta

TEST_DB_ENV_FILE="$HOME/taskmate-testdb.env" npm run test:db   # 10 suites / 117 pruebas, BD desechable
```

Las otras capas, para tenerlas a mano:

```bash
# Desde la raíz del repositorio
CI=true npm test -- --watchAll=false                   # frontend: 36 suites / 438 pruebas
(cd taskmate-api/mcp && ./venv/bin/python -m pytest)   # servicio Python del chat: 210 pruebas (requiere requirements-dev.txt)
```

## Pruebas de BD (`npm run test:db`)

- Ejecutan las migraciones arriba y abajo y escriben datos: corren **solo** contra un contenedor desechable, nunca contra `taskmate-sql` (la BD de desarrollo).
- La conexión sale únicamente de `TEST_DB_SERVER`, `TEST_DB_PORT`, `TEST_DB_NAME`, `TEST_DB_USERNAME` y `TEST_DB_PASSWORD`, más `TEST_DB_SA_PASSWORD` (o `TEST_DB_MIGRATION_USERNAME` / `TEST_DB_MIGRATION_PASSWORD`) para las migraciones. Se exportan en la terminal o van en un archivo fuera del repositorio que se pasa con `TEST_DB_ENV_FILE`. `tests/db/setupEnv.js` copia las `TEST_DB_*` sobre `DB_*` antes de que se lea la `.env`, así que el servidor, la BD y el usuario siempre son los de prueba; si falta alguna de las obligatorias, no corre nada.
- `globalSetup.js` crea las tablas base y aplica todas las migraciones pendientes (hoy 001–011, con `runner.up()`) una vez por corrida. `migrations.dbtest.js` recorre arriba y abajo hasta la última (calcula la última de forma dinámica), pero no comprueba que existan las tablas de 009–011; de esas, solo `AiReviews` tiene prueba propia (`aiReview.dbtest.js`). La app se conecta con el login de mínimo privilegio y las migraciones corren con el login de DDL, igual que en desarrollo.
- Cómo crear el contenedor, el archivo de credenciales y cómo borrarlo al terminar: [SQL Server en Docker, §6](../../documentacion/07-guias/base-de-datos-docker.md#6-bd-desechable-para-pruebas).

## Pruebas que solo corren con `NODE_ENV=integration-test`

`performance.test.js` (5 pruebas) y `integration/analytics-integration.test.js` (5 pruebas) terminan sin verificar nada si `NODE_ENV` no es `integration-test`. Cuentan como pasadas dentro de las 1322 de `npm test`, así que en la corrida normal son 10 pruebas vacías.

```bash
npm run test:performance                                        # NODE_ENV=integration-test, performance.test.js
NODE_ENV=integration-test npx jest tests/integration --runInBand  # analytics-integration (no tiene script npm)
```

Las dos usan la BD configurada en `DB_*` (la `.env`), no las `TEST_DB_*`, y la de analytics escribe datos: apunta `DB_*` a una BD desechable antes de correrlas. Las cifras que imprime `test:performance` no se registraron como mediciones del proyecto: las mejoras de la Fase 2 son estimaciones.

## Notas

- Las pruebas de `LLMService` y `llm-fallback` simulan el WebSocket hacia el servicio Python del chat; ninguna prueba llama a Groq ni a Ollama.
- Las de `aiServer/` no llaman al servidor de IA local (`127.0.0.1:8000`): `client` recibe un `fetchImpl` falso, y `taskAi` y `prReview` reciben por inyección dobles del cliente, de GitHub y de los modelos.
- Las de `deploy/` firman los cuerpos con un `VERCEL_WEBHOOK_SECRET` de prueba y simulan el modelo; no hace falta una cuenta de Vercel.
- En Python, Ollama y el servidor de IA local se simulan con `httpx.MockTransport` (salvo dos pruebas que conectan a `127.0.0.1:9`, un puerto cerrado, para simular el servicio caído), y `mcp/tests/conftest.py` fija `LLM_PROVIDER=groq`, `AI_SERVER_URL` vacío y `LLM_STREAM_CHAT=1` para que la `.env` local (la de `scripts/local-up.sh`) no se meta en las pruebas.
- Las de GitHub usan un `fetch` falso (`github/helpers/fakeGitHub.js`) o módulos simulados con `jest.mock`; no llaman a la API real de GitHub.
- El repositorio de TaskMate no tiene CI propio: estas pruebas se corren a mano. El CI/CD de la Fase 4 es una funcionalidad para el repositorio de cada grupo, no para el de TaskMate.

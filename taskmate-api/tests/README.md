# TaskMate API Tests

Pruebas del backend (Node.js, Jest 30). Hay dos configuraciones:

| Configuración | Comando (desde `taskmate-api/`) | Qué corre | Necesita BD |
|---------------|----------------------------------|-----------|-------------|
| `jest.config.js` | `npm test` | Todos los `tests/**/*.test.js`: **46 suites / 1246 pruebas** | No: modelos, GitHub y servidor de IA simulados |
| `jest.db.config.js` | `npm run test:db` | Todos los `tests/db/**/*.dbtest.js`: **9 suites / 114 pruebas** | Sí: un SQL Server **desechable** |

Resultado al 5 nov 2026, con las correcciones del cierre: 1246/1246 y 114/114 pasando. Las otras capas: frontend 423/423 (33 suites) y Python 177/177; en total 1960 pruebas (al cerrar la Fase 3 eran 1353).

## Estructura

```
tests/
├── *.test.js                    # 16 suites de servicios y modelos
│   ├── AnalyticsService, AnalyticsBatchJob, analyticsContext, analytics-api
│   ├── LLMService, llm-fallback          # WebSocket hacia el servidor de IA y su caída
│   ├── SessionManager, UserSession       # sesiones de /chat y /insights
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
├── github/                      # 19 suites: Fases 3 y 4 con un GitHub falso (helpers/fakeGitHub.js)
│   ├── githubApp, installFlow, github.controller, githubModel
│   ├── repoService, repoSnapshot, repoPlan, branchName, branchService, syncService
│   ├── webhookHandler, webhookSignature
│   └── pipelineSpec, pipelineSpec.scripts, pipelineService, pipelineAi,
│       actionsService, deployService, cicd.controller          # Fase 4: CI/CD
├── integration/
│   └── analytics-integration.test.js     # solo con NODE_ENV=integration-test (ver abajo)
└── db/
    ├── transaction.test.js               # withTransaction sin BD (corre con npm test)
    ├── *.dbtest.js                       # 9 suites contra SQL Server real (npm run test:db)
    │   ├── migrations                    # 001–008 arriba y abajo, triggers de porcentaje
    │   ├── transaction, tasks, groups, project, analytics, unicode
    │   ├── github                        # tablas de la Fase 3
    │   └── cicd                          # RepoPipelines y DeployRequests (Fase 4)
    └── globalSetup.js, setupEnv.js, afterEnv.js, helpers.js
```

## Ejecutar

```bash
# Desde taskmate-api/
npm test                         # 46 suites / 1246 pruebas, sin BD
npm test -- --coverage           # con reporte de cobertura en taskmate-api/coverage/ (no está en .gitignore: no la subas)
npm test -- --watch              # modo watch (o npm run test:watch)
npm test -- UserSession          # solo los archivos que coinciden con el patrón
npm test -- tests/github         # solo una carpeta

TEST_DB_ENV_FILE="$HOME/taskmate-testdb.env" npm run test:db   # 9 suites / 114 pruebas, BD desechable
```

Las otras capas, para tenerlas a mano:

```bash
# Desde la raíz del repositorio
CI=true npm test -- --watchAll=false                   # frontend: 32 suites / 404 pruebas
(cd taskmate-api/mcp && ./venv/bin/python -m pytest)   # servidor de IA: 177 pruebas (requiere requirements-dev.txt)
```

## Pruebas de BD (`npm run test:db`)

- Ejecutan las migraciones arriba y abajo y escriben datos: corren **solo** contra un contenedor desechable, nunca contra `taskmate-sql` (la BD de desarrollo).
- La conexión sale únicamente de `TEST_DB_SERVER`, `TEST_DB_PORT`, `TEST_DB_NAME`, `TEST_DB_USERNAME` y `TEST_DB_PASSWORD`, más `TEST_DB_SA_PASSWORD` (o `TEST_DB_MIGRATION_USERNAME` / `TEST_DB_MIGRATION_PASSWORD`) para las migraciones. Se exportan en la terminal o van en un archivo fuera del repositorio que se pasa con `TEST_DB_ENV_FILE`. `tests/db/setupEnv.js` copia las `TEST_DB_*` sobre `DB_*` antes de que se lea la `.env`, así que el servidor, la BD y el usuario siempre son los de prueba; si falta alguna de las obligatorias, no corre nada.
- `globalSetup.js` crea las tablas base y aplica 001–008 una vez por corrida. La app se conecta con el login de mínimo privilegio y las migraciones corren con el login de DDL, igual que en desarrollo.
- Cómo crear el contenedor, el archivo de credenciales y cómo borrarlo al terminar: [SQL Server en Docker, §6](../../documentacion/07-guias/base-de-datos-docker.md#6-bd-desechable-para-pruebas).

## Pruebas que solo corren con `NODE_ENV=integration-test`

`performance.test.js` (5 pruebas) y `integration/analytics-integration.test.js` (5 pruebas) terminan sin verificar nada si `NODE_ENV` no es `integration-test`. Cuentan como pasadas dentro de las 1246 de `npm test`, así que en la corrida normal son 10 pruebas vacías.

```bash
npm run test:performance                                        # NODE_ENV=integration-test, performance.test.js
NODE_ENV=integration-test npx jest tests/integration --runInBand  # analytics-integration (no tiene script npm)
```

Las dos usan la BD configurada en `DB_*` (la `.env`), no las `TEST_DB_*`, y la de analytics escribe datos: apunta `DB_*` a una BD desechable antes de correrlas. Las cifras que imprime `test:performance` no se registraron como mediciones del proyecto: las mejoras de la Fase 2 son estimaciones.

## Notas

- Las pruebas de `LLMService` y `llm-fallback` simulan el WebSocket hacia el servidor de IA; ninguna prueba llama a Groq.
- Las de GitHub usan un `fetch` falso (`github/helpers/fakeGitHub.js`) o módulos simulados con `jest.mock`; no llaman a la API real de GitHub.
- El repositorio de TaskMate no tiene CI propio: estas pruebas se corren a mano. El CI/CD de la Fase 4 es una funcionalidad para el repositorio de cada grupo, no para el de TaskMate.

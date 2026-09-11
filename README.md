# TaskMate

Plataforma colaborativa de gestión de proyectos con IA integrada. Permite a equipos crear grupos, asignar tareas, visualizar dependencias con diagramas de flujo, analizar el rendimiento del equipo, chatear con un asistente de IA y trabajar con su repositorio de GitHub sin salir de la app (explorar el repo, crear una rama por tarea, completar tareas al fusionar el PR y pedirle a la IA las siguientes tareas a partir del repositorio).

## Stack

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18, MUI v6, ReactFlow 11, react-big-calendar |
| Backend | Node.js, Express 4, tedious (SQL Server), ws 8, GitHub App (REST + webhooks) |
| AI/MCP | Python 3.9+, FastAPI, Groq (`llama-3.1-8b-instant`) |
| Base de datos | Microsoft SQL Server (Docker), migraciones versionadas en `taskmate-api/migrations/` |

## Requisitos

- Node.js 18+
- Python 3.9+
- Docker Desktop
- npm

## Inicio rápido

```bash
# 1. Clonar el repositorio
git clone <repo-url>
cd proyecto-is-cc6

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno (la plantilla documenta cada variable)
cp taskmate-api/.env.example .env   # editar con tus credenciales y secretos

# 4. Iniciar todos los servicios (Docker SQL Server + API + Python MCP)
chmod +x start.sh
./start.sh

# 5. Aplicar las migraciones de la BD (solo si tu contenedor es anterior a la Fase 3;
#    los contenedores nuevos las aplican solos al arrancar)
cd taskmate-api && npm run db:migrate   # usa MIGRATION_DB_USERNAME / MIGRATION_DB_PASSWORD

# 6. En otra terminal, iniciar el frontend
npm start
```

La app estará disponible en `http://localhost:3000`.

## Scripts

```bash
npm start                       # Frontend React (puerto 3000)
npm run start:api               # Backend Node.js (puerto 9000)
CI=true npm test -- --watchAll=false   # Tests del frontend
cd taskmate-api && npm test     # Tests del backend (sin BD)
cd taskmate-api && TEST_DB_ENV_FILE=<archivo> npm run test:db   # Tests contra un SQL Server desechable
cd taskmate-api/mcp && ./venv/bin/python -m pytest              # Tests del servidor de IA
```

Detalle de cómo levantar la BD de prueba: [docs/fase-03-integracion-github/README.md](docs/fase-03-integracion-github/README.md#cómo-reproducir--verificar).

## Estructura

```
proyecto-is-cc6/
├── src/                        # Frontend React
│   ├── components/             # Componentes UI
│   │   ├── flow/               # Diagrama de flujo (ReactFlow)
│   │   ├── hooks/              # Custom hooks
│   │   └── ui/                 # Componentes base (Button, Card, TextField)
│   ├── theme/                  # Sistema de temas MUI
│   └── context/                # GroupContext
├── taskmate-api/               # Backend
│   ├── controllers/            # Rutas y lógica HTTP
│   ├── models/                 # Queries a SQL Server
│   ├── services/               # WebSocket, LLM, Analytics, Sessions
│   ├── helpers/                # DB connection pool, execQuery
│   ├── middleware/             # Auth JWT
│   ├── mcp/                    # Servidor Python FastAPI + Agentes IA
│   ├── tests/                  # Tests Jest
│   └── server.js               # Entry point API (puerto 9000)
├── start.sh                    # Script de inicio completo
└── public/                     # Assets estáticos
```

## Variables de entorno

Crear un archivo `.env` en la raíz a partir de `taskmate-api/.env.example`. Lo mínimo:

```env
# Frontend permitido (CORS, WebSocket y redirecciones de GitHub): debe coincidir exactamente
FRONTEND_URL=http://localhost:3000

# Base de datos: la app usa un login de solo lectura/escritura; las migraciones, uno con permisos de DDL
DB_SERVER=localhost
DB_USERNAME=sqladmin
DB_PASSWORD=<password-del-login-de-la-app>
DB_NAME=taskmate-db
DB_PORT=1433
MIGRATION_DB_USERNAME=sa
MIGRATION_DB_PASSWORD=<password-de-sa>

# Auth: 32+ caracteres aleatorios (la API no arranca con valores cortos o de ejemplo)
JWT_SECRET=<openssl rand -hex 32>

# IA: el mismo secreto lo usan Node y Python (el servidor de IA rechaza conexiones sin él)
GROQ_API_KEY=<tu-api-key-de-groq>
LLM_WEBSOCKET_URL=ws://127.0.0.1:8001/ws
MCP_SHARED_SECRET=<openssl rand -hex 32>
```

Para la integración con GitHub hacen falta además las variables `GITHUB_*` (ver abajo).

## Integración con GitHub

Registrar la GitHub App, configurar los webhooks (smee.io en desarrollo) y probar el flujo completo: [docs/fase-03-integracion-github/GUIA-GITHUB-APP.md](docs/fase-03-integracion-github/GUIA-GITHUB-APP.md). Qué se construyó y cómo funciona: [docs/fase-03-integracion-github/README.md](docs/fase-03-integracion-github/README.md).

## Base de datos

Ver [db-setup.md](db-setup.md) para el contenedor Docker con SQL Server. El esquema base está en `taskmate-api/taskmate_tables.sql` y los cambios posteriores en `taskmate-api/migrations/` (se aplican con `npm run db:migrate`).

## Puertos

| Servicio | Puerto |
|---------|--------|
| Frontend React | 3000 |
| Backend Node.js API | 9000 |
| Python MCP / IA | 8001 (solo `127.0.0.1`) |
| SQL Server | 1433 |

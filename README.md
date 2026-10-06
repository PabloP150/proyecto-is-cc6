# TaskMate

Plataforma colaborativa de gestión de proyectos con IA integrada. Permite a equipos crear grupos, asignar tareas, visualizar dependencias con diagramas de flujo, analizar el rendimiento del equipo y chatear con un asistente de IA.

## Stack

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18, MUI v6, ReactFlow 11, react-big-calendar |
| Backend | Node.js, Express 4, tedious (SQL Server), ws 8 |
| AI/MCP | Python 3, FastAPI, Google Gemini 2.5 Flash |
| Base de datos | Microsoft SQL Server (Docker) |

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

# 3. Configurar variables de entorno
cp .env.example .env   # editar con tus credenciales

# 4. Iniciar todos los servicios (Docker SQL Server + API + Python MCP)
chmod +x start.sh
./start.sh

# 5. En otra terminal, iniciar el frontend
npm start
```

La app estará disponible en `http://localhost:3000`.

## Scripts

```bash
npm start          # Frontend React (puerto 3000)
npm run start:api  # Backend Node.js (puerto 9000)
npm test           # Tests del frontend
cd taskmate-api && npm test   # Tests del backend
```

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

Crear un archivo `.env` en la raíz con:

```env
# Base de datos
DB_SERVER=localhost
DB_USERNAME=sqladmin
DB_PASSWORD=yourpassword
DB_NAME=taskmate-db
DB_PORT=1433

# Auth
JWT_SECRET=your_jwt_secret

# IA
LLM_API_KEY=your_gemini_api_key
LLM_WEBSOCKET_URL=ws://localhost:8001/ws
```

## Base de datos

Ver [db-setup.md](db-setup.md) para instrucciones de configuración del contenedor Docker con SQL Server.

## Puertos

| Servicio | Puerto |
|---------|--------|
| Frontend React | 3000 |
| Backend Node.js API | 9000 |
| Python MCP / IA | 8001 |
| SQL Server | 1433 |

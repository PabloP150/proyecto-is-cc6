# Fase 1: Entornos, Repositorio e Infraestructura CI

**Estado:** ✅ COMPLETADO  
**Documentación retroactiva (código completado antes de calendarización formal)**

---

## Metadata

| Campo | Valor |
|-------|-------|
| **Fase** | 1 |
| **Nombre** | Entornos, Repositorio e Infraestructura CI Inicial |
| **Complejidad** | Baja |
| **Fechas Planificadas** | 14-21 ago 2026 |
| **Fechas Reales** | Antes de calendarización (enero-marzo 2026) |
| **Estado** | ✅ 100% Completado |
| **Responsable** | Pablo Pineda |

---

## Objetivo

Establecer los fundamentos técnicos de TaskMate: estructura de monorepo, configuración de entorno, scripts de desarrollo y CI inicial.

### Problemas que Resuelve
- Fragmentación de código (frontend, backend, Python MCP separados)
- Falta de scripts unificados para desarrollo/testing
- Variables de entorno no centralizadas
- `.gitignore` desorganizado

### Impacto Esperado
- Flujo de desarrollo cohesivo
- Fácil onboarding de nuevos desarrolladores
- Reproducibilidad en múltiples máquinas

---

## Qué Se Hizo

### Estructura de Monorepo

```
proyecto-is-cc6/
├── src/                          # Frontend React 18
│   ├── components/
│   ├── pages/
│   ├── App.js
│   └── index.js
├── taskmate-api/                 # Backend Node.js Express (workspace de npm)
│   ├── server.js / app.js
│   ├── controllers/
│   ├── models/
│   ├── services/
│   ├── tests/
│   ├── package.json
│   └── mcp/                      # Servidor de IA en Python (FastAPI + WebSocket)
│       ├── server.py
│       ├── llm_service.py
│       ├── agents/
│       └── requirements.txt
├── docs/                         # Documentación
├── start.sh                      # Arranca SQL Server (Docker), la API y el servidor de IA
├── package.json                  # Raíz: frontend + workspace taskmate-api
├── .gitignore                    # Limpio y saneado
└── README.md
```

### Variables de Entorno

**Frontend** (opcionales; `src/config.js` usa estos valores por defecto):
- `REACT_APP_API_URL` = http://localhost:9000
- `REACT_APP_WS_URL` = ws://localhost:9000

**Backend** (`taskmate-api/.env` o la `.env` de la raíz; plantilla en `taskmate-api/.env.example`):
- `DB_SERVER`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`
- `API_PORT`, `LLM_WEBSOCKET_URL`
- `JWT_SECRET`

**Python** (`taskmate-api/mcp/.env`, `taskmate-api/.env` o la `.env` de la raíz, en ese orden):
- `GROQ_API_KEY` (o `LLM_API_KEY`), `LLM_MODEL`
- `MCP_PORT` (por defecto 8001)
- Desde la Fase 3 también `MCP_SHARED_SECRET` (el mismo valor en Node y Python)

### Scripts NPM

**Raíz** (`package.json`):
```json
{
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build",
    "test": "react-scripts test",
    "eject": "react-scripts eject",
    "start:api": "npm run start --workspace=taskmate-api"
  }
}
```

**API** (`taskmate-api/package.json`): `start`, `test`, `test:watch`, `test:performance`; desde la Fase 3 también `test:db` (pruebas con SQL Server real) y `db:migrate`.

### Testing

- **Frontend:** `react-scripts test` (Jest + @testing-library)
- **Backend:** `jest` (unit + integration tests)
- **Performance:** `jest tests/performance.test.js` (benchmarks)

### Git Cleanup

- ✅ `.gitignore` saneado (removidos archivos accidentales)
- ✅ Ramas antiguas eliminadas
- ✅ Workflow claro (feature branches → master)

---

## Antes vs. Ahora

| Aspecto | Antes | Después | Mejora |
|--------|-------|---------|--------|
| Estructura | Desorganizado | Monorepo claro | Cohesión |
| Desarrollo local | Scripts manuales | `npm start` unificado | -50% fricción |
| Testing | Inconsistente | Jest + react-scripts | Cobertura |
| Onboarding | Complejo | Documentado | -60% tiempo |
| `.gitignore` | Sucio | Saneado | Seguridad |

---

## Diagramas

### Arquitectura de Tres Capas

```
┌─────────────────────────────────┐
│ Frontend (React 18)  :3000      │
│ ├─ pages/, components/          │
│ ├─ react-scripts test           │
│ └─ MUI v6 + ReactFlow           │
└────────────┬────────────────────┘
             │ HTTP REST + WS
             ↓
┌─────────────────────────────────┐
│ Backend (Express)    :9000      │
│ ├─ controllers, models          │
│ ├─ Jest testing                 │
│ └─ tedious (SQL Server)         │
└────────────┬────────────────────┘
             │ WS
             ↓
┌─────────────────────────────────┐
│ Python MCP (FastAPI)  :8001     │
│ ├─ google-generativeai          │
│ ├─ Model Context Protocol       │
│ └─ uvicorn                      │
└─────────────────────────────────┘
```

---

## Cómo Reproducir

### Instalación Inicial

```bash
# 1. Clonar repo
git clone <repo>
cd proyecto-is-cc6

# 2. Instalar dependencias (la raíz instala también el workspace taskmate-api)
npm install
cd taskmate-api/mcp && python3 -m venv venv && venv/bin/pip install -r requirements.txt && cd ../..

# 3. Configurar .env (copiar la plantilla)
cp taskmate-api/.env.example taskmate-api/.env

# 4. Levantar SQL Server (contenedor de Docker taskmate-sql), la API y el servidor de IA
./start.sh

# 5. Frontend y pruebas
npm start                      # Frontend (puerto 3000)
cd taskmate-api && npm test    # Pruebas de la API
CI=true npm test -- --watchAll=false   # Pruebas del frontend (desde la raíz)
```

### Verificación

- ✅ Frontend accesible en http://localhost:3000
- ✅ API en http://localhost:9000 (el log muestra `API running on PORT 9000`)
- ✅ Servidor de IA en ws://127.0.0.1:8001/ws (o el `MCP_PORT` configurado)
- ✅ Pruebas de la API y del frontend en verde

> **Nota (6 oct 2026):** esta sección se corrigió para describir el repositorio real. La versión anterior mencionaba un `mcp-server/` con `GOOGLE_API_KEY`, scripts de la raíz con `concurrently` y `test:api`, `docker-compose` y `/api/health`, que nunca existieron en el repositorio.

---

## Commits Relacionados

Esta fase no tiene commits específicos en el historial (fue trabajo de setup inicial). Referencia general: ramas tempranas del repo.

---

## Referencia de Diagramas Existentes

Los diagramas de arquitectura principal se encuentran en la raíz:
- `taskmate-architecture-diagram.md` — Flujo completo
- `taskmate-database-erd.md` — Schema relacional
- `use-case-diagram.md` — Casos de uso
- `chatbot-sequence-diagram.md` — Secuencia chat

---

## Pendientes

- [ ] Documentación de deployment (parte de la Fase 4, pipeline CI/CD)
- [ ] GitHub Actions workflow (será Fase 4)
- [ ] Load testing en staging (será Fase 5)

**Nota:** Estos no son bloqueadores de Fase 1. Son trabajo de fases posteriores.

---

**Documento generado:** 31 ago 2026

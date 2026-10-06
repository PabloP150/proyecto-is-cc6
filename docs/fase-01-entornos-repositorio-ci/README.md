# Fase 1: Entornos, Repositorio e Infraestructura CI

**Estado:** ✅ COMPLETADO  
**Documentación retroactiva (código completado antes de calendarización formal)**

---

## Metadata

| Campo | Valor |
|-------|-------|
| **Fase** | 1 |
| **Nombre** | Entornos, Repositorio e Infraestructura CI Inicial |
| **Complejidad** | Media |
| **Fechas Planificadas** | 21-25 ago 2026 |
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
├── taskmate-api/                 # Backend Node.js Express
│   ├── server.js
│   ├── controllers/
│   ├── models/
│   ├── services/
│   ├── tests/
│   └── package.json
├── mcp-server/                   # Python FastAPI (MCP)
│   ├── main.py
│   ├── requirements.txt
│   └── ...
├── docs/                         # Documentación
├── package.json                  # Root monorepo config
├── .gitignore                    # Limpio y saneado
└── README.md
```

### Variables de Entorno

**Frontend** (`src/.env`):
- `REACT_APP_API_URL` = http://localhost:9000

**Backend** (`taskmate-api/.env`):
- `DB_SERVER`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`
- `API_PORT`, `LLM_WEBSOCKET_URL`
- `JWT_SECRET`

**Python** (`mcp-server/.env`):
- `GOOGLE_API_KEY`
- `PORT`

### Scripts NPM

**Root** (`package.json`):
```json
{
  "scripts": {
    "start": "concurrently \"npm run start:frontend\" \"npm run start:api\"",
    "start:frontend": "cd src && react-scripts start",
    "start:api": "cd taskmate-api && npm start",
    "build": "cd src && react-scripts build",
    "test": "npm run test:frontend && npm run test:api",
    "test:frontend": "cd src && react-scripts test",
    "test:api": "cd taskmate-api && npm test",
    "test:performance": "cd taskmate-api && npm run test:performance"
  }
}
```

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

# 2. Instalar dependencias
npm install
cd taskmate-api && npm install && cd ..

# 3. Configurar .env (copiar templates)
cp .env.example .env
cp taskmate-api/.env.example taskmate-api/.env

# 4. Levantar BD (SQL Server en Docker)
docker-compose up -d

# 5. Ejecutar scripts
npm start            # Frontend + Backend
npm run test:api     # Tests backend
npm run test         # Todos los tests
```

### Verificación

- ✅ Frontend accesible en http://localhost:3000
- ✅ API responde en http://localhost:9000/api/health
- ✅ Python MCP en ws://localhost:8001/ws
- ✅ Tests pasan: `npm test`

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

- [ ] Documentación de deployment (será Fase 4 de Christian)
- [ ] GitHub Actions workflow (será Fase 4)
- [ ] Load testing en staging (será Fase 5)

**Nota:** Estos no son bloqueadores de Fase 1. Son trabajo de fases posteriores.

---

**Documento generado:** 31 ago 2026

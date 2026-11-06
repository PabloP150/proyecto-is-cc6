# Fase 1: Entornos, Repositorio e Infraestructura CI

**En una frase:** la Fase 1 dejó el monorepo de tres capas, la plantilla de variables de entorno y los scripts de desarrollo y de pruebas; se hizo en marzo de 2026, antes de la calendarización.

> **Resumen en 1 minuto**
> - **Qué agregó:** el monorepo de tres capas (frontend React en `:3000`, API Express en `:9000` y servidor de IA en Python en `MCP_PORT`, 8001 por defecto), la plantilla de variables de entorno (`taskmate-api/.env.example`), los scripts de desarrollo y de pruebas y un `.gitignore` saneado.
> - **«CI inicial»:** son los scripts de pruebas locales. El repositorio de TaskMate no tiene un workflow de CI propio; el CI/CD de la Fase 4 es para el repositorio de cada grupo.
> - **Cómo usarlo:** copiar la plantilla al `.env` de la raíz, crear el contenedor `taskmate-sql`, `./start.sh` (BD, IA y API) y `npm start` (frontend). Pasos: [Cómo reproducir](#cómo-reproducir).
> - **Estado:** ✅ completa. Hecha antes de la calendarización (setup y limpieza del repositorio el 10–12 mar 2026) y documentada el 31 ago 2026.
> - **PR:** [#2](https://github.com/PabloP150/proyecto-is-cc6/pull/2) (Fases 1 y 2), merge `7e1610f` en `master` (6 oct 2026).
> - **Pruebas:** las cifras de esta fase son las de su cierre: solo había dos capas, API y frontend, con 155 pruebas de las que 52 fallaban (las corrigió la Fase 3). Las del cierre del proyecto (1919) están en el [estado verificado](../../01-proyecto/cierre-del-proyecto.md#estado-verificado-al-3-nov-2026).
> - **Dónde está el detalle:** el resto de esta página es el anexo; limitaciones y pendientes en el [cierre del proyecto](../../01-proyecto/cierre-del-proyecto.md).

**Estado:** ✅ COMPLETADO  
**Documentación retroactiva (código completado antes de calendarización formal)**

> **Nota (estado al cierre, 3 nov 2026):** el proyecto se cerró después de la Fase 4. Esta fase está completa y sus commits llegaron a `master` con el PR #2 (merge `7e1610f`, 6 oct 2026). «CI inicial» significa aquí los scripts de prueba locales (Jest, `react-scripts test`). El repositorio de TaskMate nunca tuvo un workflow de CI alojado: no hay `.github/` en su historial. La Fase 4 construyó CI/CD como **funcionalidad del producto**, para el repositorio de cada grupo. Lo que quedó sin hacer y las limitaciones conocidas están en [cierre del proyecto](../../01-proyecto/cierre-del-proyecto.md).

---

## Metadata

| Campo | Valor |
|-------|-------|
| **Fase** | 1 |
| **Nombre** | Entornos, Repositorio e Infraestructura CI Inicial |
| **Complejidad** | Baja |
| **Fechas Planificadas** | 14-21 ago 2026 |
| **Fechas Reales** | Antes de la calendarización: setup y limpieza del repositorio el 10–12 mar 2026 ([commits](#commits-relacionados)); documentada el 31 ago 2026 |
| **Estado** | ✅ 100% Completado |
| **Responsable** | Pablo Pineda |

---

## Objetivo

Establecer los fundamentos técnicos de TaskMate: estructura de monorepo, configuración de entorno, scripts de desarrollo y CI inicial (scripts de prueba locales; ver la nota de arriba).

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
├── src/                          # Frontend React 18 (todas las páginas son componentes; no hay pages/)
│   ├── App.js                    # Rutas con React.lazy (Fase 2)
│   ├── index.js
│   ├── config.js                 # URLs de la API y del WebSocket
│   ├── components/               # Páginas y componentes (flow/, github/, realtime/, ui/, hooks/)
│   ├── api/
│   ├── hooks/
│   ├── theme/
│   ├── constants/
│   ├── utils/
│   └── __tests__/
├── taskmate-api/                 # Backend Node.js Express (workspace de npm)
│   ├── server.js / app.js
│   ├── controllers/
│   ├── models/
│   ├── services/
│   ├── helpers/                  # Pool de conexiones, transacciones (Fase 3)
│   ├── migrations/               # Migraciones versionadas (Fase 3)
│   ├── tests/                    # Jest; tests/db/ = pruebas con SQL Server real (Fase 3)
│   ├── Dockerfile                # Imagen de SQL Server (ver 07-guias/base-de-datos-docker.md)
│   ├── package.json
│   └── mcp/                      # Servidor de IA en Python (FastAPI + WebSocket, LLM vía Groq)
│       ├── server.py
│       ├── llm_service.py
│       ├── agents/
│       ├── tests/                # pytest
│       ├── requirements.txt
│       └── requirements-dev.txt
├── documentacion/                # Documentación
├── start.sh                      # Arranca SQL Server (Docker), el servidor de IA y la API
├── package.json                  # Raíz: frontend + workspace taskmate-api
├── .gitignore                    # Limpio y saneado
└── README.md
```

### Variables de Entorno

**Frontend** (opcionales; `src/config.js` usa estos valores por defecto):
- `REACT_APP_API_URL` = http://localhost:9000
- `REACT_APP_WS_URL` = ws://localhost:9000

**Backend** (plantilla completa y comentada en `taskmate-api/.env.example`):
- `DB_SERVER`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`
- `API_PORT`, `LLM_WEBSOCKET_URL` (debe usar el mismo puerto que `MCP_PORT`; `start.sh` avisa si no coincide)
- `JWT_SECRET`
- Agregadas después: `MCP_SHARED_SECRET`, `DB_PORT`, `DB_POOL_MAX`, `MIGRATION_DB_USERNAME`/`MIGRATION_DB_PASSWORD`, `GITHUB_APP_*` y `GITHUB_WEBHOOK_SECRET` (Fases 3 y 4), entre otras

Dónde se leen: `start.sh` y la API arrancada desde la raíz usan solo la `.env` de la raíz. `taskmate-api/.env` solo se carga si la API se arranca desde dentro de `taskmate-api` (`npm start` en esa carpeta).

**Python** (`taskmate-api/mcp/.env`, `taskmate-api/.env` o la `.env` de la raíz, en ese orden):
- `GROQ_API_KEY` (o `LLM_API_KEY`), `LLM_MODEL` (por defecto `openai/gpt-oss-20b`)
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
- **Backend:** `jest` (unit + integration tests, sin BD)
- **Performance:** `jest tests/performance.test.js` (`npm run test:performance`; qué mide en realidad: [Fase 2](../fase-02-optimizacion-rendimiento/README.md#-medición-real-benchmarks))
- **Python** (desde la Fase 3): `pytest` en `taskmate-api/mcp/tests` (dependencias en `requirements-dev.txt`)
- **Base de datos** (desde la Fase 3): `npm run test:db`, contra un SQL Server desechable ([guía de la BD en Docker](../../07-guias/base-de-datos-docker.md#6-bd-desechable-para-pruebas))

> **Pruebas al cierre de esta fase:** al terminar las Fases 1 y 2 solo existían las dos primeras capas (API y frontend): 155 pruebas, de las que 52 fallaban. Python y BD llegaron con la Fase 3, que dejó 1353 pasando (6 oct 2026). Al cierre del proyecto son 1919, con ESLint sin problemas y el build compilando ([estado verificado](../../01-proyecto/cierre-del-proyecto.md#estado-verificado-al-3-nov-2026)).

### Git Cleanup

- ✅ `.gitignore` saneado (removidos archivos accidentales)
- ✅ Ramas antiguas eliminadas
- ✅ Workflow claro (feature branches → master)

> **Nota (estado al cierre, 3 nov 2026):** el saneado de marzo no fue completo: `taskmate-api/node_modules` siguió versionado hasta la Fase 3, que lo sacó del índice y lo ignoró junto con `*.pem` (`9917d37`, 11 sep 2026). Al cierre quedan 4 ramas sin commits propios por delante de `master` (`feature/fase-4-cicd-github-actions`, ya fusionada, y las ramas vacías de las Fases 5, 6 y 7). Borrarlas no pierde nada; queda a decisión del responsable ([Pendientes del cierre](../../01-proyecto/cierre-del-proyecto.md#pendientes-todo)).

---

## Antes vs. Ahora

| Aspecto | Antes | Después | Mejora |
|--------|-------|---------|--------|
| Estructura | Desorganizado | Monorepo claro | Cohesión |
| Desarrollo local | Scripts manuales | `./start.sh` (SQL Server + IA + API) + `npm start` (frontend) | Menos pasos manuales (cualitativo, no medido) |
| Testing | Inconsistente | Jest + react-scripts (después también pytest y pruebas de BD) | Cobertura |
| Onboarding | Complejo | Documentado | Más fácil (cualitativo, no medido) |
| `.gitignore` | Sucio | Saneado | Seguridad |

---

## Diagramas

### Arquitectura de Tres Capas

Estado al cierre del proyecto (3 nov 2026). Los elementos marcados con la fase en que llegaron no existían al terminar la Fase 1.

```
┌─────────────────────────────────┐
│ Frontend (React 18)  :3000      │
│ ├─ src/components/              │
│ ├─ react-scripts test           │
│ └─ MUI v6 + @xyflow/react 12    │
└────────────┬────────────────────┘
             │ HTTP REST + WS
             ↓
┌─────────────────────────────────┐      ┌──────────────────────────────┐
│ Backend (Express)    :9000      │ ───→ │ SQL Server (Docker)  :1433   │
│ ├─ controllers, models, services│      │ contenedor taskmate-sql      │
│ ├─ Jest testing                 │      └──────────────────────────────┘
│ └─ tedious + pool de conexiones │ ───→  API de GitHub (GitHub App) y
└────────────┬────────────────────┘ ←───  webhooks (smee.io en desarrollo)
             │ WS (X-MCP-Secret, Fase 3)    — Fases 3 y 4
             ↓
┌─────────────────────────────────┐
│ Servidor de IA (FastAPI) :8001  │
│ ├─ uvicorn + websockets, /ws    │
│ ├─ LLM vía Groq (SDK groq)      │
│ └─ pytest (Fase 3)              │
└─────────────────────────────────┘
```

El nombre «MCP» de la carpeta `taskmate-api/mcp/` es histórico: el servidor no usa el SDK de Model Context Protocol. Gemini se retiró en marzo de 2026 (`4c7f2a6`).

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

# 3. Configurar .env en la raíz (copiar la plantilla y completarla)
cp taskmate-api/.env.example .env

# 4. Crear la imagen y el contenedor de SQL Server (solo la primera vez; ver documentacion/07-guias/base-de-datos-docker.md)
cd taskmate-api && docker build -t taskmate-sql . && cd ..
#    luego el `docker run ... --name taskmate-sql` de esa guía, sección 2.
#    El primer arranque crea la BD y aplica las migraciones. Un contenedor anterior
#    a la Fase 3 necesita además: cd taskmate-api && npm run db:migrate

# 5. Levantar SQL Server (contenedor taskmate-sql), el servidor de IA y la API
./start.sh

# 6. Frontend y pruebas
npm start                      # Frontend (puerto 3000)
cd taskmate-api && npm test    # Pruebas de la API
CI=true npm test -- --watchAll=false   # Pruebas del frontend (desde la raíz)
cd taskmate-api/mcp && venv/bin/pip install -r requirements-dev.txt && venv/bin/python -m pytest   # Pruebas de Python
```

Las pruebas de BD (`npm run test:db`) corren solo contra un contenedor aparte, nunca contra `taskmate-sql`: [guía de la BD en Docker, sección 6](../../07-guias/base-de-datos-docker.md#6-bd-desechable-para-pruebas).

### Verificación

- ✅ Frontend accesible en http://localhost:3000
- ✅ API en http://localhost:9000 (el log muestra `API running on PORT 9000`)
- ✅ Servidor de IA en ws://127.0.0.1:8001/ws (o el `MCP_PORT` configurado)
- ✅ Pruebas de la API, del frontend y de Python en verde (y las de BD, si se levantó la BD desechable)

> **Nota (6 oct 2026):** esta sección se corrigió para describir el repositorio real. La versión anterior mencionaba un `mcp-server/` con `GOOGLE_API_KEY`, scripts de la raíz con `concurrently` y `test:api`, `docker-compose` y `/api/health`, que nunca existieron en el repositorio.

> **Nota (3 nov 2026):** el paso 3 copiaba antes la plantilla a `taskmate-api/.env`, que `start.sh` no lee (la API se detenía con `FATAL: JWT_SECRET is not defined`); ahora va a la `.env` de la raíz, como en el README principal. Se agregó también la creación del contenedor de SQL Server.

---

## Commits Relacionados

Trabajo de setup y limpieza que describe esta fase (todos en `master`):

| Commit | Fecha | Qué hizo |
|--------|-------|----------|
| `0ca7b7a` | 2024-10-23 | Workspace de npm `taskmate-api` en el `package.json` de la raíz |
| `12ee245` | 2026-03-10 | LLM migrado a Groq, pool de conexiones, estabilidad del WebSocket; crea `start.sh` |
| `4c7f2a6` | 2026-03-10 | Retira las dependencias de Gemini |
| `5a9f413` | 2026-03-10 | Centraliza las URLs de la API y del WebSocket en `src/config.js` |
| `97041c5`, `3f5271c`, `5855bb3`, `ae6bb78` | 2026-03-12 | Limpieza de archivos sin uso, documentos viejos y artefactos generados |
| `24cf275`, `3172618` | 2026-03-12 | Arreglo del `.gitignore`; `venv` fuera de git |
| `2c9673e` | 2026-08-31 | Documentación de las Fases 1 y 2 |
| `8d3201b`, `fe9d87d` | 2026-10-06 | Correcciones de la documentación y del calendario |

Llegaron a `master` con el PR #2 (merge `7e1610f`, 6 oct 2026).

---

## Referencia de Diagramas Existentes

Los diagramas generales del sistema están en `documentacion/`:
- [arquitectura general](../../02-arquitectura/00-general.md) — Flujo completo
- [base de datos: visión general](../../03-base-de-datos/00-general.md) — Schema relacional
- [casos de uso](../../04-casos-de-uso/00-general.md) — Casos de uso
- [flujo del chat con IA](../../06-flujos/05-chat-ia.md) — Secuencia chat

Los diagramas de la integración con GitHub y del pipeline CI/CD están en los capítulos de la [Fase 3](../fase-03-integracion-github/README.md#diagramas) y de la [Fase 4](../fase-04-pipeline-cicd/README.md#arquitectura).

---

## Pendientes

Estado de cada pendiente **al cierre del proyecto (3 nov 2026)**:

- **Documentación de deployment** (era parte de la Fase 4): la Fase 4 la cubrió solo para el sitio del repositorio del grupo, publicado en GitHub Pages ([guía de CI/CD](../../07-guias/guia-cicd.md)). Documentar el despliegue de TaskMate mismo: **No se realizará (proyecto cerrado el 3 nov 2026)**.
- **GitHub Actions workflow** (iba a ser la Fase 4): la Fase 4 genera `.github/workflows/taskmate-ci.yml` en el repositorio del grupo, como funcionalidad del producto. Un CI propio para el repositorio de TaskMate: **No se realizará (proyecto cerrado el 3 nov 2026)**.
- **Load testing en staging** (iba a ser la Fase 5): **No se realizará (proyecto cerrado el 3 nov 2026)**.

**Nota:** ninguno bloqueaba la Fase 1. Las limitaciones conocidas y lo que quedó sin hacer se mantienen en un solo lugar: [cierre del proyecto](../../01-proyecto/cierre-del-proyecto.md).

---

**Documento generado:** 31 ago 2026  
**Última actualización:** 3 nov 2026 (cierre del proyecto)

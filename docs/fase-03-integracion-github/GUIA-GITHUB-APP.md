# Guía: registrar la GitHub App y probar la integración de TaskMate

**Fase 3 — Integración con GitHub** · Documento complementario de [README.md](README.md)

Esta guía lleva de cero a un flujo completo contra **GitHub real**: registrar la App, configurar `.env`, recibir webhooks en `localhost` con smee.io, migrar la BD de desarrollo y ejecutar el checklist E2E manual. Todo lo demás de la fase ya se verificó con GitHub simulado; este recorrido es lo único que falta para validar la integración real.

---

## Índice

1. [Antes de empezar](#1-antes-de-empezar)
2. [Crear un canal de smee.io](#2-crear-un-canal-de-smeeio)
3. [Generar los secretos](#3-generar-los-secretos)
4. [Registrar la GitHub App](#4-registrar-la-github-app)
5. [Datos de la App y llave privada](#5-datos-de-la-app-y-llave-privada)
6. [Configurar `.env`](#6-configurar-env)
7. [Migrar la BD de desarrollo](#7-migrar-la-bd-de-desarrollo)
8. [Arrancar todo](#8-arrancar-todo)
9. [Checklist E2E manual](#9-checklist-e2e-manual)
10. [Solución de problemas](#10-solución-de-problemas)
11. [Cuidado de las credenciales](#11-cuidado-de-las-credenciales)

---

## 1. Antes de empezar

- El código de la Fase 3 (rama `feature/fase-3-integracion-github`) con `npm install` hecho en la raíz y el entorno virtual de Python en `taskmate-api/mcp/venv` (`pip install -r requirements.txt`).
- Node.js 18+ (la API usa `fetch` nativo), Python 3.9+, Docker Desktop con el contenedor de desarrollo `taskmate-sql`.
- Una cuenta de GitHub y un **repositorio de prueba con al menos un commit** (en un repositorio vacío no se pueden crear ramas: `REPO_EMPTY`).
- Una API key de Groq (para el análisis con IA).
- `openssl` (viene con macOS).
- Ser **administrador** de un grupo en TaskMate (quien crea el grupo es su admin).

---

## 2. Crear un canal de smee.io

GitHub no puede llegar a `localhost`. smee.io es un proxy público: GitHub envía el webhook al canal y `smee-client`, corriendo en tu máquina, lo reenvía a la API.

1. Abre <https://smee.io> y pulsa **Start a new channel**.
2. Copia la URL del canal, por ejemplo `https://smee.io/AbCdEf123456`. La usarás como *Webhook URL* de la App y en `smee-client`.

> Cualquiera que conozca la URL del canal puede ver los eventos (nombres de repo, títulos de PR). Por eso TaskMate exige la firma HMAC en cada webhook. Usa un canal propio y solo para desarrollo.

---

## 3. Generar los secretos

```bash
openssl rand -hex 32       # GITHUB_WEBHOOK_SECRET
openssl rand -hex 32       # MCP_SHARED_SECRET   (≥ 32 caracteres aleatorios)
openssl rand -base64 48    # JWT_SECRET          (≥ 32 caracteres aleatorios)
```

- La API **no arranca** si `JWT_SECRET` tiene menos de 32 caracteres o parece de ejemplo (contiene `change-me`, `your-secret`, `secret-key`, `placeholder`, `example`, `replace-me`). El servidor de IA aplica la misma regla a `MCP_SHARED_SECRET`.
- Guárdalos en un gestor de contraseñas. Nunca en el repositorio.

---

## 4. Registrar la GitHub App

En GitHub: foto de perfil → **Settings** → **Developer settings** → **GitHub Apps** → **New GitHub App** (<https://github.com/settings/apps/new>). Si la App será de una organización: *Settings de la organización* → *Developer settings* → *GitHub Apps*.

| Campo | Valor | Por qué |
|-------|-------|---------|
| **GitHub App name** | Un nombre único en GitHub, p. ej. `TaskMate Dev <tu-usuario>` | Define el *slug* de la URL pública `https://github.com/apps/<slug>` |
| **Description** | Opcional | — |
| **Homepage URL** | `http://localhost:3000` | Campo obligatorio; no participa en el flujo |
| **Callback URL** | `http://localhost:9000/api/github/callback` | Adonde GitHub vuelve después de instalar o autorizar |
| **Expire user authorization tokens** | Dejar marcado (por defecto) | TaskMate usa el token del usuario una sola vez y lo revoca |
| **Request user authorization (OAuth) during installation** | ✅ **Marcar (obligatorio)** | Sin esto el callback no recibe `code` y TaskMate no puede comprobar que el usuario tiene acceso a la instalación; el `installation_id` de la URL por sí solo es falsificable |
| **Enable Device Flow** | Desmarcado | No se usa |
| **Setup URL** | Queda deshabilitado al marcar la opción anterior | GitHub redirige al *Callback URL* después de instalar |
| **Redirect on update** | Desmarcado | Si GitHub vuelve tras modificar una instalación desde su web, llega sin `state` y TaskMate muestra «El enlace de conexión expiró». Para conectar una App ya instalada usa **«Ya instalé la App»** en TaskMate |
| **Webhook → Active** | ✅ Marcado | — |
| **Webhook URL** | La URL de tu canal: `https://smee.io/<tu-canal>` | Paso 2 |
| **Webhook secret** | El valor de `GITHUB_WEBHOOK_SECRET` | La API verifica la firma `X-Hub-Signature-256` de cada entrega |
| **SSL verification** | Enable | smee.io usa HTTPS |

**Permisos → Repository permissions** (todo lo que no está en la tabla: *No access*):

| Permiso | Nivel | Para qué lo usa TaskMate |
|---------|-------|--------------------------|
| **Contents** | **Read and write** | Leer árbol, archivos, README y commits (funcionalidades 2 y 3) y crear la rama de cada tarea (funcionalidad 5) |
| **Metadata** | Read-only | Obligatorio para cualquier App |
| **Pull requests** | Read-only | Sincronización manual de PRs (funcionalidad 6) |
| **Issues** | Read-only | Títulos de issues abiertos para el análisis con IA (funcionalidad 2) |

*Organization permissions* y *Account permissions*: ninguno.

**Subscribe to events:** ✅ **Pull request**. Los eventos `installation` e `installation_repositories` se entregan siempre a una App con webhook; TaskMate los usa para detectar desinstalación, suspensión y repositorios agregados o quitados.

**Where can this GitHub App be installed?**
- **Only on this account**: si el repositorio de prueba está en tu cuenta personal.
- **Any account**: si la vas a instalar en una organización (p. ej. la del equipo) o en la cuenta de otra persona.

Pulsa **Create GitHub App**.

Aunque TaskMate pide a GitHub tokens de instalación con permisos **mínimos por operación** (solo lectura para explorar, `contents: write` solo al crear ramas) y **acotados al repositorio del grupo**, la App debe tener al menos los permisos de la tabla.

---

## 5. Datos de la App y llave privada

Después de crearla quedas en la pestaña **General** de la App:

| Dato | Dónde está | Variable |
|------|-----------|----------|
| App ID | Sección *About* (un número) | `GITHUB_APP_ID` |
| Client ID | Sección *About* (`Iv1.…` o `Iv23…`) | `GITHUB_APP_CLIENT_ID` |
| Client secret | **Generate a new client secret** (se muestra una sola vez) | `GITHUB_APP_CLIENT_SECRET` |
| Slug | *Public link* `https://github.com/apps/<slug>` (solo la última parte) | `GITHUB_APP_SLUG` |
| Llave privada | **Private keys → Generate a private key** (descarga un `.pem`) | `GITHUB_APP_PRIVATE_KEY` (en base64) |

Convierte la llave a base64 en una sola línea:

```bash
base64 -i ~/Downloads/<nombre-de-la-app>.<fecha>.private-key.pem | tr -d '\n'
# Linux: base64 -w0 archivo.pem
```

Pega el resultado en `GITHUB_APP_PRIVATE_KEY` y guarda el `.pem` fuera del repositorio (o bórralo: GitHub permite generar otra llave cuando quieras). `*.pem` está en `.gitignore`, pero no lo copies al proyecto. (También se acepta el PEM crudo con `\n` literales, pero base64 evita problemas de saltos de línea.)

---

## 6. Configurar `.env`

La API lee `taskmate-api/.env` y la `.env` de la raíz (gana la de `taskmate-api`); el servidor de IA lee `taskmate-api/mcp/.env`, `taskmate-api/.env` y la raíz (las variables ya exportadas en la terminal siempre ganan). Con **una sola `.env` en la raíz** ambos procesos ven los mismos valores. La plantilla completa, con comentarios, está en `taskmate-api/.env.example`.

```env
# --- API y navegador
FRONTEND_URL=http://localhost:3000

# --- Autenticación
JWT_SECRET=<openssl rand -base64 48>

# --- SQL Server
DB_SERVER=localhost
DB_PORT=1433
DB_NAME=taskmate-db
DB_USERNAME=sqladmin                     # login de la app (nunca sa)
DB_PASSWORD=<contraseña del login de la app>
# Solo para `npm run db:migrate` (puedes no guardarlas aquí y pasarlas al migrar, ver paso 7)
MIGRATION_DB_USERNAME=sa
MIGRATION_DB_PASSWORD=<SA_PASSWORD del contenedor>

# --- Servidor de IA
LLM_WEBSOCKET_URL=ws://127.0.0.1:8001/ws
MCP_SHARED_SECRET=<openssl rand -hex 32>
GROQ_API_KEY=<tu llave de Groq>
LLM_MODEL=llama-3.1-8b-instant

# --- GitHub App
GITHUB_APP_ID=<App ID>
GITHUB_APP_SLUG=<slug>
GITHUB_APP_CLIENT_ID=<Client ID>
GITHUB_APP_CLIENT_SECRET=<Client secret>
GITHUB_APP_PRIVATE_KEY=<pem en base64, una línea>
GITHUB_WEBHOOK_SECRET=<el mismo valor que en la App>
GITHUB_APP_CALLBACK_URL=
GITHUB_INSTALLATION_HOURLY_BUDGET=4000
WEBHOOK_DELIVERY_RETENTION_DAYS=90
```

| Variable | Para qué | Si falta o está mal |
|----------|----------|---------------------|
| `FRONTEND_URL` | Orígenes permitidos (CORS y *handshake* del WebSocket) y destino de la redirección del callback (`FRONTEND_URL/github`). Puede llevar varios orígenes separados por coma; el primero es el de la redirección | Por defecto `http://localhost:3000`. Si no coincide **exactamente** con el origen del navegador: errores CORS y el chat no conecta (403) |
| `JWT_SECRET` | Firma las sesiones (24 h) y el `state` del flujo de instalación | La API no arranca |
| `DB_USERNAME` / `DB_PASSWORD` | Login de la app: solo `db_datareader` + `db_datawriter` en contenedores creados con el nuevo `setup-db.sh` | La API no conecta a la BD |
| `MIGRATION_DB_USERNAME` / `MIGRATION_DB_PASSWORD` | Login con permisos de DDL para las migraciones (SA en el Docker de desarrollo) | `db:migrate` falla por permisos |
| `LLM_WEBSOCKET_URL` | Dónde escucha el servidor de IA (solo `127.0.0.1`) | El chat responde «El servicio de IA no está disponible» |
| `MCP_SHARED_SECRET` | Node lo envía en la cabecera `X-MCP-Secret`; Python rechaza (403) cualquier conexión sin él | Python no arranca si falta o es débil; con valores distintos, 403 |
| `GROQ_API_KEY`, `LLM_MODEL` | Proveedor y modelo de IA | Las llamadas de IA fallan |
| `GITHUB_APP_ID` | `iss` del JWT RS256 de la App (para `/app/*` y para pedir tokens de instalación) | `GITHUB_NOT_CONFIGURED` (503) al explorar, crear ramas, sincronizar o vincular |
| `GITHUB_APP_SLUG` | Arma la URL de instalación | 503 al pulsar «Conectar repositorio» |
| `GITHUB_APP_CLIENT_ID` | URL de autorización, canje del `code` y revocación del token del usuario | 503 al pulsar «Conectar» |
| `GITHUB_APP_CLIENT_SECRET` | Canje del `code` y revocación | El callback termina en `status=error&code=GITHUB_NOT_CONFIGURED` |
| `GITHUB_APP_PRIVATE_KEY` | Firma el JWT de la App | 503 (`GITHUB_NOT_CONFIGURED`) si falta o no es un PEM válido |
| `GITHUB_WEBHOOK_SECRET` | Verificación HMAC de los webhooks | Vacío o distinto: **todos** los webhooks responden 401 |
| `GITHUB_APP_CALLBACK_URL` | Opcional: solo si la App tiene varias *Callback URL* (debe coincidir con una) | Vacío: GitHub usa la primera |
| `GITHUB_INSTALLATION_HOURLY_BUDGET` | Solicitudes por hora que TaskMate se permite por instalación (GitHub da 5 000/h) | Por defecto 4 000 |
| `WEBHOOK_DELIVERY_RETENTION_DAYS` | Días que se conserva la bitácora de entregas (es la protección contra reenvíos); se purga una vez al día | Mínimo 30; por defecto 90 |

El frontend usa `REACT_APP_API_URL` (por defecto `http://localhost:9000`) y `REACT_APP_WS_URL` (por defecto `ws://localhost:9000`); solo hay que definirlas si cambias los puertos.

**Después de editar `.env` reinicia la API y el servidor de IA**: ambos leen las variables al arrancar.

> `JWT_SECRET` se rotó en la `.env` de desarrollo y además ahora se exige `typ: 'access'` en los tokens: después de actualizar, **todos deben iniciar sesión de nuevo**.

---

## 7. Migrar la BD de desarrollo

La API de la Fase 3 necesita las tablas y columnas de las migraciones 001–006. Los contenedores **nuevos** las aplican solos al arrancar (`setup-db.sh`); el contenedor de desarrollo `taskmate-sql` es anterior, así que hay que migrarlo una vez. (El `taskmate-sql` de Pablo ya se respaldó y migró el 11 sep 2026.)

**0. Respaldo recomendado de los triggers.** La BD de desarrollo tenía instalada a mano la versión iterativa (BFS) de los triggers de porcentaje; la migración 006 la incorpora al repositorio, así que el resultado final es el mismo. Aun así, guarda su definición antes de migrar por si tu BD tiene otra variante:

```bash
docker start taskmate-sql
read -s "SA_PW?Contraseña SA: "; echo           # zsh (en bash: read -s -p "Contraseña SA: " SA_PW; echo)
docker exec -i -e SQLCMDPASSWORD="$SA_PW" taskmate-sql /opt/mssql-tools/bin/sqlcmd \
  -S localhost -U SA -d taskmate-db -y 0 \
  -Q "SET NOCOUNT ON; SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.UpdateTargetNodePercentage')); SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.UpdateTargetOnPrerequisiteChange'));" \
  > "$HOME/triggers-antes-de-003.sql"
```

**1. Aplicar las migraciones** como SA, sin dejar la contraseña en el historial ni en `.env`:

```bash
cd taskmate-api
MIGRATION_DB_USERNAME=sa MIGRATION_DB_PASSWORD="$SA_PW" npm run db:migrate
MIGRATION_DB_USERNAME=sa MIGRATION_DB_PASSWORD="$SA_PW" node migrations/runner.js status
#   [x] 001_schema_fixes
#   [x] 002_github
#   [x] 003_triggers
#   [x] 004_repair_group_admins
#   [x] 005_unicode_membership_github
#   [x] 006_bfs_progress_triggers
unset SA_PW
```

- Cada migración corre en **una transacción** junto con su registro en `dbo.SchemaMigrations`: si algo falla, no queda nada a medias. Todas son idempotentes.
- Si 001 imprime `WARNING 001: duplicate ...`, había datos duplicados y esa restricción UNIQUE se omitió **sin borrar nada**. Corrige los datos y ejecuta `node migrations/runner.js reapply 1` (con las mismas variables).
- Revertir la última: `node migrations/runner.js down --steps 1` (la reversa de 005 es con pérdida: los caracteres fuera del *code page* vuelven a `?`).
- BD vacía: `node migrations/runner.js up --with-base` crea primero las tablas base.

---

## 8. Arrancar todo

**Opción rápida:** `./start.sh` levanta SQL Server (`taskmate-sql`), la API (`:9000`) y el servidor de IA (`127.0.0.1:8001`; avisa si falta `MCP_SHARED_SECRET` en la `.env` de la raíz). Luego, en otras terminales, `npm start` (frontend) y `smee-client`.

**Opción manual (una terminal por proceso):**

```bash
# T1 — SQL Server
docker start taskmate-sql

# T2 — API (puerto 9000)
npm run start:api

# T3 — Servidor de IA (solo local)
cd taskmate-api/mcp && source venv/bin/activate
uvicorn server:app --host 127.0.0.1 --port 8001 --ws-max-size 4194304

# T4 — Frontend (puerto 3000)
npm start

# T5 — Webhooks de GitHub hacia la API
npx smee-client -u https://smee.io/<tu-canal> -t http://localhost:9000/api/github/webhook
```

Señales de que todo está bien:
- API: `API running on PORT 9000` y `[LLMService] WebSocket connection established.`
- Servidor de IA: `Client connected`.
- smee: `Connected https://smee.io/<tu-canal>`; cada webhook aparece como `POST http://localhost:9000/api/github/webhook - 200`.

---

## 9. Checklist E2E manual

Recomendación: instala la App **desde TaskMate** («Conectar repositorio») para que el flujo lleve el `state` firmado. Si la instalas directamente en GitHub, en TaskMate usa «Ya instalé la App».

- [ ] **1. Preparación.** Los cinco procesos arriba, smee conectado y sesión iniciada de nuevo en `http://localhost:3000`.
- [ ] **2. Conectar.** En **Groups** elige un grupo del que seas admin; en **GitHub** (`/github`) pulsa **«Conectar repositorio»**. En GitHub elige tu cuenta, **Only select repositories** → el repositorio de prueba → **Install & Authorize**.
- [ ] **3. Seleccionar.** Vuelves a `/github` con la tarjeta «Conectando como @tu-login». Elige el repositorio y pulsa **«Vincular repositorio»** → aviso «Repositorio `dueño/repo` conectado correctamente.» La pestaña **Repositorio** muestra rama por defecto, cuenta de la instalación y quién lo conectó.
- [ ] **4. Permisos por rol (opcional).** Con otro usuario **miembro no admin** del grupo: ve el repositorio pero no los botones Conectar/Desconectar ni el interruptor de IA. Un usuario que no es miembro recibe 403 en cualquier ruta del grupo.
- [ ] **5. Explorar.** Pestaña **Archivos**: navega el árbol, abre un archivo y el README (renderizado). Pestaña **Commits**: aparecen los últimos commits con autor y fecha.
- [ ] **6. Permitir IA.** En **Repositorio**, activa **«Permitir análisis con IA»** y lee el aviso (qué se envía a Groq; nunca el código fuente).
- [ ] **7. Analizar.** Pulsa **«Analizar con IA»**: el chat muestra «Leyendo el repositorio en GitHub…», luego «La IA está analizando el repositorio…» y al final una tarjeta con resumen, hitos y tareas. (Alternativa: en **AI Bot**, selector **Proyecto** → tu grupo → instrucciones opcionales → enviar.)
- [ ] **8. Límite.** Pide otro análisis antes de que pase un minuto → «Espera un minuto antes de pedir otro análisis.»
- [ ] **9. Confirmar.** Pulsa **Confirmar** → «Plan guardado en «grupo»: N tareas creadas y M hitos.» En **Tasks** aparecen las tareas en listas con el nombre de cada hito (o `GitHub`); en **Milestones**, los hitos. (En otro análisis prueba **Descartar** → «Plan descartado».)
- [ ] **10. Crear rama.** En **Tasks**, en una tarea, pulsa **«Crear rama en GitHub»** → «Rama `tm/<slug>-<tid8>` lista en GitHub.» La rama existe en GitHub; recargar o pulsar de nuevo no crea otra. Clic en el chip copia `git checkout <rama>`.
- [ ] **11. Abrir PR.** En tu copia local: `git fetch origin && git checkout tm/<slug>-<tid8>`, haz un commit, `git push` y abre un PR hacia la **rama por defecto**. smee muestra el `POST … 200`. Recarga **Tasks** → la tarea muestra **«PR #N abierto»** (si es borrador, «borrador»).
- [ ] **12. Fusionar.** Haz *merge* del PR en GitHub. Recarga **Tasks** → la tarea ya no está en su lista y aparece en el filtro **Completed** con 100 %.
- [ ] **13. Reenvío sin duplicado.** En la App: **Advanced → Recent Deliveries** → la entrega `pull_request` del cierre → **Redeliver**. La respuesta es `200` con `{"status":"duplicate"}` y la tarea sigue apareciendo una sola vez en Completed.
- [ ] **14. Sincronizar.** En `/github` pulsa **«Sincronizar PRs»** → aviso con ramas revisadas, PR encontrados y actualizados. Repetir antes de 30 s → «Ya se sincronizó hace poco…».
- [ ] **15. Casos negativos.** Un PR fusionado hacia **otra** rama (no la por defecto) **no** completa la tarea. Un PR cerrado sin *merge* deja el chip «cerrado» y la tarea sigue abierta.
- [ ] **16. Desinstalar.** En GitHub: **Settings → Applications → Installed GitHub Apps** → tu App → **Configure → Uninstall**. smee muestra el evento `installation`; en `/github` el grupo aparece como **«Sin repositorio conectado»**.
- [ ] **17. Limpieza.** Detén `smee-client`. Si la App era solo de prueba, bórrala o regenera la llave privada y los secretos si se expusieron.

---

## 10. Solución de problemas

| Síntoma | Causa probable | Qué hacer |
|---------|----------------|-----------|
| La API no arranca: `FATAL: JWT_SECRET must be a random value of at least 32 characters` | `JWT_SECRET` corto o de ejemplo | `openssl rand -base64 48` y reiniciar |
| El servidor de IA no arranca: `MCP_SHARED_SECRET is not set` o `must be a random value of at least 32 characters` | Falta el secreto compartido o es débil | `openssl rand -hex 32` en la `.env` que lee Python (paso 6) |
| Log de la API: `[LLMService] The AI service rejected the connection (403); check MCP_SHARED_SECRET.` y el chat dice «El servicio de IA no está disponible» | `MCP_SHARED_SECRET` distinto entre Node y Python (o una variable exportada en la terminal pisa la `.env`) | Mismo valor en ambos procesos; reiniciar los dos. Python registra `Rejected an unauthorized WebSocket connection` |
| El chat no conecta y la consola del navegador muestra errores CORS | `FRONTEND_URL` no coincide exactamente con el origen (`http://localhost:3000` ≠ `http://127.0.0.1:3000`; sin rutas) | Corregir `FRONTEND_URL` y reiniciar la API. Los *handshakes* WebSocket de otro origen reciben 403 |
| «La integración con GitHub no está configurada» / `GITHUB_NOT_CONFIGURED` (503) | Falta alguna `GITHUB_APP_*` o la llave no es un PEM válido en base64 | Revisar paso 5 y 6; reiniciar la API |
| GitHub muestra «The redirect_uri is not associated with this application» | *Callback URL* distinta de `http://localhost:9000/api/github/callback`, o `GITHUB_APP_CALLBACK_URL` no coincide | Igualar ambas; dejar `GITHUB_APP_CALLBACK_URL` vacía si la App tiene una sola |
| `/github?status=error&code=INVALID_STATE` | El enlace duró más de 10 min, ya se usó, o **la API se reinició** a mitad del flujo (los nonces viven en memoria) | Volver a pulsar «Conectar repositorio» |
| `code=NOT_GROUP_ADMIN` | Quien volvió del callback ya no es admin del grupo | Conectar desde una cuenta admin |
| `code=ACCESS_DENIED` | Se canceló la autorización en GitHub | Repetir y aceptar |
| `code=INSTALLATION_NOT_FOUND` | Tu usuario de GitHub no tiene acceso a esa instalación | Instalar la App en una cuenta u organización donde tengas acceso |
| `code=NO_REPOSITORIES` | La instalación no tiene repositorios accesibles para ti | En GitHub, *Configure* la instalación y agrega el repositorio |
| `status=pending` | La organización exige que un propietario apruebe la instalación | Tras la aprobación, pulsar «Ya instalé la App» |
| «La selección de repositorios expiró» (`SELECTION_NOT_FOUND`) | Pasaron más de 10 min en la tarjeta de selección, ya se usó o se reinició la API | Repetir desde «Conectar repositorio» |
| La App ya estaba instalada y «Conectar» no vuelve a TaskMate | GitHub muestra la configuración de la instalación existente | Usar **«Ya instalé la App»** (autorización OAuth sin reinstalar) |
| Webhook responde **401** | `GITHUB_WEBHOOK_SECRET` vacío o distinto del *Webhook secret* de la App | Igualarlos y reiniciar la API; luego *Redeliver* |
| Webhook responde **400** | Faltan las cabeceras `X-GitHub-Event`/`X-GitHub-Delivery` o el cuerpo no es un objeto JSON (no viene de GitHub) | Enviar solo a través de la App/smee |
| Webhook responde **500** | El procesamiento falló; la entrega queda `failed` | Revisar el log de la API; *Redeliver* o «Sincronizar PRs» (GitHub no reintenta solo) |
| Webhook responde **202** | Tardó más de 8 s; se termina en segundo plano | Nada; revisar el log si no se refleja |
| No llega ningún webhook | `smee-client` apagado o con otro canal, webhook de la App inactivo, o no se suscribió **Pull request** | Revisar pasos 2, 4 y 8 |
| `REPO_NOT_ACCESSIBLE` (403) | El repositorio salió de la instalación o se cambiaron los permisos de la App y el dueño no los aceptó | Agregar el repo a la instalación / aceptar los permisos nuevos en GitHub |
| `INSTALLATION_SUSPENDED` (409) | La instalación está suspendida | Reactivarla en GitHub |
| `REPO_EMPTY` (409) al crear rama | Repositorio sin commits | Hacer un primer commit |
| `BRANCH_CONFLICT` (409) | Esa rama ya pertenece a otra tarea | Renombrar la tarea o borrar la rama huérfana |
| `GITHUB_RATE_LIMITED` (503, con `Retry-After`) | Límite de GitHub o presupuesto por instalación agotado | Esperar lo que indique `Retry-After` |
| `RATE_LIMITED` (429) | Límite por usuario (p. ej. 60 lecturas/min, sincronizar 1 cada 30 s) | Esperar |
| «El análisis con IA está desactivado…» (`AI_ANALYSIS_DISABLED`) | El admin no activó el permiso | Activar «Permitir análisis con IA» |
| «El servicio de IA está ocupado…» (`LLM_RATE_LIMIT`) | Límite de tokens por minuto del plan gratuito de Groq, u otro análisis en curso | Reintentar en unos segundos |
| «La IA tardó demasiado…» / «La IA devolvió un plan inválido» | Timeout (90 s) o salida inválida tras un reintento | Reintentar; acotar con instrucciones |
| 401 por todas partes / te saca de la sesión | Token vencido (24 h), `JWT_SECRET` rotado o token antiguo sin `typ` | Iniciar sesión de nuevo |
| `db:migrate` falla con permisos (`CREATE TABLE permission denied`…) | Se ejecutó con el login de la app | Pasar `MIGRATION_DB_USERNAME=sa` y su contraseña (paso 7) |

---

## 11. Cuidado de las credenciales

- `.env`, `taskmate-api/.env` y `*.pem` están en `.gitignore`; verifica con `git status` que no aparezcan antes de cada commit.
- Rotación: genera una llave privada nueva (GitHub admite varias; borra la vieja), un *client secret* nuevo y un *webhook secret* nuevo; actualiza `.env` y reinicia la API.
- Instala la App con **Only select repositories** y solo en los repositorios que el grupo necesita.
- smee.io es solo para desarrollo. En producción el webhook debe apuntar a un endpoint HTTPS público de la API, y `FRONTEND_URL`/*Callback URL* a los dominios reales.
- TaskMate nunca guarda tokens de GitHub en la BD: los tokens de instalación viven en memoria (1 h) y el token del usuario se revoca al terminar el callback.

---

**Documento generado:** 11 sep 2026
**Autor:** Pablo Pineda

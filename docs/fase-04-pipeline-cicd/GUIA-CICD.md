# Guía: CI/CD del repositorio desde TaskMate

**Fase 4 — Pipeline CI/CD completo** · Documento complementario de [README.md](README.md)

Esta guía es para quien usa TaskMate: **miembros** (ver ejecuciones y logs, ejecutar el CI, pedir producción) y **administradores del grupo** (configurar el pipeline, publicar, aprobar, rollback). Todo se hace en **GitHub** (barra de navegación) → pestaña **CI/CD**, sin entrar a GitHub.

---

## Índice

1. [Antes de empezar](#1-antes-de-empezar)
2. [Configurar el pipeline (admin)](#2-configurar-el-pipeline-admin)
3. [Ver las ejecuciones](#3-ver-las-ejecuciones)
4. [Ejecutar, re-ejecutar y cancelar](#4-ejecutar-re-ejecutar-y-cancelar)
5. [Ver logs y errores](#5-ver-logs-y-errores)
6. [Entornos: staging y producción](#6-entornos-staging-y-producción)
7. [Publicar en producción: solicitar, aprobar y rechazar](#7-publicar-en-producción-solicitar-aprobar-y-rechazar)
8. [Rollback de producción](#8-rollback-de-producción)
9. [Notificaciones](#9-notificaciones)
10. [Quién puede hacer qué](#10-quién-puede-hacer-qué)
11. [Solución de problemas](#11-solución-de-problemas)
12. [Límites y preguntas frecuentes](#12-límites-y-preguntas-frecuentes)

---

## 1. Antes de empezar

- **Repositorio conectado:** el grupo debe tener su repositorio de GitHub conectado (Fase 3: `/github` → «Conectar repositorio»). Sin repositorio, la pestaña **CI/CD** aparece deshabilitada.
- **Permiso de escritura para conectar:** quien conecta el repositorio debe tener permiso **push, maintain o admin** sobre él en GitHub. TaskMate solo ofrece esos repositorios; si no puedes escribir en ninguno, verás «Tu cuenta de GitHub no tiene permiso de escritura en ningún repositorio de la instalación. Solo quien puede escribir en un repositorio puede conectarlo.». El motivo: conectar le da al grupo el acceso de la App a ese repositorio (crear ramas, subir el workflow, publicar producción y hacer rollback), así que alguien con solo lectura no debe poder hacerlo.
- **Permisos de CI/CD aceptados:** la TaskMate App necesita permisos que la Fase 3 no pedía (Actions, Workflows, Pages, Deployments, Checks, Administration). Si la instalación todavía no los aceptó, TaskMate muestra «La GitHub App todavía no tiene los permisos de CI/CD en este repositorio. Quien la instaló debe aceptarlos en GitHub.» Cómo aceptarlos: [GUIA-GITHUB-APP.md](../fase-03-integracion-github/GUIA-GITHUB-APP.md#aceptar-permisos-nuevos-en-una-instalación-existente).
- **Qué tipo de proyecto:** TaskMate reconoce, hasta 2 carpetas de profundidad:
  - **Node.js con npm:** una carpeta con `package.json` (los scripts que existan: `lint`, `test`, `build`…).
  - **Python:** `requirements*.txt` o `pyproject.toml`.
  - **Sitio estático:** un `index.html` en la carpeta, o en `public/`, `docs/` o `site/`.
- **Para publicar el sitio (deploy):** solo sitios estáticos (HTML, Vite o Create React App) en **GitHub Pages**. Las APIs y los proyectos Python tienen CI (instalar, análisis estático, pruebas) pero no deploy. Con Vite, el script `build` debe terminar en un `vite build` simple ([detalle](#2-configurar-el-pipeline-admin)); un sitio estático nunca se publica desde una carpeta que contenga otro proyecto (p. ej. la raíz de un repositorio con `api/` adentro). En repositorios **privados** Pages requiere GitHub Pro, Team o Enterprise; con GitHub Free el repositorio debe ser **público**.
- **Rama principal:** TaskMate sube el pipeline con un commit directo a la rama principal. Si la rama solo acepta cambios por pull request, ver `BRANCH_PROTECTED` en [Solución de problemas](#11-solución-de-problemas).
- **Rol:** configurar el pipeline, publicar en producción, aprobar y hacer rollback es del **administrador del grupo** (quien creó el grupo, o a quien se le pasó). Los demás miembros ven todo, pueden ejecutar el CI y pueden pedir que la versión de staging pase a producción.

---

## 2. Configurar el pipeline (admin)

1. En **Groups** elige el grupo; en **GitHub** abre la pestaña **CI/CD**.
2. En la tarjeta **Pipeline de CI/CD** pulsa **«Configurar pipeline»**. TaskMate muestra «Analizando el repositorio…» y lee la rama principal.
3. Lee la propuesta y las notas en azul (por qué se eligió o se dejó fuera algo). El chip de abajo a la izquierda dice de dónde viene:
   - **«Detectado»**: «TaskMate revisó el repositorio y propone este pipeline. Ajústalo antes de subirlo.»
   - **«Propuesto por IA»**: si el grupo tiene activado «Permitir análisis con IA», la primera propuesta la hace la IA («La IA está revisando el repositorio…» y luego «La IA revisó el repositorio y propone este pipeline…», con su explicación como nota).
   - **«Guardado»**: la configuración que ya está en el repositorio (al editar).
4. **Proyecto:** si el repositorio tiene varios (p. ej. `frontend` y `api`), elige cuál construye el pipeline. Un repositorio tiene **un** pipeline de TaskMate.
5. **Build, pruebas y análisis estático:**

   | Node.js | Python | Sitio estático |
   |---------|--------|----------------|
   | **Versión de Node.js** (20, 22, 24, 26; se toma de `.nvmrc`, `.node-version` o `engines`) | **Versión de Python** (3.10–3.14; de `.python-version` o `requires-python`) | No se compila: el CI solo verifica que exista su `index.html` |
   | **Instalar dependencias:** `npm ci` (si hay `package-lock.json`) o `npm install` | **Instalar dependencias:** `pip install -r <requirements>`, `pip install .` o ninguna | |
   | **Análisis estático (lint):** un script del `package.json` o «Sin lint» | **Análisis estático con Ruff** (interruptor; los errores salen con archivo y línea) | |
   | **Auditoría de dependencias (npm audit)** (interruptor; viene activa si no hay lint) | **Pruebas con pytest** (interruptor; los fallos salen con archivo y línea) | |
   | **Pruebas** y **Build:** un script del `package.json` o ninguno | | |

   Los scripts que inician un servidor o se quedan vigilando cambios (`dev`, `start`, `preview`, `vite` sin `build`, `nodemon`, `--watch`…) aparecen **deshabilitados** con «(inicia un servidor o vigila cambios: nunca termina)»: en el CI colgarían el job.
6. **Deploy:**
   - Node.js: interruptor **«Desplegar a GitHub Pages»**, **Tipo de sitio** (Vite → `dist`, Create React App → `build`, o «Estático (rutas relativas)») y **Carpeta que se publica**. Con Vite y CRA TaskMate ajusta la ruta base sola; con «Estático» el sitio debe usar **rutas relativas**, porque se sirve bajo `/<repo>/` y `/<repo>/staging/`.
   - **Vite:** TaskMate le agrega `--base=…` al script `build`, y npm se lo pasa al **último** comando del script. Por eso el script debe terminar en un `vite build` simple, sin `--base` propio: sirven `vite build` o `tsc && vite build`; no sirven `vite build && cp …` (el `--base` le llegaría a `cp`) ni `vite build --base=/x/`. Si tu script no cumple, la propuesta no trae deploy y lo explica en una nota; elegir Vite a mano da «La configuración del pipeline no es válida para este repositorio.». Ajusta el script o usa «Estático (rutas relativas)».
   - Sitio estático: **Carpeta del sitio** (la que tiene el `index.html`). Nunca una carpeta que contenga otro proyecto Node.js o Python del repositorio: publicarla expondría ese código. Si tu `index.html` está en la raíz junto a `api/`, TaskMate propone `docs/` o `site/` si existe, o no propone el sitio y lo dice en una nota.
   - Python: no hay deploy.
7. **Etapas:** la lista se actualiza con cada cambio (TaskMate valida y regenera en el servidor). **«Ver el archivo YAML»** muestra exactamente lo que se subirá.
8. **«Proponer con IA»** (aparece si el grupo tiene activado «Permitir análisis con IA» en la pestaña Repositorio; si no, el diálogo dice «Activa «Permitir análisis con IA» en la pestaña Repositorio para que la IA proponga el pipeline.»): pide una propuesta nueva a la IA para el proyecto elegido. Se envía a Groq la lista de proyectos y scripts del repositorio, **nunca el código fuente**. La IA solo elige entre las opciones que TaskMate detectó (y conoce las reglas de Vite y de los sitios estáticos de arriba); TaskMate valida su respuesta como cualquier otra; si no sirve, tarda o la IA no está disponible, verás la propuesta detectada con «No se pudo usar la IA (…); esta es la propuesta de la detección automática.». Se ajusta igual que cualquier propuesta.
9. Lee el aviso: «Al subirlo, TaskMate hará un commit en **main** con `.github/workflows/taskmate-ci.yml` y activará GitHub Pages para que publique desde GitHub Actions.»
10. Pulsa **«Subir al repositorio»**. Verás «Pipeline subido al repositorio. GitHub lo ejecutará en unos segundos.», el enlace **«Ver commit»** y la URL del sitio de GitHub Pages. Cierra el diálogo: en **Ejecuciones** aparece la primera corrida.

Después, la tarjeta muestra el tipo de proyecto, las etapas, «Configurado por *usuario* · *fecha*», el enlace al archivo del workflow y el sitio. Para cambiar algo: **«Editar pipeline»** (el chip **«Guardado»** indica que estás viendo la configuración actual; **«Detectado»** o **«Propuesto por IA»**, una propuesta nueva) y vuelve a subir. Si la configuración es la misma, TaskMate no hace otro commit («El pipeline ya estaba en el repositorio con esta misma configuración.»).

**Avisos de la tarjeta sobre el workflow:**
- «El workflow del repositorio es de una versión anterior de TaskMate y no tiene las últimas mejoras (deploys en cola, sin reconstruir el otro entorno).»: el archivo lo escribió una plantilla anterior (la línea `# taskmate-pipeline: 1`). El admin pulsa **«Editar pipeline» → «Subir al repositorio»** (la configuración guardada sirve tal cual) y TaskMate lo reemplaza por la plantilla actual (`# taskmate-pipeline: 2`).
- «El workflow de TaskMate ya no está en el repositorio, así que el pipeline no corre.»: alguien lo borró en GitHub. El admin lo vuelve a subir igual.

> - Si el repositorio ya publicaba GitHub Pages **desde una rama** (p. ej. `gh-pages`), al subir un pipeline con deploy TaskMate cambia la fuente a **GitHub Actions**: desde entonces el sitio lo publica el pipeline.
> - Si alguien edita el workflow a mano en GitHub, funciona, pero TaskMate lo reemplaza la próxima vez que un admin suba el pipeline.

---

## 3. Ver las ejecuciones

En **Ejecuciones** están todas las ejecuciones de GitHub Actions del repositorio (las del pipeline de TaskMate y las de otros workflows), de la más nueva a la más vieja.

- **Cada fila:** estado (✔ exitoso, ✖ falló, reloj en cola, círculo girando en curso, cancelado), título (mensaje del commit o «Deploy a producción desde TaskMate»), workflow y número, evento (**Push**, **Pull request**, **Manual**…), rama, commit, quién la lanzó, hace cuánto y duración.
- **Filtros:** **Workflow** y **Estado** (En curso, En cola, Exitosos, Fallidos, Cancelados). **«Ver más»** carga las siguientes 20. El botón ↻ actualiza.
- **Expandir una fila:** enlace **«Ver la ejecución en GitHub»**, controles ([sección 4](#4-ejecutar-re-ejecutar-y-cancelar)) y los **jobs** con sus pasos y duraciones. El CI se llama «CI (Node.js)», «CI (Python)» o «CI (sitio estático)»; un deploy tiene además «Build del deploy» (construye la versión) y «Deploy a GitHub Pages» (la publica), y «Cerrar el deploy» solo aparece si algo falló o se canceló.
- **En vivo:** la lista y el detalle se actualizan solos cuando GitHub avisa. Mientras algo corre, además se revisan cada minuto por si se perdió un aviso (cada 10–15 s si se perdió la conexión en vivo), solo con la pestaña del navegador visible. Al reconectarse, la pantalla se recarga una vez para ponerse al día.

Qué dispara el CI de TaskMate: **cada push a cualquier rama**, **cada pull request** y **«Ejecutar pipeline»**. El deploy a staging solo ocurre con un push a la rama principal que pasa el CI. Las ejecuciones que pueden desplegar (push a la rama principal y deploys desde TaskMate) **esperan su turno en orden**: un push a la rama principal puede aparecer «En cola» mientras termina el deploy anterior. Ninguna se descarta.

---

## 4. Ejecutar, re-ejecutar y cancelar

| Acción | Dónde | Cuándo aparece | Qué hace |
|--------|-------|----------------|----------|
| **Ejecutar pipeline** | Botón junto a los filtros | El repositorio tiene pipeline de TaskMate | Pide la **Rama** (por defecto la principal) y corre solo el CI: instalar, análisis estático, pruebas y build. **No despliega.** Confirma con «Listo: el pipeline se ejecutará en «*rama*» en unos segundos.» |
| **Re-ejecutar fallidos** | Fila expandida | La ejecución terminó en fallo, cancelada o por tiempo | Vuelve a correr **solo los jobs que fallaron** (GitHub lo permite hasta un mes después) |
| **Cancelar** | Fila expandida | La ejecución está en cola o en curso | Pide a GitHub detenerla. También detiene un deploy en curso; su registro queda como fallido |

- Las ejecuciones de **deploy** que lanzó TaskMate («Deploy a staging/production desde TaskMate») solo las re-ejecuta o cancela el **admin**; un miembro ve «Solo el administrador del grupo puede re-ejecutar o cancelar un deploy.» (re-ejecutar un deploy viejo de producción sería un rollback).
- **Re-ejecutar nunca publica una versión vieja:** si re-ejecutas un push de la rama principal que ya no es el último commit, el CI corre pero no se despliega nada (la ejecución lo anota: «No se despliega abc1234: ya no es la última versión de main.»). Si en un push solo falló «Deploy a GitHub Pages», «Re-ejecutar fallidos» no lo vuelve a publicar: el job falla con «No se vuelve a ejecutar solo el deploy: publicaría el sitio que armó el intento 1 de esta ejecución, que puede estar desactualizado…». Para staging, haz un push nuevo (o re-ejecuta todos los jobs en GitHub); para producción, el admin publica de nuevo desde TaskMate.
- «Ejecutar pipeline» en una rama que no tiene el workflow actual (creada **antes** de subir el pipeline, o antes de su última actualización) falla con «Esa rama no tiene el workflow actual de TaskMate: actualízala con la rama principal (merge o rebase) y vuelve a intentarlo.».
- Si alguien desactivó el workflow en GitHub (pestaña **Actions** → el workflow → **Disable workflow**), verás «El workflow de TaskMate está desactivado en GitHub. Actívalo en la pestaña Actions del repositorio y vuelve a intentarlo.».
- Un nombre de rama que parece un commit (p. ej. `deadbeef` o `20261022`) funciona; lo que no funciona es escribir un SHA: «Esa rama no existe en el repositorio.».
- Límite: 10 de estas acciones por minuto por usuario (gastan minutos de GitHub Actions del repositorio). Si quien limita es GitHub, el mensaje es «Se alcanzó el límite de uso de la API de GitHub. Inténtalo más tarde.».

---

## 5. Ver logs y errores

En la fila expandida, cada job muestra sus pasos. Además:

- **Errores con archivo y línea:** si el job falló, debajo de los pasos aparecen sus anotaciones: **Error**, **Advertencia** o **Aviso**, con `archivo:línea` y el mensaje. Las producen ESLint, Ruff, pytest y Vitest. Las pruebas de Jest (Create React App) no generan anotaciones: su fallo se lee en el log.
- Si las anotaciones no se pueden cargar, lo verás escrito («No se pudieron cargar los errores y advertencias: …», p. ej. porque faltan los permisos de CI/CD), para no confundirlo con un job sin errores.
- **«Ver log»** (en jobs terminados): muestra el **final** del log, que es donde suele estar el fallo.
  - Los grupos de GitHub aparecen como encabezados (▸), los errores en rojo (✖) y las advertencias en amarillo (⚠).
  - **«Solo errores»** deja solo las líneas con errores, fallos y advertencias.
  - Se desplaza solo hasta el final; el botón ↻ lo vuelve a cargar.
  - «Se muestra el final del log.» indica que el log era largo y se recortó (TaskMate pide a GitHub solo los últimos 256 KB). Para verlo completo: ícono **«Ver el job en GitHub»**.
- Los secretos que pudieran aparecer en el log se muestran redactados como `[REDACTED]`: también una llave privada impresa en varias líneas (se vuelve una sola línea) y las credenciales de una cabecera `Authorization`.
- «El log todavía no está disponible (el job sigue corriendo) o ya expiró.»: espera a que el job termine; GitHub borra los logs después de su periodo de retención (90 días por defecto).

---

## 6. Entornos: staging y producción

La tarjeta **Entornos** aparece cuando el pipeline tiene deploy. Ambos entornos viven en el **mismo sitio de GitHub Pages**:

| Entorno | URL | Cómo se actualiza |
|---------|-----|-------------------|
| **Staging** | `https://<dueño>.github.io/<repo>/staging/` | **Solo**, con cada push a la rama principal que pasa el CI (en uno o dos minutos; más si espera detrás de otro deploy). Si llegan varios pushes seguidos, los que ya no son el último commit cuando les toca se saltan |
| **Producción** | `https://<dueño>.github.io/<repo>/` | Cuando un admin publica o aprueba una solicitud, o hace rollback |

Cada tarjeta muestra:
- **Estado:** «En línea», «Desplegando…», «Falló el último deploy» (con enlace **«ver ejecución»**) o «Sin versión». Un deploy que lleva más de una hora sin terminar (se perdió el *runner* o se canceló antes de registrarse) se muestra como fallido.
- **Versión publicada:** el commit (enlace a GitHub), hace cuánto y «Automático al pasar el CI en la rama principal» o «Pedido por *usuario*».
- **URL del sitio.**

Mientras producción no tenga versión, la raíz del sitio muestra «Producción todavía no tiene una versión publicada desde TaskMate.» con un enlace a staging.

**«Historial de deploys»** lista los últimos 15 con entorno, commit, estado (**Publicado**, **Reemplazado**, **Desplegando**, **En cola**, **Falló**), quién lo pidió (o «automático») y enlace a la ejecución. Staging y producción se leen por separado, así que muchos deploys de staging seguidos ya no esconden producción.

> Cada deploy **construye solo la versión que publica** y conserva el otro entorno **tal como está publicado** (GitHub guarda el sitio publicado 90 días). Si ese sitio ya no se puede descargar (p. ej. después de 90 días sin deploys), TaskMate reconstruye el otro entorno desde su versión vigente; si eso también falla, deja en ese entorno una página provisional («TaskMate no pudo reconstruir la versión publicada de producción. Vuelve a desplegarla desde TaskMate.») hasta su próximo deploy. En ningún caso falla el deploy que pediste.

---

## 7. Publicar en producción: solicitar, aprobar y rechazar

En la tarjeta **Staging**, debajo de la versión publicada:

**Si eres admin — publicar directo**
1. **«Publicar en producción»** → el diálogo explica qué versión se publicará → **«Publicar»**.
2. Aviso «Se está publicando `abc1234` en producción.»; en uno o dos minutos llega «Producción se actualizó con `abc1234`.». Mientras tanto la tarjeta sigue revisando hasta que el deploy aparece, aunque espere en cola.

**Si eres miembro — pedirlo**
1. **«Solicitar producción»** → **«Enviar solicitud»** → «Solicitud enviada a los administradores del grupo.»
2. Lo que se pide es siempre **la versión que está en staging**: un miembro no puede pedir otra versión ni otro entorno («Solo se puede pedir publicar en producción la versión que está en staging.»).
3. Solo puede haber **una solicitud pendiente por entorno** en el grupo; mientras exista, verás «Hay una solicitud de producción pendiente.».
4. Mientras siga pendiente puedes retirarla con **«Cancelar solicitud»**.
5. Te llega un aviso cuando un admin la responde (aprobada, o rechazada con su motivo).

En ambos casos el diálogo usa la versión de staging que se mostraba **al abrirlo**. Si staging cambia mientras está abierto, lo avisa: «Staging cambió a `def5678` mientras este diálogo estaba abierto. Esta acción usa `abc1234`; para usar la nueva versión, cancela y vuelve a abrir.».

**Si eres admin — responder solicitudes**
1. Te llega «*usuario* pide publicar `abc1234` en producción.» (**«Ver»** abre la pestaña CI/CD del grupo).
2. En **Solicitudes de producción**:
   - **«Aprobar»** → diálogo **«Aprobar y publicar»** → **«Aprobar»**. TaskMate lanza el deploy de inmediato, con el nombre de quien lo pidió.
   - **«Rechazar»** → **Motivo (opcional)**, hasta 500 caracteres → **«Rechazar»**.
3. Si otro admin ya respondió, verás «Otro administrador ya respondió esa solicitud.».
4. Si desde que se pidió **staging cambió de versión** o el grupo **cambió de repositorio**, la solicitud ya no aplica: TaskMate la cancela, quien la pidió recibe la razón («La versión de staging cambió; pide de nuevo.» o «El grupo cambió de repositorio.») y tú ves «La solicitud quedó desactualizada (cambió la versión de staging o el repositorio) y se canceló; pide de nuevo.».
5. Si GitHub no acepta el deploy, se muestra el error y la solicitud **vuelve a pendiente**; si eso ya no es posible, se cancela con la nota «No se pudo iniciar el deploy en GitHub; pide de nuevo.». Una solicitud nunca queda «Aprobada» sin un deploy.

Reglas:
- Solo se publican versiones **verificadas**: las que TaskMate ya publicó antes, o commits de la **rama principal** cuyo CI de TaskMate («CI (…)») pasó. Un deploy lanzado desde TaskMate no cuenta como CI, y un commit que solo está en otra rama o en un *fork* no se puede publicar. Si no: «Ese commit no pasó el CI de TaskMate, así que no se puede desplegar.».
- Si staging y producción ya tienen la misma versión, en lugar del botón verás «Producción ya tiene esta versión.».
- Las solicitudes son del repositorio actual del grupo: al conectar otro repositorio (o desconectarlo), las pendientes del anterior se borran; las ya respondidas no se muestran.

---

## 8. Rollback de producción

Solo el **admin**, en la tarjeta **Producción**:

1. **«Rollback…»** (aparece cuando hay versiones anteriores de producción).
2. Elige la versión (commit, fecha y quién la pidió): hasta las 10 anteriores, sin repetir y sin la actual.
3. **«Volver a esta versión»** → «Producción vuelve a `abc1234`.»

Staging no cambia: se conserva tal como está publicada. Para salir del rollback, publica de nuevo desde staging o haz otro rollback.

---

## 9. Notificaciones

Llegan en cualquier pantalla de TaskMate (abajo a la derecha), con el nombre del grupo entre corchetes. **«Ver»** selecciona ese grupo y abre su pestaña CI/CD; **«Abrir sitio»** (en deploys exitosos) abre el entorno publicado.

| Qué pasó | Quién lo ve | Mensaje |
|----------|-------------|---------|
| Una ejecución del repositorio falló (fallo, tiempo agotado o error al arrancar) | Todos los miembros | «[Grupo] Falló «*título*» en *rama*.» |
| Un deploy terminó bien | Todos los miembros | «[Grupo] Staging se actualizó con `abc1234`.» / «Producción se actualizó con…» |
| Un deploy falló | Todos los miembros | «[Grupo] Falló el deploy de `abc1234` a producción.» (un solo aviso: no llega además el de su ejecución) |
| Se canceló un deploy antes de publicar | Los admins | «[Grupo] Se canceló «Deploy a producción desde TaskMate» antes de publicar.» |
| Un miembro pidió producción | Los admins (no quien la pidió) | «[Grupo] *usuario* pide publicar `abc1234` en producción.» |
| Un admin aprobó tu solicitud | Quien la pidió | «[Grupo] *admin* aprobó tu solicitud: `abc1234` se está publicando en producción.» |
| Un admin rechazó tu solicitud | Quien la pidió | «[Grupo] *admin* rechazó tu solicitud de `abc1234`. Motivo: …» |

- Solo llegan avisos de los grupos de los que eres miembro y mientras tengas TaskMate abierto con sesión iniciada, en cualquier pantalla (también justo después de recargar la página). No se guardan: lo que pasó mientras estabas fuera está en la pestaña CI/CD (ejecuciones, entornos, historial y solicitudes).
- Si se corta la conexión, TaskMate se reconecta solo (de inmediato al volver a la pestaña o a internet) y recarga lo que estés viendo; un fallo momentáneo del servidor no te quita los avisos.
- Si te sacan de un grupo, dejas de recibir sus avisos en unos minutos.
- Con más de 10 pestañas de TaskMate abiertas, la más vieja deja de recibir avisos en vivo hasta que vuelves a ella (mientras tanto, sus pantallas de CI/CD se actualizan consultando a GitHub).

---

## 10. Quién puede hacer qué

| Acción | Miembro | Admin del grupo |
|--------|:-------:|:---------------:|
| Conectar el repositorio del grupo | — | ✅ (con permiso de escritura en el repositorio de GitHub) |
| Ver pipeline, ejecuciones, jobs, logs, anotaciones, entornos, historial y solicitudes | ✅ | ✅ |
| Recibir notificaciones del grupo | ✅ | ✅ (más las solicitudes de producción y los deploys cancelados) |
| Configurar o editar el pipeline (también «Proponer con IA») | — | ✅ |
| Ejecutar el CI en una rama | ✅ | ✅ |
| Re-ejecutar fallidos / cancelar una ejecución de CI | ✅ | ✅ |
| Re-ejecutar / cancelar una ejecución de **deploy** | — | ✅ |
| Publicar en producción directamente | — | ✅ |
| Solicitar producción | ✅ (solo la versión que está en staging) | (no lo necesita: publica directo) |
| Aprobar o rechazar solicitudes | — | ✅ |
| Cancelar una solicitud | Solo la propia | Solo la propia |
| Rollback de producción | — | ✅ |

> La aprobación controla lo que se hace **desde TaskMate**. Quien tenga permiso de escritura en el repositorio de GitHub puede lanzar el workflow o editarlo desde GitHub; si el grupo quiere cerrar eso, puede agregar reglas de protección al entorno `github-pages` o a la rama principal en GitHub. Como conectar el repositorio exige ese mismo permiso de escritura, TaskMate no le da a nadie más poder del que ya tiene en GitHub.

---

## 11. Solución de problemas

| Mensaje en TaskMate (código) | Causa | Qué hacer |
|------------------------------|-------|-----------|
| «La GitHub App todavía no tiene los permisos de CI/CD en este repositorio. Quien la instaló debe aceptarlos en GitHub.» (`APP_PERMISSIONS_MISSING`) — también «TaskMate no puede leer GitHub Pages porque la App todavía no tiene los permisos de CI/CD aceptados.» | La instalación de la App no aceptó los permisos nuevos de la Fase 4 (o la App no los tiene registrados) | Quien instaló la App: GitHub → **Settings → Applications → Installed GitHub Apps** → la App → **Configure** → **Review request** → **Accept new permissions** (en una organización, desde la configuración de la organización). Si no hay solicitud pendiente, el dueño de la App debe agregar los permisos ([GUIA-GITHUB-APP.md](../fase-03-integracion-github/GUIA-GITHUB-APP.md#aceptar-permisos-nuevos-en-una-instalación-existente)) |
| «Tu cuenta de GitHub no tiene permiso de escritura en ningún repositorio de la instalación. Solo quien puede escribir en un repositorio puede conectarlo.» (`NO_WRITABLE_REPOSITORIES`, al volver de GitHub) | Tu usuario de GitHub solo tiene lectura (o *triage*) en los repositorios de la instalación | Que conecte el repositorio alguien con permiso push, maintain o admin, o pedir ese permiso al dueño del repositorio. Si tienes escritura en algunos y no en otros, solo verás los primeros en la selección |
| «GitHub Pages no está disponible para este repositorio con su plan actual (en repositorios privados requiere GitHub Pro).» (`PAGES_UNAVAILABLE`) | Repositorio **privado** en una cuenta u organización con GitHub Free | Hacer el repositorio público, usar un plan de pago, o configurar el pipeline **sin** «Desplegar a GitHub Pages» (solo CI) |
| «La rama principal está protegida y solo acepta cambios por pull request, así que TaskMate no puede subir el pipeline.» (`BRANCH_PROTECTED`) | Regla de protección o *ruleset* de la rama principal | Un admin del repositorio en GitHub agrega la TaskMate App a la lista de excepciones (*bypass list* del ruleset, o «Allow specified actors to bypass required pull requests» en la protección clásica), o desactiva la regla, sube el pipeline y la vuelve a activar |
| «Ya existe un workflow .github/workflows/taskmate-ci.yml que no creó TaskMate. Renómbralo o bórralo para continuar.» (`WORKFLOW_CONFLICT`) | Hay un archivo con ese nombre sin la marca `# taskmate-pipeline` (o es una carpeta) | Renombrar o borrar ese archivo en GitHub y volver a subir. TaskMate nunca reemplaza un archivo que no escribió |
| «El workflow cambió en GitHub mientras lo configurabas. Vuelve a intentarlo.» (`WORKFLOW_CHANGED`) | Alguien modificó el archivo al mismo tiempo | Pulsar «Subir al repositorio» de nuevo |
| «El workflow del repositorio es de una versión anterior de TaskMate…» (aviso en la tarjeta) | El workflow lo escribió una plantilla anterior: sin cola de deploys, «Cancelar» no detiene un deploy y cada deploy reconstruye los dos entornos | El admin: «Editar pipeline» → «Subir al repositorio» |
| «El workflow de TaskMate ya no está en el repositorio, así que el pipeline no corre.» (aviso en la tarjeta) | Alguien borró `.github/workflows/taskmate-ci.yml` en GitHub | El admin lo vuelve a subir |
| «Ese commit no pasó el CI de TaskMate, así que no se puede desplegar.» (`VERSION_NOT_VERIFIED`) | La versión no está en la rama principal, o su job «CI (…)» no terminó en verde (falló, sigue corriendo, se canceló, o el commit es anterior al pipeline) | Esperar a que el CI termine en verde; si falló, corregir y hacer push; si el commit está en otra rama, fusionarlo a la principal; un commit anterior al pipeline no se puede publicar: hacer un commit nuevo |
| «Solo se puede pedir publicar en producción la versión que está en staging.» (`VERSION_NOT_STAGING`) | Staging cambió mientras tenías abierto el diálogo, o se intentó pedir otra versión | La pestaña se recarga sola: vuelve a pulsar «Solicitar producción» con la versión actual de staging |
| «La solicitud quedó desactualizada (cambió la versión de staging o el repositorio) y se canceló; pide de nuevo.» (`DEPLOY_REQUEST_STALE`) | Al aprobar, la versión de la solicitud ya no era la de staging, o el grupo había cambiado de repositorio | Quien la pidió vuelve a solicitar producción con la versión actual (o el admin publica directo) |
| «El workflow de esa rama es anterior y no se puede ejecutar desde TaskMate; vuelve a subir el pipeline.» (`PIPELINE_OUTDATED`) | Al publicar o aprobar: el workflow de la rama principal no acepta las entradas de deploy | El admin vuelve a subir el pipeline («Editar pipeline» → «Subir al repositorio») |
| «Esa rama no tiene el workflow actual de TaskMate: actualízala con la rama principal (merge o rebase) y vuelve a intentarlo.» (`BRANCH_WORKFLOW_OUTDATED`) | «Ejecutar pipeline» en una rama sin el workflow de TaskMate o con uno anterior | Actualizar la rama con la principal (merge o rebase) y volver a ejecutar |
| «El workflow de TaskMate está desactivado en GitHub. Actívalo en la pestaña Actions del repositorio y vuelve a intentarlo.» (`WORKFLOW_DISABLED`) | Alguien desactivó el workflow en GitHub | GitHub → repositorio → **Actions** → «TaskMate CI/CD» → **Enable workflow** |
| «El log todavía no está disponible (el job sigue corriendo) o ya expiró.» (`LOG_NOT_AVAILABLE`) | El job no terminó, o GitHub ya borró su log | Esperar a que termine; para logs viejos, ver la ejecución en GitHub mientras exista |
| «No se pudieron cargar los errores y advertencias: …» (en un job) | TaskMate no pudo leer las anotaciones (p. ej. faltan los permisos de CI/CD o GitHub falló) | Revisar el log del job; si el motivo son los permisos, aceptarlos (primera fila) |
| «Este repositorio todavía no tiene un pipeline de TaskMate.» (`PIPELINE_NOT_CONFIGURED`) | No se ha subido el pipeline (o se borró el workflow en GitHub) | El admin lo configura ([sección 2](#2-configurar-el-pipeline-admin)) |
| «No se encontró un proyecto de Node.js, Python ni un sitio estático en el repositorio.» (`PIPELINE_UNSUPPORTED`) | No hay `package.json`, `requirements*.txt`/`pyproject.toml` ni `index.html` a 2 niveles o menos | Agregar el proyecto (o moverlo a una carpeta de 1–2 niveles) |
| «El análisis con IA está desactivado para este repositorio…» (`AI_ANALYSIS_DISABLED`) al pedir «Proponer con IA» | El admin desactivó el permiso de IA mientras el diálogo estaba abierto | Activar «Permitir análisis con IA» en la pestaña Repositorio, o usar la propuesta detectada |
| Aviso «No se pudo usar la IA (…); esta es la propuesta de la detección automática.» | La IA tardó, alcanzó su límite de uso, no está disponible o propuso algo que no coincide con el repositorio | Usar la propuesta detectada (es válida) o reintentar «Proponer con IA» en unos minutos |
| «La configuración del pipeline no es válida para este repositorio.» (`INVALID_PIPELINE`) | Un script ya no existe, la carpeta de publicación no es válida o contiene otro proyecto, `npm ci` sin `package-lock.json`, Vite con un `build` que no termina en `vite build`… | Pulsar «Editar pipeline» para recibir una propuesta nueva y revisar los campos ([sección 2, paso 6](#2-configurar-el-pipeline-admin)) |
| La propuesta no trae deploy y la nota dice «El script «build» no termina en «vite build» (o ya fija --base)…» | TaskMate no puede pasarle la ruta base a Vite | Dejar el script terminando en `vite build` (mover lo demás antes, o a otro script), o usar «Estático (rutas relativas)» |
| «El pipeline de este repositorio no tiene deploy.» (`DEPLOY_NOT_CONFIGURED`) | El pipeline se configuró sin «Desplegar a GitHub Pages» | Activar el deploy en «Editar pipeline» (si el proyecto es un sitio estático) |
| «Ya hay una solicitud pendiente para ese entorno.» (`DEPLOY_REQUEST_PENDING`) | Una por grupo y entorno | Esperar la respuesta o que quien la pidió la cancele |
| «Otro administrador ya respondió esa solicitud.» (`DEPLOY_REQUEST_DECIDED`) / «La solicitud ya no existe.» (`DEPLOY_REQUEST_NOT_FOUND`) | Otro admin se adelantó, o la solicitud se borró (con el grupo, o al cambiar de repositorio) | La pestaña se recarga sola |
| «Solo quien pidió el deploy puede cancelar la solicitud.» (`NOT_REQUESTER`) | Intentaste cancelar la de otra persona | Un admin puede rechazarla |
| «Solo el administrador del grupo puede hacer esto.» (`NOT_GROUP_ADMIN`) | Acción de admin (configurar, publicar, aprobar, rollback, controlar un deploy) | Pedírsela al admin |
| «Solo se pueden re-ejecutar ejecuciones terminadas con jobs fallidos (y de menos de un mes).» (`RUN_NOT_RERUNNABLE`) | La ejecución fue exitosa, sigue corriendo o es muy vieja | «Ejecutar pipeline» en la rama |
| «La ejecución ya terminó.» (`RUN_NOT_CANCELLABLE`) | Terminó antes de cancelarla | Nada |
| «Esa rama no existe en el repositorio.» (`BRANCH_NOT_FOUND`) | Nombre de rama mal escrito, rama borrada, o se escribió un SHA | Revisar el nombre (distingue mayúsculas) |
| «Demasiadas solicitudes…» (`RATE_LIMITED`) / «Se alcanzó el límite de uso de la API de GitHub…» (`GITHUB_RATE_LIMITED`) | 10 acciones por minuto por usuario / límite de GitHub o presupuesto de la instalación (también al re-ejecutar o cancelar) | Esperar un momento |
| Nada se actualiza solo (ejecuciones, entornos, avisos) | Los webhooks no llegan: la App no está suscrita a **Workflow run**, **Workflow job** y **Deployment status**, o (en desarrollo) `smee-client` no corre | Revisar la suscripción de eventos ([GUIA-GITHUB-APP.md](../fase-03-integracion-github/GUIA-GITHUB-APP.md#4-registrar-la-github-app)) y smee; mientras tanto, las pantallas se revisan solas cada minuto mientras algo corre y el botón ↻ actualiza |
| Staging no se actualizó tras un push | El push no fue a la rama principal, el CI falló, el deploy falló, ya llegó un push más nuevo (solo se publica el último; la ejecución lo anota con «No se despliega …: ya no es la última versión de main.»), o el deploy sigue en cola detrás de otro | Ver la ejecución del push: «Build del deploy» y «Deploy a GitHub Pages» solo corren si el CI pasó en la rama principal |
| Un deploy aparece «En cola» un buen rato | Otro deploy (o un push a la rama principal) está corriendo: los deploys se hacen de a uno, en orden | Esperar; ninguno se descarta |
| El job «Deploy a GitHub Pages» falla con «No se vuelve a ejecutar solo el deploy…» | Se re-ejecutó solo ese job: publicaría un sitio armado en un intento anterior | Producción: el admin publica de nuevo desde TaskMate. Staging: un push nuevo, o re-ejecutar todos los jobs en GitHub |
| Advertencia en el log «No se pudo reconstruir … queda una página provisional hasta su próximo deploy.» | No se pudo descargar el sitio publicado (p. ej. más de 90 días sin deploys) y la versión vigente del otro entorno ya no compila | Volver a desplegar ese entorno: producción, publicando o con rollback; staging, con un push a la rama principal |
| «GitHub Pages está desactivado en el repositorio…» | Alguien desactivó Pages en GitHub | El admin vuelve a subir el pipeline: TaskMate lo activa de nuevo |
| El sitio abre pero sin estilos, o con páginas en blanco / 404 | El sitio usa rutas absolutas (`/app.js`) con el tipo «Estático», o la carpeta publicada no es la correcta | Usar el tipo **Vite** o **Create React App** si aplica (TaskMate ajusta la ruta base), o rutas relativas; revisar «Carpeta que se publica» |
| Falla «Instalar dependencias» con `npm ci` | `package-lock.json` desactualizado respecto a `package.json` | Regenerar el lock y hacer push, o elegir `npm install` |
| Falla «Auditoría de dependencias» | `npm audit` encontró vulnerabilidades altas o críticas en dependencias de producción | Actualizar esas dependencias; si hay un script de lint, se puede usar en lugar de la auditoría |

---

## 12. Límites y preguntas frecuentes

- **¿Qué comandos puede correr el pipeline?** Solo los scripts que existen en tu `package.json` y herramientas fijas (`npm ci`/`install`/`audit`, `pip`, Ruff, `pytest`). No se pueden escribir comandos libres, ni desde el diálogo ni desde la IA.
- **¿Qué se envía a la IA?** Los proyectos detectados y sus scripts (nombre y comando, con secretos redactados), la propuesta detectada y las versiones permitidas. Nunca el código fuente. Solo si el admin activó «Permitir análisis con IA».
- **¿Por qué no puedo conectar un repositorio que sí veo en GitHub?** Porque solo tienes permiso de lectura en él. Conectar le da al grupo poder de escritura y de publicar producción en ese repositorio; por eso solo lo puede conectar alguien que ya puede escribir en él.
- **¿Por qué como miembro solo puedo pedir la versión de staging?** Para que producción reciba lo que el grupo ya vio funcionando en staging. Cualquier otra versión (o un rollback) la decide un admin.
- **¿Qué pasa si se piden dos deploys seguidos?** Esperan en cola, en orden, y cada uno parte del sitio que dejó el anterior: ninguno se pierde ni pisa al otro.
- **¿Re-ejecutar un deploy viejo publica una versión vieja?** No. Un push que ya no es el último de la rama principal no se publica, y re-ejecutar solo el job de deploy falla antes de publicar. Re-ejecutar un deploy lanzado desde TaskMate (solo el admin) vuelve a publicar esa misma versión, como un rollback.
- **¿Cada deploy recompila todo?** No: solo la versión que se publica. El otro entorno se conserva del sitio publicado.
- **¿Mi pipeline está actualizado?** Si la tarjeta no muestra el aviso de «versión anterior de TaskMate», sí. La primera línea útil del archivo lo dice: `# taskmate-pipeline: 2`.
- **¿Puedo usar yarn o pnpm?** El pipeline instala con `npm install` (TaskMate lo avisa en las notas).
- **¿Y un monorepo?** TaskMate detecta hasta 6 proyectos (a 2 niveles o menos); el pipeline construye **uno**, elegido en «Proyecto». Un sitio estático en la raíz de un monorepo no se publica si la raíz contiene el código de otro proyecto.
- **¿Por qué mi API no tiene deploy?** GitHub Pages solo sirve archivos estáticos. Las APIs y los proyectos Python tienen CI.
- **¿Qué pasa si dos grupos usan el mismo repositorio?** Comparten el pipeline, los entornos y el historial (el workflow es uno por repositorio); las solicitudes de producción son de cada grupo.
- **¿El CI corre en pull requests?** Sí, y en cada push a cualquier rama. Los pull requests nunca despliegan. En una rama de trabajo o un pull request, un commit nuevo cancela el CI anterior; en la rama principal no se cancela nada.
- **¿Cuánto tarda?** En el repositorio de prueba (Vite), el primer CI tardó 11 s y el deploy 23 s (plantilla v1); con la v2 el deploy son dos jobs (build y publicación) y puede esperar en cola detrás de otro. GitHub Pages puede tardar un poco más en mostrar el cambio.
- **¿Dónde se guarda el historial?** En GitHub (Deployments del repositorio). TaskMate solo guarda la configuración del pipeline y las solicitudes de producción.

---

**Documento generado:** 22 oct 2026 · **Última actualización:** 22 oct 2026 (plantilla v2, versiones verificadas, solicitudes solo de staging, vinculación con permiso de escritura, logs y avisos en vivo)
**Autor:** Pablo Pineda

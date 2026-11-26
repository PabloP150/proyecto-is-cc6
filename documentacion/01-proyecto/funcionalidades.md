# Funcionalidades

**En una frase:** todo lo que un usuario puede hacer en TaskMate con el código actual (rama `test/e2e`, 25 nov 2026), por módulo, con quién puede hacerlo, en qué pantalla y dónde leer más.

```mermaid
flowchart LR
    V(["👤 Visitante"]) --> v1["Crear cuenta · Iniciar sesión"]
    M(["👤 Miembro"]) --> m1["Grupos y selector del navbar · Tareas · Hitos y calendario<br/>Chat con IA · GitHub y archivos de la tarea · CI/CD y Vercel · Avisos<br/>IA sobre el código, si el admin la permite"]
    L(["👤 Líder"]) --> l1["Panel de analytics<br/>y recomendaciones con IA"]
    A(["👤 Admin"]) --> a1["Miembros y roles · Conectar el repositorio<br/>Permitir el análisis con IA · Pipeline<br/>Publicar y aprobar producción · Vincular Vercel"]
    S(["🤖 Sistema"]) --> s1["PR fusionado completa la tarea<br/>Revisión con IA de cada PR de tarea<br/>Staging con cada cambio que pasa el CI<br/>Despliegues de Vercel guardados<br/>Avance de hitos propagado"]

    classDef rol fill:#1e3a8a,stroke:#3b82f6,color:#ffffff
    class V,M,L,A,S rol
```

Cada rol suma lo del anterior: el líder hace todo lo del miembro y el admin, todo lo del líder.

## Cómo leer la tabla
- **Visitante:** sin sesión. **Usuario:** con sesión, aunque no sea miembro del grupo.
- **Miembro:** pertenece al grupo activo. **Líder:** miembro con un rol cuyo nombre contiene «leader» (el admin también cuenta). **Admin:** el dueño del grupo.
- Lo que puede un miembro también lo pueden el líder y el admin. Detalle por acción: [permisos por rol](../04-casos-de-uso/00-permisos-por-rol.md).
- **Sistema:** pasa solo, sin que nadie pulse nada.
- **Textos entre comillas:** son los de la interfaz, que está en inglés desde el 19 nov 2026.
- **Dónde vive:** lo de la línea de Christian (asistente del chat, archivos por tarea, Vercel, IA sobre el código, selector de grupo del navbar e interfaz en inglés) está en `test/e2e`, todavía no en `master`.

## Tabla de funcionalidades

| Módulo | Funcionalidad | Quién | Pantalla | Más |
|---|---|---|---|---|
| 1 · Usuarios y acceso | Crear una cuenta (también crea su grupo personal) | Visitante | `/register` | [Casos](../04-casos-de-uso/01-usuarios-y-acceso.md) · [UI](../05-interfaz/01-usuarios-y-acceso.md) |
| 1 · Usuarios y acceso | Iniciar sesión (JWT de 24 h); queda activo su primer grupo | Visitante | `/` | [Casos](../04-casos-de-uso/01-usuarios-y-acceso.md) · [UI](../05-interfaz/01-usuarios-y-acceso.md) |
| 1 · Usuarios y acceso | Inicio con accesos a Tasks, Calendar, Milestones y Groups | Usuario | `/home` | [UI](../05-interfaz/00-general.md) |
| 1 · Usuarios y acceso | Conservar la sesión al recargar la misma pestaña | Usuario | Todas | [Casos](../04-casos-de-uso/01-usuarios-y-acceso.md) |
| 1 · Usuarios y acceso | Cerrar sesión (menú con su nombre → «Logout») | Usuario | Navbar | [Casos](../04-casos-de-uso/01-usuarios-y-acceso.md) |
| 1 · Usuarios y acceso | Salir solo de la sesión cuando el token vence | Sistema | Todas | [Casos](../04-casos-de-uso/01-usuarios-y-acceso.md) |
| 2 · Grupos y roles | Crear un grupo (queda como su admin) | Usuario | `/groups` | [Casos](../04-casos-de-uso/02-grupos-y-roles.md) · [UI](../05-interfaz/02-grupos-y-roles.md) |
| 2 · Grupos y roles | Ver sus grupos y elegir el activo con un clic en el grupo (también abre sus detalles) | Usuario | `/groups` | [Casos](../04-casos-de-uso/02-grupos-y-roles.md) · [UI](../05-interfaz/02-grupos-y-roles.md) |
| 2 · Grupos y roles | Cambiar el grupo activo desde el selector del navbar: cambia el de todas las pantallas y «Manage groups» lleva a `/groups` | Usuario | Navbar | [Casos](../04-casos-de-uso/02-grupos-y-roles.md) · [UI](../05-interfaz/00-general.md) |
| 2 · Grupos y roles | Ver miembros, roles y quién tiene cada rol | Miembro | `/groups` | [Casos](../04-casos-de-uso/02-grupos-y-roles.md) · [UI](../05-interfaz/02-grupos-y-roles.md) |
| 2 · Grupos y roles | Salir del grupo (si sale el admin, pasa al miembro más antiguo) | Miembro | `/groups` | [Casos](../04-casos-de-uso/02-grupos-y-roles.md) · [UI](../05-interfaz/02-grupos-y-roles.md) |
| 2 · Grupos y roles | Agregar un miembro por su nombre de usuario («Add User») | Admin | `/groups` | [Casos](../04-casos-de-uso/02-grupos-y-roles.md) · [UI](../05-interfaz/02-grupos-y-roles.md) |
| 2 · Grupos y roles | Quitar un miembro | Admin | `/groups` | [Casos](../04-casos-de-uso/02-grupos-y-roles.md) · [UI](../05-interfaz/02-grupos-y-roles.md) |
| 2 · Grupos y roles | Eliminar el grupo (el botón «Delete Group» aparece cuando el admin es el único miembro) | Admin | `/groups` | [Casos](../04-casos-de-uso/02-grupos-y-roles.md) · [UI](../05-interfaz/02-grupos-y-roles.md) |
| 2 · Grupos y roles | Crear, editar y borrar roles con color e icono | Admin | `/groups` | [Casos](../04-casos-de-uso/02-grupos-y-roles.md) · [UI](../05-interfaz/02-grupos-y-roles.md) |
| 2 · Grupos y roles | Asignar y quitar roles a un miembro («Assign/Edit Roles») | Admin | `/groups` | [Casos](../04-casos-de-uso/02-grupos-y-roles.md) · [UI](../05-interfaz/02-grupos-y-roles.md) |
| 3 · Tareas | Ver las listas, filtrar por hoy, semana o mes y ordenar | Miembro | `/tasks` | [Casos](../04-casos-de-uso/03-tareas.md) · [UI](../05-interfaz/03-tareas.md) |
| 3 · Tareas | Crear listas y tareas | Miembro | `/tasks` | [Casos](../04-casos-de-uso/03-tareas.md) · [UI](../05-interfaz/03-tareas.md) |
| 3 · Tareas | Editar una tarea: datos, avance y lista | Miembro | `/tasks` | [Casos](../04-casos-de-uso/03-tareas.md) · [UI](../05-interfaz/03-tareas.md) |
| 3 · Tareas | Completar una tarea o mandarla a la papelera | Miembro | `/tasks` | [Casos](../04-casos-de-uso/03-tareas.md) · [UI](../05-interfaz/03-tareas.md) |
| 3 · Tareas | Borrar una lista entera | Miembro | `/tasks` | [Casos](../04-casos-de-uso/03-tareas.md) · [UI](../05-interfaz/03-tareas.md) |
| 3 · Tareas | Asignar o quitar personas | Miembro | `/tasks` | [Casos](../04-casos-de-uso/03-tareas.md) · [UI](../05-interfaz/03-tareas.md) |
| 3 · Tareas | Ver y vaciar completadas y papelera | Miembro | `/tasks` | [Casos](../04-casos-de-uso/03-tareas.md) · [UI](../05-interfaz/03-tareas.md) |
| 4 · Hitos y calendario | Ver el diagrama de hitos (React Flow) | Miembro | `/block-diagram` | [Casos](../04-casos-de-uso/04-hitos-y-calendario.md) · [UI](../05-interfaz/04-hitos-y-calendario.md) |
| 4 · Hitos y calendario | Crear un hito o importar una tarea como hito | Miembro | `/block-diagram` | [Casos](../04-casos-de-uso/04-hitos-y-calendario.md) · [UI](../05-interfaz/04-hitos-y-calendario.md) |
| 4 · Hitos y calendario | Editar, mover y borrar hitos | Miembro | `/block-diagram` | [Casos](../04-casos-de-uso/04-hitos-y-calendario.md) · [UI](../05-interfaz/04-hitos-y-calendario.md) |
| 4 · Hitos y calendario | Fijar el % de avance o completar un hito | Miembro | `/block-diagram` | [Casos](../04-casos-de-uso/04-hitos-y-calendario.md) · [UI](../05-interfaz/04-hitos-y-calendario.md) |
| 4 · Hitos y calendario | Conectar hitos como prerrequisito o progresor | Miembro | `/block-diagram` | [Casos](../04-casos-de-uso/04-hitos-y-calendario.md) · [UI](../05-interfaz/04-hitos-y-calendario.md) |
| 4 · Hitos y calendario | Propagar el avance a los hitos que dependen (triggers de la BD) | Sistema | `/block-diagram` | [Casos](../04-casos-de-uso/04-hitos-y-calendario.md) · [BD](../03-base-de-datos/04-hitos-y-calendario.md) |
| 4 · Hitos y calendario | Calendario mensual con tareas e hitos | Miembro | `/calendar` | [Casos](../04-casos-de-uso/04-hitos-y-calendario.md) · [UI](../05-interfaz/04-hitos-y-calendario.md) |
| 5 · Chat con IA | Conversar con el asistente (Groq u Ollama local, según `LLM_PROVIDER`): la respuesta llega en streaming y el historial se recupera | Usuario | `/chat` | [Casos](../04-casos-de-uso/05-chat-ia.md) · [UI](../05-interfaz/05-chat-ia.md) |
| 5 · Chat con IA | Usar como proyecto el grupo del navbar («Project: …», con el chip de su repositorio o «No repository») | Miembro | `/chat` | [Casos](../04-casos-de-uso/05-chat-ia.md) · [UI](../05-interfaz/05-chat-ia.md) |
| 5 · Chat con IA | Preguntar sobre el proyecto: equipo, tareas, hitos, asignaciones y, con «Allow AI analysis», el repositorio | Miembro | `/chat` | [Casos](../04-casos-de-uso/05-chat-ia.md) · [UI](../05-interfaz/05-chat-ia.md) |
| 5 · Chat con IA | Pedir tareas para el proyecto («Propose tasks» o pidiendo un plan): analiza el repositorio y las tareas propuestas se guardan o descartan (1 por minuto; requiere repositorio y «Allow AI analysis») | Miembro | `/chat` | [Casos](../04-casos-de-uso/05-chat-ia.md) · [UI](../05-interfaz/05-chat-ia.md) |
| 5 · Chat con IA | Sin grupo seleccionado: pedir un plan de proyecto nuevo (roles, al menos 8 tareas e hitos) y guardarlo como grupo nuevo al confirmar; el asistente puede apoyarse en los documentos del servidor de IA local | Usuario | `/chat` | [Casos](../04-casos-de-uso/05-chat-ia.md) · [UI](../05-interfaz/05-chat-ia.md) |
| 5 · Chat con IA | Pedir cambios al plan de proyecto nuevo o descartarlo | Usuario | `/chat` | [Casos](../04-casos-de-uso/05-chat-ia.md) · [UI](../05-interfaz/05-chat-ia.md) |
| 5 · Chat con IA | Contestar con un texto fijo lo que no es de software (fuera de tema) | Sistema | `/chat` | [Casos](../04-casos-de-uso/05-chat-ia.md) · [Flujo](../06-flujos/05-chat-ia.md) |
| 6 · Analytics | Panel del equipo: resumen, carga de trabajo y experiencia por categoría | Líder | `/analytics` | [Casos](../04-casos-de-uso/06-analytics.md) · [Arquitectura](../02-arquitectura/06-analytics.md) |
| 6 · Analytics | Filtrar la carga de trabajo por rol | Líder | `/analytics` | [Casos](../04-casos-de-uso/06-analytics.md) · [Arquitectura](../02-arquitectura/06-analytics.md) |
| 6 · Analytics | Recomendaciones de asignación con IA | Líder | `/analytics` | [Casos](../04-casos-de-uso/06-analytics.md) · [Arquitectura](../02-arquitectura/06-analytics.md) |
| 6 · Analytics | Ver el aviso «Team leaders only» | Miembro | `/analytics` | [Casos](../04-casos-de-uso/06-analytics.md) |
| 7 · GitHub | Conectar el repositorio: instalar la GitHub App y elegirlo (exige escritura en GitHub) | Admin | `/github` › Repository | [Casos](../04-casos-de-uso/07-github.md) · [UI](../05-interfaz/07-github.md) |
| 7 · GitHub | Desvincular el repositorio («Disconnect») | Admin | `/github` › Repository | [Casos](../04-casos-de-uso/07-github.md) · [UI](../05-interfaz/07-github.md) |
| 7 · GitHub | Permitir o bloquear el análisis con IA («Allow AI analysis»): decide si la IA ve el repositorio en el chat y si se puede usar la IA sobre el código | Admin | `/github` › Repository | [Casos](../04-casos-de-uso/07-github.md) · [UI](../05-interfaz/07-github.md) |
| 7 · GitHub | Ver el repositorio vinculado y sincronizar los PRs («Sync PRs») | Miembro | `/github` › Repository | [Casos](../04-casos-de-uso/07-github.md) · [UI](../05-interfaz/07-github.md) |
| 7 · GitHub | Ir al chat a analizar el repositorio («Analyze with AI») | Miembro | `/github` › Repository | [Casos](../04-casos-de-uso/07-github.md) · [UI](../05-interfaz/07-github.md) |
| 7 · GitHub | Explorar el árbol, ver archivos y el README | Miembro | `/github` › Files | [Casos](../04-casos-de-uso/07-github.md) · [UI](../05-interfaz/07-github.md) |
| 7 · GitHub | Ver los últimos commits | Miembro | `/github` › Commits | [Casos](../04-casos-de-uso/07-github.md) · [UI](../05-interfaz/07-github.md) |
| 7 · GitHub | Crear la rama de una tarea («Create branch on GitHub») y ver el estado de su PR | Miembro | `/tasks` | [Casos](../04-casos-de-uso/07-github.md) · [UI](../05-interfaz/07-github.md) |
| 7 · GitHub | Ver los archivos que cambia una tarea activa con rama («View task files» → «Task files»), con «Also changed by» si otra tarea toca el mismo archivo | Miembro | `/tasks` | [Casos](../04-casos-de-uso/07-github.md) · [UI](../05-interfaz/07-github.md) |
| 7 · GitHub | Completar la tarea al fusionar su PR y limpiar la rama | Sistema (webhook de GitHub) | — | [Casos](../04-casos-de-uso/07-github.md) · [Flujo](../06-flujos/07-github.md) |
| 8 · CI/CD | Configurar el pipeline: propuesta (detectada o con IA), vista previa del YAML y subirlo | Admin | `/github` › CI/CD | [Casos](../04-casos-de-uso/08-cicd.md) · [UI](../05-interfaz/08-cicd.md) |
| 8 · CI/CD | Ver las ejecuciones, con filtros | Miembro | `/github` › CI/CD | [Casos](../04-casos-de-uso/08-cicd.md) · [UI](../05-interfaz/08-cicd.md) |
| 8 · CI/CD | Ver cada job con su log y sus anotaciones (archivo y línea) | Miembro | `/github` › CI/CD | [Casos](../04-casos-de-uso/08-cicd.md) · [UI](../05-interfaz/08-cicd.md) |
| 8 · CI/CD | Ejecutar el CI en una rama | Miembro | `/github` › CI/CD | [Casos](../04-casos-de-uso/08-cicd.md) · [UI](../05-interfaz/08-cicd.md) |
| 8 · CI/CD | Re-ejecutar fallidos o cancelar (las ejecuciones de deploy, solo el admin) | Miembro | `/github` › CI/CD | [Casos](../04-casos-de-uso/08-cicd.md) · [UI](../05-interfaz/08-cicd.md) |
| 8 · CI/CD | Ver los entornos y el historial de deploys | Miembro | `/github` › CI/CD | [Casos](../04-casos-de-uso/08-cicd.md) · [UI](../05-interfaz/08-cicd.md) |
| 8 · CI/CD | Publicar en staging cada cambio de la rama principal que pasa el CI | Sistema | — | [Casos](../04-casos-de-uso/08-cicd.md) · [Flujo](../06-flujos/08-cicd.md) |
| 8 · CI/CD | Solicitar producción (la versión de staging) y cancelar su propia solicitud | Miembro | `/github` › CI/CD | [Casos](../04-casos-de-uso/08-cicd.md) · [UI](../05-interfaz/08-cicd.md) |
| 8 · CI/CD | Publicar en producción o hacer rollback | Admin | `/github` › CI/CD | [Casos](../04-casos-de-uso/08-cicd.md) · [UI](../05-interfaz/08-cicd.md) |
| 8 · CI/CD | Aprobar o rechazar solicitudes de producción | Admin | `/github` › CI/CD | [Casos](../04-casos-de-uso/08-cicd.md) · [UI](../05-interfaz/08-cicd.md) |
| 8 · CI/CD | Vincular o desvincular el proyecto de Vercel del grupo (Project ID) | Admin | `/github` › Vercel (monitoring) | [Casos](../04-casos-de-uso/08-cicd.md) · [UI](../05-interfaz/08-cicd.md) |
| 8 · CI/CD | Ver los despliegues de Vercel (solo monitoreo): estado, production o preview, rama, commit y URL; se actualiza con «Refresh» | Miembro | `/github` › Vercel (monitoring) | [Casos](../04-casos-de-uso/08-cicd.md) · [UI](../05-interfaz/08-cicd.md) |
| 8 · CI/CD | Guardar cada despliegue que avisa Vercel (webhook firmado con HMAC-SHA1) | Sistema (webhook de Vercel) | — | [Casos](../04-casos-de-uso/08-cicd.md) · [Flujo](../06-flujos/08-cicd.md) |
| 9 · Tiempo real y avisos | Ver en vivo las ejecuciones y los deploys | Miembro | `/github` › CI/CD | [Casos](../04-casos-de-uso/09-tiempo-real-y-avisos.md) · [UI](../05-interfaz/09-tiempo-real-y-avisos.md) |
| 9 · Tiempo real y avisos | Aviso de ejecución fallida o deploy terminado | Miembro | Todas | [Casos](../04-casos-de-uso/09-tiempo-real-y-avisos.md) · [UI](../05-interfaz/09-tiempo-real-y-avisos.md) |
| 9 · Tiempo real y avisos | Aviso de solicitud de producción nueva o deploy cancelado antes de publicar | Admin | Todas | [Casos](../04-casos-de-uso/09-tiempo-real-y-avisos.md) · [UI](../05-interfaz/09-tiempo-real-y-avisos.md) |
| 9 · Tiempo real y avisos | Aviso de que su solicitud se aprobó o se rechazó | Miembro (quien la pidió) | Todas | [Casos](../04-casos-de-uso/09-tiempo-real-y-avisos.md) · [UI](../05-interfaz/09-tiempo-real-y-avisos.md) |
| 9 · Tiempo real y avisos | «View» en un aviso: activa ese grupo y abre su pestaña CI/CD | Miembro | Todas | [Casos](../04-casos-de-uso/09-tiempo-real-y-avisos.md) · [UI](../05-interfaz/09-tiempo-real-y-avisos.md) |
| 10 · IA sobre el código | Auditar la rama de la tarea («Audit»): veredicto («No issues», «Needs review» o «Serious issues») y hallazgos por archivo y línea | Miembro (si el admin lo permite) | `/tasks` › «Task files» | [Casos](../04-casos-de-uso/10-ia-sobre-el-codigo.md) · [UI](../05-interfaz/10-ia-sobre-el-codigo.md) |
| 10 · IA sobre el código | Generar pruebas para la rama («Generate tests»): las propone (pytest o Jest) para copiarlas; no las ejecuta ni las sube | Miembro (si el admin lo permite) | `/tasks` › «Task files» | [Casos](../04-casos-de-uso/10-ia-sobre-el-codigo.md) · [UI](../05-interfaz/10-ia-sobre-el-codigo.md) |
| 10 · IA sobre el código | Revisar el PR abierto de la tarea («Review PR») y ver la última revisión guardada | Miembro (si el admin lo permite) | `/tasks` › «Task files» | [Casos](../04-casos-de-uso/10-ia-sobre-el-codigo.md) · [UI](../05-interfaz/10-ia-sobre-el-codigo.md) |
| 10 · IA sobre el código | Revisar cada PR de tarea al abrirse o recibir commits (una revisión por commit) y publicarla en GitHub como comentario, sin aprobar ni bloquear (si la App tiene «Pull requests: write») | Sistema (webhook de GitHub, si el admin lo permite) | — | [Casos](../04-casos-de-uso/10-ia-sobre-el-codigo.md) · [Flujo](../06-flujos/10-ia-sobre-el-codigo.md) |

Los tres botones de la IA sobre el código comparten un límite de 5 pedidos por minuto por usuario y necesitan el servidor de IA local en marcha.

## Qué no está en la tabla
- **Rutas solo de API:** 20 rutas REST no tienen pantalla (por ejemplo, casi todo `/api/analytics` salvo el panel). Lista: [cierre de la línea de Pablo y estado](cierre-del-proyecto.md#api-y-código).
- **Direcciones antiguas:** `/flow` lleva a `/block-diagram` y `/create-group` a `/groups`; `/register` con sesión lleva a `/home` ([correcciones del 3 nov](cierre-del-proyecto.md#correcciones-del-cierre-3-nov-2026)).
- **Tareas en segundo plano:** recálculo de métricas de analytics (solo con `ANALYTICS_BATCH_ENABLED=true`) y purga diaria de las entregas del webhook de GitHub.

## Dónde está en el código

| Archivo | Qué hace |
|---|---|
| `src/App.js` | Rutas de todas las pantallas y sus redirecciones |
| `src/components/Navbar.jsx` | Las 8 entradas del menú y el selector de grupo |
| `src/components/NavGroupSelector.jsx` | Selector de grupo del navbar: cambia el grupo de todas las pantallas |
| `src/components/github/TaskFilesDialog.jsx`, `TaskAiPanel.jsx` | Diálogo «Task files» y su panel «AI on the branch» (Audit, Generate tests y Review PR) |
| `src/components/deploy/DeploymentPanel.jsx` | Pestaña «Vercel (monitoring)» de `/github` |
| `taskmate-api/middleware/groupAccess.js` | Controles de miembro y admin de cada ruta |
| `taskmate-api/models/access.model.js` | Quién es líder (`isGroupLeader`) |

## Para saber más
- [Qué es TaskMate](que-es-taskmate.md): visión de una página.
- [Recorridos de usuario](../04-casos-de-uso/00-recorridos-de-usuario.md): las funcionalidades en orden de uso.
- [Interfaz: visión general](../05-interfaz/00-general.md): mapa de pantallas.
- Línea de Christian, de donde salen el asistente del chat, Vercel, los archivos por tarea y la IA sobre el código: [09-linea-christian](../09-linea-christian/README.md).
- Limitaciones de cada funcionalidad: [cierre de la línea de Pablo y estado](cierre-del-proyecto.md#limitaciones-conocidas).

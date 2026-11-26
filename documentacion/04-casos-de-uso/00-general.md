# Casos de uso: visión general

**En una frase:** quién usa TaskMate (cuatro roles de personas y tres sistemas externos: GitHub, Vercel y el servidor de IA local) y qué puede hacer cada uno en los 10 módulos.

```mermaid
%%{init: {"flowchart": {"wrappingWidth": 420}}}%%
flowchart LR
    U(["👤 Usuario"])
    M(["👤 Miembro<br/>también es usuario"])
    L(["👤 Líder<br/>también es miembro"])
    A(["👤 Admin<br/>también es líder"])

    subgraph TM["Sistema TaskMate"]
        P1["<b>1 · Usuarios y acceso</b><br/>Registrarse · Iniciar y cerrar sesión"]
        P5["<b>5 · Chat IA</b><br/>Preguntar sobre el grupo del navbar · Proponer tareas (miembro)<br/>Sin grupo activo, crear un proyecto con un plan de IA (usuario)<br/>Documentos de apoyo sin grupo activo (servidor de IA local)"]
        P2["<b>2 · Grupos y roles</b><br/>Crear un grupo · Elegir el activo en el navbar (usuario)<br/>Ver miembros y salir (miembro)<br/>Agregar miembros y asignar roles (admin)"]
        P3["<b>3 · Tareas</b><br/>Crear, editar y completar · Asignar personas"]
        P4["<b>4 · Hitos y calendario</b><br/>Diagrama de hitos con avance · Calendario"]
        P6["<b>6 · Analytics</b><br/>Panel del equipo · Recomendaciones de asignación"]
        P7["<b>7 · GitHub</b><br/>Explorar el repo · Rama y archivos de la tarea (miembro)<br/>Conectar el repositorio (admin)<br/>El PR fusionado completa la tarea (GitHub)"]
        P8["<b>8 · CI/CD</b><br/>Ver y ejecutar el CI · Solicitar producción · Ver despliegues de Vercel (miembro)<br/>Pipeline, publicar, aprobar, rollback y vincular Vercel (admin)<br/>Correr el workflow y publicar en Pages (GitHub)<br/>Avisar de cada despliegue (Vercel)"]
        P9["<b>9 · Tiempo real y avisos</b><br/>Avisos de CI/CD en vivo (miembro)<br/>Avisos de solicitudes de producción (admin)"]
        P10["<b>10 · IA sobre el código</b><br/>Auditar la rama · Generar pruebas · Revisar el PR (miembro)<br/>Permitir el análisis con IA (admin)<br/>Revisión automática al abrir o actualizar el PR (GitHub)<br/>Revisar el diff con el modelo local (servidor de IA local)"]
    end

    GH(["⚙️ GitHub"])
    VC(["⚙️ Vercel"])
    AIS(["⚙️ Servidor de IA local"])

    U --- P1 & P5 & P2
    M --- P5 & P2 & P3 & P4 & P7 & P8 & P9 & P10
    L --- P6
    A --- P2 & P7 & P8 & P9 & P10
    P7 --- GH
    P8 --- GH
    P9 --- GH
    P10 --- GH
    P8 --- VC
    P5 --- AIS
    P10 --- AIS

    linkStyle 0,1,2 stroke:#64748b,stroke-width:2px
    linkStyle 3,4,5,6,7,8,9,10 stroke:#2563eb,stroke-width:2px
    linkStyle 11 stroke:#9333ea,stroke-width:2px
    linkStyle 12,13,14,15,16 stroke:#dc2626,stroke-width:2px
    linkStyle 17,18,19,20,21,22,23 stroke:#16a34a,stroke-width:2px
    classDef usr fill:#475569,stroke:#64748b,color:#ffffff
    classDef mem fill:#1e3a8a,stroke:#2563eb,color:#ffffff
    classDef lead fill:#581c87,stroke:#9333ea,color:#ffffff
    classDef adm fill:#7f1d1d,stroke:#dc2626,color:#ffffff
    classDef ext fill:#14532d,stroke:#16a34a,color:#ffffff
    classDef pkg fill:#f8fafc,stroke:#64748b,color:#0f172a,text-align:left
    class U usr
    class M mem
    class L lead
    class A adm
    class GH,VC,AIS ext
    class P1,P2,P3,P4,P5,P6,P7,P8,P9,P10 pkg
```

**Cómo leerlo:**
- Cada recuadro es un módulo: un «paquete» con sus casos de uso principales. Entre paréntesis, quién lo hace cuando no es el mismo para todo el paquete.
- Una línea une a un actor con un módulo cuando **su rol** agrega algo ahí. Cada actor tiene su color: gris usuario, azul miembro, morado líder, rojo admin y verde los sistemas externos (GitHub, Vercel y el servidor de IA local).
- Los roles se heredan: el admin también es líder, el líder también es miembro y el miembro también es usuario. Por eso el admin también puede hacer todo lo del miembro, aunque no tenga línea a ese módulo.

## Rol por rol

El diagrama completo de arriba tiene muchas líneas. Estos cuatro lo muestran por partes: cada uno deja a un solo rol con **sus propias** conexiones y solo los casos que ese rol agrega (lo heredado no se repite). La barra de arriba de cada imagen dice en qué rol se está. Son los mismos diagramas de la presentación; sus fuentes HTML están en [`fuentes/`](fuentes/).

### Usuario

Cuenta e inicio de sesión, crear grupos (y quedar como admin), elegir el grupo activo y el chat sin grupo activo, que arma un plan para un grupo nuevo con documentos del servidor de IA local.

![Casos de uso del usuario y sus conexiones](imagenes/00-general-rol-usuario.png)

### Miembro

Lo que agrega al pertenecer a un grupo: tareas, hitos y calendario, chat sobre el grupo, GitHub, CI/CD, avisos en vivo y la IA sobre el código, con sus líneas a GitHub, Vercel y el servidor de IA local.

![Casos de uso del miembro y sus conexiones](imagenes/00-general-rol-miembro.png)

### Líder

Solo analytics: el panel del equipo, la carga por rol y la recomendación de a quién asignar una tarea; lo que no tiene pantalla se usa por la API.

![Casos de uso del líder y sus conexiones](imagenes/00-general-rol-lider.png)

### Admin

Miembros y roles, CI/CD (pipeline, publicar, aprobar, rollback y vincular Vercel), el repositorio, los avisos que solo le llegan a él y el permiso de análisis con IA.

![Casos de uso del admin y sus conexiones](imagenes/00-general-rol-admin.png)

## Actores

| Actor | Quién es | Cómo lo comprueba el código |
|---|---|---|
| Usuario | Cualquier persona. Sin sesión, solo se registra o inicia sesión. Con sesión, crea grupos, elige el grupo activo en el navbar y usa el chat | `requireAuth`: JWT (token firmado) de 24 h |
| Miembro | Usuario que pertenece al grupo (una fila en `UserGroups`) | `requireGroupMember` y `requireResourceMember` |
| Líder | El admin, o un miembro con un rol cuyo nombre contiene «leader» | `isGroupLeader` (`models/access.model.js`) |
| Admin | El dueño del grupo (`Groups.adminId`). Hay uno por grupo. Es el único que conecta el repo, activa «Allow AI analysis» y vincula el proyecto de Vercel | `requireGroupAdmin` |
| GitHub | Sistema externo: la GitHub App y GitHub Actions. Avisa de PRs, instalaciones y ejecuciones; recibe las ramas, el workflow y la revisión de IA del PR (como comentario) | Webhook firmado con HMAC SHA-256 (`X-Hub-Signature-256`) |
| Vercel | Sistema externo, solo de monitoreo: avisa de cada despliegue del proyecto que el admin vinculó. TaskMate no despliega en Vercel | Webhook firmado con HMAC SHA-1 (`x-vercel-signature`) |
| Servidor de IA local | Sistema externo: `taskmate-ai-server`, el repo aparte de Christian (FastAPI en `127.0.0.1:8000`, con Ollama). TaskMate le pide auditar la rama, generar pruebas y revisar el PR; el chat sin grupo activo le pide documentos de apoyo | Lo llama TaskMate, no al revés, con la cabecera `X-AI-Server-Secret`; sin ella responde 401 |

La matriz completa, acción por acción, está en [Permisos por rol](00-permisos-por-rol.md).

## Módulos

| # | Módulo | Casos de uso principales | Quién |
|---|---|---|---|
| 1 | [Usuarios y acceso](01-usuarios-y-acceso.md) | Registrarse (crea un grupo personal), iniciar y cerrar sesión | Usuario |
| 2 | [Grupos y roles](02-grupos-y-roles.md) | Crear grupos y elegir el activo; ver miembros y salir; agregar y quitar miembros, roles | Usuario, miembro, admin |
| 3 | [Tareas](03-tareas.md) | Listas y tareas: crear, editar, completar, papelera, asignar | Miembro |
| 4 | [Hitos y calendario](04-hitos-y-calendario.md) | Diagrama de hitos con prerrequisitos y avance; calendario | Miembro |
| 5 | [Chat IA](05-chat-ia.md) | Preguntar sobre el grupo del navbar y pedirle tareas; sin grupo activo, plan que crea un grupo nuevo | Usuario, miembro, servidor de IA local |
| 6 | [Analytics](06-analytics.md) | Panel del equipo, carga, experiencia y recomendaciones de asignación | Líder |
| 7 | [GitHub](07-github.md) | Conectar el repo, explorarlo, rama por tarea, archivos de la tarea, PR que completa la tarea | Miembro, admin, GitHub |
| 8 | [CI/CD](08-cicd.md) | Pipeline, ejecuciones, staging, producción con aprobación, rollback; monitoreo de despliegues de Vercel | Miembro, admin, GitHub, Vercel |
| 9 | [Tiempo real y avisos](09-tiempo-real-y-avisos.md) | Avisos en vivo de ejecuciones, deploys y solicitudes | Miembro, admin, GitHub |
| 10 | [IA sobre el código](10-ia-sobre-el-codigo.md) | Auditar la rama de la tarea, generar pruebas (se proponen, no se ejecutan) y revisar el PR con IA | Miembro, admin, GitHub, servidor de IA local |

## Reglas que conviene saber
- **La interfaz esconde, la API decide.** Las pantallas ocultan los botones de admin, pero el permiso real lo revisa la API. Un llamado directo sin el rol recibe 403.
- **Nadie se une solo a un grupo.** Solo el admin agrega miembros, por nombre de usuario.
- **El grupo activo se elige en el navbar.** El selector junto al logo cambia el grupo de todas las pantallas, también el del chat; «Manage groups» lleva a Groups, donde basta un clic en el grupo. Al iniciar sesión se activa el primero de la lista.
- **El chat sigue al grupo del navbar.** Con grupo, responde sobre ese proyecto y propone tareas solo si se le pide. Solo sin grupo activo arma un plan que crea un **grupo nuevo**, y quien lo pidió queda como admin.
- **Sin repositorio no hay GitHub ni CI/CD.** Las pestañas Files, Commits y CI/CD se activan cuando el admin conecta el repositorio. «Vercel (monitoring)» no está deshabilitada, pero vuelve a Repository mientras no haya repo, y las tareas no muestran «View task files».
- **La IA sobre el repositorio pide permiso.** Mientras el admin no active «Allow AI analysis», no hay análisis del repo, el chat no ve el repo, «Propose with AI» no propone el pipeline, y «Audit», «Generate tests» y «Review PR» (también la revisión automática) no corren.
- **Vercel solo informa.** TaskMate guarda lo que Vercel avisa del proyecto vinculado; no despliega ahí ni se actualiza en vivo («Refresh»).

## Para saber más
- [Recorridos de usuario](00-recorridos-de-usuario.md): un día típico de cada rol.
- [Permisos por rol](00-permisos-por-rol.md): la matriz completa.
- [Interfaz](../05-interfaz/00-general.md): las pantallas y la navegación.
- [Flujo de punta a punta](../06-flujos/00-general.md): del plan con IA a producción.
- Qué agregó la línea de Christian: [09-linea-christian](../09-linea-christian/README.md).
- Limitaciones y pendientes: [cierre de la línea de Pablo y estado](../01-proyecto/cierre-del-proyecto.md#limitaciones-conocidas).

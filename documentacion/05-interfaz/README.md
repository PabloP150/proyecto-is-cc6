# 05 · Interfaz

**En una frase:** cómo se ven y se usan las pantallas de TaskMate, con capturas reales del admin y de un miembro: primero el mapa de navegación y después una página por módulo.

```mermaid
flowchart LR
    G["00 · Visión general<br/>mapa de pantallas"] --> M["01–09 · Pantallas de cada módulo"]
    C[("capturas/<br/>18 imágenes")] -.-> G
    C -.-> M
```

## Páginas generales

| Página | Qué explica |
|---|---|
| [Visión general](00-general.md) | El mapa de pantallas, la barra de navegación, las rutas que redirigen y la sesión por pestaña |

## Páginas por módulo

| Módulo | Qué explica |
|---|---|
| [1 · Usuarios y acceso](01-usuarios-y-acceso.md) | «Sign In» (`/`), «Create Account» (`/register`) y el menú con tu nombre para salir |
| [2 · Grupos y roles](02-grupos-y-roles.md) | `/groups`: elegir el grupo activo, ver miembros y roles; el admin agrega, quita y maneja roles |
| [3 · Tareas](03-tareas.md) | `/tasks`: listas con una tarjeta por tarea y el panel lateral de completadas y papelera |
| [4 · Hitos y calendario](04-hitos-y-calendario.md) | «Milestones» (`/block-diagram`), el lienzo de hitos, y «Calendar» (`/calendar`), la vista de mes |
| [5 · Chat con IA](05-chat-ia.md) | «AI Bot» (`/chat`): selector de proyecto, conversación y cuadro de texto |
| [6 · Analytics](06-analytics.md) | `/analytics`: el panel del líder y el aviso «Solo líderes del equipo» para los demás |
| [7 · GitHub](07-github.md) | `/github`: pestañas Repositorio, Archivos y Commits, más la rama y el PR en cada tarea |
| [8 · CI/CD](08-cicd.md) | La pestaña CI/CD: pipeline, entornos staging y producción, ejecuciones y logs |
| [9 · Tiempo real y avisos](09-tiempo-real-y-avisos.md) | Sin pantalla propia: avisos abajo a la derecha y la pestaña CI/CD que se recarga sola |

## Galería de capturas

Capturas JPG de 1440 × 1000 en [`capturas/`](capturas/). El nombre dice quién la ve: `anon-` (sin sesión), `admin-` (admin del grupo) o `miembro-` (un miembro que no es admin).

| Captura | Qué muestra | Página |
|---|---|---|
| <img src="capturas/anon-login.jpg" alt="Pantalla Sign In" width="220"> | «Sign In» (`/`), sin sesión | [Usuarios](01-usuarios-y-acceso.md) |
| <img src="capturas/anon-registro.jpg" alt="Pantalla Create Account" width="220"> | «Create Account» (`/register`), sin sesión | [Usuarios](01-usuarios-y-acceso.md) |
| <img src="capturas/admin-home.jpg" alt="Inicio del admin" width="220"> | Inicio (`/home`) con la barra de navegación | [Usuarios](01-usuarios-y-acceso.md) |
| <img src="capturas/admin-grupos.jpg" alt="Grupos del admin" width="220"> | `/groups` con «Demo CI/CD» como grupo activo | [Grupos](02-grupos-y-roles.md) |
| <img src="capturas/admin-tareas.jpg" alt="Tareas del admin" width="220"> | `/tasks` del admin, grupo «Fitness App» | [Tareas](03-tareas.md) |
| <img src="capturas/miembro-tareas.jpg" alt="Tareas de un miembro" width="220"> | `/tasks` de un miembro en «Demo CI/CD», sin listas todavía | [Tareas](03-tareas.md) |
| <img src="capturas/admin-hitos.jpg" alt="Hitos del admin" width="220"> | «Milestones»: barra para crear hitos y lienzo | [Hitos](04-hitos-y-calendario.md) |
| <img src="capturas/admin-calendario.jpg" alt="Calendario" width="220"> | «Calendar»: vista de mes con Today, Back y Next | [Hitos](04-hitos-y-calendario.md) |
| <img src="capturas/admin-chat.jpg" alt="Chat con IA" width="220"> | «AI Bot»: saludo inicial, sin proyecto de contexto | [Chat](05-chat-ia.md) |
| <img src="capturas/admin-analytics.jpg" alt="Panel de analytics" width="220"> | Panel de analytics que ve el admin (es líder) | [Analytics](06-analytics.md) |
| <img src="capturas/miembro-analytics.jpg" alt="Aviso solo líderes" width="220"> | Aviso «Solo líderes del equipo» que ve un miembro | [Analytics](06-analytics.md) |
| <img src="capturas/admin-github-repositorio.jpg" alt="Pestaña Repositorio del admin" width="220"> | GitHub → Repositorio, vista del admin | [GitHub](07-github.md) |
| <img src="capturas/miembro-github-repositorio.jpg" alt="Pestaña Repositorio de un miembro" width="220"> | Repositorio, vista de un miembro: sin «Desconectar» | [GitHub](07-github.md) |
| <img src="capturas/admin-github-archivos.jpg" alt="Pestaña Archivos" width="220"> | Archivos: árbol y README | [GitHub](07-github.md) |
| <img src="capturas/admin-github-commits.jpg" alt="Pestaña Commits" width="220"> | Commits de la rama por defecto | [GitHub](07-github.md) |
| <img src="capturas/admin-github-cicd.jpg" alt="Pestaña CI/CD del admin" width="220"> | CI/CD del admin: pipeline, entornos y ejecuciones | [CI/CD](08-cicd.md) |
| <img src="capturas/admin-github-cicd-ejecucion.jpg" alt="Detalle de una ejecución" width="220"> | Una ejecución abierta, con sus jobs y su log | [CI/CD](08-cicd.md) |
| <img src="capturas/miembro-github-cicd.jpg" alt="Pestaña CI/CD de un miembro" width="220"> | CI/CD de un miembro: «Solicitar producción» en vez de «Publicar» | [CI/CD](08-cicd.md) |

No hay captura del aviso en vivo (módulo 9): su aspecto se describe en [tiempo real y avisos](09-tiempo-real-y-avisos.md).

## Diagramas e imágenes

- Los diagramas de estas páginas son bloques Mermaid.
- Su copia en PNG está en [`imagenes/`](imagenes/), con el nombre `<página>-<n>.png` (n = orden del diagrama en la página).

## Para saber más

- Qué puede hacer cada rol en cada pantalla: [guía de uso](../07-guias/guia-de-uso.md).
- Limitaciones de la interfaz: [cierre del proyecto](../01-proyecto/cierre-del-proyecto.md#interfaz).
- [Índice de la documentación](../README.md).

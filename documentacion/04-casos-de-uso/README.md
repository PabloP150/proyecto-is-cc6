# 04 · Casos de uso

**En una frase:** quién usa TaskMate (usuario, miembro, líder y admin, más tres sistemas externos: GitHub, Vercel y el servidor de IA local) y qué puede hacer cada uno, en general y en cada uno de los 10 módulos.

```mermaid
flowchart LR
    G["00 · Visión general<br/>actores y módulos"] --> P["00 · Permisos por rol"]
    G --> R["00 · Recorridos de usuario"]
    G --> M["01–10 · Casos de cada módulo"]
```

## Páginas generales

| Página | Qué explica |
|---|---|
| [Visión general](00-general.md) | El diagrama de actores y módulos, y las reglas que conviene saber |
| [Permisos por rol](00-permisos-por-rol.md) | Referencia: qué puede hacer cada rol en cada módulo, tal como lo revisa la API |
| [Recorridos de usuario](00-recorridos-de-usuario.md) | Cuatro recorridos paso a paso: usuario nuevo, miembro, admin y líder |

## Páginas por módulo

| Módulo | Qué explica |
|---|---|
| [1 · Usuarios y acceso](01-usuarios-y-acceso.md) | Crear cuenta, iniciar sesión y usar la app hasta salir o hasta que el token vence (24 h) |
| [2 · Grupos y roles](02-grupos-y-roles.md) | Cualquiera crea grupos y elige el activo en el navbar; los miembros ven y salen; solo el admin agrega, quita y maneja roles |
| [3 · Tareas](03-tareas.md) | Cualquier miembro del grupo activo maneja cualquier tarea; GitHub la completa al fusionar su PR |
| [4 · Hitos y calendario](04-hitos-y-calendario.md) | Cualquier miembro crea, conecta, edita y borra hitos y ve el calendario; sin permisos extra |
| [5 · Chat con IA](05-chat-ia.md) | Preguntar sobre el grupo del navbar y pedirle tareas (miembro); sin grupo activo, crear un proyecto nuevo desde su plan |
| [6 · Analytics](06-analytics.md) | El líder ve el panel y pide recomendaciones de asignación; lo demás es solo de API o automático |
| [7 · GitHub](07-github.md) | El admin conecta y gobierna el repositorio; los miembros lo exploran, crean ramas, ven los archivos de cada tarea y piden propuestas |
| [8 · CI/CD](08-cicd.md) | Los miembros ven, corren el CI, piden producción y ven los despliegues de Vercel; el admin configura, publica, aprueba, hace rollback y vincula Vercel |
| [9 · Tiempo real y avisos](09-tiempo-real-y-avisos.md) | Cada miembro recibe en vivo los eventos de CI/CD de sus grupos y el aviso que le toca según su papel |
| [10 · IA sobre el código](10-ia-sobre-el-codigo.md) | Cualquier miembro audita la rama de una tarea, genera pruebas y pide la revisión del PR al servidor de IA local, si el admin lo permitió; GitHub dispara la revisión al abrir o actualizar el PR |

## Diagramas e imágenes

- Los diagramas de estas páginas son bloques Mermaid (los de casos de uso son flowcharts con actores y casos).
- Su copia en PNG está en [`imagenes/`](imagenes/), con el nombre `<página>-<n>.png` (n = orden del diagrama en la página).
- Los cuatro diagramas «rol por rol» de [Visión general](00-general.md) no son Mermaid: son `imagenes/00-general-rol-<rol>.png`, dibujados desde [`fuentes/`](fuentes/) en HTML y SVG (los mismos de la presentación). Se regeneran igual que la arquitectura general: Chrome sin interfaz a 1370×990 y escala 2.

## Para saber más

- Cómo se ve cada caso: [05-interfaz](../05-interfaz/README.md).
- Qué puede hacer cada rol, pantalla por pantalla: [guía de uso](../07-guias/guia-de-uso.md).
- Todas las funcionalidades en una tabla: [funcionalidades](../01-proyecto/funcionalidades.md).
- Lo que agregó la línea de Christian (Vercel, archivos por tarea, IA sobre el código, chat con modelo local): [09-linea-christian](../09-linea-christian/README.md).
- [Índice de la documentación](../README.md).

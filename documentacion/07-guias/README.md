# 07 · Guías

**En una frase:** las guías prácticas de TaskMate: instalarlo desde cero (macOS con `./start.sh` o Linux con `./scripts/local-up.sh` y la IA local), usarlo según tu rol, correr las pruebas, montar SQL Server, registrar la GitHub App, usar el CI/CD y la referencia técnica.

```mermaid
flowchart LR
    PA["Primer arranque<br/>macOS o Linux"] --> DB["SQL Server<br/>Docker o Podman"]
    PA -.->|"camino Linux"| IA["IA local<br/>Gemma 4 en Ollama<br/>y servidor de IA local"]
    PA --> GU["Guía de uso"]
    PA --> PR["Pruebas"]
    PA -.->|"solo con GitHub"| GA["GitHub App"]
    GA --> CI["CI/CD"]
    PA -.->|"para consultar"| GT["Guía técnica<br/>(referencia)"]
```

## Guías

Esta carpeta no tiene páginas por módulo. Empieza por el primer arranque.

| Guía | Para qué sirve |
|---|---|
| [Primer arranque](primer-arranque.md) | De `git clone` a TaskMate corriendo, con **tus propios** secretos, cuando nadie te pasó una `.env`. Dos caminos: `./start.sh` (macOS, Docker o Podman; no levanta Ollama: modelo local si lo corres tú, o Groq como respaldo) o `./scripts/local-up.sh` (Linux con Podman: genera la `.env`, migra y levanta el modelo local y el servidor de IA local) |
| [Guía de uso por rol](guia-de-uso.md) | Qué puede hacer un miembro, un líder y un admin en cada pantalla |
| [Pruebas](pruebas.md) | Correr las cuatro suites (API, frontend, servicio Python del chat y BD), el lint y el build; 2087 pruebas al 25 nov 2026 |
| [SQL Server en Docker](base-de-datos-docker.md) | La imagen, el contenedor `taskmate-sql` (Docker o Podman), las migraciones 001–011 y la BD desechable para las pruebas (10 suites, 117 pruebas) |
| [GitHub App](guia-github-app.md) | Registrar la App (permisos de las Fases 3 y 4, y el opcional para la revisión de PR con IA), smee, `.env`, migrar y el checklist E2E |
| [CI/CD](guia-cicd.md) | Configurar, ejecutar y publicar el CI/CD del repositorio del grupo desde TaskMate |
| [Guía técnica](guia-tecnica.md) | Referencia: carpetas, versiones, rutas REST, WebSockets, variables de entorno, puertos y convenciones |

## Lo más buscado

- Todas las variables de entorno: [guía técnica, §7](guia-tecnica.md#7-variables-de-entorno).
- Puertos: [guía técnica, §8](guia-tecnica.md#8-puertos).
- Estructura de carpetas del repositorio: [guía técnica, §3](guia-tecnica.md#3-estructura-de-carpetas).
- Permisos y eventos de la GitHub App: [guía de la GitHub App, §4](guia-github-app.md#4-registrar-la-github-app).
- Arrancar en Linux con el modelo local y el servidor de IA local: [primer arranque, camino B](primer-arranque.md#camino-b--linux-con-podman-e-ia-local-scriptslocal-upsh).
- Aplicar migraciones nuevas a una BD que ya existía: [SQL Server en Docker, §5](base-de-datos-docker.md#5-migrar-una-bd-que-ya-existía).
- Problemas comunes al arrancar: [primer arranque](primer-arranque.md#problemas-comunes).

## Diagramas e imágenes

- Los diagramas de estas guías son bloques Mermaid.
- Su copia en PNG está en [`imagenes/`](imagenes/), con el nombre `<página>-<n>.png` (n = orden del diagrama en la página).

## Para saber más

- Cómo está hecho TaskMate: [02-arquitectura](../02-arquitectura/README.md).
- El entorno Linux con IA local, según Christian: [ENTORNO-LOCAL.md](../09-linea-christian/ENTORNO-LOCAL.md).
- Limitaciones y pendientes: [cierre de la línea de Pablo y estado](../01-proyecto/cierre-del-proyecto.md#limitaciones-conocidas).
- [Índice de la documentación](../README.md).

# Calendarización TaskMate — Línea de trabajo de Pablo Pineda

## Resumen Ejecutivo

**Proyecto:** TaskMate — Plataforma Colaborativa de Gestión de Tareas con IA  
**Duración total:** 14 agosto — 27 noviembre 2026 (15 semanas)  
**Responsable:** Pablo Pineda (las 8 fases). La Fase 7 se hace junto con Christian Martínez.

| # | Funcionalidad | Complejidad | Fechas | Duración | Estado | Rama |
|---|---------------|-------------|--------|----------|--------|------|
| 1 | Preparación de entornos, repositorio y CI inicial | Baja | 14 ago – 21 ago | 1 semana | ✅ Completo | fusionada en `master` |
| 2 | Optimización y mejora del rendimiento | Media | 21 ago – 4 sep | 2 semanas | ✅ Completo | fusionada en `master` (PR #2) |
| 3 | Integración con GitHub | Media | 4 sep – 18 sep | 2 semanas | ✅ Completo | fusionada en `master` (PR #4) |
| 4 | Pipeline CI/CD completo (build, pruebas, análisis estático, deploy y actualización automática) | Alta | 18 sep – 9 oct | 3 semanas | ✅ Completo | `feature/fase-4-cicd-github-actions` |
| 5 | Testing automático (ciclo de pruebas por tarea) | Media | 9 oct – 23 oct | 2 semanas | ⏳ Pendiente | `feature/fase-5-testing-automatico` |
| 6 | Integración con SonarQube | Media | 23 oct – 6 nov | 2 semanas | ⏳ Pendiente | `feature/fase-6-sonarqube` |
| 7 | Algoritmo de colisión de archivos (junto con Christian) | Alta | 6 nov – 20 nov | 2 semanas | ⏳ Pendiente | `feature/fase-7-colision-archivos` |
| 8 | Pruebas finales | — | 20 nov – 27 nov | 1 semana | ⏳ Pendiente | — |

---

### Fase 1: Preparación de entornos, repositorio y CI inicial ✅
**Estado:** 100% COMPLETADO

- ✅ Estructura de monorepo
- ✅ Variables de entorno
- ✅ Scripts npm + Jest/react-scripts
- ✅ Git saneado

---

### Fase 2: Optimización y mejora del rendimiento ✅
**Estado:** 100% COMPLETADO

**Mejoras implementadas:**
- Batchear DELETEs (-50% roundtrips)
- INSERT atómico, sin race conditions
- Paralelización con Promise.all (-50% a -88% latencia)
- Eliminar N+1 queries (-97.5% ops)
- Row explosion fix (-66%)
- Code-splitting frontend (-65%)
- Logging removal (-100%)

**Mejora global estimada (no medida): -71% latencia | 3.5x más rápido**

**Documentación:** 6 archivos en `docs/fase-02-optimizacion-rendimiento/`

---

### Fase 3: Integración con GitHub ✅
**Fechas:** planificada 4–18 sep 2026 · implementada 10–11 sep 2026 · E2E con GitHub real y limpieza segura de ramas 5–6 oct 2026  
**Estado:** 100% COMPLETADO (fusionada en `master` el 6 oct 2026, PR #4)

**Funcionalidades (manejar GitHub sin salir de TaskMate):**
- ✅ 1. Conectar un grupo con un repositorio (GitHub App, flujo seguro de instalación)
- ✅ 2. La IA analiza el repositorio y propone las siguientes tareas (chat con selector de proyecto, confirmación explícita, permiso del admin)
- ✅ 3. Explorador del repositorio (página `/github`: repositorio, archivos, commits)
- ✅ 5. Rama por tarea (`tm/<slug>-<tid8>`), con limpieza segura al cerrar la tarea
- ✅ 6. Progreso automático por PR (webhooks firmados; PR fusionado → tarea completada)

**Además:** se corrigieron todos los problemas existentes detectados (transacciones ACID y 3FN, JWT en todas las rutas, autorización por grupo, servidor de IA autenticado, XSS en el chat) y los 9 que encontró el E2E con GitHub real. Pruebas: de 52 fallando a 1353 pasando (6 oct 2026).

**Documentación:** 3 archivos en `docs/fase-03-integracion-github/`

---

### Fase 4: Pipeline CI/CD completo ✅
**Fechas:** planificada 18 sep – 9 oct 2026 · implementada 9–22 oct 2026 (alcance, plan y paso 1 el 9 oct; pasos 2–5, revisión y correcciones el 22 oct)  
**Estado:** 100% COMPLETADO (rama `feature/fase-4-cicd-github-actions`)

**Funcionalidades (el CI/CD del repositorio del grupo sin salir de TaskMate; pestaña CI/CD en `/github`):**
- ✅ 1. TaskMate propone el pipeline (detectado del repositorio o, si el grupo lo permite, con IA) y lo sube: build, pruebas y análisis estático para Node.js (npm) y Python, sin comandos libres
- ✅ 2. Panel de ejecuciones en vivo (WebSocket `/events`)
- ✅ 3. Logs y anotaciones (errores con archivo y línea) dentro de TaskMate
- ✅ 4. Ejecutar, re-ejecutar fallidos y cancelar
- ✅ 5. Deploy a GitHub Pages con entornos (staging en `/<repo>/staging/`, producción en `/<repo>/`) y aprobación del admin
- ✅ 6. Staging automático con cada cambio que pasa el CI y rollback de producción
- ✅ 13. Notificaciones (pipeline fallido, deploy terminado, solicitudes y decisiones)

**Además:** regreso directo a la selección de repositorio al volver de GitHub tras darle acceso a otro repositorio, scripts que nunca terminan fuera de las etapas y diálogos opacos. Revisión con verificación adversarial (107 agentes, 112 requisitos, 43 defectos confirmados, unos 30 distintos) y corrección en 5 áreas: plantilla v2 del workflow (build y deploy separados, deploys en cola, solo se reconstruye la versión que se publica), solo versiones verificadas de la rama principal, un miembro solo pide la versión de staging, vincular un repositorio exige permiso de escritura en GitHub, logs y tiempo real más confiables. Problemas existentes corregidos: un *deadlock* en la BD al completar una tarea mientras se crea su rama y un fallo del servidor de IA con JSON muy anidado. Ideas 7, 11 y 12 para después; la 8 pasa a la Fase 5; 9 y 10 descartadas. Pruebas: de 1353 a 1914 pasando (22 oct 2026: API 1228, frontend 404, Python 177, BD 105). E2E con GitHub real el 22 oct en `PabloP150/taskmate-fase4-demo`: la IA propuso el pipeline, staging automático, producción publicada por el admin y por una solicitud aprobada de un miembro, rollback, logs y anotaciones de un fallo, re-ejecutar y cancelar, y 118 eventos en vivo; de ahí salieron dos ajustes (títulos de deploy en español y sitio publicado que GitHub ya no guardaba).

**Documentación:** 2 archivos en `docs/fase-04-pipeline-cicd/` y la guía de la GitHub App de la Fase 3 actualizada

---

### Fases 5–8 ⏳

- **Fase 5 — Testing automático:** ciclo de pruebas por tarea.
- **Fase 6 — Integración con SonarQube.**
- **Fase 7 — Algoritmo de colisión de archivos** (junto con Christian Martínez; se apoya en las ramas y PRs por tarea de la Fase 3).
- **Fase 8 — Pruebas finales.**

---

**Documento generado:** 31 ago 2026  
**Última actualización:** 22 oct 2026 (Fase 4 completada; fechas planificadas sin cambios, según la tabla oficial de la línea de trabajo de Pablo Pineda)

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
| 4 | Pipeline CI/CD completo (build, pruebas, análisis estático, deploy y actualización automática) | Alta | 18 sep – 9 oct | 3 semanas | ⏳ En curso | `feature/fase-4-cicd-github-actions` |
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

### Fases 4–8 ⏳

- **Fase 4 — Pipeline CI/CD completo:** build, pruebas, análisis estático, deploy y actualización automática.
- **Fase 5 — Testing automático:** ciclo de pruebas por tarea.
- **Fase 6 — Integración con SonarQube.**
- **Fase 7 — Algoritmo de colisión de archivos** (junto con Christian Martínez; se apoya en las ramas y PRs por tarea de la Fase 3).
- **Fase 8 — Pruebas finales.**

---

**Documento generado:** 31 ago 2026  
**Última actualización:** 6 oct 2026 (responsables y fechas alineados con la tabla oficial de la línea de trabajo de Pablo Pineda)

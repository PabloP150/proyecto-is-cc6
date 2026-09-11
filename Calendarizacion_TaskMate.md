# Calendarización TaskMate — Líneas de Trabajo

## Resumen Ejecutivo

**Proyecto:** TaskMate — Plataforma Colaborativa de Gestión de Tareas con IA  
**Duración Total:** 21 agosto — 8 septiembre 2026 (3 semanas)  
**Responsables:** Pablo Pineda (líder técnico) + Christian Martínez (integración)

---

## Línea de Trabajo 1: Pablo Pineda — Optimización y Cierre

### Fase 1: Entornos e Infraestructura CI ✅
**Estado:** 100% COMPLETADO

- ✅ Estructura de monorepo
- ✅ Variables de entorno
- ✅ Scripts npm + Jest/react-scripts
- ✅ Git saneado

---

### Fase 2: Optimización y Rendimiento ✅
**Estado:** 100% COMPLETADO

**Mejoras implementadas:**
- Batchear DELETEs (-50% roundtrips)
- INSERT atómico, sin race conditions
- Paralelización con Promise.all (-50% a -88% latencia)
- Eliminar N+1 queries (-97.5% ops)
- Row explosion fix (-66%)
- Code-splitting frontend (-65%)
- Logging removal (-100%)

**Mejora global: -71% latencia | 3.5x más rápido**

**Documentación:** 6 archivos en `docs/fase-02-optimizacion-rendimiento/`

---

### Fase 3: Integración GitHub ✅
**Fechas:** planificada 5-8 sep 2026 · realizada 10-11 sep 2026  
**Estado:** 100% COMPLETADO (rama `feature/fase-3-integracion-github`)

**Funcionalidades (manejar GitHub sin salir de TaskMate):**
- ✅ 1. Conectar un grupo con un repositorio (GitHub App, flujo seguro de instalación)
- ✅ 2. La IA analiza el repositorio y propone las siguientes tareas (chat con selector de proyecto, confirmación explícita, permiso del admin)
- ✅ 3. Explorador del repositorio (página `/github`: repositorio, archivos, commits)
- ✅ 5. Rama por tarea (`tm/<slug>-<tid8>`)
- ✅ 6. Progreso automático por PR (webhooks firmados; PR fusionado → tarea completada)

**Además:** se corrigieron todos los problemas existentes detectados (transacciones ACID y 3FN, JWT en todas las rutas, autorización por grupo, servidor de IA autenticado, XSS en el chat). Pruebas: de 52 fallando a 1153 pasando.

**Pendiente:** recorrer el checklist E2E con la GitHub App real (ya registrada; BD de desarrollo ya migrada).

**Documentación:** 3 archivos en `docs/fase-03-integracion-github/`

---

## Línea de Trabajo 2: Christian Martínez — Infraestructura

### Fases 4-8 (Paralelas)
- Fase 4: CI/CD con GitHub Actions
- Fase 5: Testing automático integral
- Fase 6: SonarQube analysis
- Fase 7: Algoritmo colisión de archivos (conjunta; se apoya en las ramas y PRs por tarea de la Fase 3)
- Fase 8: Pruebas finales

---

## Hitos

| Hito | Fecha | Estado |
|------|-------|--------|
| Fase 1 | 25 ago | ✅ Completo |
| Fase 2 | 4 sep | ✅ Completo |
| Fase 3 | 8 sep (real: 11 sep) | ✅ Completo |
| Fases 4-8 | 8 sep | ⏳ Pendiente (fecha a reprogramar) |

---

**Documento generado:** 31 ago 2026  
**Última actualización:** 11 sep 2026

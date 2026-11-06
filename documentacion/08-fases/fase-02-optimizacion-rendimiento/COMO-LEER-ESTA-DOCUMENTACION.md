# Cómo Leer Esta Documentación

**Guía de navegación — Fase 2: Optimización y Mejora del Rendimiento**

> **Nota de cierre (3 nov 2026).** Antes de usar cualquier número de esta carpeta:
> - **Todas las mejoras son estimaciones con tiempos supuestos o modelos conceptuales, no mediciones.**
> - La única medición (28 ago 2026) toma tiempos de lecturas que la Fase 2 no cambió; ver [README, Medición real](README.md#-medición-real-benchmarks).
> - La Fase 3 reemplazó parte de los cambios (borrados e inserciones en paralelo) por transacciones.
>
> El proyecto se cerró después de la Fase 4; lo que quedó sin hacer está en [cierre del proyecto](../../01-proyecto/cierre-del-proyecto.md).

---

## 📚 Estructura de Documentos

Esta carpeta contiene **6 documentos**: esta guía y 5 documentos complementarios que abordan el antes y después de la Fase 2 desde diferentes ángulos.

### 1. **[README.md](README.md)** — Visión General + Estado al Cierre
**Para:** Entender qué se hizo, qué sigue vigente y qué se midió de verdad

📋 Contenido:
- Nota de cierre y metadata (fechas, estado, commits)
- Objetivo y contexto (por qué se hizo Fase 2)
- Tabla de 5 commits + narrativa por commit, con los extractos reales y una «Nota (estado al cierre)» en cada cambio
- Tabla "Antes vs. Ahora" con la mejora estimada y el estado al cierre de cada cambio
- Sección "Medición real (benchmarks)": qué mide la única corrida y por qué no evalúa las mejoras
- Diagramas Mermaid (secuencia del borrado de una tarea, patrón N+1)
- Cómo reproducir/verificar y pendientes con su estado

**Tiempo de lectura:** 15 min  
**Mejor para:** Ejecutivos, PMs, visión general rápida

---

### 2. **[TABLA-COMPARATIVA-RAPIDA.md](TABLA-COMPARATIVA-RAPIDA.md)** — Reference Card
**Para:** Ver de un vistazo cuánto se estima que mejoró cada cosa

📋 Contenido:
- Resumen ejecutivo en tabla (90 segundos)
- 10 cambios desglosados con antes/después
- Mejoras estimadas por cambio
- Ranking de impacto (crítico → bajo)
- Escenarios ilustrativos (dashboard, crear proyecto, analytics)
- Estado al cierre de cada cambio

**Tiempo de lectura:** 10 min  
**Mejor para:** Desarrolladores que quieren números rápidos, stakeholders

---

### 3. **[ANALISIS-DETALLADO-IMPACTO.md](ANALISIS-DETALLADO-IMPACTO.md)** — Deep Dive
**Para:** Entender el código específico que cambió y por qué

📋 Contenido:
- **7 cambios principales** analizados línea por línea
- Código ANTES + DESPUÉS para cada uno (resumen de los diffs reales)
- Explicación de qué mejora (con ejemplos)
- Timeline de ejecución con tiempos supuestos (antes vs. después)
- Impacto estimado (ms, operaciones, factor de escala)
- Ejemplos de escalabilidad (100 miembros → 1000 miembros) según un modelo conceptual

**Cambios cubiertos:**
1. deleteTask() — batchear roundtrips
2. recordTaskAssignment() — INSERT condicional
3. Promise.all — paralelización
4. getWorkloadDistribution() — N+1 fix
5. getTeamAnalyticsSummary() — row explosion fix
6. Code-splitting — React.lazy
7. Logging removal — I/O en el hot path

**Tiempo de lectura:** 30-45 min  
**Mejor para:** Ingenieros senior, code reviewers, personas que quieren entender a fondo

---

### 4. **[RESUMEN-VISUAL.md](RESUMEN-VISUAL.md)** — Diagramas ASCII + Gráficos
**Para:** Ver visualmente cómo se estima que mejoraron las cosas

📋 Contenido:
- 8 diagramas ASCII (barras, timelines, flujos), todos con valores estimados o conceptuales
- Esquema de escalabilidad (subconsultas por fila vs. pre-agregación)
- Comparativa visual del bundle (antes/después, sin tamaños medidos)
- Tabla de impacto por tipo de usuario (ilustrativa)
- Conclusión visual con resumen ejecutivo

**Tiempo de lectura:** 5 min  
**Mejor para:** Presentaciones, personas visuales, ejecutivos que no quieren leer código

---

### 5. **[CODIGO-LADO-A-LADO.md](CODIGO-LADO-A-LADO.md)** — Código Antes/Después
**Para:** Comparar el código de cada cambio sin abrir git

📋 Contenido:
- Los 7 cambios principales con el código ANTES y DESPUÉS lado a lado (resumen de los diffs reales)
- Notas de qué cambió después, en la Fase 3
- Tabla resumen con la mejora estimada y el estado al cierre

**Tiempo de lectura:** 20 min  
**Mejor para:** Code reviewers, quien quiere ver el código sin el análisis

---

### 6. **COMO-LEER-ESTA-DOCUMENTACION.md** — Esta guía

---

## 🎯 Rutas de Lectura Recomendadas

### Ruta A: "Quiero la respuesta rápida" (10 minutos)
1. **[README.md](README.md)** → Nota de cierre + "Resumen de cambios" + "Antes vs. Ahora"
2. **[TABLA-COMPARATIVA-RAPIDA.md](TABLA-COMPARATIVA-RAPIDA.md)** → Tabla resumida

✅ Resultado: Entiendes qué se optimizó, cuánto se estima que mejoró y qué sigue vigente

---

### Ruta B: "Tengo que presentar esto" (20 minutos)
1. **[RESUMEN-VISUAL.md](RESUMEN-VISUAL.md)** → Diagramas ASCII
2. **[TABLA-COMPARATIVA-RAPIDA.md](TABLA-COMPARATIVA-RAPIDA.md)** → Números clave

✅ Resultado: Tienes visuals para mostrar al equipo/clientes (presentar los números como estimaciones)

---

### Ruta C: "Necesito revisar el código" (60 minutos)
1. **[README.md](README.md)** → Entender contexto + commits
2. **[ANALISIS-DETALLADO-IMPACTO.md](ANALISIS-DETALLADO-IMPACTO.md)** o **[CODIGO-LADO-A-LADO.md](CODIGO-LADO-A-LADO.md)** → Código + explicación
3. **Git** → `git show <commit>` para ver diffs exactos

✅ Resultado: Entiendes cada línea de código que cambió

---

### Ruta D: "Quiero todo" (90 minutos)
1. README.md
2. TABLA-COMPARATIVA-RAPIDA.md
3. ANALISIS-DETALLADO-IMPACTO.md
4. CODIGO-LADO-A-LADO.md
5. RESUMEN-VISUAL.md
6. `git show d7bf277 a04a576 a4148dd` (revisar commits)

✅ Resultado: Conocimiento completo de la Fase 2

---

## 📊 Números Clave (Spoilers)

**Si solo tienes 30 segundos** (todo estimado, nada medido):

| Métrica | Mejora estimada |
|---------|--------|
| Latencia global | **-71%** (escenario ilustrativo) |
| Roundtrips críticos | **-50%** (4 operaciones; 3 son transacciones desde la Fase 3) |
| DB operaciones (N+1) | **-97.5%** (201 → 5 ops en el modelo conceptual) |
| Bundle inicial | Menor (no medido) |
| Paralelización | **-88%** (1250ms → 150ms con tiempos supuestos; en serie desde la Fase 3) |

---

## 🔍 Búsqueda Rápida por Tema

### Si busco información sobre...

**Roundtrips de BD reducidos**
→ [TABLA-COMPARATIVA-RAPIDA.md](TABLA-COMPARATIVA-RAPIDA.md) sección "1️⃣"  
→ [ANALISIS-DETALLADO-IMPACTO.md](ANALISIS-DETALLADO-IMPACTO.md) sección "1. deleteTask()"

**Queries N+1 corregidas**
→ [TABLA-COMPARATIVA-RAPIDA.md](TABLA-COMPARATIVA-RAPIDA.md) sección "4️⃣"  
→ [ANALISIS-DETALLADO-IMPACTO.md](ANALISIS-DETALLADO-IMPACTO.md) sección "4. N+1 en getWorkloadDistribution()"  
→ [RESUMEN-VISUAL.md](RESUMEN-VISUAL.md) gráfico 3

**Paralelización (Promise.all)**
→ [TABLA-COMPARATIVA-RAPIDA.md](TABLA-COMPARATIVA-RAPIDA.md) sección "3️⃣"  
→ [ANALISIS-DETALLADO-IMPACTO.md](ANALISIS-DETALLADO-IMPACTO.md) sección "3. Paralelización"  
→ [RESUMEN-VISUAL.md](RESUMEN-VISUAL.md) gráfico 4

**Bug de exactitud corregido**
→ [TABLA-COMPARATIVA-RAPIDA.md](TABLA-COMPARATIVA-RAPIDA.md) sección "5️⃣"  
→ [ANALISIS-DETALLADO-IMPACTO.md](ANALISIS-DETALLADO-IMPACTO.md) sección "5. Row Explosion"

**Bundle size**
→ [TABLA-COMPARATIVA-RAPIDA.md](TABLA-COMPARATIVA-RAPIDA.md) sección "8️⃣"  
→ [ANALISIS-DETALLADO-IMPACTO.md](ANALISIS-DETALLADO-IMPACTO.md) sección "6. Code-Splitting"  
→ [RESUMEN-VISUAL.md](RESUMEN-VISUAL.md) gráfico 5

**Pruebas de rendimiento (28 ago)**
→ [README.md](README.md#-medición-real-benchmarks) sección "Medición real (benchmarks)" + sección "Cómo reproducir"

**Qué cambió después, en la Fase 3**
→ [README.md](README.md) notas «estado al cierre» + tabla "Antes vs. Ahora"  
→ [TABLA-COMPARATIVA-RAPIDA.md](TABLA-COMPARATIVA-RAPIDA.md#-estado-al-cierre-3-nov-2026) sección "Estado al Cierre"

**Escalabilidad a 1000+ miembros**
→ [ANALISIS-DETALLADO-IMPACTO.md](ANALISIS-DETALLADO-IMPACTO.md) sección "4. N+1 en getWorkloadDistribution()"  
→ [RESUMEN-VISUAL.md](RESUMEN-VISUAL.md) gráfico 8

---

## 💾 Archivos Relacionados (Fuentes)

### Código que cambió (revisar con git)
```bash
git show d7bf277  # Commit 3 — Optimizaciones DB principales
git show a04a576  # Commit 4 — Más roundtrips, WebSocket cleanup
git show a4148dd  # Commit 5 — Batch deletes, row explosion fix
git show 2589b55  # Commit 1 — Code-splitting, API key leak
git show 4969894  # Commit 2 — Logging removal
git show --stat 285bf14 349aa02  # Fase 3 — transacciones que reemplazaron parte de lo anterior
```

### Tests de rendimiento
```bash
cd taskmate-api
npm run test:performance  # Ejecutar benchmarks (no evalúan las mejoras de la Fase 2)
cat tests/performance.test.js  # Ver suite completa
```

### Otros documentos de Fase 2
```
documentacion/08-fases/fase-02-optimizacion-rendimiento/README.md   # Este es el principal
documentacion/08-fases/fase-01-entornos-repositorio-ci/README.md   # Contexto previo (Fase 1)
```

---

## ❓ Preguntas Frecuentes

**P: ¿Estos números son reales o estimados?**  
R: Las mejoras son **estimaciones**. Los números de "antes vs. después" (201 → 5 operaciones, -88%, -71%, etc.) salen de modelos conceptuales y tiempos supuestos, deducidos por inspección del SQL y del código; no se capturaron planes de ejecución ni mediciones. Los benchmarks de `npm run test:performance` (30ms, 17ms, 10ms, 4.39MB) sí son **números reales**, pero miden lecturas que la Fase 2 no cambió, con IDs sintéticos y sin línea base «antes», así que no dicen nada de las mejoras.

---

**P: ¿Debo leer todo esto?**  
R: No. La Ruta A (10 min) es suficiente para 90% de casos. Lee más si vas a:
- Implementar características similares
- Revisar el código en detalle
- Presentar al equipo/clientes
- Entender decisiones de arquitectura

---

**P: ¿Puedo reproducir estos benchmarks?**  
R: Sí, con `npm run test:performance` (requiere SQL Server local disponible). Ver sección "Cómo reproducir" en README.md. Medir de verdad las mejoras de la Fase 2 no se hará: el proyecto se cerró el 3 nov 2026.

---

**P: ¿Qué pasa si tengo más/menos usuarios?**  
R: Según los modelos (no medido):
- **Roundtrips**: -50% siempre (independiente de usuarios)
- **N+1**: la ventaja crece con el número de miembros (-97.5% con 100 a -99.75% con 1000, en el modelo), pero las agregaciones también crecen con el tamaño de las tablas
- **Paralelización**: -50% a -88% (depende de operación y del pool de conexiones)
- **Bundle**: independiente de usuarios (no medido)

---

**P: ¿Hay trade-offs o desventajas?**  
R: Sí:
- Code-splitting: la primera visita a otra página descarga su chunk
- Pre-agregación de queries: queries algo más largas (SQL mejor, mantenibilidad similar)
- Paralelización: limitada por el pool de conexiones (10 por defecto)
- Batches y paralelismo sin transacción: un error a mitad de camino dejaba datos a medias. Por eso la Fase 3 los cambió por transacciones (más roundtrips o ejecución en serie, pero atómicas)

---

**P: ¿Cuáles son las optimizaciones más importantes?**  
R: En orden (según las estimaciones):
1. **N+1 query fix** (-99.75% de operaciones en el modelo, 1000 miembros) — Crítico
2. **Paralelización** (-88% con tiempos supuestos) — Crítico, aunque en serie desde la Fase 3
3. **Code-splitting** (bundle inicial menor, no medido) — Importante
4. **Row explosion fix** (conteos correctos + -66% filas intermedias en el ejemplo) — Importante
5. **Roundtrips** (-50% × 4 ops) — Importante

---

## 📈 Próximos Pasos

Después de leer esta documentación:

1. **Si eres developer:** Familiarízate con patrones de optimización (N+1, paralelización, batching) y con cuándo conviene cambiarlos por transacciones
2. **Si eres architect:** Usa estos como referencia para futuras optimizaciones, midiendo antes y después
3. **Si eres PM/stakeholder:** Compartir "RESUMEN-VISUAL.md" con equipo, aclarando que los números son estimaciones
4. **Para el resto del proyecto:** las Fases 3 y 4 siguieron este formato de documentación; las Fases 5–8 no se realizarán (proyecto cerrado el 3 nov 2026)

---

**Documento generado:** 28 ago 2026 (corregido al cierre: 3 nov 2026)  
**Ubicación:** `documentacion/08-fases/fase-02-optimizacion-rendimiento/`  
**Commits relacionados:** `d7bf277`, `a04a576`, `a4148dd`, `2589b55`, `4969894`, `48ddea4`, `e959fc0`, `b34a0ee`, `887bfea`, `ba3f1cf`, `2531272`, `2c9673e`

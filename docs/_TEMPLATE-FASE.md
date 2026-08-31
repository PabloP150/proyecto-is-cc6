# Fase N: [Nombre de la Fase]

**Plantilla reutilizable para cada capítulo de fase**

---

## Metadata

| Campo | Valor |
|-------|-------|
| **Fase** | N |
| **Nombre** | [Nombre descriptivo] |
| **Complejidad** | [Baja/Media/Alta/Muy Alta] |
| **Fechas Planificadas** | [Inicio] — [Fin] |
| **Fechas Reales** | [Inicio] — [Fin] (si aplica) |
| **Estado** | [⏳ Planificada / 🔄 En Curso / ✅ Completada] |
| **Rama Git** | `feature/fase-N-...` o rama actual |
| **Responsable** | [Nombre] |

---

## Objetivo

¿Por qué se hace esta fase? Contexto y motivación.

### Problemas que Resuelve
- Problema 1
- Problema 2
- Problema 3

### Impacto Esperado
- Métrica 1: X% mejora
- Métrica 2: Y ahorrado
- Métrica 3: Z enablement

---

## Qué Se Hizo

### Tabla de Commits

| Hash | Mensaje | Archivos | Fecha |
|------|---------|----------|-------|
| `abc1234` | feat: descripcción del cambio | src/file1.js, src/file2.js | 1 sep |
| `def5678` | perf: otra mejora | src/file3.js | 2 sep |

### Narrativa por Cambio

#### Cambio 1: [Descripción]
**Problema:** [Qué no funcionaba bien]  
**Solución:** [Qué cambió]  
**Archivos afectados:** `src/file.js`  
**Commits relacionados:** `abc1234`

```javascript
// ANTES
const oldCode = () => {
  // ...
};

// DESPUÉS
const newCode = () => {
  // ...
};
```

---

## Antes vs. Ahora

| Funcionalidad | Antes | Después | Mejora | Medición |
|---------------|-------|---------|--------|----------|
| [Feature 1] | Métrica A | Métrica B | Cambio | Real/Estimada |
| [Feature 2] | Métrica A | Métrica B | Cambio | Real/Estimada |

---

## Diagramas

### Diagrama 1: [Concepto]

```mermaid
[Mermaid diagram aquí]
```

### Diagrama 2: [Otro concepto]

```mermaid
[Otro Mermaid aquí]
```

---

## Cómo Reproducir / Verificar

### Pasos para Validar los Cambios

1. **Revisar commits:**
   ```bash
   git show abc1234
   git show def5678
   ```

2. **Ejecutar tests:**
   ```bash
   npm test
   npm run test:performance  # si aplica
   ```

3. **Verificar en UI:**
   - Paso 1
   - Paso 2
   - Paso 3

### Requisitos
- Dependencias: [list]
- Variables de entorno: [list]
- BD: [si requiere]

---

## Commits Relacionados

- `abc1234` — [Descripción]
- `def5678` — [Descripción]

**Ver todos:**
```bash
git log --oneline --grep="fase-N" --all
```

---

## Pendientes

- [ ] Tarea 1 (bloqueador)
- [ ] Tarea 2 (no-bloqueador)
- [ ] Tarea 3 (opcional)

**Notas:**
- Las tareas marcadas como no-bloqueador fueron documentadas explícitamente y no afectan el go-live de esta fase.
- Las pendientes opcionales pueden ser abordadas en fases futuras.

---

## Referencias Relacionadas

- [Fase anterior]
- [Fase siguiente]
- [Documento de arquitectura]

---

**Documento generado:** [Fecha]  
**Autor:** [Nombre]

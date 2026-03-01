---
description: Crear plan de implementación, auditar con 4 agentes, y esperar confirmación antes de codificar
---

Objetivo: transformar un requerimiento en un plan ejecutable, auditarlo, y esperar confirmación sin tocar código.

Tarea: `$ARGUMENTS`

## FASE 1: Crear Plan

### Entregable del plan
1. Restatement de requerimientos.
2. Supuestos y preguntas abiertas.
3. Fases de implementación (paso a paso).
4. Archivos candidatos a modificar.
5. Riesgos + mitigaciones.
6. Estrategia de pruebas.
7. Estimación de complejidad (`LOW|MEDIUM|HIGH`).

### Reglas
- Este prompt **no implementa** cambios.
- Si hay ambigüedad, hacer preguntas antes de cerrar el plan.
- Guardar plan en `.pi/plan/<feature>.md`.

## FASE 2: Auditar Plan

Una vez guardado el plan, invocar `tmux-plan-auditor`:

```bash
bash ~/.pi/agent/skills/tmux-plan-auditor/scripts/run_tmux_plan_audit.sh .pi/plan/<feature>.md
```

### Qué hace el auditor
Lanza 4 agentes en paralelo que revisan:
1. **Logic** - Contradicciones, dependencias circulares, pasos faltantes
2. **Code Quality** - Complejidad innecesaria, simplificaciones posibles
3. **Silent Failures** - Edge cases sin manejo, errores silenciosos
4. **Testing** - Cobertura estática, quality gates

### Output del auditor
En `_ctx/review_runs/<run-id>/`:
- `handoff.json` - Findings consolidados + parches propuestos
- `summary.md` - Resumen ejecutivo

## FASE 3: Revisar y Confirmar

1. Leer `handoff.json` y `summary.md`
2. Presentar findings al usuario:
   - Problemas detectados por severidad
   - Parches propuestos (deduplicados)
3. Capturar decisión del usuario por cada parche:
   - `approved` - Aplicar antes de ejecución
   - `rejected` - No aplicar
   - `deferred` - Aplicar después
4. Aplicar solo parches aprobados
5. Esperar confirmación explícita: `APROBAR` / `APROBAR CON CAMBIOS` / `RECHAZAR`

## Flujo Completo

```
Usuario: plan <tarea>
    ↓
FASE 1: Crear plan en .pi/plan/<feature>.md
    ↓
FASE 2: tmux-plan-auditor (4 agentes paralelos)
    ↓
FASE 3: Revisar findings + confirmar parches
    ↓
Usuario confirma → PASAR A EJECUCIÓN
```

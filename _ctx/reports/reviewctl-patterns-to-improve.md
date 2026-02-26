# Registro de patrones a mejorar (reviewctl)

Fecha: 2026-02-26
Contexto: prueba E2E del flujo `init -> explore -> plan -> run -> ingest -> verdict` sobre PR `fix/frontend-design-consistency`.

## Resumen
Durante la ejecución real se observaron inconsistencias entre etapas del pipeline. Este documento deja trazabilidad para corregirlas sin perder contexto.

## Patrones detectados

## 1) `run --no-plan` no evita bloqueo por plan ambiguo
- **Severidad**: Alta
- **Síntoma**: aunque se pasa `--no-plan`, `run` falla con precondición de plan faltante/ambiguo.
- **Impacto**: contradice la UX esperada; bloquea casos válidos de revisión sin plan formal.
- **Comportamiento esperado**: `--no-plan` debe omitir `plan_resolved` en precondiciones.
- **Evidencia**: ejecución de `reviewctl run --no-plan` devolviendo `Precondition failures: Plan is MISSING or AMBIGUOUS`.

## 2) Desalineación entre `plan.json` y REQUEST generados por `run`
- **Severidad**: Alta
- **Síntoma**: `plan.json` marcó 3 agentes requeridos (`code-reviewer`, `code-simplifier`, `pr-test-analyzer`), pero `run` generó REQUEST solo para 2 agentes.
- **Impacto**: la ejecución no respeta el contrato de plan; estado de completitud puede ser falso positivo.
- **Comportamiento esperado**: `run` debe generar REQUEST para todos los `required_agents`.

## 3) `verdict` calcula requeridos desde `REQUEST_*.md`, no desde `plan.json`
- **Severidad**: Alta
- **Síntoma**: en `final.md` aparece `Required Agents: 2`, pese a que `plan.json` tenía 3.
- **Impacto**: métrica de completitud incorrecta; riesgo de PASS con cobertura incompleta.
- **Comportamiento esperado**: fuente de verdad para requeridos debe ser `plan.json` (con fallback controlado).

## 4) Detección de tipo de review inconsistente para PR de UI
- **Severidad**: Media
- **Síntoma**: `plan --type auto` devolvió `sql` para un PR puramente frontend.
- **Impacto**: elección subóptima de agentes/herramientas; ruido en reports.
- **Comportamiento esperado**: reglas de `determineReviewType` ponderadas por archivos realmente cambiados en diff objetivo.

## 5) Estado de drift queda `UNKNOWN` aun con plan definido manualmente
- **Severidad**: Media
- **Síntoma**: `final.md` muestra `Drift Status: UNKNOWN` pese a tener `plan_path` explícito.
- **Impacto**: menor trazabilidad de alineación plan-implementación.
- **Comportamiento esperado**: recalcular drift tras `plan`/`run` o antes de `verdict`.

## Criterio de cierre sugerido
- `--no-plan` funcional con test de integración.
- `run` alinea REQUEST con `plan.json.required_agents`.
- `verdict` usa `plan.json` para completion status.
- `type auto` no clasifica PR UI como `sql` cuando no hay archivos SQL/migrations en diff.
- `drift_status` no queda en `UNKNOWN` si existe plan resuelto.

# Plan: mejoras de workflow para testing Python en reviewctl

**Fecha:** 2026-02-26
**Objetivo:** fortalecer la validación de pruebas y cobertura para cambios Python dentro del flujo `reviewctl`.

## Alcance

- `mini-services/reviewctl/src/commands/explore.ts`
- `mini-services/reviewctl/src/commands/run.ts`
- `mini-services/reviewctl/src/commands/ingest.ts` (si aplica parser de pytest)
- docs asociadas al flujo de statics

## Problema actual

1. El check "Test coverage as planned" en `explore` usa una heurística por nombre de archivo (`test|spec`) y no evidencia ejecución real.
2. `run` soporta herramientas estáticas (biome, ruff, pyrefly, coderabbit), pero no incluye `pytest` como gate explícito de ejecución de tests para Python.
3. No existe umbral de cobertura configurable para Python en el flujo.

## Objetivos de hardening de workflow

1. **Gate verificable de testing Python**
   - Añadir soporte de request para `pytest` cuando aplique stack Python.
   - Guardar estado auditable (`PENDING/DONE/FAILED/SKIPPED`) con evidencia de comando y exit code.

2. **Cobertura como criterio explícito**
   - Definir umbral mínimo configurable (default 80%) en plan o flags.
   - Permitir que el análisis marque FAIL cuando cobertura < umbral.

3. **Mejorar señal en explore**
   - Cambiar el estado de "Test coverage as planned" a `UNKNOWN` si no hay evidencia de ejecución.
   - Añadir evidencia de si existe configuración Python de tests (`pytest.ini`, `pyproject.toml`, carpeta `tests/`).

## Responsables por fase y criterio de salida

| Fase | Responsable | Criterio de salida |
|---|---|---|
| Fase 1 (Explore) | Maintainer reviewctl | Checklist de drift no marca PASS sin evidencia de ejecución |
| Fase 2 (Run) | Maintainer reviewctl | `REQUEST_statics_pytest.md` + `pytest_status.json` generados cuando aplica |
| Fase 3 (Ingest/Coverage) | Maintainer reviewctl | Parse mínimo de pytest + evaluación contra threshold |
| Fase 4 (Docs/Guardrails) | Maintainer reviewctl | Runbook actualizado con estados y ejemplos |

## Plan de implementación

### Fase 1 — Explore: señal confiable (bajo riesgo)
1. Ajustar drift checklist para no reportar PASS por presencia de archivos `test|spec` únicamente.
2. Agregar detección de capacidad de testing Python (config/tests dir) como evidencia auxiliar.
3. Mantener compatibilidad con comportamiento actual de salida markdown.

**DoD:** no se reporta PASS de cobertura sin evidencia directa.

### Fase 2 — Run: request y estado de pytest (riesgo bajo/medio)
1. Incluir `pytest` en el set de static tools con lógica de habilitación por stack/config.
2. Generar `REQUEST_statics_pytest.md` con ejemplos de ejecución (`pytest -q`, opcional cobertura).
3. Crear `statics/pytest_status.json` con campos equivalentes a otras tools.

**DoD:** pipeline puede solicitar, rastrear e ingerir pytest como herramienta de validación.

### Fase 3 — Ingest + threshold cobertura (riesgo medio)
1. Extender ingest estático para aceptar salida de pytest/cobertura.
2. Parsear señales mínimas: passed/failed/errors y coverage% si existe.
3. Evaluar threshold configurable (default 80%) y reflejar cumplimiento en status/final.
4. Aplicar checklist de errores observables:
   - capturar `exit_code`, `stderr` resumido y comando ejecutado,
   - evitar silent fallback sin marca explícita,
   - registrar razón de `UNKNOWN`/`SKIPPED`.
5. Definir mapeo de estados lógicos para respuestas API que expongan este estado:
   - `DONE` -> 200,
   - `FAILED` por input inválido -> 400,
   - `SKIPPED`/`UNKNOWN` -> 200 con estado explícito,
   - errores internos de ejecución/parsing -> 500.

**DoD:** salida pytest queda normalizada, observable y usable en verdict.

### Fase 4 — Documentación y guardrails
1. Documentar cómo ejecutar pytest desde requests de statics.
2. Documentar limitaciones (si no hay coverage plugin, estado de coverage = UNKNOWN).
3. Agregar ejemplos de reporte esperado para `pr-test-analyzer`.

**DoD:** operador entiende claramente cuándo hay PASS/FAIL/UNKNOWN en tests Python.

## Reglas de ejecución

- Cambios atómicos por fase (sin mezclar refactors amplios).
- Priorizar alto impacto / bajo esfuerzo.
- Cada fase debe incluir evidencia de validación antes de pasar a la siguiente.

## Cobertura mínima por ruta crítica

- `explore` (detección y señal): tests unitarios de decisión de estado.
- `run` (generación de requests/status): tests unitarios de habilitación `pytest`.
- `ingest` (parse/result): tests unitarios de parsing con casos `DONE/FAILED/UNKNOWN`.
- Target general: 80% para código nuevo; rutas críticas del parser y mapeo de estado: 100%.

## No objetivos

- No introducir refactors amplios fuera de `reviewctl`.
- No imponer dependencias Python globales en repos JS/TS.
- No bloquear flujos no Python por ausencia de pytest.

## Riesgos y mitigaciones

1. **Falsos negativos por repos sin pytest instalado**
   - Mitigación: estado `SKIPPED` con razón explícita; no asumir FAIL automático.

2. **Parsing frágil de salida pytest**
   - Mitigación: parser defensivo; fallback a contenido raw + status UNKNOWN.

3. **Cobertura no disponible**
   - Mitigación: separar "tests execution" de "coverage evidence".

## Validación

- `bun run lint`
- `bun test`
- `bun run typecheck` (documentar deudas baseline no relacionadas)
- Smoke `reviewctl`:
  - `help`
  - `init`
  - `explore context`
  - `explore diff`
  - `plan`
  - `run`
  - `ingest --static pytest --input <sample-output>`
  - `verdict`

# Fixes ejecutados en `reviewctl`

**Fecha:** 2026-02-26  
**Objetivo:** Corregir los patrones detectados durante la prueba E2E de revisión de PR.

## Cambios implementados

1) `run --no-plan` funcional
- **Archivo:** `mini-services/reviewctl/src/commands/run.ts`
- **Cambio:** Se interpreta correctamente `--no-plan` (Commander `--no-plan` -> `plan === false`) y se omite la precondición `plan_resolved`.
- **Además:** Si no existe `plan.md` y se usa `--no-plan`, se emplea un conjunto seguro de agentes por defecto (`code-reviewer`, `code-simplifier`) en lugar de fallar.

2) Alineación de `plan.json` con los agentes de `run`
- **Archivo:** `mini-services/reviewctl/src/commands/run.ts`
- **Cambio:** `run` ahora utiliza `plan.json` como fuente de verdad (`required_agents` + `optional_agents`) con fallback a `plan.md`.
- **Fix adicional:** Se actualizó el parser de Markdown para agentes con múltiples guiones (`pr-test-analyzer`).

3) `verdict` usa agentes requeridos desde `plan.json`
- **Archivo:** `mini-services/reviewctl/src/commands/verdict.ts`
- **Cambio:** `checkCompletionStatus` toma `required_agents` desde `plan.json` (fallback a `REQUEST_*.md` solo si `plan.json` no existe).

4) `type auto` más preciso para PR frontend
- **Archivo:** `mini-services/reviewctl/src/lib/stack-detector.ts`
- **Cambio:** `determineReviewType` ahora considera archivos cambiados + zonas sensibles y no clasifica automáticamente como `sql` solo por presencia de Prisma.
- **Archivo:** `mini-services/reviewctl/src/commands/plan.ts`
- **Cambio:** Se pasan `changedFiles` y `sensitiveZones` a `determineReviewType`.

5) Persistencia de drift en `current.json`
- **Archivo:** `mini-services/reviewctl/src/commands/explore.ts`
- **Cambio:** Tras `explore diff`, además de `run.json`, también se actualiza `current.json` con `saveCurrentRun(run)`.

6) Mejoras de integridad y ergonomía
- **Archivo:** `mini-services/reviewctl/src/index.ts`
- **Cambio:** Se agrega la opción `--plan-path` en el comando `plan`.
- **Archivo:** `mini-services/reviewctl/src/lib/constants.ts`
- **Cambio:** Se agrega el estado `pending_ingest` al tipo `RunStatus`.

## Validación ejecutada

- **Flujo sin plan:**
  - `init --create`
  - `explore context`
  - `explore diff`
  - `run --no-plan`
  - **Resultado:** ✅ Se generan REQUESTs y no se bloquea por plan ambiguo.

- **Flujo con plan explícito:**
  - `plan --plan-path ...`
  - `run`
  - **Resultado:** ✅ Se generan 3 REQUESTs (`code-reviewer`, `code-simplifier`, `pr-test-analyzer`) alineados con `plan.json`.

- **Verificación de completitud:**
  - Con 2/3 reportes ingestados, `verdict` devuelve INCOMPLETE `2/3` y falta `pr-test-analyzer`.
  - **Resultado:** ✅ No hay falsos positivos de completitud.

- **Calidad estática:**
  - `bun run lint` ✅
  - `bun run typecheck` ⚠️ Persisten errores preexistentes del workspace (`examples/websocket`, `bun:test`), sin errores nuevos en `reviewctl`.

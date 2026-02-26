# reviewctl fixes ejecutados

Fecha: 2026-02-26
Objetivo: corregir patrones detectados en la prueba E2E de revisión de PR.

## Cambios implementados

1) `run --no-plan` funcional
- Archivo: `mini-services/reviewctl/src/commands/run.ts`
- Cambio: se interpreta correctamente `--no-plan` (Commander `--no-plan` -> `plan === false`) y se omite precondición `plan_resolved`.
- Además: si no hay `plan.md` y se usa `--no-plan`, usa agentes por defecto (`code-reviewer`, `code-simplifier`) en lugar de fallar.

2) Alineación `plan.json` -> agentes de `run`
- Archivo: `mini-services/reviewctl/src/commands/run.ts`
- Cambio: `run` ahora usa `plan.json` como fuente de verdad (`required_agents` + `optional_agents`) con fallback a `plan.md`.
- Fix adicional: parser markdown actualizado para agentes con múltiples guiones (`pr-test-analyzer`).

3) `verdict` usa requeridos desde `plan.json`
- Archivo: `mini-services/reviewctl/src/commands/verdict.ts`
- Cambio: `checkCompletionStatus` toma `required_agents` desde `plan.json` (fallback a `REQUEST_*.md` solo si falta plan.json).

4) `type auto` más preciso para PR frontend
- Archivo: `mini-services/reviewctl/src/lib/stack-detector.ts`
- Cambio: `determineReviewType` ahora considera archivos cambiados + zonas sensibles, y no clasifica automáticamente como `sql` solo por presencia de Prisma.
- Archivo: `mini-services/reviewctl/src/commands/plan.ts`
- Cambio: pasa `changedFiles` y `sensitiveZones` a `determineReviewType`.

5) persistencia de drift en `current.json`
- Archivo: `mini-services/reviewctl/src/commands/explore.ts`
- Cambio: tras `explore diff`, además de `run.json`, también actualiza `current.json` con `saveCurrentRun(run)`.

6) mejoras de integridad/ergonomía
- Archivo: `mini-services/reviewctl/src/index.ts`
- Cambio: agrega opción `--plan-path` en comando `plan`.
- Archivo: `mini-services/reviewctl/src/lib/constants.ts`
- Cambio: agrega estado de run `pending_ingest` al tipo `RunStatus`.

## Validación ejecutada

- Flujo sin plan:
  - `init --create`
  - `explore context`
  - `explore diff`
  - `run --no-plan`
  - Resultado: ✅ genera REQUESTs y no bloquea por plan ambiguo.

- Flujo con plan explícito:
  - `plan --plan-path ...`
  - `run`
  - Resultado: ✅ genera 3 REQUESTs (`code-reviewer`, `code-simplifier`, `pr-test-analyzer`) alineado con `plan.json`.

- Verificación de completitud:
  - con 2/3 ingestados, `verdict` devuelve INCOMPLETE `2/3` y falta `pr-test-analyzer`.
  - Resultado: ✅ no false-positive de completitud.

- Calidad estática:
  - `bun run lint` ✅
  - `bun run typecheck` ⚠️ persisten errores preexistentes del workspace (`examples/websocket`, `bun:test`), sin errores nuevos de reviewctl.

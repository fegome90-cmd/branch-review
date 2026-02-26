# Operating Model Improvement Plan (CLI flow + learning loop)

## Objetivo

Institucionalizar un flujo operativo confiable para cambios técnicos (plan -> ejecución -> validación -> PR -> merge) con menor riesgo de regresiones, mayor trazabilidad y mejor reutilización de aprendizajes.

## Alcance

- Reglas operativas para trabajo diario.
- Endurecimiento de flujo CLI para commit/PR.
- Claridad de typecheck por scope.
- Cierre de adopción con DoD y smoke flow.

## No alcance

- Refactors grandes fuera del flujo de operación.
- Cambios funcionales de producto no relacionados con el proceso.

---

## Fase 1 — Documentar estándares

### Entregables

1. `docs/operating-rules.md`
2. `docs/retro-template.md`
3. `docs/retrospective-2026-02-26.md`
4. Referencia cruzada desde `README.md`.

### Criterios de aceptación

- Reglas imperativas, concretas y medibles.
- Comandos reales del repo (no placeholders).
- Retro reutilizable para próximas iteraciones.

### Riesgo

- Documentación extensa sin adopción.

### Mitigación

- Mantener documentos cortos y accionables (checklists).

---

## Fase 2 — Endurecer flujo CLI

### Entregables

1. `scripts/flow-branch.sh` + `flow:branch`
2. `scripts/flow-merge.sh` + `flow:merge`
3. Guardrail para bloquear `/_ctx/review_runs/**` en commits de producto (override explícito).

### Criterios de aceptación

- `flow:branch` siempre parte de `origin/main` actualizado.
- Commits con artifacts operativos bloqueados por defecto.
- `flow:merge` ejecuta validaciones previas y merge reproducible.
- Cambios atómicos: 1 concern principal por PR.
- Tamaño objetivo por PR: <= 300 LOC netas (excluyendo lockfiles y snapshots).

### Riesgo

- Hooks demasiado estrictos bloquean casos legítimos.

### Mitigación

- Override documentado y auditado (`ALLOW_CTX_ARTIFACTS=1`).

---

## Fase 3 — Typecheck por scope

### Entregables

1. Scripts:
   - `typecheck:app`
   - `typecheck:mini-services` (si aplica)
   - `typecheck:all`
2. Documentación de uso por contexto.
3. `pre-pr` configurable por scope con defaults explícitos.

### Criterios de aceptación

- Alcance claro por comando.
- Evitar falsos negativos por código fuera de scope.
- Documentación de decisión (qué gate bloquea PR).

### Riesgo

- Ambigüedad entre validación local y CI.

### Mitigación

- Tabla de compatibilidad: local vs CI.

---

## Fase 4 — Cierre de adopción

### Entregables

1. `docs/pr-dod.md` (Definition of Done).
2. PR de adopción con docs + scripts + hooks.
3. Smoke flow obligatorio:
   - `flow:branch`
   - `flow:commit`
   - `flow:prepr`
   - `flow:pr`

### Criterios de aceptación

- DoD aplicado en PRs nuevos.
- Smoke flow ejecutado y registrado.
- Cambios aprobados sin bypass no documentado.

### Riesgo

- Baja adopción por fricción inicial.

### Mitigación

- Mensajes de error de hooks con guía exacta para resolver.

---

## Dependencias

1. Fase 1 antes de Fase 2 (primero reglas, luego enforcement).
2. Fase 3 puede ejecutarse en paralelo parcial con Fase 2.
3. Fase 4 depende de 1, 2 y 3.

## Secuencia sugerida

1. Fase 1
2. Fase 3
3. Fase 2
4. Fase 4

## Responsables por fase

| Fase | Responsable | Salida mínima esperada |
|---|---|---|
| Fase 1 | Maintainer de documentación | Reglas y plantillas publicadas + links en README |
| Fase 2 | Maintainer de tooling/scripts | Scripts de flujo y guardrails activos |
| Fase 3 | Maintainer de build/typecheck | Comandos por scope definidos y documentados |
| Fase 4 | Owner de adopción del equipo | DoD aplicado + smoke flow registrado |

## Indicadores de éxito por fase (medibles)

- **Fase 1:** 3 documentos creados + README referenciando flujo.
- **Fase 2:** hooks activos y scripts nuevos ejecutables en local.
- **Fase 3:** comandos de typecheck por scope funcionando y documentados.
- **Fase 4:** smoke flow completo ejecutado y PR de adopción mergeado.

## Checklist transversal de errores y observabilidad

- [ ] Cada script/hook devuelve mensajes accionables (qué falló + cómo resolverlo).
- [ ] Errores distinguen causa: configuración, validación, estado stale o permisos.
- [ ] Eventos clave de flujo (prepr, prepush, merge) quedan trazables en logs/CI.
- [ ] No exponer secretos en logs ni en salida de hooks.
- [ ] Toda condición `UNKNOWN`/`SKIPPED` incluye razón explícita para evitar silent failures.

## Mapeo de estado lógico del flujo

- `PASS` -> exit code `0`.
- `FAILED_VALIDATION` -> exit code `2` (input/estado inválido).
- `FAILED_EXECUTION` -> exit code `1` (error interno/script).
- `SKIPPED`/`UNKNOWN` -> exit code `0` con mensaje explícito y condición trazable.

## Baseline de testing por ruta crítica del flujo

- [ ] `flow:commit` bloquea commit directo y permite wrapper.
- [ ] `flow:prepr` valida lint + test + typecheck por scope configurado.
- [ ] `pre-push` bloquea cuando falta marcador de `pre-pr` o está stale.
- [ ] `flow:pr` ejecuta `pre-pr` antes de crear PR.

## Validación global

- `bun run lint`
- `bun test`
- `bun run typecheck:app` (si existe)
- `bun run typecheck:all` (si se implementa)

## Restricciones

- Cambios mínimos y reversibles por lote.
- Sin refactors grandes sin aprobación explícita.
- Toda modificación de comportamiento observable debe tener prueba asociada.

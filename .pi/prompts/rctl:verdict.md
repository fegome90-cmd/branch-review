---
description: Generar veredicto final y validar quality gates
---

Objetivo: Generar veredicto final desde todos los agentes y validar quality gates.

Tarea: `$ARGUMENTS` (opcional: run-id)

## FASE 1: Verificar Prerrequisitos

```bash
# Ver que todos los agentes fueron ingeridos
reviewctl status

# Verificar que no hay pendientes
cat _ctx/review_runs/<run-id>/run.json | grep -E "completed|missing"
```

## FASE 2: Ejecutar Verification Loop

Antes de verdict, validar quality gates con skill `verification-loop`:

```bash
# Leer comandos de validación del proyecto
cat AGENTS.md | grep -A 5 "Build and Validation"

# Ejecutar validación (adaptar al proyecto)
bun run lint:all 2>/dev/null || npm run lint 2>/dev/null || echo "No lint script"
bun test 2>/dev/null || npm test 2>/dev/null || echo "No test script"
```

Si falla:
- Invocar skill `debug-helper` para diagnosticar
- Invocar skill `gh-fix-ci` si es CI issue

## FASE 3: Generar Verdict

```bash
reviewctl verdict
```

### Posibles Veredictos

| Verdict | Significado | Acción |
|---------|-------------|--------|
| PASS | Todo OK | Proceder a merge |
| PASS_WITH_NOTES | OK con observaciones | Review notes, decidir |
| FAIL | Problemas críticos | Fix antes de merge |
| BLOCKED | Dependencias faltantes | Resolver blockers |

## FASE 4: Revisar Verdict

Leer output de verdict:
```bash
cat _ctx/review_runs/<run-id>/verdict.md
```

Presentar al usuario:
- Veredicto final
- Findings críticos (si hay)
- Recomendaciones
- Siguiente paso

## Si PASS

Invocar prompt `rctl:learning.md` para reflexión:
- ¿Qué funcionó bien?
- ¿Qué se puede mejorar?
- ¿Hay patrón reusable?

## Si FAIL

1. Identificar issues críticos
2. Crear plan de fixes
3. Invocar skills según tipo de issue:
   - `security-review` si hay security issues
   - `debug-helper` si hay bugs
   - `gh-fix-ci` si hay CI failures

## Skills Integradas

| Skill | Cuándo Usar |
|-------|-------------|
| `verification-loop` | Antes de verdict |
| `debug-helper` | Si quality gates fallan |
| `gh-fix-ci` | Si CI issues |
| `security-review` | Si security findings |

## Output

Presentar al usuario:
- Veredicto final (PASS/FAIL/BLOCKED)
- Resumen de findings
- Quality gates status
- Siguiente paso sugerido (merge o fix)

---
description: Limpiar artifacts y branches de review run
---

Objetivo: Limpiar artifacts y branches de una review run completada.

Tarea: `$ARGUMENTS` (opcional: run-id, --force)

## Cuándo Ejecutar

- Después de merge exitoso
- Cuando una review se cancela
- Para liberar espacio

## FASE 1: Verificar Estado

```bash
# Ver runs activos
reviewctl status

# Ver runs completados
ls _ctx/review_runs/
```

## FASE 2: Cleanup Selectivo

```bash
# Cleanup de run actual
reviewctl cleanup

# Cleanup de todos los runs
reviewctl cleanup --all

# Cleanup de runs antiguos (>7 días)
reviewctl cleanup --older-than 7
```

## FASE 3: Verificar Cleanup

```bash
# Verificar que se eliminaron artifacts
ls _ctx/review_runs/<run-id>/  # debería dar error

# Verificar branches eliminadas
git branch -a | grep review/
```

## Qué se Limpia

| Artifact | Ubicación |
|----------|-----------|
| Run directory | `_ctx/review_runs/<run-id>/` |
| Review branch | `review/<run-id>` |
| Worktree (si existe) | `../<run-id>-worktree/` |
| Explore outputs | `explore/` |

## Flags

| Flag | Descripción |
|------|-------------|
| `--all` | Limpiar todos los runs |
| `--older-than <days>` | Limpiar runs mayores a N días |

## Advertencias

⚠️ **No ejecutar si:**
- Run está en progreso
- Hay cambios sin commit en review branch
- Verdict pendiente

## Output

Presentar al usuario:
- Artifacts eliminados
- Branches eliminadas
- Espacio liberado
- Confirmación de cleanup

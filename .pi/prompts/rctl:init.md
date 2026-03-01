---
description: Inicializar review run con branch aislada y configuración
---

Objetivo: Inicializar una nueva review run en branch aislada.

Tarea: `$ARGUMENTS` (opcional: target branch, base branch)

## FASE 1: Verificar Estado

```bash
# Verificar que no hay cambios pendientes
git status --porcelain

# Verificar branch actual
git branch --show-current
```

Si hay cambios pendientes, preguntar: ¿Commit o stash?

## FASE 2: Crear Review Branch

```bash
reviewctl init --create --base <base-branch> --target <target-branch>
```

### Opcional: Worktree Aislado
Si el cambio es grande, considerar worktree aislado:
- Invocar skill: `git-worktree-curated`
- Beneficio: ambiente limpio, sin conflictos con otros trabajos

## FASE 3: Verificar Inicialización

```bash
# Verificar que se creó el run
reviewctl status

# Verificar estructura
ls _ctx/review_runs/<run-id>/
```

## Output Esperado

- Review branch creada: `review/<run-id>`
- Run metadata en `_ctx/review_runs/<run-id>/run.json`
- Branch base registrada para comparación

## Siguiente Paso

```
reviewctl explore context
```

## Skills Integradas

| Skill | Cuándo Usar |
|-------|-------------|
| `git-worktree-curated` | Si se necesita ambiente aislado |
| `git-workflow` | Si hay conflictos de branch |

## Confirmación

Presentar al usuario:
- Run ID creado
- Branch de review
- Base branch
- Siguiente paso sugerido

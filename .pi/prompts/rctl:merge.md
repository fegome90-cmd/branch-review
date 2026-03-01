---
description: Merge review branch después de verdict PASS
---

Objetivo: Merge de la review branch después de verdict PASS.

Tarea: `$ARGUMENTS` (opcional: merge strategy)

## Prerrequisitos

- ✅ Verdict = PASS
- ✅ Learning completado (si aplica)
- ✅ Usuario confirma merge

Verificar:
```bash
reviewctl status
cat _ctx/review_runs/<run-id>/verdict.md | head -5
```

## FASE 1: Pre-Merge Validation

```bash
# Verificar que estamos en review branch
git branch --show-current

# Verificar que base branch está actualizada
BASE_BRANCH=${BASE_BRANCH:-main}
git fetch origin "$BASE_BRANCH"

# Verificar no-conflict (abortar si hay conflictos)
git merge --no-commit --no-ff "origin/$BASE_BRANCH" && git merge --abort || git merge --abort
```

## FASE 2: Ejecutar Merge

```bash
reviewctl merge --squash  # o --merge o --rebase
```

### Estrategias

| Estrategia | Flag | Cuándo Usar |
|------------|------|-------------|
| Squash | `--squash` | Un commit limpio |
| Merge | `--merge` | Preservar historial |
| Rebase | `--rebase` | Linear history |

## FASE 3: Post-Merge

```bash
# Verificar merge exitoso
git log --oneline -3

# Push a base branch
git push origin <base-branch>
```

## FASE 4: Si hay PR

Si hay un PR abierto para esta branch:
- Usar `gh pr merge` para cerrar el PR y hacer merge en el remoto
- O confiar en el merge local + push de la FASE 2/3

```bash
gh pr merge <pr-number> --squash
```

## Skills Integradas

| Skill | Cuándo Usar |
|-------|-------------|
| `git-commit-curated` | Para commit de merge |
| `github-pr-curated` | Si hay PR |
| `git-workflow` | Si hay conflictos |

## Cleanup Post-Merge

Después de merge exitoso:
```bash
reviewctl cleanup
```

## Output

Presentar al usuario:
- Merge exitoso ✅
- Branch destino
- Commit hash
- Link a PR (si aplica)

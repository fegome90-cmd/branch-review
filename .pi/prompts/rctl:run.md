---
description: Ejecutar agentes de revisión con handoff requests
---

Objetivo: Generar handoff requests para agentes de revisión y ejecutarlos.

Tarea: `$ARGUMENTS` (opcional: max-agents, timeout)

## Prerrequisitos

- ✅ `reviewctl init` completado
- ✅ `reviewctl explore context` completado
- ✅ `reviewctl explore diff` completado
- ✅ `reviewctl plan` completado

Verificar:
```bash
reviewctl status
```

## FASE 1: Configurar Ejecución

```bash
# Ver agentes recomendados del plan
cat _ctx/review_runs/<run-id>/plan.md | grep -A 10 "agentes"

# Configurar timeout y max-agents
reviewctl run --max-agents 3 --timeout 8
```

### Parámetros

| Parámetro | Default | Descripción |
|-----------|---------|-------------|
| `--max-agents` | 3 | Máximo agentes paralelos |
| `--timeout` | 8 | Timeout en minutos |
| `--no-plan` | — | Ejecutar sin plan (requiere flag) |
| `--allow-drift` | — | Override drift protection |

## FASE 2: Monitorear Ejecución

```bash
# Ver progreso
reviewctl status

# Ver logs de agentes
ls _ctx/review_runs/<run-id>/*.txt
```

## FASE 3: Verificar Outputs

Cada agente genera:
- `<agent-name>.json` - Findings estructurados
- `<agent-name>.txt` - Reporte legible
- `<agent-name>.sh` - Script de ejecución

```bash
# Verificar que todos completaron
ls _ctx/review_runs/<run-id>/agent-*.json
```

## Manejo de Errores

Si un agente falla:
1. Revisar `<agent-name>.txt` para error
2. Verificar si es timeout → aumentar `--timeout`
3. Verificar si es dependencia → ejecutar prerrequisitos

## Siguiente Paso

```
reviewctl ingest --agent <agent-name>
```

## Output

Presentar al usuario:
- Agentes ejecutados
- Estado de cada uno (PASS/FAIL)
- Tiempo total
- Siguiente paso sugerido

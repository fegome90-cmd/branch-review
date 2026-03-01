---
description: Ingerir outputs de agentes y análisis estático
---

Objetivo: Ingerir outputs de agentes de revisión y análisis estático.

Tarea: `$ARGUMENTS` (opcional: agent-name, all)

## FASE 1: Listar Outputs Disponibles

```bash
# Ver outputs generados
ls -la _ctx/review_runs/<run-id>/agent-*.json

# Ver estado de ingesta
reviewctl status
```

## FASE 2: Ingerir por Agente

```bash
# Ver agentes disponibles
ls _ctx/review_runs/<run-id>/agent-*.json | xargs -n1 basename | sed 's/agent-\(.*\)\.json/\1/'

# Ingerir agente específico
reviewctl ingest --agent <agent-name>
```

## FASE 3: Validar Ingesta

Verificar que cada JSON tiene estructura esperada:

```json
{
  "agent": "<name>",
  "generated_at": "<timestamp>",
  "findings": [...]
}
```

### Validaciones

- [ ] JSON válido
- [ ] Tiene campo `agent`
- [ ] Tiene array `findings`
- [ ] Cada finding tiene `severity`, `title`, `evidence`

## FASE 4: Resumen de Findings

Después de ingerir, presentar resumen:

| Agente | Findings | Críticos | Altos | Medios |
|--------|----------|----------|-------|--------|
| logic | X | X | X | X |
| code-quality | X | X | X | X |
| silent-failure | X | X | X | X |
| testing-static | X | X | X | X |

## Manejo de Errores

Si JSON inválido:
1. Verificar que el agente completó
2. Revisar `<agent-name>.txt` para error
3. Re-ejecutar agente si es necesario

## Siguiente Paso

```
reviewctl verdict
```

## Output

Presentar al usuario:
- Agentes ingeridos
- Total findings por severidad
- Hallazgos críticos (si hay)
- Siguiente paso sugerido

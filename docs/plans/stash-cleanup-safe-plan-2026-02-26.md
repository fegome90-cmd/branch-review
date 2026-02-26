# Stash Cleanup Safe Plan

**Fecha:** 2026-02-26  
**Objetivo:** limpiar stashes antiguos sin pérdida de trabajo ni borrados accidentales.

## Responsables y criterio por fase

| Fase   | Responsable                     | Criterio de salida                                  |
| ------ | ------------------------------- | --------------------------------------------------- |
| Fase 1 | Maintainer del repo             | Inventario completo con categoría por stash         |
| Fase 2 | Maintainer del repo             | Decisión preliminar (`keep/drop/archive`) por stash |
| Fase 3 | Maintainer del repo             | Backups generados para stashes no triviales         |
| Fase 4 | Maintainer + aprobación usuario | Solo se eliminan stashes aprobados                  |
| Fase 5 | Maintainer del repo             | Reporte final con trazabilidad y política futura    |

## Fase 1 — Inventario y clasificación

1. Listar stashes con índice, rama origen y mensaje.
2. Clasificar cada stash en:
   - `obsoleto` (ya mergeado/aplicado),
   - `dudoso` (requiere inspección),
   - `importante` (debe preservarse).

**DoD:** existe tabla de inventario con categoría por stash.

## Fase 2 — Inspección mínima

Para cada stash:

1. Revisar archivos tocados (`git stash show --name-only stash@{n}`).
2. Si hay duda, revisar diff corto (`git stash show -p stash@{n}` acotado).
3. Definir decisión preliminar:
   - `keep`,
   - `drop`,
   - `archive`.

**DoD:** cada stash tiene decisión preliminar trazable.

## Fase 3 — Backup preventivo

1. Crear carpeta de respaldo (`tmp/stash-backups/`).
2. Exportar patch para stashes `dudoso/importante`:
   - `git stash show -p stash@{n} > tmp/stash-backups/stash-n.patch`
3. Verificar existencia y tamaño de archivos exportados.

**DoD:** stashes no triviales con backup verificable.

## Fase 4 — Limpieza controlada

1. Mostrar plan final de borrado al usuario (confirmación explícita).
2. Borrar únicamente stashes marcados `drop`.
3. Re-listar stashes para validar estado final.

**DoD:** solo se borran stashes aprobados por usuario.

## Fase 5 — Cierre

1. Reporte final:
   - stashes eliminados,
   - stashes retenidos,
   - backups generados (ruta).
2. Recomendaciones operativas:
   - convención de nombres (`tmp|keep|restore`),
   - TTL sugerido (ej. 7 días),
   - limpieza quincenal.

**DoD:** estado final claro y repetible.

## Semántica de error y observabilidad mínima

- Error de validación de entrada/comando -> abortar con mensaje accionable y exit `2`.
- Error de ejecución interna (lectura/escritura/comando git) -> abortar con mensaje accionable y exit `1`.
- Estado `SKIPPED` o `UNKNOWN` -> exit `0` con razón explícita registrada.
- Cada acción crítica debe registrar: stash objetivo, decisión aplicada y resultado.

## Principios de ejecución

- Aplicar cambios atómicos por lote (inventario, backup, limpieza, reporte).
- Evitar refactors grandes durante limpieza operativa.
- Priorizar alto impacto / bajo esfuerzo y trazabilidad total.

## Riesgos y mitigación

- Riesgo: borrar stash con trabajo valioso.
  - Mitigación: backup obligatorio antes de cualquier `drop` no trivial.
- Riesgo: clasificaciones ambiguas.
  - Mitigación: usar categoría `dudoso` y escalar decisión al usuario.
- Riesgo: ruido operacional por demasiados stashes.
  - Mitigación: política de naming + TTL.

## Validación mínima

- `git stash list` antes y después.
- Conteo de stashes eliminado coincide con plan aprobado.
- Backups presentes cuando aplica.

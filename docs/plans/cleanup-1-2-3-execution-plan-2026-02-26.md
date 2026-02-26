# Cleanup 1-2-3 Execution Plan

**Fecha:** 2026-02-26
**Objetivo:** separar cambios útiles de artefactos temporales, commitear solo lo correcto y dejar el repo limpio.

## Paso 1 — Separación segura (producto vs temporal)

1. Inventariar cambios con `git status --short`.
2. Clasificar cada ruta:
   - `keep` (código/docs de producto),
   - `discard` (temporales: `_ctx/**`, `tmp/**`, `pi-session-*.html`),
   - `review` (duda, pedir confirmación).
3. Presentar tabla de clasificación para aprobación explícita.

**DoD:** tabla `ruta -> categoría -> decisión` aprobada por usuario.

## Paso 2 — Commit limpio (solo keep)

1. Limpiar staging (`git reset`) y stagear únicamente `keep`.
2. Verificar staged diff (`git diff --cached --stat` + revisión por archivo).
3. Ejecutar validaciones:
   - `bun run lint`
   - `bun test`
   - `bun run flow:prepr` (scope apropiado)
4. Crear commit atómico con Conventional Commit.

**DoD:** commit sin artefactos temporales y gates en verde.

## Paso 3 — Limpieza de temporales

1. Eliminar solo rutas `discard` aprobadas.
2. Verificar repo limpio (`git status --short`).
3. Si aplica, conservar backups fuera del repo.

**DoD:** working tree limpio y sin pérdida de cambios útiles.

## Contrato de estados y errores

- `PASS` -> exit code `0`.
- `FAILED_VALIDATION` -> exit code `2` (clasificación inválida, input incompleto, decisión faltante).
- `FAILED_EXECUTION` -> exit code `1` (fallo interno de comandos git o filesystem).
- `SKIPPED` -> exit code `0` con razón explícita.

## Checklist de observabilidad

- [ ] Registrar comando ejecutado por fase y resultado (`ok|error`).
- [ ] Registrar cantidad de archivos por categoría (`keep|discard|review`).
- [ ] Registrar antes/después de `git status --short` en pasos críticos.
- [ ] Registrar ruta de backups generados y conteo.
- [ ] Si algo se omite (`SKIPPED`), documentar motivo explícito.

## Revisión manual de consistencia (antes de ejecutar)

- [ ] Revisar contradicciones entre DoD de cada paso y validación final.
- [ ] Confirmar que ninguna acción de borrado ocurra antes de aprobación de Paso 1.
- [ ] Confirmar que el commit del Paso 2 no incluya artefactos temporales.

## Riesgos y mitigación

- Riesgo: borrar cambios útiles por clasificación incorrecta.
  - Mitigación: no borrar nada sin aprobación previa en Paso 1.
- Riesgo: mezclar concerns en un commit.
  - Mitigación: commit atómico y staging selectivo por archivo.
- Riesgo: silent failure en limpieza.
  - Mitigación: verificar estado antes y después de cada acción.

## Principios de ejecución

- Cambios atómicos por paso (no mezclar limpieza de temporales con cambios de producto).
- Mantener PR pequeña y verificable; si crece, dividir en commits por concern.
- Preferir operaciones reversibles (backup antes de drop).

## Validación final

- `git status --short` limpio.
- Commit generado solo con archivos `keep`.
- Evidencia de ejecución de gates en salida de comandos.
- Pruebas mínimas por ruta crítica:
  - Paso 1: evidencia de clasificación aprobada.
  - Paso 2: evidencia de staged diff limpio de temporales.
  - Paso 3: evidencia de limpieza + conteo final de stashes/archivos temporales.

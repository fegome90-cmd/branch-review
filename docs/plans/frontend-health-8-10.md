# Plan: Frontend Health a 8/10 mínimo

## Objetivo

Elevar salud del frontend en arquitectura, data layer, accesibilidad, mantenibilidad y consistencia visual a mínimo **8/10**, con ejecución incremental y bajo riesgo.

## Restricciones

- Cambios mínimos por PR (sin refactors grandes sin validación)
- Mantener funcionalidad actual
- Verificar en cada fase: `bun run lint` y `bun run build`

## Métrica de calidad obligatoria

- Cobertura de tests frontend **>= 90%** en líneas/funciones/branches para módulos intervenidos.
- No se cierra fase sin reporte de cobertura (artefacto en CI o salida local reproducible).

## Punto 1 — Arquitectura de componentes (5/10 → 8.5/10)

### Alcance

- Extraer `src/app/page.tsx` en componentes composables:
  - `DashboardHeader`
  - `RunStatusCard`
  - `CommandPanel`
  - `CommandOutputCard`
  - `ResultsTabs` + tabs internas

### Entregables

- `src/components/review-dashboard/*`
- `src/components/review/types.ts` con contratos compartidos
- `src/app/page.tsx` reducido a orquestación

### Criterios de aceptación

- `page.tsx` < 200 líneas
- Ningún componente nuevo > 200 líneas
- Sin cambios funcionales visibles

## Punto 2 — Data layer (6/10 → 8.5/10)

### Alcance

- Crear hooks:
  - `useReviewRun`
  - `useReviewFinal`
  - `useReviewCommand`
- Envelopes API estandarizados `{ data, error }`
- Invalidación de estado tras comandos

### Entregables

- `src/hooks/review/*`
- Manejo explícito de errores 401/413/503

### Criterios de aceptación

- `page.tsx` sin `fetch` directo
- Reintentos controlados en GET, sin retry en mutaciones
- Mensajes de error consistentes para usuario

## Punto 3 — Accesibilidad (6/10 → 8/10)

### Alcance

- `aria-live="polite"` para salida de comandos
- `aria-busy` en ejecución
- Feedback de botones deshabilitados con motivo
- Validación por teclado de flujo principal

### Entregables

- Ajustes en componentes de panel y resultados
- Checklist de navegación por teclado

### Criterios de aceptación

- Lighthouse Accessibility >= 90
- 0 errores críticos en auditoría axe

## Punto 4 — Mantenibilidad (5/10 → 8/10)

### Alcance

- Extraer helpers puros de mapeo de estado/UI
- Reducir complejidad dentro de JSX
- Tests unitarios para componentes críticos

### Entregables

- Helpers en `src/lib/review-dashboard/*` o equivalente
- Tests para `CommandPanel`, `RunStatusCard`, `ResultsTabs`

### Criterios de aceptación

- Funciones bajo 50 líneas cuando aplique
- Cobertura frontend >= 90%

## Punto 5 — UI consistency (7/10 → 8.5/10)

### Alcance

- Estandarizar badges por estado y severidad
- Ajustar spacing y jerarquía visual
- Metadata real del producto (quitar referencias scaffold)
- Skeletons para estados de carga

### Entregables

- Actualización de `src/app/layout.tsx`
- Variantes visuales consistentes en dashboard

### Criterios de aceptación

- Estados equivalentes con misma semántica visual
- Sin layout shifts perceptibles en loading

## Plan de ejecución por PR

### PR-1 (estructura + base)

- Punto 1 completo
- Punto 5 metadata
- Validaciones: lint/build

### PR-2 (data + a11y)

- Punto 2 completo
- Punto 3 completo
- Validaciones: lint/build + Lighthouse + axe

### PR-3 (tests + consistencia final)

- Punto 4 completo
- Punto 5 completo
- Validaciones: lint/build + cobertura >= 90%

## Checklist transversal de errores y observabilidad (aplica a PR-2 y PR-3)

- Todas las llamadas de data layer deben mapear explícitamente `401|413|429|500|503` a mensajes de UI.
- No se permiten errores silenciosos: toda falla en mutation muestra feedback visible en `CommandOutput` o toast.
- Logging estructurado en cliente para fallas críticas (`event`, `status`, `code`, `requestId?`) sin secretos.
- Cada estado degradado debe tener estado visual explícito (`error`, `retry`, `disabled-reason`).

## Criterios medibles transversales (DoD global)

- Complejidad de cambio por PR: objetivo <= 12 archivos modificados (si supera, justificar en descripción del PR).
- Cambios atómicos: 1 preocupación principal por PR.
- Presupuesto de regresión visual: 0 roturas en flujo principal (init → explore → plan → run → verdict).
- Cobertura mínima frontend en módulos intervenidos: **>= 90%** (lines/functions/branches).

## Matriz mínima de testing (para sostener >=90%)

- **Unit**: helpers puros (`getStatusBadgeConfig`, mapeos de estado, parseo de envelope).
- **Component**: `CommandPanel`, `RunStatusCard`, `ResultsTabs` (render condicional, disabled reasons, eventos).
- **Integration (UI + hooks)**: ejecución de comando con token válido/inválido + refresh de estado.
- **Smoke manual**: flujo de comandos principal y revisión de estados vacíos/error/carga.

## Riesgos

- Riesgo de regresión UI por separación de componentes
- Riesgo de desalineación de contratos API en hooks

## Mitigaciones

- Cambios atómicos por PR
- Snapshot/manual smoke del flujo principal tras cada fase
- Bloqueo de merge si cobertura < 90%

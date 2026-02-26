# Backend Hardening Plan (P0/P1)

## Context
API backend en `src/app/api/**` con rutas principales:
- `GET /api` healthcheck
- `POST /api/review/command`
- `GET /api/review/run`
- `GET /api/review/final`
- `GET /api/review/state`

Patrones ya presentes: validación Zod, auth por token para command route, tests básicos.

## Objetivo
Aumentar seguridad operativa, consistencia de API y mantenibilidad sin refactor grande ni breaking changes.

## Estrategia de entrega (cambios pequeños y verificables)
- **Lote A (P0):** Issue 1 + Issue 2
- **Lote B (P0):** Issue 3
- **Lote C (P1):** Issue 4
- **Lote D (P1):** Issue 5 + Issue 6

Cada lote debe terminar con pruebas y chequeos antes de iniciar el siguiente.

## Fases y responsable
- **Fase 1 (Issue 1-2):** Implementación API core + tests de contrato HTTP.
- **Fase 2 (Issue 3):** Observabilidad y trazabilidad.
- **Fase 3 (Issue 4-6):** Refactor de servicio + hardening adicional.
- **Responsable:** backend owner del repositorio (ejecución), reviewer técnico (aprobación).

---

## Issue 1 (P0): Rate limit + lock de concurrencia en `/api/review/command`

### Problema
No hay límites de frecuencia ni lock para ejecución concurrente de comandos largos.

### Alcance
- Implementar rate limiting en memoria por `x-review-token` (fallback por IP).
- Implementar lock de ejecución activo para evitar procesos simultáneos conflictivos.
- Responder:
  - `429` cuando excede límite.
  - `409` cuando hay lock activo.

### Criterios de aceptación
- Cobertura de tests para `429`, `409`, y caso exitoso.
- Sin romper tests existentes.

---

## Issue 2 (P0): Unificar envelope de respuestas `{ data, error }`

### Problema
Las rutas usan formatos distintos (`{ run }`, `{ result }`, `{ success }`).

### Alcance
- Añadir helpers HTTP comunes:
  - `jsonOk(data, status?)`
  - `jsonFail(error, status, details?)`
- Migrar todas las rutas API a este contrato.

### Mapeo explícito estado lógico -> HTTP
- `OK` -> `200`
- `CREATED` -> `201`
- `INVALID_INPUT` -> `400`
- `UNAUTHORIZED` -> `401`
- `CONFLICT` (lock activo) -> `409`
- `PAYLOAD_TOO_LARGE` -> `413`
- `RATE_LIMITED` -> `429`
- `INTERNAL_ERROR` -> `500`
- `MISCONFIGURED` -> `503`

### Criterios de aceptación
- Todas las respuestas siguen `{ data, error }`.
- Errores de validación exponen `details` cuando aplique.
- Tests actualizados.

---

## Issue 3 (P0): Logging estructurado con `requestId`

### Problema
No existe trazabilidad consistente entre petición, comando, duración y resultado.

### Alcance
- Crear `src/lib/logger.ts` con salida JSON (`info`, `warn`, `error`).
- Generar/propagar `requestId` por request.
- Log de inicio/fin/error con duración y metadatos sanitizados.

### Criterios de aceptación
- Logs contienen `requestId`, `route`, `status`, `durationMs`.
- No se loguean secretos (`REVIEW_API_TOKEN`, header completo).

---

## Issue 4 (P1): Extraer Service Layer para command execution

### Problema
La lógica de negocio de ejecución CLI está concentrada en el route handler.

### Alcance
- Crear `ReviewCommandService` para:
  - validación operativa,
  - ejecución de `reviewctl`,
  - mapeo de errores de dominio.
- Mantener route handler delgado.

### Criterios de aceptación
- Handler de command simplificado (<50 líneas objetivo).
- Tests de servicio.
- Sin cambios funcionales de API.

---

## Issue 5 (P1): Hardening de auth por token

### Problema
Autenticación básica sin rotación ni comparación segura.

### Alcance
- Comparación en tiempo constante.
- Soporte de rotación simple opcional (`REVIEW_API_TOKEN_PREVIOUS`).
- Documentar estrategia en `.env.example`.

### Criterios de aceptación
- Token actual y previo válidos durante ventana de rotación.
- Tests para token válido/previo/inválido.

---

## Issue 6 (P1): Hardening de payload/output y taxonomía de errores

### Problema
Falta acotar tamaño de entrada/salida y clasificar mejor errores.

### Alcance
- Limitar tamaño de payload y longitud de args.
- Truncar output de comando de forma segura.
- Formalizar respuestas por clase de error: `400/401/409/413/429/500/503`.

### Criterios de aceptación
- Rechazo explícito de payload excesivo.
- Output acotado y estable.
- Tabla de errores documentada.

---

## Checklist transversal (errores + observabilidad)
- [ ] Cada endpoint define códigos HTTP esperados y payload de error.
- [ ] Cada endpoint emite logs estructurados con `requestId`.
- [ ] Errores internos incluyen contexto técnico en logs, no en respuesta pública.
- [ ] Timeouts y fallos de subprocess quedan diferenciados en logs.

## Dependencias
1. Issue 2 (envelope) antes de 4 y 6 para evitar retrabajo.
2. Issue 1 puede implementarse en paralelo con 2.
3. Issue 3 en paralelo con 1/2.

## Secuencia sugerida
1. Issue 1
2. Issue 2
3. Issue 3
4. Issue 4
5. Issue 5
6. Issue 6

## Validación global
- `bun test src/app/api/__tests__/health-route.test.ts src/app/api/review/__tests__/command-route.test.ts src/app/api/review/__tests__/file-routes.test.ts`
- `bun run typecheck`
- `bun run lint`

## Riesgo detectado por auditoría
- Se observó falla de gate (`bun run typecheck:app`, exit_code=1) en auditoría.
- Acción: resolver esos errores o separar explícitamente el scope de validación para este plan antes de merge final.

## Restricciones
- Cambios mínimos, sin refactor masivo no aprobado.
- Mantener compatibilidad razonable del frontend consumidor.
- **Regla de test asociado:**
  - Cambio de comportamiento en endpoint o contrato -> test obligatorio.
  - Cambio interno sin impacto observable -> test recomendado (no bloqueante) con justificación en PR.

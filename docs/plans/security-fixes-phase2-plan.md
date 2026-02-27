# Security Fixes - Phase 2 Plan

**Date:** 2026-02-27
**Scope:** Fixes de alta y media prioridad identificados en code review post-security fixes
**Status:** Draft

---

## Overview

Este plan aborda los issues identificados en el code review de los fixes de seguridad aplicados en Phase 1.

| Prioridad    | Issues | Archivos Afectados |
| ------------ | ------ | ------------------ |
| P0 (Crítica) | 3      | 5                  |
| P1 (Media)   | 2      | 2                  |
| P2 (Baja)    | 3      | 4                  |

---

## P0 - Alta Prioridad (Must Have)

### P0-1: Logging de Errores en API Routes

**Problema:** Los bloques `catch` ignoran el error original, dificultando debugging.

**Archivos a modificar:**

- `src/app/api/review/final/route.ts`
- `src/app/api/review/run/route.ts`
- `src/app/api/review/state/route.ts`

**Cambios:**

```typescript
// ANTES
} catch {
  return jsonFail('Failed to read final data', 500, { code: 'INTERNAL_ERROR' });
}

// DESPUÉS
} catch (error) {
  logger.error('Failed to read final data', {
    error: error instanceof Error ? error.message : String(error),
  });
  return jsonFail('Failed to read final data', 500, { code: 'INTERNAL_ERROR' });
}
```

**Dependencias:** Importar `logger` de `@/lib/logger`

**Testing:** Tests existentes deben seguir pasando

---

### P0-2: Logging de Intentos de Path Traversal

**Problema:** `safeResolve` retorna `null` silenciosamente ante ataques.

**Archivo a modificar:** `src/lib/review-runs.ts`

**Cambios:**

```typescript
// ANTES
function safeResolve(basePath: string, ...segments: string[]): string | null {
  const resolved = path.resolve(basePath, ...segments);
  const normalizedBase = path.resolve(basePath);

  if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
    return null;
  }
  return resolved;
}

// DESPUÉS
function safeResolve(basePath: string, ...segments: string[]): string | null {
  const resolved = path.resolve(basePath, ...segments);
  const normalizedBase = path.resolve(basePath);

  if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'warn',
        message: 'Path traversal attempt blocked',
        attemptedSegments: segments.join('/'),
      })
    );
    return null;
  }
  return resolved;
}
```

**Testing:** Agregar test que verifique logging

---

### P0-3: Cleanup de Variable de Entorno en Tests

**Problema:** `process.env.REVIEW_API_TOKEN` no se limpia entre tests.

**Archivo a modificar:** `src/app/api/review/__tests__/file-routes.test.ts`

**Cambios:**

```typescript
// ANTES
beforeEach(() => {
  process.env.REVIEW_API_TOKEN = TEST_TOKEN;
});

afterEach(() => {
  // No limpia el token
});

// DESPUÉS
const originalToken = process.env.REVIEW_API_TOKEN;

beforeEach(() => {
  process.env.REVIEW_API_TOKEN = TEST_TOKEN;
});

afterEach(() => {
  // Restore original environment
  if (originalToken === undefined) {
    delete process.env.REVIEW_API_TOKEN;
  } else {
    process.env.REVIEW_API_TOKEN = originalToken;
  }
});
```

**Testing:** Tests deben seguir pasando

---

## P1 - Media Prioridad (Should Have)

### P1-1: Logging de Fallos de Autenticación

**Problema:** Intentos fallidos de auth no se registran.

**Archivo a modificar:** `src/lib/review-auth.ts`

**Cambios:**

```typescript
// ANTES
export function isReviewTokenAuthorized(providedToken: string | null) {
  // ... sin logging
  return false;
}

// DESPUÉS
export function isReviewTokenAuthorized(providedToken: string | null) {
  // ... validaciones ...

  // Log failed auth (sin exponer el token)
  console.warn(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'warn',
      message: 'Authentication failed',
      providedTokenLength: providedToken?.length ?? 0,
    })
  );

  return false;
}
```

**Consideración:** No loggear el token real, solo metadata

---

### P1-2: Expandir Tests de Path Traversal

**Problema:** Solo se prueba un caso de path traversal.

**Archivo a modificar:** `src/app/api/review/__tests__/file-routes.test.ts`

**Cambios:**

```typescript
// ANTES
it('blocks path traversal attempts', async () => {
  const request = createAuthRequest('http://localhost/api/review/final?runId=..');
  // ...
});

// DESPUÉS
it('blocks various path traversal attempts', async () => {
  const maliciousRunIds = ['..', '../..', '../../../etc/passwd', '..%2F', '/etc/passwd'];

  for (const runId of maliciousRunIds) {
    const request = createAuthRequest(`http://localhost/api/review/final?runId=${runId}`);
    const response = await getFinal(request);
    expect([400, 404]).toContain(response.status);
  }
});
```

---

## P2 - Baja Prioridad (Nice to Have)

### P2-1: Eliminar Código Muerto

**Archivo:** `src/app/api/review/final/route.ts`

**Cambio:** Eliminar `.refine()` redundante que nunca se ejecuta.

```typescript
// ANTES
const runIdSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9_-]+$/)
  .refine((val) => !val.includes('..'), 'Path traversal not allowed');

// DESPUÉS
const runIdSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9_-]+$/);
```

**Nota:** El regex ya no permite puntos, el refine es código muerto.

---

### P2-2: Extraer Constantes de Validación

**Archivos nuevos:**

- `src/lib/constants.ts`

**Contenido:**

```typescript
export const VALIDATION = {
  RUN_ID_MIN_LENGTH: 1,
  RUN_ID_MAX_LENGTH: 120,
  RUN_ID_PATTERN: /^[a-zA-Z0-9_-]+$/,
} as const;
```

**Archivos a actualizar:**

- `src/app/api/review/final/route.ts`

---

### P2-3: Extraer Patrón Auth a HOF (Opcional)

**Archivo nuevo:** `src/lib/with-auth.ts`

**Contenido:**

```typescript
import type { NextRequest } from 'next/server';
import type { NextResponse } from 'next/server';
import { jsonFail } from '@/lib/http';
import { isReviewTokenAuthorized } from '@/lib/review-auth';

export function withAuth(handler: (request: NextRequest) => Promise<NextResponse>) {
  return async (request: NextRequest) => {
    const providedToken = request.headers.get('x-review-token');
    if (!isReviewTokenAuthorized(providedToken)) {
      return jsonFail('Unauthorized', 401, { code: 'UNAUTHORIZED' });
    }
    return handler(request);
  };
}
```

**Nota:** Esto es refactor opcional, no esencial para seguridad.

---

## Execution Order

```
Phase 2.1 (P0 - Blocking)
├── P0-3: Test cleanup (evita flaky tests)
├── P0-1: Error logging en API routes
└── P0-2: Path traversal logging

Phase 2.2 (P1 - Important)
├── P1-1: Auth failure logging
└── P1-2: Expand path traversal tests

Phase 2.3 (P2 - Polish)
├── P2-1: Remove dead code
├── P2-2: Extract constants
└── P2-3: Extract auth HOF (optional)
```

---

## Verification Checklist

- [ ] `bun run typecheck:app` pasa
- [ ] `bun test src/app/api/review/` pasa
- [ ] `bun test src/lib/` pasa
- [ ] Tests nuevos para path traversal logging
- [ ] No regression en funcionalidad existente

---

## Rollback Plan

Si hay problemas, revertir commits en orden inverso:

1. P2 changes (cosméticos)
2. P1 changes (logging)
3. P0 changes (críticos)

---

## Estimated Effort

| Fase      | Issues | Tiempo Estimado |
| --------- | ------ | --------------- |
| P0        | 3      | 15 min          |
| P1        | 2      | 10 min          |
| P2        | 3      | 15 min          |
| **Total** | **8**  | **40 min**      |

---

## Decision Points

1. **¿Incluir P2-3 (HOF)?** - Agrega complejidad pero reduce duplicación
2. **¿Usar logger existente o console.warn?** - Por consistencia, usar logger estructurado
3. **¿Nivel de detalle en logs?** - No loggear tokens, solo metadata

---

## Approval

- [ ] Plan aprobado para ejecución
- [ ] Ejecutar solo P0 + P1
- [ ] Ejecutar todo (P0 + P1 + P2)

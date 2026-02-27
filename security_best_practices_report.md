# Security Best Practices Report - Branch Review

**Generated:** 2026-02-26
**Scope:** Next.js 16.1.x + React 19.x + TypeScript Application
**Frameworks:** Next.js App Router, Prisma ORM, Bun Runtime

---

## Executive Summary

This security review identified **3 Critical/High**, **3 Medium**, and **3 Low** severity findings in the branch-review codebase. The most critical issues involve a **path traversal vulnerability** in the file reading API, **missing authentication** on several API endpoints, and **token storage in localStorage** which is vulnerable to XSS attacks.

The codebase demonstrates several positive security practices including timing-safe token comparison, Zod schema validation, rate limiting, command allowlisting, and proper `.env` file handling. However, defense-in-depth measures like security headers and CSP are missing.

---

## Critical & High Severity Findings

### SEC-001: Path Traversal Vulnerability in Run ID Parameter

| Attribute    | Value                                                                     |
| ------------ | ------------------------------------------------------------------------- |
| **Rule ID**  | NEXT-PATH-001, NEXT-FILES-001                                             |
| **Severity** | **HIGH**                                                                  |
| **Location** | `src/lib/review-runs.ts:29-31`, `src/app/api/review/final/route.ts:10-20` |
| **Impact**   | Attacker can read arbitrary JSON files on the server filesystem           |

**Evidence:**

```typescript
// src/lib/review-runs.ts:29-31
export async function readFinalByRunId<T = unknown>(runId: string) {
  const finalPath = path.join(runsRootPath(), runId, 'final.json');
  return readJsonIfExists<T>(finalPath);
}
```

```typescript
// src/app/api/review/final/route.ts:7-12
const runIdSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9._-]+$/); // <-- Allows ".." characters!
```

**Impact Statement:** An attacker can craft a `runId` like `..` or `../..` to escape the `_ctx/review_runs` directory and read arbitrary JSON files accessible to the application process.

**Proof of Concept:**

```
GET /api/review/final?runId=..
GET /api/review/final?runId=../..
```

**Fix:**

```typescript
// src/app/api/review/final/route.ts
const runIdSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9_-]+$/); // Remove "." from allowed characters

// OR add explicit path traversal check:
const runIdSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9._-]+$/)
  .refine((val) => !val.includes('..'), 'Path traversal not allowed');
```

**Mitigation:** In `readFinalByRunId`, verify the resolved path remains within the expected directory:

```typescript
export async function readFinalByRunId<T = unknown>(runId: string) {
  const runsRoot = runsRootPath();
  const finalPath = path.join(runsRoot, runId, 'final.json');
  const resolved = path.resolve(finalPath);

  if (!resolved.startsWith(path.resolve(runsRoot))) {
    throw new Error('Path traversal detected');
  }

  return readJsonIfExists<T>(resolved);
}
```

---

### SEC-002: Missing Authentication on API Endpoints

| Attribute    | Value                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| **Rule ID**  | NEXT-AUTH-001                                                                                               |
| **Severity** | **HIGH**                                                                                                    |
| **Location** | `src/app/api/review/run/route.ts`, `src/app/api/review/state/route.ts`, `src/app/api/review/final/route.ts` |
| **Impact**   | Unauthenticated users can access review run data and final results                                          |

**Evidence:**

```typescript
// src/app/api/review/run/route.ts - No auth check!
export async function GET() {
  try {
    const runData = await readCurrentRun();
    return jsonOk({ run: runData });
  } catch {
    return jsonFail('Failed to read run data', 500, { code: 'INTERNAL_ERROR' });
  }
}
```

```typescript
// src/app/api/review/state/route.ts - No auth check!
export async function GET() {
  try {
    const runData = await readCurrentRun<RunPayload>();
    // ... returns sensitive run data
  }
}
```

**Impact Statement:** The `/api/review/run`, `/api/review/state`, and `/api/review/final` endpoints expose review data without authentication, while the `/api/review/command` endpoint properly requires token authentication.

**Fix:**

```typescript
// Add auth check to each unprotected endpoint
import { isReviewTokenAuthorized } from '@/lib/review-auth';

export async function GET(request: NextRequest) {
  const providedToken = request.headers.get('x-review-token');
  if (!isReviewTokenAuthorized(providedToken)) {
    return jsonFail('Unauthorized', 401, { code: 'UNAUTHORIZED' });
  }
  // ... rest of handler
}
```

**Alternative:** If these endpoints are intended to be public, document this decision explicitly.

---

### SEC-003: API Token Stored in localStorage (XSS Vulnerable)

| Attribute    | Value                                              |
| ------------ | -------------------------------------------------- |
| **Rule ID**  | REACT-AUTH-001                                     |
| **Severity** | **HIGH**                                           |
| **Location** | `src/app/page.tsx:24-26`, `src/app/page.tsx:53-54` |
| **Impact**   | Any XSS vulnerability can exfiltrate the API token |

**Evidence:**

```typescript
// src/app/page.tsx:24-26
const [reviewToken, setReviewToken] = useState(() => {
  if (typeof window === 'undefined') {
    return '';
  }
  return window.localStorage.getItem('review_api_token') ?? '';
});

// src/app/page.tsx:53-54
function handleTokenChange(token: string) {
  setReviewToken(token);
  window.localStorage.setItem('review_api_token', token);
}
```

**Impact Statement:** Storing authentication tokens in `localStorage` makes them accessible to any JavaScript running on the page. A single XSS vulnerability would allow attackers to steal the token and gain full API access.

**Fix:**

Option 1 - Use HttpOnly cookies (preferred):

```typescript
// Server-side: Set token as HttpOnly cookie
// Client-side: Credentials automatically included in fetch
const response = await fetch('/api/review/command', {
  method: 'POST',
  credentials: 'include', // Include cookies
  // ... no manual token handling
});
```

Option 2 - Use in-memory storage with session duration:

```typescript
// Store token only in memory, clear on page unload
const [reviewToken, setReviewToken] = useState<string>('');
// User must re-enter token on each session
```

---

## Medium Severity Findings

### SEC-004: Missing Security Headers

| Attribute    | Value                                                                                   |
| ------------ | --------------------------------------------------------------------------------------- |
| **Rule ID**  | NEXT-HEADERS-001, REACT-HEADERS-001                                                     |
| **Severity** | **MEDIUM**                                                                              |
| **Location** | `next.config.ts`, No middleware.ts                                                      |
| **Impact**   | Application lacks defense-in-depth against XSS, clickjacking, and content-type sniffing |

**Evidence:**

```typescript
// next.config.ts - No security headers configured
const nextConfig: NextConfig = {
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};
```

**Fix:**

Create `src/middleware.ts`:

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Content Security Policy (adjust based on app needs)
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"
  );

  // Prevent MIME-type sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking
  response.headers.set('X-Frame-Options', 'DENY');

  // Control referrer information
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  return response;
}

export const config = {
  matcher: '/:path*',
};
```

---

### SEC-005: Command Execution via spawn() - High-Risk Pattern

| Attribute    | Value                                                     |
| ------------ | --------------------------------------------------------- |
| **Rule ID**  | NEXT-INJECT-002                                           |
| **Severity** | **MEDIUM**                                                |
| **Location** | `src/lib/review-command-service.ts:93-117`                |
| **Impact**   | Potential for command injection if validation is bypassed |

**Evidence:**

```typescript
// src/lib/review-command-service.ts:93-117
async function runReviewctl(cliArgs: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', cliArgs, {
      // spawn() with cliArgs
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // ...
  });
}
```

**Mitigating Factors:**

- Commands are allowlisted (`ALLOWED_COMMANDS`)
- Args keys are validated with regex `/^[a-zA-Z0-9-]+$/`
- Args values are typed as `string | number | boolean`
- No `shell: true` option

**Recommendation:** This is a high-risk pattern that is well-mitigated. Document the security model and ensure the allowlist and validation remain strict. Consider adding:

```typescript
// Explicitly disallow shell metacharacters in values
.refine((val) => typeof val !== 'string' || !/[;&|`$()]/.test(val),
  'Shell metacharacters not allowed')
```

---

### SEC-006: No Rate Limiting on Unauthenticated Endpoints

| Attribute    | Value                                          |
| ------------ | ---------------------------------------------- |
| **Rule ID**  | NEXT-DOS-001                                   |
| **Severity** | **MEDIUM**                                     |
| **Location** | All unauthenticated API routes                 |
| **Impact**   | Potential for DoS through unthrottled requests |

**Evidence:** Rate limiting is implemented only in `ReviewCommandService` for the `/api/review/command` endpoint. The `/api/review/run`, `/api/review/state`, and `/api/review/final` endpoints have no rate limiting.

**Fix:** Implement rate limiting at the middleware level or add to each endpoint.

---

## Low Severity Findings

### SEC-007: No Content Security Policy (CSP)

| Attribute    | Value                                        |
| ------------ | -------------------------------------------- |
| **Rule ID**  | NEXT-CSP-001, REACT-CSP-001                  |
| **Severity** | **LOW**                                      |
| **Location** | Application-wide                             |
| **Impact**   | Reduced defense-in-depth against XSS attacks |

**Recommendation:** Implement a CSP as shown in SEC-004.

---

### SEC-008: Logging Could Include Sensitive Context

| Attribute    | Value                                                      |
| ------------ | ---------------------------------------------------------- |
| **Rule ID**  | NEXT-LOG-001                                               |
| **Severity** | **LOW**                                                    |
| **Location** | `src/lib/logger.ts`, `src/app/api/review/command/route.ts` |
| **Impact**   | Logs may inadvertently capture sensitive data              |

**Evidence:**

```typescript
// src/app/api/review/command/route.ts
logger.info('Review command request received', { requestId, route });
logger.info('Review command completed', {
  requestId,
  route,
  command: parsed.data.command,
  // ...
});
```

**Recommendation:** Ensure no tokens, secrets, or PII are logged. Consider adding log redaction for known sensitive fields.

---

### SEC-009: Next.js Version Security Advisory Check

| Attribute    | Value                                       |
| ------------ | ------------------------------------------- |
| **Rule ID**  | NEXT-SUPPLY-001                             |
| **Severity** | **LOW**                                     |
| **Location** | `package.json`                              |
| **Impact**   | Potential exposure to known vulnerabilities |

**Evidence:** The project uses `next: ^16.1.1`. Verify this version is patched against the "react2shell" vulnerability (CVE-2025-66478). Patched versions include 16.0.7+.

**Recommendation:** Run `bun audit` or `npm audit` to check for known vulnerabilities in all dependencies.

---

## Positive Security Practices Observed

1. **Timing-safe token comparison** (`src/lib/review-auth.ts`) - Prevents timing attacks
2. **Zod schema validation** on all API inputs - Prevents type confusion and injection
3. **Request body size limits** (16KB) - Prevents resource exhaustion
4. **Command allowlisting** - Only specific reviewctl commands can be executed
5. **Strict arg key validation** - Regex `/^[a-zA-Z0-9-]+$/` prevents injection
6. **Rate limiting** on command endpoint - Prevents abuse
7. **`.env` files properly gitignored** - Secrets not committed
8. **No raw SQL** - Using Prisma ORM with parameterized queries
9. **No `NEXT_PUBLIC_` secrets** - Environment variables not exposed to client
10. **No `dangerouslySetInnerHTML` with user content** - XSS prevention

---

## Summary Table

| ID      | Finding                       | Severity | Status      |
| ------- | ----------------------------- | -------- | ----------- |
| SEC-001 | Path Traversal in runId       | **HIGH** | Needs Fix   |
| SEC-002 | Missing Auth on API Endpoints | **HIGH** | Needs Fix   |
| SEC-003 | Token in localStorage         | **HIGH** | Needs Fix   |
| SEC-004 | Missing Security Headers      | MEDIUM   | Recommended |
| SEC-005 | spawn() Command Execution     | MEDIUM   | Review      |
| SEC-006 | No Rate Limiting (unauth)     | MEDIUM   | Recommended |
| SEC-007 | No CSP                        | LOW      | Recommended |
| SEC-008 | Logging Sensitive Data        | LOW      | Review      |
| SEC-009 | Dependency Audit              | LOW      | Verify      |

---

## Next Steps

1. **Immediate:** Fix SEC-001 (path traversal) - add `..` blocking or path boundary check
2. **Immediate:** Fix SEC-002 (auth) - add token validation to all sensitive endpoints
3. **Short-term:** Fix SEC-003 (localStorage) - migrate to HttpOnly cookies or in-memory storage
4. **Short-term:** Implement SEC-004 (security headers) via middleware
5. **Review:** Audit SEC-005 command execution patterns
6. **Ongoing:** Run dependency audits regularly

---

_Report generated following Next.js and React security best practices guidelines._

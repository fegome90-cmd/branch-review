# Agent Task Card: branch-review API

> Auto-contenido para consumo por LLMs/agentes externos.

## Base URL

```
http://localhost:3001
```

## Authentication

Todos los endpoints bajo `/api/review/*` requieren autenticación:

**Método 1: Header**

```
X-Review-Token: <your-token>
```

**Método 2: Cookie**

```
Cookie: review_api_token=<your-token>
```

El token se configura via `REVIEW_API_TOKEN` en el entorno.

---

## Endpoints

### GET /api/review/info

**Público** - Retorna metadata del API sin requerir autenticación.

**Request:**

```bash
curl http://localhost:3001/api/review/info
```

**Response:**

```json
{
  "data": {
    "name": "branch-review",
    "version": "1.0.0",
    "description": "Multi-agent code review orchestration API",
    "baseUrl": "/api/review",
    "authentication": {
      "required": true,
      "methods": ["X-Review-Token header", "review_api_token cookie"]
    },
    "endpoints": [...],
    "rateLimits": {...},
    "errorCodes": [...],
    "workflow": [...]
  },
  "error": null
}
```

---

### GET /api/review/run

Obtiene el estado actual del run.

**Request:**

```bash
curl -H "X-Review-Token: your-token" http://localhost:3001/api/review/run
```

**Response (success):**

```json
{
  "data": {
    "run": {
      "runId": "review-20260227-123456",
      "status": "running",
      "branch": "feature/my-feature",
      "startedAt": "2026-02-27T12:00:00Z"
    }
  },
  "error": null
}
```

**Response (unauthorized):**

```json
{
  "data": null,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Unauthorized"
  }
}
```

---

### GET /api/review/final

Obtiene el veredicto final de un run completado.

**Parámetros:**

- `runId` (query, required): ID del run

**Request:**

```bash
curl -H "X-Review-Token: your-token" \
  "http://localhost:3001/api/review/final?runId=review-20260227-123456"
```

**Response (success):**

```json
{
  "data": {
    "result": {
      "verdict": "PASS",
      "summary": "All checks passed",
      "findings": {
        "P0": 0,
        "P1": 2,
        "P2": 5
      }
    }
  },
  "error": null
}
```

---

### GET /api/review/state

Obtiene un snapshot del estado actual del run.

**Request:**

```bash
curl -H "X-Review-Token: your-token" http://localhost:3001/api/review/state
```

**Response:**

```json
{
  "data": {
    "phase": "plan",
    "progress": 0.6,
    "artifacts": ["context.json", "diff.json"]
  },
  "error": null
}
```

---

### POST /api/review/command

Ejecuta un comando de reviewctl.

**Headers:**

- `Content-Type: application/json`

**Body:**

```json
{
  "command": "<command-name>",
  "args": {
    "<arg-name>": "<value>"
  }
}
```

**Comandos permitidos:**
| Comando | Descripción | Args |
|---------|-------------|------|
| `init` | Crear nuevo run | - |
| `explore` | Explorar contexto/diff | `mode: "context"\|"diff"` |
| `plan` | Generar plan de revisión | - |
| `run` | Crear handoffs para agentes | - |
| `ingest` | Capturar output de agente | `agent: string` |
| `verdict` | Generar veredicto final | - |
| `merge` | Merge del branch | - |
| `cleanup` | Limpiar artefactos | - |

**Request:**

```bash
curl -X POST \
  -H "X-Review-Token: your-token" \
  -H "Content-Type: application/json" \
  -d '{"command": "init"}' \
  http://localhost:3001/api/review/command
```

**Response (success):**

```json
{
  "data": {
    "output": "Run created: review-20260227-123456"
  },
  "error": null
}
```

**Response (rate limited):**

```json
{
  "data": null,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded"
  }
}
```

**Response (command in progress):**

```json
{
  "data": null,
  "error": {
    "code": "COMMAND_IN_PROGRESS",
    "message": "Another command is already running"
  }
}
```

---

### POST /api/review/token

Establece el token de autenticación via cookie HttpOnly.

**Request:**

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"token": "your-token"}' \
  http://localhost:3001/api/review/token
```

---

### DELETE /api/review/token

Limpia la cookie de autenticación.

**Request:**

```bash
curl -X DELETE http://localhost:3001/api/review/token
```

---

## Rate Limits

| Tipo              | Límite                | Ventana     |
| ----------------- | --------------------- | ----------- |
| Authenticated     | Sin límite específico | -           |
| Unauthenticated   | 30 requests           | 60 segundos |
| Command execution | 10 requests           | 60 segundos |

---

## Error Codes

| Código                | HTTP | Descripción                     |
| --------------------- | ---- | ------------------------------- |
| `UNAUTHORIZED`        | 401  | Token inválido o ausente        |
| `INVALID_INPUT`       | 400  | Payload inválido                |
| `NOT_FOUND`           | 404  | Recurso no encontrado           |
| `RATE_LIMITED`        | 429  | Rate limit excedido             |
| `COMMAND_IN_PROGRESS` | 409  | Otro comando ejecutándose       |
| `COMMAND_TIMEOUT`     | 503  | Comando excedió timeout (120s)  |
| `COMMAND_FAILED`      | 500  | Error en ejecución del comando  |
| `MISCONFIGURED`       | 503  | REVIEW_API_TOKEN no configurado |
| `INTERNAL_ERROR`      | 500  | Error interno del servidor      |

---

## Workflow Típico

```
1. POST /api/review/command {"command": "init"}
2. POST /api/review/command {"command": "explore", "args": {"mode": "context"}}
3. POST /api/review/command {"command": "explore", "args": {"mode": "diff"}}
4. POST /api/review/command {"command": "plan"}
5. POST /api/review/command {"command": "run"}
6. POST /api/review/command {"command": "ingest", "args": {"agent": "code-reviewer"}}
7. POST /api/review/command {"command": "verdict"}
8. GET /api/review/final?runId=<run-id>
```

---

## Notas para Agentes

1. **Siempre** incluir `X-Review-Token` header
2. **Verificar** `error.code` antes de continuar
3. **Reintentar** con backoff exponencial en 429/503
4. **Esperar** entre comandos (evitar 409 COMMAND_IN_PROGRESS)
5. **Timeout máximo**: 120 segundos por comando

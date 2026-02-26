# API Error Mapping

Rutas backend (`src/app/api/**`) usan envelope uniforme:

```json
{
  "data": null,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": {}
  }
}
```

## Command endpoint (`POST /api/review/command`)

- `400 INVALID_INPUT`: payload inválido
- `401 UNAUTHORIZED`: token inválido
- `409 COMMAND_IN_PROGRESS`: ejecución concurrente bloqueada
- `413 PAYLOAD_TOO_LARGE`: body excede límite
- `429 RATE_LIMITED`: excede ventana de rate limit
- `500 COMMAND_FAILED|COMMAND_EXECUTION_ERROR`: fallo de comando
- `503 MISCONFIGURED|COMMAND_TIMEOUT`: misconfig o timeout

## Health endpoint (`GET /api`)

- `200`: servicio OK
- `503 SERVICE_DEGRADED`: checks degradados (incluye detalles en `error.details`)

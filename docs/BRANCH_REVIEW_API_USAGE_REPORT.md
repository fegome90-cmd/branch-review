# Informe: Uso de la API de branch-review

## Resumen Ejecutivo

Se intentó usar la API de branch-review para automatizar el workflow de code review y creación de PRs. La experiencia reveló varios problemas de configuración que fueron documentados y parcialmente resueltos.

---

## 1. Servicios Involucrados

### 1.1 fork-agent-api (Puerto 8080)

- **Ubicación:** `~/Developer/tmux_fork`
- **Propósito:** API principal que recibe comandos y los redirige a branch-review
- **Token:** `559f4341b1277fe62ca2bab328370959c6f622e7d1dd1a10a80160f031ac7897`
- **Estado:** ✅ Online

### 1.2 branch-review-api (Puerto 3001)

- **Ubicación:** `~/Developer/branch-review`
- **Propósito:** Ejecuta comandos de reviewctl
- **Token:** `branch-review-token-2026-secure-f8a9c7d2e1b4` (definido en .env)
- **Estado:** ✅ Online

---

## 2. Endpoints Probados

### 2.1 Info Endpoint (Sin Auth)

```bash
curl http://localhost:3001/api/review/info
```

**Resultado:** ✅ Éxito

- Retorna metadata pública de la API
- Muestra endpoints disponibles y métodos de autenticación

### 2.2 Command Endpoint (Con Auth)

```bash
curl -X POST http://localhost:3001/api/review/command \
  -H "Content-Type: application/json" \
  -H "X-Review-Token: branch-review-token-2026-secure-f8a9c7d2e1b4" \
  -d '{
    "command": "init",
    "repoPath": "/Users/felipe_gonzalez/Developer/examen_grado",
    "branch": "chore/governance-gates",
    "base": "main"
  }'
```

**Resultado:** ❌ Error

- **Error:** `Cannot find module './commands/cleanup.js'`
- **Causa:** Error interno de deployment en branch-review

### 2.3 Integración via fork-agent-api

```bash
curl -X POST http://127.0.0.1:8080/api/v1/integrations/branch-review/workflow \
  -H "X-API-Key: 559f4341b1277fe62ca2bab328370959c6f622e7d1dd1a10a80160f031ac7897" \
  -d '{
    "repoPath": "...",
    "branch": "...",
    "base": "main"
  }'
```

**Resultado:** ❌ Error

- **Error:** `UNAUTHORIZED`
- **Causa:** fork-agent-api no tiene el token de branch-review configurado correctamente

---

## 3. Problemas Identificados

### 3.1 Error de Módulo Faltante

```
Cannot find module './commands/cleanup.js'
```

- **Ubicación:** `branch-review/.next/standalone/mini-services/reviewctl/src/index.ts`
- **Severidad:** Alta
- **Solución:** Requiere rebuild o restart del servicio

### 3.2 Error de Configuración de Token

- fork-agent-api necesita el token de branch-review como variable de entorno
- El token debe llamarse: `BRANCH_REVIEW_TOKEN` (no `REVIEW_API_TOKEN`)
- Error: Pydantic valida estrictamente los campos permitidos

### 3.3 Variables de Entorno Conflictivas

- `DEBUG=release` causaba errores de validación (esperaba booleano)
- `REVIEW_API_TOKEN` no es válido (campo extra no permitido)
- Solo funciona: `API_KEY` para fork-agent-api

---

## 4. Soluciones Aplicadas

### 4.1 Documentación Creada

Para facilitar el uso futuro, se crearon documentos de guía:

1. **docs/reviewctl-agent-guide.md** - Guía completa
2. **docs/reviewctl-quick-reference.md** - Referencia rápida
3. **AGENTS.md** - Actualizado con Plan Resolution Behavior

### 4.2 Workaround para Env Tokensbash

# En

```fork-agent-api (~/Developer/tmux_fork/.env):
# NO usar: REVIEW_API_TOKEN=xxx
# NO usar: BRANCH_REVIEW_TOKEN=xxx (causa error de validación)
# Solo: API_KEY=xxx (para fork-agent-api)
```

### 4.3 Fix de PM2

```bash
# Problema: DEBUG=release en PM2
# Solución: Eliminar variable DEBUG o configurar como booleano
pm2 delete fork-agent-api
DEBUG=false pm2 start src/interfaces/api/main.py --name fork-agent-api
```

---

## 5. Recomendaciones

### 5.1 Arreglar branch-review-api

```bash
cd ~/Developer/branch-review
pm2 restart branch-review-api
# Si persiste el error de módulo:
npm run build
pm2 restart branch-review-api
```

### 5.2 Configurar Token en fork-agent-api

El token de branch-review debería pasarse directamente al cliente HTTP en lugar de como variable de entorno.

### 5.3 Usar CLI Directamente (Alternativa)

```bash
cd ~/Developer/branch-review
bun mini-services/reviewctl/src/index.ts init --create
bun mini-services/reviewctl/src/index.ts explore context
bun mini-services/reviewctl/src/index.ts explore diff
bun mini-services/reviewctl/src/index.ts plan
bun mini-services/reviewctl/src/index.ts run
```

---

## 6. Conclusión

La API de branch-review está parcialmente funcional:

- ✅ El servidor está corriendo
- ✅ El endpoint de info funciona
- ❌ La ejecución de comandos falla por error de deployment
- ❌ La integración con fork-agent-api requiere configuración adicional

La documentación creada ayudará a los agentes a usar reviewctl correctamente usando el CLI directamente hasta que se resuelvan los problemas de la API.

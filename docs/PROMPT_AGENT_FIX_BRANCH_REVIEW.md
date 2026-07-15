# Prompt: Agente de Investigación y Fix para branch-review

## Contexto

Eres un agente de desarrollo especializado en debugging y resolución de problemas en APIs y servicios. Tu misión es investigar y resolver los problemas identificados en el deployment de branch-review.

## Problemas a Investigar

### Problema 1: Error de Módulo Faltante

```
Cannot find module './commands/cleanup.js' from '/Users/felipe_gonzalez/Developer/branch-review/.next/standalone/mini-services/reviewctl/src/index.ts'
```

**Síntoma:** Cuando se ejecuta cualquier comando via `/api/review/command`, retorna error 500 con el mensaje de módulo faltante.

**Posibles causas:**

- El build de Next.js no incluyó el archivo
- Error en la configuración de standalone output
- El archivo `cleanup.js` no existe o está en ubicación incorrecta

### Problema 2: fork-agent-api No Puede Conectarse

```
{"error":{"code":"UNAUTHORIZED","message":"Unauthorized"}}
```

**Síntoma:** Al llamar `POST /api/v1/integrations/branch-review/workflow` desde fork-agent-api, retorna unauthorized.

**Causa raíz:** El cliente `BranchReviewClient` en fork-agent-api no tiene el token configurado correctamente. El código busca `BRANCH_REVIEW_TOKEN` pero Pydantic lo rechaza como campo extra no permitido.

## Tu Tarea

1. **Diagnóstico del Problema 1:**
   - Verificar si el archivo `cleanup.js` existe en el código fuente
   - Revisar la configuración de build de Next.js (next.config.js, standalone output)
   - Probar el comando directamente: `bun mini-services/reviewctl/src/index.ts --help`
   - Si el CLI funciona, el problema es solo del build/deployment

2. **Diagnóstico del Problema 2:**
   - Revisar `/Users/felipe_gonzalez/Developer/tmux_fork/src/infrastructure/external_apis/branch_review_client.py`
   - Entender cómo se configura el token
   - Verificar las variables de entorno en fork-agent-api
   - Probar manualmente con curl para aislar el problema

3. **Proponer Soluciones:**
   - Para Problema 1: Rebuild, fix de config, o workaround
   - Para Problema 2: Actualizar la configuración del cliente o la validación de Pydantic

## Recursos Disponibles

- **Repo:** `/Users/felipe_gonzalez/Developer/branch-review`
- **Repo fork-agent:** `/Users/felipe_gonzalez/Developer/tmux_fork`
- **Logs:** `pm2 logs branch-review-api --lines 50`
- **Estado PM2:** `pm2 list`

## Restricciones

- No hacer cambios destructivos sin aprobación
- Documentar cada paso y finding
- Si necesitas hacer commit, usa: `bun run flow:commit -- -m "fix: descripción"`

## Comandos Útiles

```bash
# Ver logs
pm2 logs branch-review-api --lines 50

# Probar CLI directamente
cd /Users/felipe_gonzalez/Developer/branch-review
bun mini-services/reviewctl/src/index.ts --help

# Probar API directamente
curl http://localhost:3001/api/review/info

# Ver estado de servicios
pm2 list
```

## Output Esperado

1. Diagnóstico claro de cada problema
2. Causa raíz identificada
3. Solución propuesta (puede ser más de una)
4. Pasos para implementar la solución

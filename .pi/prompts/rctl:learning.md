---
description: Reflexión post-verdict para extraer patrones reutilizables y crear learned skills
---

Objetivo: Después de un verdict PASS, reflexionar sobre lo aprendido y crear skills reutilizables.

Contexto: `$ARGUMENTS` (run_id o descripción de la tarea completada)

## FASE 1: Reflexión

Revisar la sesión y responder:

### ¿Qué funcionó bien?
- Patrones que aceleraron el trabajo
- Herramientas/skills que fueron útiles
- Decisiones que evitaron problemas

### ¿Qué falló o fue lento?
- Errores que consumieron tiempo
- Procesos que podrían automatizarse
- Información que faltó

### ¿Qué patrón es reusable?
- Algo que probablemente vuelva a pasar
- Algo que otros proyectos podrían beneficiar
- Algo que no es trivial (exclusión: typos, one-time fixes)

## FASE 2: Skill Extraction

Si hay un patrón reusable, invocar `codex-learn-capture`:

```text
Contexto: [descripción de la tarea]
Patrón identificado: [nombre descriptivo]
Evidencia: [archivos/comandos específicos]
Por qué es reusable: [justificación]
```

### Estructura de learned skill

```markdown
---
name: learned-<pattern-name>
description: Use when <triggering conditions>.
---

# <Pattern Name>

## Context
When this applies.

## Problem
Specific problem this solves.

## Solution
Reusable technique.

## Example
Concrete code/command.

## Activation Signals
- Trigger 1
- Trigger 2
```

### Ubicación
`~/.pi/agent/skills/learned-<pattern-name>/SKILL.md`

## FASE 3: Validación

Verificar que la skill:
- [ ] Tiene frontmatter válido (name, description)
- [ ] Description tiene triggers específicos (no genérico)
- [ ] Incluye ejemplo concreto
- [ ] Scope es narrow (un patrón, no múltiples)

## FASE 4: Registro

Si se creó skill, registrar en `_ctx/review_runs/<run_id>/run.json`:

```json
{
  "learning_completed": true,
  "learned_skills": ["learned-<pattern-name>"],
  "learning_notes": "Breve descripción del patrón"
}
```

## Exclusiones

NO crear skill para:
- Typos o syntax errors
- One-time incidents (outages, flaky tests)
- Contexto puramente local que no se repetirá
- Cosas triviales (<5 min de trabajo)

## Ejemplos de Patrones Validos

| Patrón | Why Reusable |
|--------|--------------|
| PR feedback resolution | Todos los PRs tienen bots |
| CI fix prettier/biome | Común en proyectos JS/TS |
| Division by zero guard | Patrón defensivo general |
| Progressive disclosure | Skills grandes son comunes |

## Output

Presentar al usuario:
1. Resumen de reflexión
2. Skill creada (si aplica) con path
3. O justificación de por qué no se creó skill

Esperar confirmación: `APROBAR` / `AJUSTAR` / `SALTAR`

---
name: learned-progressive-disclosure
description: |
  Use when creating or refactoring skills that have grown too large (>300 lines) or have multiple phases/variants.
  Triggers: skill exceeds 300 lines, skill has multiple execution modes, skill mixes concerns (workflow + details).
  Pattern: SKILL.md as orchestrator (~150 lines) + resources/ for detailed instructions (~150 lines each).
---

# Progressive Disclosure for Skills

## Context
When a skill becomes too large, it contaminates the LLM context and becomes harder to maintain. Skills with multiple phases or variants are especially prone to bloat.

## Problem
- Skills >300 lines load unnecessary context
- Multi-phase skills require different instructions at different times
- Mixing orchestration with details creates maintenance burden
- Evals/workspace in skill directory add noise

## Solution

### Structure

```
~/.pi/agent/skills/<skill-name>/
├── SKILL.md           # Orchestrator (~150 lines max)
├── resources/         # Detailed instructions (loaded as needed)
│   ├── phase-1.md
│   ├── phase-2.md
│   └── variant-a.md
└── scripts/           # Optional executable helpers
```

### SKILL.md (Orchestrator)

Contains only:
- Frontmatter (name, description for triggering)
- Index/table of contents pointing to resources/
- Entry point instructions
- When to load which resource

```markdown
---
name: my-workflow
description: Multi-phase workflow. Triggers on X, Y, Z.
---

# My Workflow

## Phases

| Phase | Resource | When to Load |
|-------|----------|--------------|
| Init | resources/init.md | Starting fresh |
| Execute | resources/execute.md | After init |
| Cleanup | resources/cleanup.md | After execute |

## Entry Point
1. Determine current phase from context
2. Read corresponding resource
3. Execute instructions
4. Advance to next phase
```

### resources/ (Details)

Each file ~100-200 lines with:
- Specific instructions for that phase/variant
- Tools to use
- Output format
- Validation checklist

### Directory Hygiene

**DO NOT** mix in skill directory:
```
❌ skills/my-skill/
   ├── SKILL.md
   ├── evals/           # NO - put in skill-evals/
   ├── workspace/       # NO - put in skill-evals/
   └── *.json           # NO - artifacts go elsewhere
```

**Correct structure:**
```
✅ skills/my-skill/
   ├── SKILL.md
   ├── resources/
   └── scripts/

✅ skill-evals/my-skill/
   ├── evals.json
   └── workspace/
```

## Example

**Before (monolithic 500 lines):**
```markdown
# reviewctl-workflow

## Phase 1: Init
[100 lines of init instructions]

## Phase 2: Explore
[150 lines of explore instructions]

## Phase 3: Plan
[100 lines of plan instructions]

...
```

**After (progressive disclosure):**
```
reviewctl-workflow/
├── SKILL.md (~150 lines - index + entry)
└── resources/
    ├── init.md (~100 lines)
    ├── explore.md (~150 lines)
    └── plan.md (~100 lines)
```

Context loaded: ~300 lines max (orchestrator + 1 resource)

## Activation Signals

- Skill exceeds 300 lines
- Skill has 3+ distinct phases
- Skill has variants (e.g., by language, by framework)
- User complains skill is "too long" or "hard to navigate"
- Skill mixes orchestration with implementation details

## Quality Checklist

- [ ] SKILL.md < 200 lines
- [ ] Each resource < 250 lines
- [ ] Index table in SKILL.md points to all resources
- [ ] No evals/workspace in skill directory
- [ ] Resources are independently loadable

## Learned From

| Attribute | Value |
|-----------|-------|
| Session | 2026-02-28 |
| Context | Creating rctl-workflow skill system |
| Issue | Single skill would be ~1000 lines |
| Solution | Orchestrator + resources/ |
| Evidence | `.pi/plan/rctl-workflow-architecture.md` |

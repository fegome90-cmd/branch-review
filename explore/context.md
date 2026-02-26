# Context Analysis

## Run Information
- **Run ID**: run_20260226_61dea96e
- **Branch**: review/main-72cb7b2
- **Base Branch**: main
- **Generated**: 2026-02-26T15:04:58.737Z

## Stack Detection

### Primary Stack
- **Languages**: JavaScript, Python, TypeScript
- **Frameworks**: Next.js, React
- **Runtimes**: Node.js, Python

### Secondary Components
- **Databases**: Prisma
- **Services**: None detected
- **Build Tools**: Prisma CLI, npm/bun

## Sensitive Zones Touched

| Zone | Files | Risk Level |
|------|-------|------------|
| None detected | - | - |

## Relevant Commands

### Build/Test
```bash
bun run dev
bun run lint
```

### Database
```bash
bun run db:push
bun run db:generate
```

## Obvious Risks
1. No obvious high-risk areas detected

## Recommended Agents

Based on detected stack:
- **Always**: code-reviewer, code-simplifier
- **Third**: pr-test-analyzer

## Recommended Static Tools

- ruff: Python linter and formatter
- pyrefly: Python type checker
- biome: JS/TS linter and formatter
- coderabbit: AI external review (optional)

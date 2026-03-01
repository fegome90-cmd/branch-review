# AGENTS.md — UI Components

**Location:** `src/components/ui/`

## Overview

shadcn/ui component library. Based on Radix UI primitives with Tailwind CSS 4 styling.

## Structure

```text
src/components/ui/
├── button.tsx
├── dialog.tsx
├── dropdown-menu.tsx
├── input.tsx
├── select.tsx
└── ... (additional components)
```

## Conventions

- **Styling**: Tailwind CSS 4 + `tailwind-merge` + `clsx`
- **Components**: Use `cva` (class-variance-authority) for variants
- **Icons**: Lucide React
- **Format**: Biome (2-space, single quotes, trailing commas)

## Anti-Patterns

- **NEVER use hardcoded spacing values** — use Tailwind scale
- **DO NOT mix CSS approaches** — stay consistent with existing components
- **Avoid inline styles** — use Tailwind classes

## Linting

Run spacing validation before commit:

```bash
bun run lint:spacing-grid
```

## References

- Radix UI primitives for accessibility
- shadcn/ui installation pattern
- Tailwind CSS 4 documentation

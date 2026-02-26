# branch-review

> Code review tool for analyzing GitHub branches and pull requests

## Stack

- **Runtime**: Bun
- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript 5
- **Styling**: Tailwind CSS 4 + shadcn/ui
- **State**: Zustand + TanStack Query
- **Database**: Prisma
- **Auth**: NextAuth.js
- **Validation**: Zod + React Hook Form

## Commands

```bash
bun run dev      # Development server (port 3000)
bun run build    # Production build
bun run start    # Production server
bun run lint     # ESLint
bun db:push      # Push Prisma schema
bun db:generate  # Generate Prisma client
```

## Structure

```
src/
├── app/           # Next.js App Router pages
├── components/    # React components (shadcn/ui in ui/)
├── hooks/         # Custom hooks
└── lib/           # Utilities and configurations
```

## Development Guidelines

- Use `bun` for all package operations
- Follow existing component patterns from shadcn/ui
- Use Zod schemas for form validation
- Prefer server components when possible
- Use TanStack Query for data fetching

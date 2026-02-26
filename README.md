# branch-review

> Orchestrate multi-agent code reviews from CLI or dashboard

## What It Does

branch-review coordinates code review agents and static analysis tools into a unified workflow. Run reviews from the CLI with `reviewctl`, or manage them visually through the web dashboard.

**Two interfaces:**
- **reviewctl CLI** - Orchestrate reviews from terminal
- **Web Dashboard** - Visual review management at localhost:3000

## Features

- 8 CLI commands for complete review workflow
- Multi-agent support (code-reviewer, code-simplifier, sql-safety-hunter)
- Static analysis integration (biome, ruff, pyrefly)
- Plan-based reviews with drift detection
- Priority findings: P0 (blocking), P1 (important), P2 (minor)
- Real-time dashboard with verdict visualization

## Quick Start

```bash
bun install           # Install dependencies
bun run dev           # Start dashboard at localhost:3000
bun reviewctl help    # Show CLI commands
```

## CLI Commands

| Command | Purpose |
|---------|---------|
| `init` | Create review run on review/* branch |
| `explore context` | Gather repository context |
| `explore diff` | Analyze branch changes |
| `plan` | Generate review plan |
| `run` | Create handoff requests for agents |
| `ingest --agent <name>` | Capture agent output |
| `verdict` | Generate final PASS/FAIL verdict |
| `merge` | Merge branch after PASS |
| `cleanup` | Remove run artifacts |

## Workflow

```
init → explore context → explore diff → plan → run → ingest → verdict → merge
```

## API Endpoints

| Method | Endpoint | Returns |
|--------|----------|---------|
| GET | /api/review/run | Current run status |
| POST | /api/review/command | Execute reviewctl command |
| GET | /api/review/final | Final verdict JSON |
| GET | /api/review/state | Run state snapshot |

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Bun |
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 + shadcn/ui |
| State | Zustand + TanStack Query |
| CLI | Commander + Chalk |
| Database | Prisma |
| Auth | NextAuth.js |
| Validation | Zod + React Hook Form |

## Project Structure

```
src/
├── app/
│   ├── api/review/      # REST endpoints
│   └── page.tsx         # Dashboard UI
├── components/ui/       # shadcn/ui components
└── lib/                 # Services and utilities

mini-services/reviewctl/
└── src/
    ├── index.ts         # CLI entry
    ├── commands/        # Command handlers
    └── lib/             # CLI utilities
```

## Contributing

Read these before submitting PRs:

- [docs/operating-rules.md](docs/operating-rules.md)
- [docs/cli-flow.md](docs/cli-flow.md)
- [docs/pr-dod.md](docs/pr-dod.md)

## License

MIT

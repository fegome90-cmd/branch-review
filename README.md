# branch-review

[![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)](https://github.com/fegome90-cmd/branch-review)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/runtime-bun-black.svg)](https://bun.sh)

> Orchestrate multi-agent code reviews from CLI or dashboard

**branch-review** coordinates code review agents and static analysis tools into a unified workflow. Run reviews from the CLI with `reviewctl`, or manage them visually through the web dashboard.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [CLI Commands](#cli-commands)
- [Workflow](#workflow)
- [API Endpoints](#api-endpoints)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [PM2 Deployment](#pm2-deployment)
- [Quality Checks](#quality-checks)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Features

- **9 CLI commands** for complete review workflow
- **Multi-agent support** (code-reviewer, code-simplifier, sql-safety-hunter, silent-failure-hunter, pr-test-analyzer)
- **Static analysis integration** (biome, ruff, pyrefly)
- **Plan-based reviews** with drift detection
- **Priority findings**: P0 (blocking), P1 (important), P2 (minor)
- **Real-time dashboard** with verdict visualization
- **Post-PR learning hook** that extracts reusable decision skills

## Prerequisites

| Tool                             | Version | Purpose                          |
| -------------------------------- | ------- | -------------------------------- |
| [Bun](https://bun.sh)            | v1.3+   | Runtime and package manager      |
| [Git](https://git-scm.com)       | ≥2.0    | Version control                  |
| [PM2](https://pm2.keymetrics.io) | ≥5.0    | Production deployment (optional) |

**For Python projects** (optional):

| Tool                                 | Purpose             |
| ------------------------------------ | ------------------- |
| [Ruff](https://docs.astral.sh/ruff/) | Python linter       |
| [Pyrefly](https://pyrefly.org/)      | Python type checker |

## Quick Start

```bash
# Clone and install
git clone https://github.com/fegome90-cmd/branch-review.git
cd branch-review
bun install

# Start dashboard
bun run dev
# → Dashboard available at http://localhost:3000

# Or use CLI directly
bun run reviewctl help
```

## CLI Commands

| Command                 | Purpose                               |
| ----------------------- | ------------------------------------- |
| `init`                  | Create review run on review/\* branch |
| `explore context`       | Gather repository context             |
| `explore diff`          | Analyze branch changes                |
| `plan`                  | Generate review plan                  |
| `run`                   | Create handoff requests for agents    |
| `ingest --agent <name>` | Capture agent output                  |
| `status`                | Show run progress and status          |
| `verdict`               | Generate final PASS/FAIL verdict      |
| `merge`                 | Merge branch after PASS               |
| `cleanup`               | Remove run artifacts                  |

### Command Details

#### `init` - Initialize review run

```bash
reviewctl init --create --base main --target feat/my-feature
reviewctl init --create                              # base=auto, target=HEAD
reviewctl init --branch feat/x                       # deprecated, use --target
```

#### `status` - Show run status

```bash
reviewctl status              # current active run
reviewctl status --last       # most recent run
reviewctl status --run-id run_20260227_abc123
reviewctl status --json       # JSON output for automation
```

#### `run` - Generate agent handoffs

```bash
reviewctl run                         # fail if drift detected
reviewctl run --allow-drift           # override drift (debug only)
reviewctl run --max-agents 2
```

#### `ingest` - Capture agent/static output

```bash
reviewctl ingest --agent code-reviewer --input report.md
reviewctl ingest --static ruff --input ruff-output.txt
cat report.md | reviewctl ingest --agent code-simplifier --input -
```

## Workflow

```text
init → explore context → explore diff → plan → run → ingest → verdict → merge
```

### Drift Protection

The workflow detects drift (changes to context, diff, or plan after initial generation):

- **ALIGNED**: No changes detected
- **DRIFT_RISK**: HEAD changed but digests match
- **DRIFT_CONFIRMED**: File digests changed
- **DRIFT_OVERRIDE**: User approved with `--allow-drift`

## API Endpoints

| Method | Endpoint              | Auth     | Returns                   |
| ------ | --------------------- | -------- | ------------------------- |
| GET    | `/api/review/info`    | Public   | API metadata              |
| GET    | `/api/review/run`     | Required | Current run status        |
| POST   | `/api/review/command` | Required | Execute reviewctl command |
| GET    | `/api/review/final`   | Required | Final verdict JSON        |
| GET    | `/api/review/state`   | Required | Run state snapshot        |

### Authentication

```bash
# Via header
curl -H "X-Review-Token: your-token" http://localhost:3001/api/review/run

# Via cookie
curl -b "review_api_token=your-token" http://localhost:3001/api/review/run
```

## Tech Stack

| Layer      | Technology                 |
| ---------- | -------------------------- |
| Runtime    | Bun                        |
| Framework  | Next.js 16 (App Router)    |
| Language   | TypeScript 5               |
| Styling    | Tailwind CSS 4 + shadcn/ui |
| State      | Zustand + TanStack Query   |
| CLI        | Commander + Chalk          |
| Database   | Prisma                     |
| Auth       | NextAuth.js                |
| Validation | Zod + React Hook Form      |

## Project Structure

```text
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

docs/
├── agent-task-card.md   # API documentation for agents
├── cli-flow.md          # CLI workflow guide
├── report-contract.md   # Report format specification
└── pr-dod.md            # PR definition of done
```

## PM2 Deployment

Run the API as a daemon with PM2:

```bash
# 1. Create .env with your token (append if exists)
if [ ! -f .env ]; then touch .env; fi
echo "REVIEW_API_TOKEN=your-secure-token-here" >> .env

# 2. Build production bundle
bun run build

# 3. Start with PM2
pm2 start ecosystem.config.js

# 4. Save PM2 configuration
pm2 save
```

**API available at:** `http://localhost:3001`

## Quality Checks

```bash
bun run lint                                                # ESLint repo gate
bun run lint:biome                                          # Biome on JS/TS/JSON
bun run lint:ruff                                           # Ruff on Python files
bun run lint:all                                            # All linters
bun run test                                                # Run test suite
bun run typecheck:all                                       # Full typecheck
bun run audit:deps                                          # Dependency audit
```

### Pre-PR Validation

```bash
bun run flow:prepr    # Run all checks before PR
```

## Troubleshooting

### Common Issues

| Issue                  | Cause                       | Solution                                          |
| ---------------------- | --------------------------- | ------------------------------------------------- |
| `ENOTDIR` errors       | Stale build cache           | `rm -rf .next && bun run build`                   |
| Drift detected         | Files changed after explore | Re-run `explore context` and `explore diff`       |
| `reviewctl init` fails | Not in git repo             | Run from repository root                          |
| API returns 401        | Missing/invalid token       | Check `REVIEW_API_TOKEN` in `.env`                |
| PM2 won't start        | Port in use                 | `pm2 delete all && pm2 start ecosystem.config.js` |

### Debug Mode

```bash
# Enable verbose logging
DEBUG=reviewctl:* bun reviewctl status

# Check run state
cat _ctx/review_runs/current.json
```

## Contributing

Read these before submitting PRs:

- [docs/operating-rules.md](docs/operating-rules.md) - Development conventions
- [docs/cli-flow.md](docs/cli-flow.md) - CLI workflow guide
- [docs/pr-dod.md](docs/pr-dod.md) - PR definition of done

### Development Setup

```bash
bun install
bun run prepare    # Install git hooks
bun run dev        # Start development server
```

## License

MIT © Felipe González

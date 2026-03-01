# Contributing to branch-review

## Development Workflow

### Prerequisites

- **Runtime**: Bun (v1.3+)
- **Node**: v20+
- **Database**: SQLite (local development)

### Setup

```bash
# Install dependencies
bun install

# Start development server
bun run dev
```

The dashboard will be available at `http://localhost:3000`

### Available Scripts

| Script                            | Description                                    |
| --------------------------------- | ---------------------------------------------- |
| `bun run dev`                     | Start Next.js dev server on port 3000          |
| `bun run build`                   | Build production bundle with standalone output |
| `bun run start`                   | Start production server (requires build)       |
| `bun run lint`                    | Run ESLint with zero warnings                  |
| `bun run lint:biome`              | Run Biome check via shell script               |
| `bun run lint:ruff`               | Run Ruff check on Python files                 |
| `bun run lint:pyright`            | Run Pyright type checking                      |
| `bun run lint:all`                | Run all linters sequentially                   |
| `bun run lint:spacing-grid`       | Validate Tailwind spacing in UI components     |
| `bun run format`                  | Format all files with Prettier                 |
| `bun run format:check`            | Check formatting without modifying files       |
| `bun run typecheck`               | Run full TypeScript check                      |
| `bun run typecheck:app`           | Type check app scope only                      |
| `bun run typecheck:mini-services` | Type check mini-services scope only            |
| `bun run typecheck:all`           | Type check all scopes                          |
| `bun test`                        | Run all tests with Bun                         |
| `bun run audit:deps`              | Audit dependencies for vulnerabilities         |
| `bun run db:push`                 | Push Prisma schema to database                 |
| `bun run db:generate`             | Generate Prisma client                         |
| `bun run db:migrate`              | Run Prisma migrations in dev                   |
| `bun run db:reset`                | Reset database and re-run migrations           |

### Git Flow Scripts

| Script                         | Description                               |
| ------------------------------ | ----------------------------------------- |
| `bun run flow:branch`          | Create new branch via flow script         |
| `bun run flow:commit`          | Commit with conventional commits + hooks  |
| `bun run flow:prepr`           | Run pre-PR checks (lint, typecheck, test) |
| `bun run flow:pr`              | Create pull request                       |
| `bun run flow:pr-comments`     | Post review comments to PR                |
| `bun run flow:postpr-learning` | Extract skills after PR merge             |
| `bun run flow:merge`           | Merge PR after approval                   |

### CLI

| Script              | Description                |
| ------------------- | -------------------------- |
| `bun run reviewctl` | Run reviewctl CLI commands |

### Pre-commit Hooks

The project uses Husky with lint-staged for pre-commit validation:

- **TypeScript/JavaScript**: ESLint + Biome fix
- **JSON**: Biome format
- **Markdown/CSS/YAML**: Prettier
- **Python**: Ruff check + format

---

## Environment Setup

### Required Variables

Copy `.env.example` to `.env` and configure:

| Variable                    | Description                 | Default               |
| --------------------------- | --------------------------- | --------------------- |
| `DATABASE_URL`              | SQLite database path        | `file:./db/custom.db` |
| `NODE_ENV`                  | Runtime environment         | `development`         |
| `REVIEW_API_TOKEN`          | API authentication token    | (required)            |
| `REVIEW_API_TOKEN_PREVIOUS` | Previous token for rotation | (optional)            |

### Generating Tokens

```bash
# Generate a secure token
openssl rand -base64 32
```

---

## Testing Procedures

### Running Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test path/to/test.spec.ts

# Run with coverage
bun test --coverage
```

### Linting Before Commit

```bash
# Run all checks
bun run lint:all

# Or individually
bun run lint
bun run lint:biome
bun run lint:ruff
bun run lint:pyright
```

### Type Checking

```bash
# Full type check
bun run typecheck:all

# Scoped checks
bun run typecheck:app
bun run typecheck:mini-services
```

---

## Project Structure

```text
branch-review/
├── src/
│   ├── app/              # Next.js App Router pages
│   ├── components/      # React components
│   │   └── ui/           # shadcn/ui components
│   └── lib/              # Utilities and services
├── mini-services/
│   └── reviewctl/        # CLI tool
├── scripts/              # Build and flow scripts
├── prisma/               # Database schema
└── docs/                 # Documentation
```

---

## Making Changes

1. **Create a branch**: `bun run flow:branch -- type/short-name`
2. **Make changes** following existing patterns
3. **Run checks**: `bun run flow:prepr`
4. **Commit**: `bun run flow:commit -- -m "type(scope): message"`
5. **Push and create PR**: `bun run flow:pr -- "Title" "Body"`

---

## Related Documentation

- [CLI Flow](cli-flow.md) - Detailed reviewctl command reference
- [Operating Rules](operating-rules.md) - Project conventions
- [PR DOD](pr-dod.md) - Definition of Done for PRs
- [Runbook](RUNBOOK.md) - Deployment and operations

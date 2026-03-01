---
name: rctl-explore
description: Structured exploration for reviewctl code review workflow. ONLY use when running `reviewctl explore context` or `reviewctl explore diff`. Produces structured markdown output with stack detection, drift analysis, and agent recommendations. NOT for ad-hoc searches (use cli-explorer instead). Specify phase: "context" or "diff".
---

# rctl-explore: Intelligent Exploration for Code Review

Semantic exploration agent for the reviewctl workflow. Produces structured analysis for Context and Diff phases.

## Two Phases

| Phase | Command | Output | Purpose |
|-------|---------|--------|---------|
| **Context** | `reviewctl explore context` | `explore/context.md` | Stack detection, sensitive zones, agent recommendations |
| **Diff** | `reviewctl explore diff` | `explore/diff.md` | Change analysis, hotspots, plan drift detection |

---

## PHASE A: Context Exploration

### Objective
Generate `explore/context.md` with deep semantic analysis of the project context surrounding the changes.

### Tools to Use
```bash
git ls-files                        # List all tracked files
git diff --name-only <base>...HEAD  # Modified files
fd -e json -e yaml -e toml     # Find config files
```

Then read key files:
- `package.json`, `bunfig.toml`, `pyproject.toml` - dependencies
- `tsconfig.json`, `.eslintrc`, `ruff.toml` - tooling
- `AGENTS.md`, `CLAUDE.md`, `README.md` - project conventions
- `_ctx/review_runs/<run-id>/plan.md` - if exists, the review plan

#### Edge Case: Empty Diff

If `git diff --name-only <base>...HEAD` returns no files:

1. Verify `<base>` is correct (not same as HEAD)
2. Report: "No changes detected between <base> and HEAD"
3. Proceed with baseline repo analysis (stack detection only)

### Required Analysis

#### 1. Stack Detection (SEMANTIC)

Do NOT just search for "typescript" in package.json. Analyze:

**Framework patterns:**
- React/Next.js/Vue/Svelte? App Router or Pages?
- Server components or client-only?
- API layer: Express/Fastify/Hono/built-in?

**Runtime & Build:**
- Node/Bun/Deno? Version constraints?
- Bundler: webpack/vite/esbuild/turbopack?

**Architecture:**
- Monorepo? Single package?
- Mini-services pattern?
- Database: PostgreSQL/MySQL/MongoDB/SQLite?

**Example Output:**
```
Stack: Next.js 14 with App Router, server components dominant,
Bun runtime (1.1+), mini-services architecture with 4 Python CLIs
(reviewctl, ecc-check, ecc-report, ecc-ingest). PostgreSQL via Supabase.
Testing: Bun test + pytest. Linting: Biome + Ruff.
```

#### 2. Sensitive Zones (WITH RISK ANALYSIS)

Do NOT just find files with "auth" in the name. Analyze:

**What changes?** - Specific functions, modules, patterns
**What risk?** - Blast radius, dependency impact
**Why sensitive?** - Security, data integrity, user-facing

**Example Output:**
```
### Sensitive Zone: Authentication Middleware
- Files: src/middleware/auth.ts, src/lib/session.ts
- Changes: Token validation logic modified, new refresh flow
- Risk: ALL /api/* routes depend on this middleware
- Blast radius: 47 protected endpoints, 3 user flows
- Severity: CRITICAL - security regression would expose entire API
```

#### 3. Recommended Agents (JUSTIFIED)

Do NOT just list generic reviewers. Justify each:

| Agent | Why | What to Check |
|-------|-----|---------------|
| `security-reviewer` | Shell commands in input | Command injection in shell.ts:45 |
| `perf-reviewer` | New caching layer | Cache invalidation logic, TTL handling |
| `arch-reviewer` | Module restructuring | Circular deps, layer violations |

### Context Output Format

Generate `explore/context.md`:

```markdown
# Context Analysis

## Stack Detection
[Semantic analysis of framework, runtime, architecture, tooling]

## Modified Files Scope
[List files with categorization: core/peripheral/config]

## Sensitive Zones

### Zone 1: [Name]
- **Files**: [paths]
- **Changes**: [what specifically changes]
- **Risk**: [why it matters]
- **Blast Radius**: [what depends on this]
- **Severity**: [CRITICAL/HIGH/MEDIUM/LOW]

## Recommended Agents

| Agent | Justification | Focus Areas |
|-------|---------------|-------------|
| [name] | [why needed] | [specific checks] |

## Relevant Commands
[Detected from AGENTS.md, package.json scripts]

## Obvious Risks

### Risk 1: [Title]
- **Evidence**: [specific lines/patterns]
- **Impact**: [what could go wrong]
- **Recommendation**: [specific fix]
- **Severity**: [CRITICAL/HIGH/MEDIUM/LOW]
```

---

## PHASE B: Diff Exploration

### Objective
Generate `explore/diff.md` with deep analysis of changes and drift detection against plan.

### Tools to Use
```bash
git diff --stat <base>...HEAD        # Statistics
git diff <base>...HEAD               # Full diff
git log --oneline <base>...HEAD      # Commit history
```

Then read:
- `_ctx/review_runs/<run-id>/plan.md` - if exists, compare against diff

### Required Analysis

#### 1. Diff Stats (WITH INTERPRETATION)

Do NOT just report "+100 -50 lines". Interpret:

**Change Type:**
- Feature (new functionality)
- Refactor (structure change, same behavior)
- Fix (bug correction)
- Chore (tooling, deps, docs)

**Magnitude:**
- Small: <10 files, <100 lines
- Medium: 10-30 files, 100-500 lines
- Large: >30 files or >500 lines

**Note:** Thresholds assume medium-sized repos (<5000 files). For monorepos, scale thresholds proportionally (e.g., Large: >100 files).

**Example:**
```
Diffstat: +847/-312 in 23 files
Interpretation: Large feature with significant refactoring.
Core changes in api/ (12 files), supporting changes in lib/ (8 files),
test updates in __tests__/ (3 files). Pattern suggests API expansion
with backward compatibility concerns.
```

#### 2. Hotspots (WITH ANALYSIS)

Do NOT just list files with "api" in the name. Analyze:

**What specifically changes:**
- New functions? Modified functions? Deleted?
- Pattern: additive, modificative, subtractive

**Why it matters:**
- Entry point? Core logic? Utility?

**Example:**
```
### Hotspot: api/handlers/ingest.ts
- Changes: +156/-23 lines
- New: processIngest(), validatePayload(), queueForProcessing()
- Modified: handleAuth() - added service account support
- Risk: New public endpoint without rate limiting
- Dependencies: Called by 3 external services (per docs)
```

**Note:** If docs unavailable or outdated, verify with actual imports:
```bash
rg "import.*hotspot_module" -t ts
rg "from.*hotspot_module" -t py
```

#### 3. Drift Detection (SEMANTIC)

Do NOT just check if plan exists. Compare:

**Plan vs Implementation:**
- What plan said would be done
- What actually changed
- Gaps: planned but not implemented
- Extras: implemented but not planned

**Drift Indicators:**
- Missing files mentioned in plan
- Unexpected files not in plan
- Scope expansion/reduction

#### Edge Case: No Plan Exists

If `_ctx/review_runs/<run-id>/plan.md` doesn't exist:

1. Infer intended scope from:
   - Commit messages (look for "feat:", "fix:", "refactor:")
   - PR title/description if available
   - Branch name patterns (e.g., `feat/auth` → auth feature)
2. Generate "Inferred Scope" section instead of "Plan vs Implementation"
3. Skip Drift Checklist (not applicable)

**Example:**
```
### Drift Analysis

**Plan Scope:**
- Add caching layer for API responses
- Implement rate limiting
- Update documentation

**Implementation Reality:**
- ✅ Caching layer added (cache/*.ts)
- ❌ Rate limiting NOT found in diff
- ⚠️ Documentation partial (README updated, API docs not)

**Drift Assessment:**
Plan mentions "rate limiting" but no changes in middleware/ or lib/rate-limit*.
Either: (1) scope reduced, (2) deferred to follow-up, (3) already exists.
RECOMMENDATION: Verify with author before proceeding.
```

### Diff Output Format

Generate `explore/diff.md`:

```markdown
# Diff Analysis

## Diffstat Summary
[Stats with interpretation of change type and magnitude]

## Top Changed Files

| File | +/- | Type | Analysis |
|------|-----|------|----------|
| [path] | [stats] | [core/peripheral] | [what changes] |

## Hotspots

### Hotspot 1: [File/Module]
- **Changes**: [specific additions/modifications/deletions]
- **New Functions**: [list if any]
- **Modified Functions**: [list with what changed]
- **Risk**: [why this matters]
- **Dependencies**: [what calls/depends on this]

## Commit History
[Last N commits with messages]

## Plan vs Implementation

### Planned Scope
[From plan.md if exists]

### Implementation Reality
[From diff analysis]

### Drift Checklist

| Item | Status | Evidence |
|------|--------|----------|
| [planned item] | [DONE]/[MISSING]/[PARTIAL] | [file/line evidence] |

### Drift Assessment
[Analysis of gaps, extras, scope changes]

## Gate Status

- **Has Plan**: [yes/no]
- **Plan Drift**: [none/minor/major]
- **Sensitive Changes**: [yes/no + details]
- **Ready for Review**: [yes/no + blockers]

## Recommendations for Review
[What reviewers should focus on]
```

---

## Quality Standards

### DO
- Provide specific file paths and line numbers
- Explain WHY something is a risk, not just THAT it is
- Give actionable recommendations
- Include evidence from the actual code/diff
- Interpret findings in context of the project

### DO NOT
- Use generic statements like "check for security issues"
- List files without explaining relevance
- Report raw stats without interpretation
- Skip drift detection when plan exists
- Miss obvious cross-file dependencies

### Output Quality Checklist

Before finalizing output, verify:

- [ ] All paths are relative to repo root (e.g., `src/auth/middleware.ts`)
- [ ] Every "risk" has evidence (file:line)
- [ ] Every recommendation is specific and actionable
- [ ] Drift detection compares plan vs diff semantically
- [ ] Agent recommendations are justified with reasoning
- [ ] Hotspots explain WHAT changes, not just that they change

### Output Format Note

XML-like tags (`<results>`, `<analysis>`, `<files>`) structure output for human readability. They are NOT parsed by tools.

### Large Repository Handling

For repos with >5000 files:

1. Limit scope with path filters: `rg "pattern" src/ | head -100`
2. Avoid full-repo scans; target specific directories
3. Use `-l` (list files) first, then inspect specific files

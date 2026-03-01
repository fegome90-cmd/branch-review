# Runbook - branch-review Operations

## Deployment Procedures

### Development Deployment

```bash
# Install dependencies
bun install

# Start development server
bun run dev

# Access at http://localhost:3000
```

### Production Deployment

#### Option 1: Standalone (Recommended)

```bash
# 1. Build production bundle
bun run build

# 2. Start production server
bun run start

# Server runs on port 3000 via standalone output
```

#### Option 2: PM2 Daemon

```bash
# 1. Create .env with secure token
echo "REVIEW_API_TOKEN=$(openssl rand -base64 32)" > .env

# 2. Build production bundle
bun run build

# 3. Start with PM2
pm2 start ecosystem.config.js

# 4. Save PM2 configuration
pm2 save

# 5. Setup startup script
pm2 startup
```

### Environment Configuration

| Variable                    | Required | Description                               |
| --------------------------- | -------- | ----------------------------------------- |
| `DATABASE_URL`              | Yes      | SQLite path (e.g., `file:./db/custom.db`) |
| `NODE_ENV`                  | Yes      | `production` for production builds        |
| `REVIEW_API_TOKEN`          | Yes      | Secure token for API authentication       |
| `REVIEW_API_TOKEN_PREVIOUS` | No       | Previous token for seamless rotation      |

---

## Monitoring and Alerts

### Health Checks

```bash
# Check API status
curl http://localhost:3000/api/review/info

# Check run status
curl http://localhost:3000/api/review/run
```

### PM2 Monitoring

```bash
# View logs
pm2 logs branch-review

# View metrics
pm2 monit

# View process status
pm2 status
```

### Log Locations

| Environment | Log File                               |
| ----------- | -------------------------------------- |
| Development | `dev.log` (via tee in dev script)      |
| Production  | `server.log` (via tee in start script) |

---

## Common Issues and Fixes

### Database Issues

**Issue**: Prisma client out of sync

```bash
# Regenerate Prisma client
bun run db:generate
```

**Issue**: Migration needed after schema change

```bash
# Push schema changes
bun run db:push

# Or create and run migration
bun run db:migrate
```

**Issue**: Database locked

```bash
# Reset database (dev only)
bun run db:reset
```

### Build Issues

**Issue**: TypeScript errors blocking build

```bash
# Run full type check
bun run typecheck:all

# Fix errors, then rebuild
bun run build
```

**Issue**: Lint warnings blocking commit

```bash
# Run all linters
bun run lint:all

# Fix reported issues, then commit
```

### Runtime Issues

**Issue**: Port already in use

```bash
# Find process using port 3000
lsof -i :3000

# Kill process or use different port
PORT=3001 bun run dev
```

**Issue**: Module not found after build

```bash
# Clear Next.js cache
rm -rf .next

# Rebuild
bun run build
```

---

## Rollback Procedures

### Quick Rollback (PM2)

```bash
# List previous deployments
pm2 list

# Restart previous version
pm2 delete branch-review
# Re-run deployment commands for previous version
```

### Database Rollback

```bash
# View migration status
bunx prisma migrate status

# Rollback last migration (dev only)
bunx prisma migrate rollback
```

### Token Rotation

If `REVIEW_API_TOKEN` is compromised:

1. Set previous token: `REVIEW_API_TOKEN_PREVIOUS=<old-token>`
2. Update `REVIEW_API_TOKEN` with new token
3. Restart service
4. Verify authentication works
5. Clear `REVIEW_API_TOKEN_PREVIOUS`

---

## API Reference

### Endpoints

| Method | Endpoint              | Auth  | Description                 |
| ------ | --------------------- | ----- | --------------------------- |
| GET    | `/api/review/info`    | None  | API metadata (health check) |
| GET    | `/api/review/run`     | Token | Current run status          |
| POST   | `/api/review/command` | Token | Execute reviewctl command   |
| GET    | `/api/review/final`   | Token | Final verdict JSON          |
| GET    | `/api/review/state`   | Token | Run state snapshot          |

### Authentication

Provide token via header:

```
X-Review-Token: <your-token>
```

Or via cookie:

```
Cookie: review_api_token=<your-token>
```

---

## Backup and Recovery

### Database Backup

```bash
# Copy SQLite file
cp db/custom.db db/custom.backup.db

# Or use date-stamped backup
cp db/custom.db "db/custom.$(date +%Y%m%d).db"
```

### Restore from Backup

```bash
# Stop service
pm2 stop branch-review

# Restore database
cp db/custom.backup.db db/custom.db

# Restart service
pm2 start branch-review
```

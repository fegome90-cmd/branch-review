# Sample Plan: Authentication Module Migration

## Overview
This is a sample plan document demonstrating the Plan SSOT system.

## Objectives
1. Migrate authentication to use NextAuth.js v4
2. Implement Prisma-based user storage
3. Add OAuth providers (Google, GitHub)
4. Secure API routes with session checks

## Scope

### Files to Modify
- `src/app/api/auth/[...nextauth]/route.ts`
- `prisma/schema.prisma`
- `src/lib/auth.ts`
- `src/middleware.ts`

### Files to Create
- `src/types/next-auth.d.ts`
- `src/components/auth/LoginForm.tsx`
- `src/components/auth/AuthGuard.tsx`

## Implementation Steps

### Phase 1: Database Setup
- [ ] Update Prisma schema with User model
- [ ] Add Account and Session models
- [ ] Run `bun run db:push`

### Phase 2: NextAuth Configuration
- [ ] Create [...nextauth] route handler
- [ ] Configure providers
- [ ] Set up callbacks

### Phase 3: UI Components
- [ ] Create LoginForm component
- [ ] Create AuthGuard wrapper
- [ ] Add sign-out button to header

### Phase 4: Middleware
- [ ] Configure middleware matcher
- [ ] Add protected routes
- [ ] Test auth flow

## Success Criteria
- Users can login via OAuth
- Protected routes redirect to login
- Session persists across page reloads
- No auth-related security vulnerabilities

## Risks
- OAuth callback URL configuration
- Session token rotation
- CSRF protection

## Dependencies
- next-auth@^4.24.0
- @prisma/client

---

*Plan created: 2024-01-15*
*Estimated effort: 4 hours*

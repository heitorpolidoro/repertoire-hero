# Auth Migration: Supabase Auth → Better Auth

**Date:** 2026-06-03
**Status:** Approved

## Context

Supabase Auth requires a registered and verified domain to customize transactional emails (email change, password reset, verification). To avoid domain registration at this stage, the authentication layer will be replaced with Better Auth — a self-hosted TypeScript auth library that runs inside Next.js and stores state in the existing Supabase PostgreSQL database.

The database, RLS policies, and all existing tables remain unchanged.

## Goals

- Replace Supabase Auth with Better Auth
- Preserve existing user sessions transparently (same UUIDs, same passwords)
- Support email/password login and Spotify OAuth
- Defer all email flows (verification, reset, email change) until a domain is available

## Out of Scope

- Email verification
- Password reset via email
- Email change
- Any changes to the database schema beyond adding Better Auth tables
- Any changes to `songs.ts`, `bands.ts`, `playlists.ts`, or other data-layer files

## Architecture

Better Auth runs as a library inside Next.js. It connects to the same Supabase PostgreSQL database and creates its own tables alongside existing ones.

```
Browser
  │
  ├─► Next.js Middleware       ← Better Auth session validation
  │
  ├─► /app/login               ← Better Auth client SDK
  ├─► /app/signup              ← Better Auth client SDK
  │
  └─► /api/auth/[...all]/      ← Better Auth handler (new)
           │
           └─► Supabase PostgreSQL
                 ├── auth_user      (new — Better Auth)
                 ├── auth_session   (new — Better Auth)
                 ├── auth_account   (new — Better Auth: credentials + spotify)
                 └── profiles, songs, bands, repertoire...  (unchanged)
```

## Auth Flows

| Flow | Status | Notes |
|------|--------|-------|
| Login (email/password) | Implemented | Session via HTTP-only cookie |
| Signup (email/password) | Implemented | No email verification |
| Logout | Implemented | Invalidates session in DB |
| Spotify OAuth | Implemented | Better Auth Social Provider replaces `/api/auth/spotify/` |
| Email verification | Deferred | Requires domain + email provider |
| Password reset | Deferred | Requires domain + email provider |
| Email change | Deferred | Original motivation — add when domain is ready |

## Files Changed

| File | Change |
|------|--------|
| `src/lib/auth.ts` | New — Better Auth server configuration |
| `src/lib/auth-client.ts` | New — Better Auth browser client |
| `src/app/api/auth/[...all]/route.ts` | New — Better Auth handler |
| `src/middleware.ts` | Replace `supabase.auth.getUser()` with `auth.api.getSession()` |
| `src/app/login/` | Replace Supabase SDK calls with Better Auth client |
| `src/app/signup/` | Replace Supabase SDK calls with Better Auth client |
| `src/app/api/auth/spotify/` | Removed — handled by Better Auth Social Provider |
| `src/lib/supabase/client.ts` | Auth references removed, DB queries unchanged |
| `src/lib/supabase/server.ts` | Auth references removed, DB queries unchanged |

## New Dependencies

```
better-auth
```

No other new dependencies. Supabase SDK remains for database access.

## User Migration

### Strategy

A migration script `scripts/migrate-auth.ts` reads from Supabase's `auth.users` table and inserts into Better Auth tables. It is **idempotent** — safe to run multiple times.

### UUID Preservation

Better Auth tables use the same UUIDs from `auth.users`. All foreign keys in `profiles`, `repertoire`, and other tables remain valid without modification.

### Password Compatibility

Supabase stores passwords as bcrypt hashes. Better Auth also uses bcrypt. Password hashes are copied directly — users keep their existing passwords with no reset required.

### Spotify Accounts

Users with a connected Spotify account get a corresponding `auth_account` record with `providerId = "spotify"` and their stored token data.

### CI Integration (Temporary)

The migration script runs in CI after `supabase db push`, until all users are confirmed migrated. It will be removed from CI once migration is complete.

```yaml
# .github/workflows/ci.yml — temporary step
- name: Apply DB migrations
  run: supabase db push

- name: Migrate auth users (one-time, idempotent)
  run: npx tsx scripts/migrate-auth.ts
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

### Idempotency

```ts
for (const user of supabaseUsers) {
  const exists = await checkUserExists(user.id)
  if (exists) continue  // already migrated, skip
  await insertBetterAuthUser(user)
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `BETTER_AUTH_SECRET` | Random secret for signing sessions (new) |
| `BETTER_AUTH_URL` | Base URL of the app (e.g. `https://repertoire-hero.vercel.app`) |
| `SPOTIFY_CLIENT_ID` | Already exists — reused |
| `SPOTIFY_CLIENT_SECRET` | Already exists — reused |
| `DATABASE_URL` | Direct PostgreSQL connection string to Supabase DB (new — currently accessed via Supabase SDK) |

## Rollback

If migration fails, Supabase Auth is still intact and functional. Reverting means:
1. Remove Better Auth tables via a down migration
2. Restore original `middleware.ts`, login/signup pages
3. Re-enable Supabase Auth SDK usage

No user data is modified or deleted at any point.

## Future Work

Once a domain is registered and an email provider (e.g. Resend) is configured:
1. Enable Better Auth email plugin
2. Add email verification on signup
3. Add password reset flow
4. Implement email change — the original motivation for this migration

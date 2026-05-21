# 🗺️ Meridian Project Standards

## 🎯 Project Overview

**Repertoire Hero** is a musician-focused web application for tracking and managing a personal song repertoire. Musicians can maintain their song catalog, track mastery level per song, organize songs into playlists, and collaborate via bands. Spotify integration enables playlist import and sync.

**Core Tech Stack**

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | 16.2.6 |
| Language | TypeScript | ^5 |
| UI | React | 19.2.0 |
| Styling | Tailwind CSS | ^4 |
| State | Zustand | ^5 |
| Database | Supabase (PostgreSQL + Auth + RLS) | `@supabase/ssr` ^0.10.3 |
| Secondary DB | MongoDB (legacy types, see `src/lib/mongodb.ts`) | ^6 |
| Observability | Sentry (`@sentry/nextjs`) | ^10 |
| React Compiler | babel-plugin-react-compiler | 1.0.0 |
| Testing | Vitest | ^4 |
| Node.js (CI) | 24.x | — |

**Key integrations**: Spotify OAuth (playlist import/sync), Supabase Auth (email/password), Vercel (deployment).

---

## 🛠️ Critical Commands

```bash
# Local development
npm run dev               # Start Next.js dev server (http://localhost:3000)

# Build & production
npm run build             # Next.js production build
npm run start             # Start production server

# Testing
npm test                  # Run Vitest test suite
npm test -- --coverage    # Run tests with V8 coverage

# Code quality
npm run lint              # ESLint (eslint.config.mjs, eslint-config-next)

# Database (Supabase CLI required)
supabase start            # Start local Supabase stack (Docker)
supabase db push          # Push pending migrations to linked project
supabase migration new <name>   # Create a new migration file

# Seeding (dev only)
npm run seed              # Run seed.js (MongoDB legacy seed)
npm run dev:seed-users    # bash scripts/seed-dev-users.sh (Supabase dev users)
node seed-users.mjs       # Alternative seed script

# Docker (local Supabase stack)
docker compose up -d      # Start full local stack (see docker-compose.yml)
```

**Environment variables** (copy `.env.local.example` → `.env.local`):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_AUTO_LOGIN=false          # Dev auto-login shortcut
NEXT_PUBLIC_DEV_USER_EMAIL=           # Used with AUTO_LOGIN
NEXT_PUBLIC_DEV_USER_PASSWORD=
```

---

## 🏗️ Structure & Navigation

```
repertoire_hero/
├── src/
│   ├── app/                          # Next.js App Router pages
│   │   ├── layout.tsx                # Root layout (ConditionalLayout)
│   │   ├── page.tsx                  # Home / repertoire view
│   │   ├── songs/                    # Individual song detail pages
│   │   ├── playlists/                # Playlist management pages
│   │   ├── bands/                    # Band management pages
│   │   ├── profile/                  # User profile pages
│   │   ├── login/ signup/ join/      # Auth & onboarding pages
│   │   └── api/
│   │       ├── auth/
│   │       │   ├── dev-login/        # Dev-only auto-login route
│   │       │   └── spotify/          # Spotify OAuth authorize/callback/disconnect
│   │       ├── spotify/
│   │       │   └── playlists/        # Spotify playlist fetch, import, sync, tracks
│   │       └── dev/profiles/         # Dev-only profile listing route
│   │
│   ├── components/
│   │   ├── layout/                   # AppLayout, ConditionalLayout wrappers
│   │   ├── songs/                    # SongCard, SongForm
│   │   ├── profile/                  # InstrumentPicker
│   │   └── Sidebar.tsx               # Navigation sidebar
│   │
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts             # Browser Supabase client (createBrowserClient)
│   │   │   ├── server.ts             # Server Supabase client (createServerClient)
│   │   │   └── admin.ts              # Service-role client (admin operations)
│   │   ├── songs.ts                  # Repertoire & global_songs CRUD
│   │   ├── bands.ts / bands.server.ts # Band operations (client + server)
│   │   ├── playlists.ts              # Playlist operations
│   │   ├── profile.ts                # Profile operations
│   │   ├── spotify.ts                # Spotify API calls
│   │   ├── spotifyAuth.ts            # Spotify token management
│   │   ├── filterSongs.ts            # Shared filtering logic
│   │   ├── statusConfig.ts           # song_status display config
│   │   ├── mongodb.ts                # MongoDB client (legacy)
│   │   ├── logger.ts                 # Structured logger (Sentry-backed)
│   │   └── __tests__/               # Vitest unit tests for lib utilities
│   │
│   ├── store/
│   │   └── repertoireStore.ts        # Zustand store (repertoire state + filters)
│   │
│   ├── types/
│   │   ├── database.ts               # All domain types (GlobalSong, UserRepertoire, Band, etc.)
│   │   └── index.ts                  # Legacy MongoDB types (Song, Playlist)
│   │
│   └── middleware.ts                 # Auth guard: redirects unauthenticated requests
│
├── supabase/
│   ├── migrations/                   # Ordered SQL migrations (timestamp prefix)
│   └── seed.sql                      # Dev seed data
│
├── .github/workflows/
│   ├── ci.yml                        # Node.js CI (lint + test + SonarCloud)
│   ├── release.yml                   # Label-gated semantic release
│   └── pr-label-check.yml            # Enforces release label on every PR
│
├── .meridian/                        # Meridian agent configuration
├── .deepsource.toml                  # DeepSource static analysis config
├── next.config.ts                    # Next.js config (React Compiler enabled)
├── vitest.config.ts                  # Vitest config (node environment, @ alias)
├── eslint.config.mjs                 # ESLint flat config
└── sonar-project.properties          # SonarCloud project configuration
```

---

## 📏 Golden Rules

### Authentication & Security

1. **Never bypass RLS.** All Supabase queries from the client must go through the anon client (`createBrowserClient`). The admin/service-role client (`admin.ts`) must only be used in server-only code (API routes, Server Actions) and never exposed to the browser.
2. **Always call `supabase.auth.getUser()` in middleware.** The middleware's `getUser()` call is mandatory for session refresh — do not remove or short-circuit it.
3. **Public paths are explicitly listed in `middleware.ts`.** When adding a new public route (no auth required), add it to the `PUBLIC_PATHS` array.
4. **Secrets in environment variables only.** No credentials in source code. Dev-only variables (`NEXT_PUBLIC_AUTO_LOGIN`, `NEXT_PUBLIC_DEV_USER_*`) must never be set to `true`/non-empty in production.

### Database & Migrations

5. **All schema changes via Supabase migrations.** Run `supabase migration new <descriptive-name>` and write idempotent SQL (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` before `CREATE POLICY`, etc.).
6. **RLS on every table.** Any new table must have `ALTER TABLE … ENABLE ROW LEVEL SECURITY` and explicit `CREATE POLICY` statements. Default-deny is the baseline.
7. **`global_songs` DELETE is admin-only.** Do not add a client-facing DELETE policy on `global_songs`. Admin deletions use the service-role key.
8. **`contributor_id` not `owner_id`.** Migration `20240113` renamed the column. Use `contributor_id` in all code and migrations; `owner_id` is the old name in early migrations only.

### Code Style

9. **Types live in `src/types/database.ts`.** All domain interfaces (`GlobalSong`, `UserRepertoire`, `Band`, `Playlist`, etc.) belong there. `src/types/index.ts` holds legacy MongoDB types only; do not add new types to it.
10. **Use the structured `logger` — never `console.*` directly.** `src/lib/logger.ts` routes to Sentry in production and to the console in development. Every `catch` block or error path should call `logger.error(…)` before re-throwing.
11. **Optimistic updates in the Zustand store must roll back on error.** Follow the pattern in `repertoireStore.ts`: save previous state, apply the optimistic change, catch errors, restore previous state, and re-throw.
12. **`supabase/client.ts` for browser, `supabase/server.ts` for server components and API routes.** Never call `createBrowserClient` from a Server Component or API route handler.
13. **React Compiler is enabled.** Avoid manual `useMemo`/`useCallback` unless the compiler cannot infer the optimization. Do not suppress the compiler without justification.

### API Routes

14. **All API routes under `src/app/api/`.** Routes under `/api/auth/` and `/api/dev/` are public (listed in `PUBLIC_PATHS`). All other API routes are implicitly protected by the middleware auth guard.
15. **Dev-only routes (`/api/dev/*`, `NEXT_PUBLIC_AUTO_LOGIN`) must be gated by environment check.** Verify `process.env.NODE_ENV !== 'production'` or an explicit env flag before executing dev-only logic.

---

## 🧪 Quality & Workflow

### Testing

- **Framework**: Vitest with `@vitejs/plugin-react`. Environment is `node`.
- **Path alias**: `@` resolves to `./src` (configured in `vitest.config.ts`).
- **Test location**: `src/lib/__tests__/*.test.ts`. Co-locate tests with the code they cover.
- **Coverage**: V8 coverage via `@vitest/coverage-v8`. DeepSource tracks coverage via `test-coverage` analyzer.
- **Run**: `npm test` (watch) or `npm test -- --run` (single pass, used in CI).

### CI/CD Pipeline

The project uses three GitHub Actions workflows:

| Workflow | Trigger | Purpose |
|---|---|---|
| `ci.yml` | Push/PR to `main`/`master` | Lint, test (Node 24.x), SonarCloud analysis. Uses shared reusable workflow from `heitorpolidoro/.github`. |
| `pr-label-check.yml` | PR opened/labeled/updated | Enforces that every PR targeting `main`/`master` carries exactly one of: `major`, `minor`, `bugfix`, `skip-release`. **PRs will fail CI without this label.** |
| `release.yml` | PR merged to `main`/`master` | Bumps `package.json` version (`npm version major|minor|patch`), commits with `[skip ci]`, creates a Git tag and GitHub Release. Skipped when `skip-release` label is present. |

**Version bump logic**: `major` label → major bump; `minor` label → minor bump; `bugfix` or unlabeled → patch bump.

### Branch & PR Conventions

- Target branch for all PRs: `master`.
- Every PR **must** carry one of the four labels above before it can be merged.
- Use Conventional Commit prefixes in commit messages: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`.
- PRs are squash-merged; the release workflow runs on `pull_request.types: [closed]`.

### Static Analysis

- **DeepSource**: JavaScript analyzer (React + browser/node environments), secrets scanner, test-coverage reporter, Docker linter. Config in `.deepsource.toml`.
- **SonarCloud**: Configured via `sonar-project.properties`. Runs in CI alongside the test suite.
- **ESLint**: Flat config (`eslint.config.mjs`) extending `eslint-config-next`. Run with `npm run lint` locally and in CI.

### Deployment

- **Platform**: Vercel. Project config in `.vercel/project.json`.
- **Production**: Deployments are triggered by Git tags created by the release workflow.
- **Preview**: Every PR gets an automatic Vercel preview deployment.

---

### 🤖 Bot Identity & Agent Simulation (Required)

To maintain a consistent audit trail and simulate that actions (branches, commits, and Pull Requests) are performed by the **Meridian Agent**, you MUST use the automated helper script.

**Using the meridian-agent Wrapper**
The `.meridian/meridian-agent` script acts as a transparent proxy for `git` and `gh` commands, automatically injecting the agent's identity and authentication token.

```bash
# Any git or gh command can be prefixed with meridian-agent
.meridian/meridian-agent git checkout -b feature/agent-task
.meridian/meridian-agent git add src/
.meridian/meridian-agent git commit -m "feat: simulate agent work"
.meridian/meridian-agent gh pr create --title "..." --body "..."
```

### 🚀 Auto-Merge
To enable automatic merging for Pull Requests that pass all status checks, run:
```bash
gh pr merge --auto --squash --delete-branch
```

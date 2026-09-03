# AGENTS.md

Project manifest for AI agents working in this repository. This document describes what the software does and how it is built — not how to behave as an agent.

# Project Context & Purpose

**Repertoire Hero** is a repertoire-management tool for musicians and bands. It solves the problem of song knowledge being scattered across folders, chat links, and paper: it gives a musician (or a whole band) a single place to catalog songs, track how well each one is learned, and pull up chords/lyrics/tabs quickly during rehearsal or on stage.

Core capabilities:
- **Song catalog (CRUD)** — title, artist, album, key, cover art, duration, and arbitrary links (chords/lyrics/video).
- **Progress tracking** — a 5-stage mastery scale per song, per owner: `unknown → learning → practicing → polishing → mastered`.
- **Tagging, search, and filtering** — instant search by title/artist, filter by status or tag.
- **Fast View** — a stripped-down, mobile-optimized reading mode meant to be used on a music stand during a gig.
- **Bands** — shared repertoires and playlists for a group, with invite-code-based joining and an aggregate "weakest member wins" progress calculation.
- **Playlists** — personal or band-owned ordered collections of songs, optionally synced with Spotify.
- **Spotify integration** — OAuth-based track/playlist search and import into the catalog.
- **Tabs** — PDF chord-chart/tab uploads attached to a repertoire entry, stored in Vercel Blob.

Audience: individual musicians (amateur/professional) and bands coordinating a shared setlist.

# High-level Architecture

Repertoire Hero is a single Next.js 16 (App Router) application — there is no separate backend service. Server-side logic lives in Next.js Server Actions and Route Handlers, both running in the Node.js runtime (not Edge, because the Postgres driver requires Node APIs).

```
Browser (React 19)
   │
   ├─ Server Components / pages  (src/app/**/page.tsx)
   ├─ Server Actions             (src/app/actions/*.ts)   ← primary read/write path for UI
   ├─ Route Handlers / API       (src/app/api/**/route.ts) ← auth, Spotify OAuth/proxy, dev tools
   │
   ├─ src/proxy.ts  (Next.js middleware — session gate on every request)
   │
   ▼
src/lib/*  (data-access + domain logic, talks to Postgres via `pg`/Pool in src/lib/db.ts)
   │
   ▼
PostgreSQL  (schema in /migrations)
   — hosts both the app's own tables and Better Auth's auth tables in the same DB/schema
   │
   also: Vercel Blob (tab PDF storage), Spotify Web API (external), Resend (transactional email)
```

Key architectural decisions:
- **Auth**: [Better Auth](https://better-auth.com) (`src/lib/auth.ts`), backed directly by the same Postgres pool as the app data (not a separate auth service). A `databaseHook` auto-creates an app-level `profiles` row whenever a Better Auth `user` is created.
- **Data access**: no ORM — hand-written parameterized SQL via `pg`, wrapped in domain modules under `src/lib/*.ts` (`songs.ts`, `bands.ts`, `playlists.ts`, `profile.ts`). `kysely` is a dependency but the primary query path shown in the codebase uses raw `pg` queries directly.
- **Mutations**: implemented as Next.js **Server Actions** (`'use server'` files in `src/app/actions/`) rather than a REST/GraphQL API — this is the primary way the UI writes data.
- **Session gating**: `src/proxy.ts` (Next.js middleware) calls the Better Auth session endpoint via `fetch` (rather than importing `auth` directly) specifically to avoid pulling the `pg` driver into a non-Node runtime, and redirects unauthenticated users to `/login`.
- **Band vs. personal ownership**: most domain tables (`repertoire`, `playlists`) use a mutually-exclusive `user_id` / `band_id` pair rather than a separate join table, enforced by a DB CHECK constraint. A Postgres trigger (`sync_band_repertoire_on_member_update`) keeps a band's aggregate song status in sync as the MIN status across its members whenever a member's personal status changes.
- **File storage**: PDF tab uploads go to **Vercel Blob** (`@vercel/blob`), not the database or Supabase Storage.
- **State**: `zustand` (with `persist`) is used client-side only for lightweight UI state — currently just which "context" (personal vs. a specific band) the user is browsing in (`src/store/bandContextStore.ts`).
- **Observability**: Sentry (`@sentry/nextjs`) is wired for client, server, and edge configs.

Legacy/unused code to be aware of: `src/lib/mongodb.ts` and the `Song`/`Playlist` shapes in `src/types/index.ts` are leftovers from an earlier MongoDB-based prototype and are not wired into any current route or action — the live data model is `src/types/database.ts`. Similarly, `NEXT_PUBLIC_SUPABASE_*` env vars and stray "Supabase" comments are historical; the app's actual persistence and auth run on plain Postgres via Better Auth, not Supabase Auth/client (the `supabase/` directory retains only `config.toml` and `seed.sql` for the local docker-compose stack; the Supabase CLI migration flow is disabled — see `[db.migrations] enabled = false`).

# Key Technologies & Stack

**Framework / runtime**
- Next.js 16 (App Router, React Server Components, Server Actions) with Webpack dev server and the React Compiler babel plugin
- React 19 / React DOM 19
- TypeScript 5
- Node.js (version pinned via `.nvmrc`)

**Data & auth**
- PostgreSQL — primary datastore, accessed via `pg` (`Pool`) in `src/lib/db.ts`
- `kysely` — present as a query-builder dependency
- `better-auth` (+ `@better-auth/utils`) — authentication (email/password), session management; passwords hashed with scrypt (new accounts) or `bcryptjs` (migrated legacy accounts)
- Raw SQL migrations in `/migrations` (the single source of truth for the schema), run via `scripts/migrate.mjs` (invoked automatically on `npm run build` and via `npm run db:migrate`)

**Storage & external services**
- `@vercel/blob` — PDF tab file storage
- Spotify Web API — OAuth (`src/lib/spotifyAuth.ts`) + search/import (`src/lib/spotify.ts`), integrated via `src/app/api/spotify/**` and `src/app/api/auth/spotify/**`
- `resend` — transactional email (password reset)
- `@vercel/analytics`, `@sentry/nextjs` — analytics and error monitoring

**Frontend**
- Tailwind CSS 4 (`@tailwindcss/postcss`)
- `zustand` — small client-side state store
- `next/font` (Geist)

**Testing & quality**
- `vitest` (+ `@vitest/coverage-v8`, `@vitejs/plugin-react`) — unit/integration tests for `src/lib/*` domain logic (`src/lib/__tests__/`)
- `@playwright/test` — end-to-end tests (`/e2e`), covering auth, songs CRUD, and mobile Fast View
- ESLint 9 (`eslint-config-next`)
- SonarCloud (`sonar-project.properties`) and DeepSource (`.deepsource.toml`) for static analysis / code quality gates

**Deployment**
- Vercel (`vercel.json`, `.vercel/`) is the target platform
- A `Dockerfile` and `docker-compose.yml` also exist for local/self-hosted Postgres + app orchestration (`docker/` has Kong/Supabase-style local env config)

# Directory Structure

```
src/
├── app/                        Next.js App Router — pages, layouts, routes
│   ├── actions/                Server Actions ('use server') — primary mutation path
│   │   ├── bands.ts            Create/join/manage bands
│   │   ├── playlists.ts        Playlist CRUD, song ordering
│   │   ├── profile.ts          User profile updates (instruments, etc.)
│   │   ├── repertoire.ts       Song status/tags/key updates, add/remove from repertoire
│   │   └── tabs.ts             PDF tab upload/delete (Vercel Blob + repertoire_tabs table)
│   ├── api/
│   │   ├── auth/[...all]/      Better Auth catch-all handler
│   │   ├── auth/dev-login/     Dev-only auto-login endpoint
│   │   ├── auth/spotify/       Spotify OAuth authorize/callback/disconnect
│   │   ├── dev/profiles/       Dev-only: list users for "Dev Fast Login" UI (404s outside development)
│   │   └── spotify/            Spotify search, playlist import/sync/tracks proxy endpoints
│   ├── bands/, playlists/, songs/, profile/, settings/, join/[code]/
│   │                           Feature pages (one route segment per feature area)
│   ├── songs/[id]/fast-view/   Mobile-optimized "on stage / on stand" reading view
│   ├── login/, signup/, forgot-password/, reset-password/
│   │                           Auth pages
│   └── layout.tsx, page.tsx    Root layout and dashboard/home
├── components/
│   ├── layout/                 AppLayout, ConditionalLayout (auth-aware chrome)
│   ├── profile/                InstrumentPicker
│   ├── songs/                  SongCard, SongForm
│   └── Sidebar.tsx
├── lib/                        Domain logic + data access (no ORM; parameterized SQL via `pg`)
│   ├── db.ts                   Postgres connection pool + `query()` helper
│   ├── auth.ts / auth-client.ts / auth-session.ts
│   │                           Better Auth server config, browser client, session helpers
│   ├── songs.ts                Global song catalog + repertoire read/write logic
│   ├── bands.ts / bands.server.ts
│   │                           Band domain logic (client-safe + server-only halves)
│   ├── playlists.ts            Playlist domain logic
│   ├── profile.ts              Profile domain logic
│   ├── spotify.ts / spotifyAuth.ts
│   │                           Spotify Web API client + OAuth token handling
│   ├── filterSongs.ts          Search/filter predicate logic used by the UI
│   ├── statusConfig.ts         The 5-stage status enum, labels, colors, ordering/cycling helper
│   ├── logger.ts                Structured logging helper
│   ├── mongodb.ts              Legacy/unused — from an earlier prototype, not wired up
│   └── __tests__/              Vitest unit/integration tests for the above
├── store/
│   ├── bandContextStore.ts     Zustand store: is the user viewing "personal" or a specific band?
│   └── repertoireStore.ts      Client-side repertoire UI state
├── types/
│   ├── database.ts             Authoritative domain types (Song, Repertoire, Band, Playlist, …)
│   └── index.ts                Legacy/unused types from the MongoDB-era prototype
└── proxy.ts                    Next.js middleware — session-gates all non-public routes

migrations/                     Hand-written SQL migrations — the SINGLE source of truth for the schema.
                                 Applied by scripts/migrate.mjs (`npm run db:migrate`, and automatically on
                                 `npm run build`), and bind-mounted by docker-compose.yml for local
                                 first-boot database initialisation (docker/init-migrations.sh).
                                 New migrations MUST be named `NNNN_snake_case.sql`, continuing the existing
                                 four-digit numbering — lexicographic order is the apply order. Do not create
                                 a second migrations directory; a vitest guard
                                 (src/lib/__tests__/migrationsSingleSource.test.ts) enforces this.
e2e/                            Playwright end-to-end specs (auth, songs CRUD, mobile fast view)
docker/                         Local Postgres/Kong env config + Dockerfile support files
scripts/                        migrate.mjs (schema migration runner), dev-seed (local data seeding)
docs/                           security-audit.md, test-coverage-plan.md
spec.md, SDS.md, plan.md, tasks.md
                                 Product requirements, software design spec, implementation plan, task breakdown
```

# Domain Concepts

- **Global Song (`global_songs`)** — A song definition (title, artist, album, key, links, cover, duration) shared across all users, wiki-style: any user can contribute a song, and it's looked up by title+album before creating a duplicate. `contributor_id` is informational only and does not imply ownership.
- **Repertoire (`repertoire`)** — The join between a *global song* and an *owner* (a user or a band, never both — enforced by a DB constraint). This is where per-owner data lives: `status`, `tags`, `personal_key`, `lyrics`, `last_practiced`. A song can appear in many different repertoires (one per user/band that has added it).
- **Status / Mastery scale** — The 5-stage progress enum defined once in `statusConfig.ts` and the Postgres `song_status` type: `unknown → learning → practicing → polishing → mastered`. Represents how gig-ready a song is.
- **Band aggregate status** — When any band member updates their personal status for a song, a Postgres trigger recomputes that band's repertoire status for the same song as the **minimum** status across all members who have it in their personal repertoire — i.e., a band is only as "ready" as its least-prepared member.
- **Band / Band Member** — A group of users sharing a repertoire and playlists. Membership is `admin` or `member`; joining happens via a unique `invite_code` (see `/join/[code]`).
- **Playlist** — An ordered collection of global songs (`playlist_songs`, ordered by `position`), owned by either a user or a band (same exclusivity rule as repertoire). Can optionally be linked to and synced from a Spotify playlist (`spotify_playlist_id`, `sync_with_spotify`, `last_synced_at`).
- **Tags** — Freeform string arrays on `repertoire` and `playlists` rows (e.g., genre, "setlist-2026"), not a separate normalized table.
- **Fast View** — A reading-mode page (`/songs/[id]/fast-view`) stripped of editing chrome, designed to be legible on a phone propped on a music stand mid-performance.
- **Repertoire Tab (`repertoire_tabs`)** — A PDF file (chord chart, tab) attached to one specific repertoire entry, stored as a URL pointing into Vercel Blob.
- **Band Context** — A client-side UI concept (not a DB table): which "hat" the signed-in user is currently browsing under — their personal repertoire, or a specific band's shared repertoire — tracked in `bandContextStore.ts` and applied as the `RepertoireOwner` (`{ userId }` or `{ bandId }`) passed into most `src/lib` functions.
- **Song & Album Sanitization** — `sanitizeSongTitle` and `sanitizeAlbumName` (`src/lib/songSanitizer.ts`) strip remaster/edition noise (e.g. `- 2018 Remaster`, `(30th Anniversary Super Deluxe Edition)`) while strictly preserving performance versions (`Live`, `Acoustic`, `Unplugged`, `Demo`, `Cover`, `Orchestral`).
- **Auto-Fetched Link Labels & oEmbed** — When adding external links (YouTube, Spotify, chord sites), link label input is optional. If left blank, `fetchUrlTitle` (`src/lib/linkFetcher.ts`) auto-fetches track/video/page titles via Spotify/YouTube oEmbed or HTML `<title>` parsing.
- **Client-Side Image Compression** — Camera photos uploaded for Band covers or song art are compressed client-side (`compressImageIfNeeded` in `src/lib/imageCompressor.ts`) to max 1024x1024 JPEG (~100KB) prior to Server Action execution to prevent HTTP 413 body size errors.

# UI & UX Behavioral Directives

- **NO Browser Alerts**: NEVER use browser `alert()` or `confirm()` dialogs. Always use floating Toast notifications (`showToast`), inline alert banners, or accessible modal overlays.
- **Fast View Playlist Layout**:
  - **Desktop (`lg:flex`)**: Two-column layout with a dedicated right sidebar (`w-80 shrink-0 border-l border-gray-200 bg-white sticky top-0 h-screen`) displaying the actual playlist name, track position numbers, and `▶ NOW` indicator.
  - **Mobile (`< lg`)**: Non-overlapping `🎵 Setlist (X/Y)` pill button in the top header row next to `← Back`, which opens a smooth bottom-sheet modal.
- **Link Card UI**: Single white rounded card (`rounded-xl bg-white border border-gray-200 shadow-sm`) with a square-with-arrow SVG icon and an in-card delete button on the far right separated by a vertical divider line (`h-4 w-px bg-gray-200`).

# AI Agent Workflow Rules

- **Version Bumping Rule**: Whenever you make changes that lead to a merge or a deploy, you MUST update the package version in `package.json`. Increase the patch/bugfix version by default and append a timestamp suffix in the format `YYYYMMDDHHmm` using the local timezone.
  - Example version format: `v0.1.6-202608060948` (representing version `0.1.6` released on August 6, 2026 at 09:48).
  - The version must only ever go up: check `git log` for the highest version already used before bumping, never reuse or go below it.
- **Landing Page Rule**: The landing page (`src/components/landing/LandingPage.tsx`, copy in `src/i18n/dictionaries/en.json` and `pt-BR.json` under `landing.*`) is marketing, not a changelog — it lists **selling points only**. Whenever a task ships a user-facing feature, its spec MUST decide whether the feature is a selling point (something a musician or band would choose the app for, e.g. handwritten annotations on tabs in Stage Mode) and, if so, include an expected result that updates the landing copy in BOTH dictionaries. The developer implements that expected result as part of the same task, and code review and QA verify it like any other expected result. Internal, operational or admin features (moderation queues, invite-link maintenance, i18n plumbing, error handling, etc.) are NOT selling points and must not be added to the landing page.











<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- MERIDIAN_INSTRUCTIONS_START -->
# Meridian Instructions

> **AI Task Management**: If an AI agent needs to create, update, or read project tasks, it MUST go through the Meridian server first — the server owns the timestamps, so it is the only write path that keeps them consistent. Read with `GET http://localhost:3333/api/status?project=<absolute project path>`, create with `POST http://localhost:3333/api/projects/tasks`, update with `PUT http://localhost:3333/api/projects/tasks/<task id>` (both writes take `projectPath` in the JSON body). Only when the server is not running — the request fails to connect and `node cli.js start` is not an option — may an agent fall back to hand-editing `.meridian/tasks.json` directly, applying the timestamp rules below by hand.
> **File Shape**: `.meridian/tasks.json` is a bare JSON **array** of task objects. It is NOT an object with a `tasks` key. A task carries `id`, `title`, `status`, `priority`, `justification`, `expected_results`, `blockedBy`, `running`, `created_at`, `updated_at`, `moved_at` and `completed_at`. Never delete a task — move it to `nope` instead.
> **Timestamps**: ISO-8601 UTC strings. `created_at` is set once, on creation. `updated_at` is set on every write. `moved_at` is set on every status change. `completed_at` is set when the status enters `done` and set back to `null` when it leaves `done`. The server stamps all four; a hand-edit must reproduce them exactly.
> **Priority (`priority`)**: EXACTLY one of `critical`, `high`, `medium`, `low`. A task without one is read as `medium`.
> **Active Execution (`running`)**: boolean flag (`true`/`false`). Set to `true` when an agent starts actively working on a task, and set to `false` when finished or handed off.
> **Dependencies (`blockedBy`)**: optional array of task IDs that must reach `done` before this task can proceed. A task with a non-empty `blockedBy` whose dependencies aren't all `done` yet should have status `blocked` — that dependency is sufficient justification on its own (e.g. `justification: "Blocked on <task-id>"`). When every task in `blockedBy` reaches `done`, move this task back to `backlog`.
> **Allowed Statuses**: When assigning a status to a task, you MUST use EXACTLY one of the following lowercase strings. They carry no spaces and no slashes. DO NOT invent new statuses or use synonyms like 'pending', 'todo', 'completed', 'in progress' or 'qa/review'.
  - `backlog`: Task is planned but not ready to be worked on yet.
  - `spec_review`: Task needs specification or design review.
  - `ready_todo`: Task is fully specified and ready to be picked up.
  - `in_progress`: Task is currently being worked on by developer.
  - `code_review`: Task code is being reviewed for architecture, security, and test quality.
  - `qa_review`: Task is being verified independently by QA against expected results.
  - `blocked`: Task cannot proceed due to external dependencies.
  - `done`: Task is fully completed.
  - `nope`: Task was cancelled or won't be done.
> **Implementation Rule**: Before starting any implementation work, ask the user if they want to create a task for it in the Meridian system.
<!-- MERIDIAN_INSTRUCTIONS_END -->

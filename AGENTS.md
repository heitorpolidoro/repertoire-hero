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
   ├─ src/proxy.ts  (Next.js Proxy — redirects an allow-list of routes; not an authorization boundary)
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
- **Redirect convenience, not an authorization boundary (RH-65)**: `src/proxy.ts` (the Next.js Proxy, which is what Next.js 16 renamed Middleware to) checks only whether the request carries a Better Auth session cookie, reading it straight from the request headers with `getSessionCookie` from `better-auth/cookies` — never through a `fetch` back into the app, never through the database, with no timeout and no failure mode. It never validates the cookie, so a present cookie proves nothing (it may be expired, revoked or signed under a rotated secret), and it runs on an explicit twelve-entry allow-list of page routes rather than on every request. No page, Server Action or route handler may rely on it: each resolves its own session and answers for itself. A new private page route does not inherit the redirect — add it to the matcher in `src/proxy.ts`.
- **The Server Component page pattern (RH-62, RH-63)**: `/bands`, `/admin/moderation` and `/playlists` are async Server Components — they read through `src/lib` directly instead of loading in a `useEffect`, call `redirect("/login")` themselves rather than trusting the proxy, and inject their Server Actions into `"use client"` islands under `src/components/<area>/` as a typed actions object, which is the same import-direction rule (F21) Fast View follows. New read-only page routes follow this pattern.
- **Never externalize a React-exposing package**: `next.config.ts`'s `serverExternalPackages` may contain only Node-only packages (`pg`, `kysely`, the Kysely adapter). Listing a package that ships React hooks — `better-auth` did, via `better-auth/react` — leaves it unbundled, so it loads its own `react` instead of Next's vendored SSR React and every SSR render dies with `Cannot read properties of null (reading 'useRef')` (RH-32). Enforced by `src/lib/__tests__/serverExternalPackages.test.ts`.
- **One bundler everywhere: Turbopack (RH-72)**. Next.js 16 defaults `next dev` and `next build` to Turbopack, so dev, `npm run build`, Vercel and the production-build e2e runs (`PLAYWRIGHT_WEB_SERVER="npx next start ..."`) all use it. The `--webpack` opt-in flag must not be reintroduced into the `dev` script: under Next 16's webpack dev runtime `pdfjs-dist`'s ESM build dies with `TypeError: Object.defineProperty called on non-object`, and because Fast View imports `FastViewOverlays` -> `PdfStageOverlay` -> `TabDrawingStage` -> `react-pdf` eagerly, that failure takes the whole `/songs/[id]/fast-view` client graph down and the route renders Next.js's client error shell instead of the song — which is also what the `E2E Tests (Playwright)` job hits, since it starts the server with `npm run dev`. Enforced by `src/lib/__tests__/devBundler.test.ts`. (`next.config.ts` still carries a `webpack(config, ...)` key and `webpack` is still a dependency; both survive only for an ad-hoc `next dev|build --webpack`, nothing in the repo runs them.)
- **Band vs. personal ownership**: most domain tables (`repertoire`, `playlists`) use a mutually-exclusive `user_id` / `band_id` pair rather than a separate join table, enforced by a DB CHECK constraint. A Postgres trigger (`sync_band_repertoire_on_member_update`) keeps a band's aggregate song status in sync as the MIN status across its members whenever a member's personal status changes.
- **File storage**: PDF tab uploads go to **Vercel Blob** (`@vercel/blob`), not the database or Supabase Storage.
- **State**: `zustand` (with `persist`) is used client-side only for lightweight UI state — currently just which "context" (personal vs. a specific band) the user is browsing in (`src/store/bandContextStore.ts`).
- **Observability**: Sentry (`@sentry/nextjs`) is wired for client, server, and edge configs.
- **Identity fields change only through Better Auth's verified flows (RH-42).** `"user".email` is the login identity: no SQL under `src/` may `UPDATE` the `"user"` table, and no application code writes `profiles.email`. A user-facing change goes through `requestEmailChange` (`src/lib/emailChange.ts`) -> `auth.api.changeEmail`, which mails a verification link and leaves the row untouched until the link is opened at `/api/auth/verify-email`; `profiles.email` follows automatically through the `sync_profile_email_on_user_update` trigger (`migrations/0008_sync_profile_email.sql`), in the same transaction as the write, so the two identity rows cannot diverge. Enforced by `src/lib/__tests__/identityWriteGuard.test.ts`.
- **Fast View is a composition root (RH-38).** `src/app/songs/[id]/fast-view/page.tsx` holds no `useState`, no `useEffect` and no data access: it wires seven controller hooks (`usePlaylistNav`, `useTabLibrary`, `usePdfStage`, `useLyricsEditor`, `useSongEntry`, `useSongStatus`, `useSongLinks`) to the presentational components under `src/components/fastview/`, and the pure decisions live in `src/lib` (`playlistNav.ts`, `tabLibrary.ts`, `scrollHost.ts`, `stageHistory.ts`, `lyricsMarkdown.ts`, `lyricsEditor.ts`, `songEntry.ts`, `songStatus.ts`, `songLinks.ts`). Because of the import-direction rule below, no hook or component may import a Server Action: the page injects them as typed dependency objects from `src/app/fastViewNavActions.ts`, `fastViewTabActions.ts`, `fastViewLyricsActions.ts` and `fastViewEntryActions.ts`. New Fast View behaviour goes into a lib function, its hook and its component - never back into the page.

Legacy/unused code to be aware of: the live data model is `src/types/database.ts`. `NEXT_PUBLIC_SUPABASE_*` env vars and stray "Supabase" comments are historical; the app's actual persistence and auth run on plain Postgres via Better Auth, not Supabase Auth/client (the `supabase/` directory retains only `config.toml` and `seed.sql` for the local docker-compose stack; the Supabase CLI migration flow is disabled — see `[db.migrations] enabled = false`).

# Key Technologies & Stack

**Framework / runtime**
- Next.js 16 (App Router, React Server Components, Server Actions) with the Turbopack dev server and the React Compiler babel plugin
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
- `resend` — transactional email (password reset and email-change verification), sent through `src/lib/authEmail.ts`
- `@vercel/analytics`, `@sentry/nextjs` — analytics and error monitoring

**Frontend**
- Tailwind CSS 4 (`@tailwindcss/postcss`)
- `zustand` — small client-side state store
- `next/font` (Geist)

**Testing & quality**
- `vitest` (+ `@vitest/coverage-v8`, `@vitejs/plugin-react`) — unit/integration tests for `src/lib/*` domain logic (`src/lib/__tests__/`), the Server Actions (`src/app/actions/__tests__/`) and the shared hooks (`src/hooks/__tests__/`)
- **Environments.** `vitest.config.ts` sets `environment: 'node'`, which is the default for every `*.test.ts`. A DOM test opts in **per file** with `// @vitest-environment jsdom` as the literal first line of the file — there is no `environmentMatchGlobs` (the option does not exist in Vitest 4) and no second test project.
- **Component/hook tests** use `@testing-library/react` (with `jsdom` and its `@testing-library/dom` peer as devDependencies). Because `globals: false`, Testing Library's automatic cleanup does **not** self-register: every `*.test.tsx` must `import { cleanup } from '@testing-library/react'` and call `afterEach(cleanup)` explicitly.
- **The React Compiler babel plugin (`reactCompiler: true` in `next.config.ts`) is not applied in vitest runs** — `@vitejs/plugin-react` compiles the sources plainly. A green DOM test is a statement about the source semantics, never about the compiled bundle.
- **Coverage universe and gate.** `coverage.include` is `src/lib/**/*.ts`, `src/app/actions/*.ts`, `src/hooks/**/*.ts` and `src/proxy.ts`; excluded from it are `**/__tests__/**`, the better-auth wiring (`auth.ts`, `auth-client.ts`, `auth-session.ts`), the Sentry shim `logger.ts`, the asset-path shim `pdfWorker.ts` and `imageCompressor.ts` (needs canvas/`Image`). The thresholds are enforced, so a drop fails the run: statements **80**, branches **65**, functions **78**, lines **80**.
- **Page-level components (`src/app/**/page.tsx`, `src/components/**`) and the `src/app/api/**` route handlers are deliberately outside the coverage gate and are verified by Playwright end-to-end specs plus manual QA** — pulling 11k lines of pages into the denominator would produce a number nobody can move. Extract the decisions out of a component (as `annotationMath.ts` / `stageInteraction.ts` / `bandAdminLoad.ts` do) and unit-test those instead.
- `npm run test:coverage` (`vitest run --coverage`) is the gate command; the `Coverage (vitest)` CI job runs it against a `postgres:16` service after `npm run db:migrate`.
- **Running the full suite locally needs a live Postgres** at `DATABASE_URL` (default `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, migrations applied) **and a non-empty `SUPABASE_SERVICE_ROLE_KEY`** in the environment or `.env.local`. Without them six DB-backed files skip 51 tests and the coverage number is meaningless.
- `@playwright/test` — end-to-end tests (`/e2e`), covering auth, songs CRUD, and mobile Fast View
- ESLint 9 (`eslint-config-next`)
- **Complexity budgets (F20).** `eslint.config.mjs` sets `complexity` 15, `max-depth` 4, `max-lines-per-function` 200, `max-params` 4 and `max-lines` 400 as errors for everything under `src`. Test files (`**/__tests__/**`, `*.test.ts(x)`) turn `max-lines-per-function` off - a `describe` block is a container, not a function with logic - and get `max-lines` 800. The files already over budget when the rules landed each carry a per-file override pinned to their own current worst number, in the block between `// BEGIN:complexity-budget-overrides` and `// END:complexity-budget-overrides`: that list is a **ratchet and may only shrink** - never add an entry for new code. In a glob, `[id]` is a character class, so a Next.js dynamic segment must be escaped (`src/app/bands/\[id\]/page.tsx`) or the override silently matches nothing. No CI job runs eslint, so `src/lib/__tests__/complexityBudget.test.ts` is the enforcement: it lints all of `src` through the real config and fails on any budget violation, on an override ceiling that is not exactly the file's current worst number, and on the list growing past 20 entries.
- `knip` — dead-code / unused-dependency detection (`npm run lint:dead`, config in `knip.json`), enforced by the `dead-code` CI job
- `jscpd` — copy/paste (duplication) detection (`npm run lint:dup`, config in `.jscpd.json`: `src`, `minTokens: 50`, `minLines: 8`, `threshold: 2`), enforced by the `Duplication (jscpd)` CI job
- `npm audit` — dependency vulnerability gate (`npm run audit`, i.e. `npm audit --audit-level=high`), enforced by the `Dependency audit (npm audit)` CI job, which resolves the tree straight from `package-lock.json` and therefore runs with no `npm ci` step; it deliberately audits the **full dependency tree** rather than production-only (`--omit=dev`), because Dependabot alerts on the whole lockfile regardless of scope and CI actually executes the dev dependencies (`vitest`, `eslint`, `knip`, `jscpd`, `playwright`) — moderate and low advisories are reported but do not fail the build
- SonarCloud (`sonar-project.properties`) and DeepSource (`.deepsource.toml`) for static analysis / code quality gates
- **Import direction (F21).** Nothing under `src/components`, `src/hooks` or `src/lib` may import from `@/app/*`; a page or a wrapper under `src/app` owns the Server Action and passes it down as a prop or an injected dependency (`src/app/bandAdminActions.ts` is the pattern). Enforced by the `no-restricted-imports` block in `eslint.config.mjs`, which exempts `__tests__` because a route-handler test has to import the handler.

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
│   ├── bandAdminActions.ts, fastView*Actions.ts
│   │                           Typed Server Action bundles injected into client islands
│   └── layout.tsx, page.tsx    Root layout and dashboard/home
├── components/                 Presentational React, one directory per feature area
│   ├── admin/                  ModerationQueue and the pending-edit cards
│   ├── bands/                  BandsView island, BandColorPicker
│   ├── fastview/               The 27 Fast View pieces (setlist, tabs, lyrics, PDF stage)
│   ├── landing/                LandingPage — the only dictionary-driven component
│   ├── layout/                 AppLayout, ConditionalLayout, LanguageSelector
│   ├── playlists/              PlaylistsView island, cards, Spotify import panel
│   ├── profile/                InstrumentPicker, EmailChangeSection
│   ├── songs/                  SongForm, CorrectionModal
│   ├── tabs/                   TabDrawingStage annotation canvas
│   └── ui/                     The only cross-area directory (ConfirmPanel, Toast, AlertBanner)
├── hooks/                      Client controller hooks, one use<Name>.ts per subject
│   ├── useBandAdmin.ts         Band-detail controller shared by /bands/[id] and the /profile band tab
│   ├── useBandEdit.ts          Band edit modal state, delegated to by useBandAdmin
│   ├── useBandPendingAction.ts Confirm-then-run state for the destructive band actions
│   ├── useLyricsEditor.ts      Fast View lyrics: draft, save, version switch, Stage Mode
│   ├── usePdfStage.ts          Fast View PDF Stage Mode: viewport, scroll lock, annotations
│   ├── usePlaylistNav.ts       Fast View setlist navigation (fetch, drawer, router pushes)
│   ├── useSongEntry.ts         Fast View song entry: load, band-context reconciliation, patches
│   ├── useSongLinks.ts         Fast View link add/delete (duplicate check, moderation queue)
│   ├── useSongStatus.ts        Fast View mastery-status dropdown + write
│   ├── useTabLibrary.ts        Fast View tab library: fetch, upload destination, delete
│   └── useToast.ts             Floating Toast state + 4s auto-dismiss (render with components/ui/Toast)
├── i18n/dictionaries/          en.json / pt-BR.json — landing-page copy only (see Internationalisation)
├── lib/                        Domain logic + data access (no ORM; parameterized SQL via `pg`)
│   ├── db.ts                   Postgres connection pool + `query()` helper
│   ├── auth.ts / auth-client.ts / auth-session.ts
│   │                           Better Auth server config, browser client, session helpers
│   ├── songs.ts                Global song catalog + repertoire read/write logic
│   ├── bands.ts / bands.server.ts
│   │                           Band domain logic; both import @/lib/db, so both are server-only.
│   │                           The .server suffix marks a second return shape (see Module Layout)
│   ├── playlists.ts            Playlist domain logic
│   ├── profile.ts              Profile domain logic
│   ├── spotify.ts / spotifyAuth.ts
│   │                           Spotify Web API client + OAuth token handling
│   ├── filterSongs.ts          Search/filter predicate logic used by the UI
│   ├── statusConfig.ts         The 5-stage status enum, labels, colors, ordering/cycling helper
│   ├── logger.ts                Structured logging helper
│   └── __tests__/              Vitest unit/integration tests for the above
├── store/
│   ├── bandContextStore.ts     Zustand store: is the user viewing "personal" or a specific band?
│   └── repertoireStore.ts      Client-side repertoire UI state
├── types/
│   └── database.ts             Authoritative domain types (Song, Repertoire, Band, Playlist, …)
└── proxy.ts                    Next.js Proxy — redirects a twelve-entry allow-list of page routes
                                 to /login (and signed-in visitors away from the auth pages); it is
                                 a convenience, not an authorization boundary

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
docs/                           security-audit.md, test-coverage-plan.md, suggestions-log.md,
                                 plans/ (code-quality-review.md, mobile-app-analysis.md) and
                                 tasks/ (one <id>-spec.md per Meridian task)
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

# Error Handling Conventions

These are the patterns the codebase already follows. New code must match them; the
`catch (x: any)` ban is enforced mechanically by `src/lib/__tests__/errorHandlingStyle.test.ts`,
which walks every `.ts`/`.tsx` file under `src/`.

- **Never `catch (x: any)`.** Narrow instead: `const err = error instanceof Error ? error : new Error(String(error))`. Never cast with `error as Error` either — the cast only lies to the type checker.
- **Never `console.error` in a catch body.** Use `logger` (`@/lib/logger`), so the event reaches Sentry. (Two deliberate exceptions, documented at their call sites: the `console.log` dev echo in `src/lib/authEmail.ts`, which prints the link for every auth mail — password reset, change-email confirmation and new-address verification — when no `RESEND_API_KEY` is configured, and must not become a Sentry breadcrumb because that link is a single-use credential; and the module-load `console.warn` in `src/lib/db.ts`, which runs before Sentry is initialised.)

**L1 — data-access / domain layer (`src/lib/*.ts`): log, then throw a prefixed message.**

```ts
} catch (error) {
  const err = error instanceof Error ? error : new Error(String(error))
  logger.error('Failed to fetch bands', err, { userId })
  throw new Error(`Failed to fetch bands: ${err.message}`)
}
```

The logged message and the thrown prefix are the same `Failed to <verb the thing>` phrase, and
`logger.error` is called *before* throwing so the event is recorded even if a caller swallows it.
Never re-throw the raw error.

- **L1a — exception.** A domain/authorization error deliberately raised inside the same `try` is re-thrown unwrapped behind an explicit message check (`if (err.message.startsWith('Access denied')) throw err` — see `src/lib/moderation.ts`). A precondition that throws a *user-facing* message (e.g. `'Only band admins can regenerate the invite link'`) goes **outside** the wrapping `try`, so its text survives verbatim to the UI.

**A1 — Server Actions returning a result envelope.**

```ts
} catch (err) {
  const message = err instanceof Error ? err.message : undefined
  return { error: message || 'Failed to save annotations' }
}
```

`undefined` (not `String(err)`) is deliberate: it makes the `|| fallback` fire for non-`Error`
throws *and* for an `Error` with an empty message.

**A2 — thin Server Actions.** Actions that only resolve the session and delegate to `src/lib`
(e.g. `src/app/actions/profile.ts`, `src/app/actions/moderation.ts`) have **no** `try/catch` — they
let the L1 wrapped error propagate. Do not add catches to them. That the action layer holds no data
access at all — no `query()` call and no `@/lib/db` import under `src/app/actions/*.ts`, and no
hand-rolled `pg` client anywhere under `src/` outside `src/lib/db.ts` — is enforced mechanically by
`src/app/actions/__tests__/actionDataAccessGuard.test.ts`.

**R1 — route handlers (`src/app/api/**/route.ts`).** Log with the route path as the tag; return a
fixed message plus `code`, never the raw exception text.

```ts
} catch (error) {
  logger.error('[spotify/playlists]', error instanceof Error ? error : undefined, { id })
  return NextResponse.json({ error: 'Unexpected error fetching Spotify playlists', code: 500 }, { status: 500 })
}
```

**P1 — client pages / components.** Narrow with `instanceof Error`, surface the message through
component state (inline banner or Toast), and log with `logger.error`.

**S1 — deliberate swallow.** Use the binding-less form and carry a one-line comment saying why:

```ts
} catch {
  // oEmbed is best-effort — fall through to the next strategy.
}
```

**E1 — Postgres error-code checks.** Read the code through a scoped structural cast, not an
`any`-typed binding:

```ts
} catch (err) {
  // 23505 = unique_violation: the row is already there, which is not an error here.
  if ((err as { code?: string }).code !== '23505') throw err
}
```

# Transactions

Every multi-statement write that must be atomic goes through `withTransaction` from `@/lib/db`, which checks a single client out of the pool, issues `BEGIN`, runs the callback against that client, issues `COMMIT`, and on failure rolls back and rethrows the original error unwrapped (so the `L1` log-then-wrap at the call site still produces its usual message) while always releasing the connection. `query()` is `pool.query()` — it hands back an arbitrary idle connection per call, so `BEGIN`, `COMMIT` or `ROLLBACK` issued through it lands on a connection the other statements never see and leaks the one that opened the transaction idle in transaction; passing any of those three to `query()` is forbidden everywhere except `src/lib/db.ts` and is enforced mechanically by `src/lib/__tests__/transactionGuard.test.ts`. Inside a transaction an expected duplicate is absorbed with `ON CONFLICT DO NOTHING` and never by catching `23505` (the `E1` pattern), because a caught `23505` leaves the transaction aborted and every later statement fails with `25P02` instead of the intended no-op.

# Database Row Types

`query()` and `Queryable.query()` in `src/lib/db.ts` default their row parameter to
`DbRow = Record<string, unknown>`, never `any`: a call that names no type argument hands
back `unknown`-valued columns, so the compiler forces every read to declare the shape it
expects. Dropping the default instead of replacing it does nothing - `@types/pg` declares
`QueryResultRow` as `{ [column: string]: any }`, so an omitted argument falls back to that
constraint and rows stay `any`. Declare the shape as a type argument
(`query<Repertoire>(sql, params)`), never as a cast on `res.rows`: a cast asserts a shape
the checker never verified against the SELECT list, which is exactly what RH-25 F16 set out
to remove.

Row shapes that are not already a domain type from `src/types/database.ts` live in
`src/lib/dbRows.ts` - one exported interface per distinct SELECT list, named `<Subject>Row`
and mirroring the projection column for column (`SpotifyTokenRow`, `PlaylistSongIdRow`).
They live there rather than beside their SQL because `src/lib/songs.ts` is pinned at
`max-lines: 531` by the RH-39 ratchet and cannot grow by even one import line. Keep
`src/types/database.ts` as the app's public vocabulary and `dbRows.ts` as an implementation
detail of the data layer: never duplicate a domain type there, name it at the call site
instead. `knip` (`npm run lint:dead`) fails on a row interface nobody imports, so do not add
speculative ones. A single-column projection whose shape is evident at the call site
(`query<{ id: string }>('... RETURNING id')`) may be written inline.

# Naming Conventions

These are the names the codebase already uses, measured at `bb5070b`. Every claim
below carries one of two tags. A **guarded** claim is one that
`src/lib/__tests__/namingConventions.test.ts` fails the run on when new code
breaks it; five claims are guarded. A **convention only** claim has nothing
enforcing it, so a reviewer has to; five claims are convention only. Of the
claims in this section, the guard covers exactly those five and nothing more - do
not read a green run as approval of the other five. The guard file also carries
two further tests, for rules stated in the Module Layout and Internationalisation
sections below. Where a rule has an exception in the tree, the exception is named
here rather than left for the next reader to discover.

- **Server Actions end in `Action`** `(guarded)`. All 44 *function* exports of
  `src/app/actions/*.ts` are `export async function <verb><Subject>Action(...)` -
  `createBandAction`, `getRepertoireAction`, `updateSongStatusAction`. The suffix
  is what tells a reader at the call site that this is a round trip to the server
  rather than a local call. The rule is about function exports only: the
  directory also carries one type re-export,
  `export type { Stroke, TabAnnotations }` at `src/app/actions/tabs.ts:17`, which
  is not an action and is not covered.
- **Injected action bundles are `<Subject>Actions`** `(convention only)`. Because
  of the import direction rule (F21) a hook or component never imports a Server
  Action; the page hands it down as one typed object. The eight bundles live in
  five `src/app/<area>Actions.ts` files (`bandAdminActions.ts`,
  `fastViewEntryActions.ts`, `fastViewLyricsActions.ts`, `fastViewNavActions.ts`,
  `fastViewTabActions.ts`) as SCREAMING_SNAKE consts -
  `BAND_ADMIN_ACTIONS: BandAdminActions`, `SONG_ENTRY_ACTIONS: SongEntryActions`.
  An island that receives its actions from a Server Component page declares the
  same `<Subject>Actions` shape as a prop type (`BandsViewActions`,
  `ModerationQueueActions`).
- **Hooks are `use<Subject>` in a file of exactly that name** `(guarded)`. All
  eleven files under `src/hooks` are `use<Name>.ts` exporting
  `export function use<Name>`. Ten of the eleven also annotate a
  `<Subject>Controller` return type - `SongEntryController`,
  `TabLibraryController`, `BandAdminController` - which is the vocabulary behind
  the phrase "controller hook" `(convention only)`; `useToast.ts` is the one hook
  with no return annotation, and no test reads return types.
- **Components are `PascalCase.tsx`** `(guarded)`, one component per file, named
  after the file: 51 files under `src/components`, no exception.
- **`src/lib` modules are `camelCase.ts`** `(convention only)`, named for the
  noun they own (`playlistNav.ts`, `songSanitizer.ts`, `stageHistory.ts`). Three
  legacy names stand outside that and stay: `auth-client.ts` and
  `auth-session.ts`, which mirror `better-auth`'s own module names, and
  `bands.server.ts` (see Module Layout).
- **`src/lib` exports are function declarations** `(guarded)` -
  `export function` / `export async function` - never
  `export const f = async () => {}`. The choice is arbitrary but settled:
  declarations hoist and produce better stack traces, and 45 of the 46 modules
  already did it. RH-43 converted the last outlier, `src/lib/bands.ts`, so the
  rule now has no exceptions and the guard allows none.
- **Type vocabulary.** Domain nouns live in `src/types/database.ts`; a raw SQL
  projection is `<Subject>Row` in `src/lib/dbRows.ts` `(guarded)`, see Database
  Row Types; a parsed-and-narrowed input shape is `<Subject>Payload`
  (`GlobalSongEditPayload`, `BandUpdatePayload`) `(convention only)`.
- **Tests sit in `__tests__/` beside the code they test** `(convention only)`,
  named `<subject>.test.ts`, or `.test.tsx` for a DOM test. A test that needs a
  live Postgres is `<subject>.db.test.ts` - nine of the 106 test files - which is
  how a reader knows why it skipped. One file stands outside the
  one-test-file-per-subject shape:
  `src/components/ui/__tests__/feedbackSurfaces.test.tsx` covers `Toast` and `AlertBanner`
  together (`ConfirmPanel` has its own test file), and there is no subject file of that name.

# Module Layout - where a thing goes

- **`src/lib/*.ts`** - domain logic and data access. Pure decision functions and
  SQL both live here, and this is the only place `@/lib/db` may be imported.
- **`src/app/actions/*.ts`** - `'use server'` entry points: resolve the session,
  delegate to `src/lib`. No SQL (enforced by `actionDataAccessGuard.test.ts`).
- **`src/app/<area>Actions.ts`** - the typed bundles that carry those actions
  into client code without breaking the import direction.
- **`src/hooks/use*.ts`** - client controllers: state plus intent commands. No
  JSX, no SQL, no `@/app/*` import.
- **`src/components/<area>/`** - presentational React, one directory per feature
  area (`admin`, `bands`, `fastview`, `landing`, `layout`, `playlists`,
  `profile`, `songs`, `tabs`, `ui`). `ui/` is the only cross-area one; anything
  else that two areas need moves there rather than being imported sideways.
- **`src/store/*.ts`** - zustand stores for UI state that outlives a route
  (`bandContextStore`, `repertoireStore`). Not a cache for server data.
- **`src/i18n/dictionaries/*.json`** - landing-page copy only (see
  Internationalisation).

**Server-only is decided by the `@/lib/db` import, not by a filename (F24).**
Twelve of the 46 modules under `src/lib` import it at module scope - `auth.ts`,
`bands.ts`, `bands.server.ts`, `devProfiles.ts`, `moderation.ts`,
`playlists.ts`, `profile.ts`, `songs.ts`, `spotifyAuth.ts`,
`spotifyConnection.ts`, `spotifyPlaylistSync.ts`, `tabs.ts` - and three more pull
`pg` in through them: `auth-session.ts` and `emailChange.ts` (via `@/lib/auth`)
and `spotifyRouteAuth.ts` (via `@/lib/bands`, `@/lib/playlists` and
`@/lib/spotifyAuth`, among others). None of those fifteen may be imported for its
values from a file carrying `'use client'`. A type-only import is not a
violation: `import type` is erased before bundling, so it pulls in no `pg`, and
client files already use it against `src/lib` today. The other thirty-one modules
are free of `pg`, and nineteen of them appear in the 60 client files - fifteen
imported for their values (`playlistNav.ts`, `statusConfig.ts`, `auth-client.ts`,
...) and the rest for their types only.
`src/lib/__tests__/namingConventions.test.ts` computes both sets from the source,
counting only value imports as graph edges, follows the graph to a fixed point,
and fails the run on any client value import of a server-only module.

The `.server` suffix on `bands.server.ts` does **not** mean that `bands.ts` is
safe to import from a `'use client'` file: `bands.ts` imports `@/lib/db` too, so
both halves pull in `pg` and the isolation the suffix suggests never existed.
What it actually marks is a second return shape for the same
`join_band_by_invite($1, $2)` call: `joinBandByInviteServer` returns the richer
`JoinBandResult` that `/join/[code]` renders, while `joinBandByInviteClient` in
`bands.ts` returns only the band id. Do not add another `.server` file - a new
server-only module is just `camelCase.ts` that imports `@/lib/db`.

# Internationalisation

**The decision (F25): i18n is scoped to the landing page. The application UI is
English-only, written inline.**

`src/lib/i18n.ts` resolves a locale (`pt-BR` by default, or `en`) from the
`NEXT_LOCALE` cookie and then `Accept-Language`, and returns one of the two
dictionaries in `src/i18n/dictionaries/`. Exactly one component reads copy from
them, `src/components/landing/LandingPage.tsx`, and `LanguageSelector` is
rendered in exactly one place - inside that same landing page. `LanguageSelector`
reads no copy from a dictionary itself; it hardcodes its four strings, including
the app's only non-English literal. Every other `.tsx` file under `src/` (68 of
69) hardcodes its copy in English where it has any, as does the user-facing error
text assembled in `src/lib` (`Failed to fetch bands: ...`).

So: do not add a `getDictionary` lookup to a component outside
`src/components/landing/`, do not add a `t()` helper, and do not translate a page
as a side errand while doing something else. New application copy is written
inline, in English.

Two tests hold the halves of this in place.
`src/lib/__tests__/namingConventions.test.ts` pins the consumer set: exactly one
file calls `getDictionary`. `src/lib/__tests__/landingCopy.test.ts` already pins
the other half - `both dictionaries expose the same key set` - so a landing-copy
edit cannot land in one dictionary only. There is no third test, and none is
needed.

Two consequences are deliberate, and are not bugs to fix in passing:

- A `pt-BR` visitor sees a Portuguese landing page and an English application.
  That is the accepted cost of scoping i18n to marketing.
- 22 of the 49 dictionary keys are consumed by nothing: `common.*` except
  `appName` (11 keys), `nav.*` except `signIn` and `getStarted` (6 keys), and all
  five `status.*`. They are the residue of an abandoned app-wide attempt, and
  `knip` cannot see inside JSON. They stay, so that revisiting the decision does
  not start by re-typing them.

Adopting i18n app-wide remains a live option, not a closed door - it just has to
be its own task, starting with the shared chrome (`AppLayout`, `nav.*`,
`status.*`, for which the dictionaries already carry keys) rather than with
whichever page happens to be open.

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

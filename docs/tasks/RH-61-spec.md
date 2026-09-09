# RH-61 - Server Components parte 1/5: tirar force-dynamic do layout raiz e tornar auth/landing estaticas

Parent: RH-41 (part 1 of 5). Source finding: `docs/plans/code-quality-review.md`
section 5, T8, F15. Baseline: `65cadd8`.

## Scope

This task changes **only the rendering mode configuration** of the App Router
tree. It deletes `export const dynamic = "force-dynamic"` from the root layout
(`src/app/layout.tsx:12`), verifies by measurement which segments still need
per-request rendering, and pins the resulting `next build` route classification
with a regression guard.

In scope:

- deleting the `force-dynamic` export and its now-false comment block from
  `src/app/layout.tsx`;
- deciding, on measured evidence, which segments must carry their own
  `dynamic`/`revalidate` export (answer: none of the page segments; the one
  route handler that already carries `force-dynamic` keeps it);
- a new vitest guard that pins the invariant so a later part of RH-41 cannot
  silently reintroduce a global `force-dynamic`;
- pinning the static/dynamic route split as an expected result;
- the version bump and the suggestions log entry.

Explicitly **not** in scope (owned by parts 2-5 of RH-41 and by RH-53):

- converting any `'use client'` page into a Server Component;
- touching `src/hooks/useBandAdmin.ts` or its two consumer pages;
- touching `src/proxy.ts` (F10), including its matcher;
- touching `src/components/landing/LandingPage.tsx`, `src/app/page.tsx`,
  `src/app/login/page.tsx`, `src/app/signup/page.tsx`,
  `src/app/forgot-password/page.tsx`, `src/app/reset-password/page.tsx` or any
  other page body;
- moving the band context out of `localStorage`;
- adding a `Status:` line to `docs/plans/code-quality-review.md` for F15 (F15 is
  only resolved when the last part of RH-41 lands).

## Audit at 65cadd8

`git log --oneline -1` -> `65cadd8 test(RH-59): load eslint.config.mjs once in complexityBudget guard, explicit timeouts`.
`git status --porcelain` -> empty (clean tree).
Next.js version: `16.3.4` (Turbopack build).

### What the root layout actually does

`src/app/layout.tsx` is 46 lines (`grep -c '' src/app/layout.tsx` prints `46`). Line 12 is
`export const dynamic = "force-dynamic";`, preceded by a five-line comment
(lines 7-11) claiming "All routes require authentication, so there is nothing
useful to prerender". Both halves of that claim are false today: `/` is public
(it renders the marketing landing page for anonymous visitors), and `/login`,
`/signup`, `/forgot-password`, `/reset-password` and `/join/` are public in
`src/proxy.ts:3`.

The root layout is a **synchronous, non-async function component**. It reads no
cookies, no headers, and calls no dynamic server API. It renders
`src/app/AppShell.tsx`, and the dispatch's premise that `AppShell` is a Server
Component that calls `getBandsAction()` during the server render is **wrong**:
`src/app/AppShell.tsx:1` is `'use client'`, it reads the session with
`authClient.useSession()` and calls `getBandsAction()` from a `useEffect`
(line 26). It therefore contributes nothing to server-side dynamism. The same
holds for `src/components/layout/ConditionalLayout.tsx` (`'use client'`,
`usePathname`).

`src/app/layout.tsx` is the only `layout.tsx` in the whole tree
(`find src/app -name layout.tsx` returns exactly one path). There is no route
group, no nested layout, and no `template.tsx`. So the root directive was the
single global switch, and there is no layout split to perform: nothing needs to
be moved below a `(app)`/`(auth)` boundary because nothing above the pages reads
per-request state.

Grepping `src/app` for `next/headers`, `await params`, `await searchParams` and
`connection()` returns six files: the five Spotify/auth route handlers and
`src/app/join/[code]/page.tsx`. Those are dynamic by construction (they use
request data), so they need no directive of their own.

The only other `force-dynamic` in `src/` is `src/app/api/dev/profiles/route.ts:5`,
which genuinely needs per-request rendering (it 404s outside development based
on `NODE_ENV` at request time). It stays.

The four auth pages all wrap their `useSearchParams()` consumers in `Suspense`
(`src/app/login/page.tsx`, `src/app/signup/page.tsx:188`,
`src/app/reset-password/page.tsx:169`; `src/app/forgot-password/page.tsx` does
not use `useSearchParams` at all), so none of them needs per-request data: the
reset token and the `?redirect=` parameter are read on the client after
hydration. That is the evidence for including `/forgot-password` and
`/reset-password` in the static set.

`/` does not read the session on the server either. `src/app/page.tsx:624`
(`HomePage`) is `'use client'`; it renders "Loading..." while
`authClient.useSession()` is pending, then `LandingPage` or `RepertoireDashboard`.
The server HTML for `/` was already the pending shell before this change, so
making `/` static changes no byte a crawler sees except the cache headers. The
F15 goal for `/` is therefore fully reachable as "static shell + client
decision" - no reduction of the target set is needed.

### Baseline `npx next build` route table (verbatim, at 65cadd8)

```
Route (app)
+ f /
| f /_not-found
| f /admin/moderation
| f /api/auth/[...all]
| f /api/auth/spotify/authorize
| f /api/auth/spotify/callback
| f /api/auth/spotify/disconnect
| f /api/dev/profiles
| f /api/spotify/playlists
| f /api/spotify/playlists/[id]/import
| f /api/spotify/playlists/[id]/sync
| f /api/spotify/playlists/[id]/tracks
| f /api/spotify/search
| f /bands
| f /bands/[id]
| f /forgot-password
| o /icon.jpg
| f /join/[code]
| f /login
| f /playlists
| f /playlists/[id]
| f /profile
| f /reset-password
| f /settings
| f /signup
| f /songs/[id]/fast-view
+ f /songs/search

f Proxy (Middleware)

o  (Static)   prerendered as static content
f  (Dynamic)  server-rendered on demand
```

(The box-drawing characters and the two markers are reproduced above as ASCII:
`o` stands for the "(Static)" marker and `f` for the "(Dynamic)" marker that
Next prints in the legend. Every real glyph is non-ASCII, which is why every
expected result below asserts on build manifests and HTTP headers instead of on
this table.)

Machine-readable baseline: `.next/prerender-manifest.json` has
`routes` = `["/_global-error", "/icon.jpg"]` and `dynamicRoutes` = `[]`.
`.next/server/app/` contains exactly one page HTML file, `_global-error.html`.
The build reports `Generating static pages using 7 workers (7/7)`.

Under `npx next start`, `GET /login` and `GET /` both answer
`200` with `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`
and **no** `x-nextjs-prerender` header.

### What forces dynamic rendering where, at 65cadd8

| cause | routes affected |
|---|---|
| `src/app/layout.tsx:12` `force-dynamic` | every app route except `/icon.jpg` |
| `await params` + `getSession()` in the page body | `/join/[code]` |
| a dynamic `[id]` segment with no `generateStaticParams` | `/bands/[id]`, `/playlists/[id]`, `/songs/[id]/fast-view` |
| route handler reading the request | all of `/api/**` |
| explicit `force-dynamic` in the handler | `/api/dev/profiles` |

So the root directive is the only cause that has to be removed, and the other
four causes are what keeps the data routes dynamic afterwards.

`src/proxy.ts` does **not** affect static rendering. Its matcher
(`src/proxy.ts:51-55`) is a negative lookahead over non-asset paths; middleware
runs before the cache lookup on every matched request regardless of whether the
matched route is prerendered. Measured after the change: `GET /profile` without
a session still answers `307` from the middleware even though `/profile` is now
statically prerendered. No matcher change is needed or allowed here.

### Probe: the minimal change, measured

Method: `cp -Rc` clone of the repo into a scratch directory, delete lines 7-12
of `src/app/layout.tsx` (the comment block plus the export), `rm -rf .next`,
`npx next build`. No other file touched. The scratch clone has been deleted.

Result: the build succeeds (exit 0), reports
`Generating static pages using 7 workers (19/19)`, and produces this route
table (same ASCII substitution as above):

```
Route (app)
+ o /
| o /_not-found
| o /admin/moderation
| f /api/auth/[...all]
| f /api/auth/spotify/authorize
| f /api/auth/spotify/callback
| f /api/auth/spotify/disconnect
| f /api/dev/profiles
| f /api/spotify/playlists
| f /api/spotify/playlists/[id]/import
| f /api/spotify/playlists/[id]/sync
| f /api/spotify/playlists/[id]/tracks
| f /api/spotify/search
| o /bands
| f /bands/[id]
| o /forgot-password
| o /icon.jpg
| f /join/[code]
| o /login
| o /playlists
| f /playlists/[id]
| o /profile
| o /reset-password
| o /settings
| o /signup
| f /songs/[id]/fast-view
+ o /songs/search
```

Every one of `/`, `/login`, `/signup`, `/forgot-password` and `/reset-password`
is static, and every `/api/**` route plus every dynamic-parameter route plus
`/join/[code]` stays dynamic. **No per-segment `dynamic` or `revalidate` export
had to be added anywhere**, because no page segment reads per-request state:
the pages that need it are already dynamic by construction. This is the answer
to "push the directive down to only the segments that need it" - the set of
page segments that need it is empty, and the one route handler that needs it
already has it.

The pages that go static "for free" (`/profile`, `/settings`, `/bands`,
`/playlists`, `/admin/moderation`, `/songs/search`) are correct to be static
today: they are `'use client'` shells that fetch their data after hydration, so
the prerendered HTML contains no user data. Verified: the prerendered
`/` HTML contains "Repertoire Hero" (from the layout `metadata`) three times and
contains no `href="/signup"` (the landing markup is produced on the client after
hydration) - which is byte-for-byte the same shape the dynamic render produced
at baseline. Parts 2-5 of RH-41 will convert several of these pages to Server
Components, at which point they become dynamic again through `getSession()`.

Verified behaviours on the probe build:

- `npx next start`: `GET /login` -> `200`, `x-nextjs-prerender: 1`,
  `x-nextjs-stale-time: 300`, `Cache-Control: s-maxage=31536000`, **no**
  `Set-Cookie`. Same for `GET /`.
- `GET /profile` with no session -> `307` (middleware gate intact).
- `e2e/ssr-smoke.spec.ts` against `npx next start`: **4 passed**.
- `e2e/auth.spec.ts --grep "credentials"` against `npx next start`:
  **2 passed** (login through the now-static `/login` still works end to end).
- A Server Action still runs from a statically prerendered authenticated page:
  loading `/bands` with the e2e storage state renders the seeded band name and
  produces zero page errors. (Checked with a throwaway spec that was deleted;
  it is recorded here as evidence, not as a deliverable.)

Not usable as a gate: the full `npx playwright test` run is red at `65cadd8`
independently of this change (9 failed / 8 passed at baseline, 8 failed /
9 passed with the change, with a largely overlapping failure set that includes
`songs-crud`, `fast-view-mobile` and `bands-confirm`). Two `e2e/auth.spec.ts`
tests (`unauthenticated user is redirected to /login`, `redirect param is
honoured after login`) fail at baseline because they assume `/` is protected,
which it has not been since the landing page landed. None of that is RH-61's
work, so only `e2e/ssr-smoke.spec.ts` and the two `credentials` tests are named
below.

### Gate baselines at 65cadd8 (given, to be preserved)

`rtk proxy npx vitest run` 92 files / 1064 tests / 0 skipped;
`rtk proxy npx eslint .` `22 problems (8 errors, 14 warnings)`;
`npm run lint:dup` 19 clones / 242 lines / 0.71 %; knip clean; tsc clean;
`npm run audit` 0 high; coverage thresholds 80/65/78/80; complexity overrides 23;
`e2e/ssr-smoke.spec.ts` 4 passed. Version `0.1.90-202609091102`.

## Approach

Three source edits, one doc edit, one version bump.

**1. `src/app/layout.tsx` - delete lines 7 through 13.**

Remove the entire comment block, the export, and the blank line that separated
them from the font declarations, so the imports are followed directly by the
`const geistSans = Geist({` declaration. Do not replace the comment with a new
one in this file; the reasoning belongs in the guard test (below) and in this
spec, not in a comment that will rot again. Nothing else in the file changes:
`metadata`, the fonts, `AppShell`, `Analytics` and the `RootLayout` function
body stay exactly as they are. The file goes from 46 to 39 lines. It carries no
complexity-budget override, so no ratchet arithmetic is needed.

**2. No per-segment `dynamic` export is added.** The probe proves the set of
page segments needing per-request rendering is empty. `src/app/api/dev/profiles/route.ts:5`
keeps its existing `export const dynamic = 'force-dynamic'` untouched, and after
this task it is the only occurrence of that string under `src/`.

**3. New guard `src/lib/__tests__/rootLayoutRendering.test.ts`.**

A source-reading guard in the established house style (see
`src/lib/__tests__/serverExternalPackages.test.ts`,
`migrationsSingleSource.test.ts`, `transactionGuard.test.ts`). Node environment
(the vitest default; do **not** add a `@vitest-environment jsdom` line). It
reads files with `fs.readFileSync` and asserts:

- `src/app/layout.tsx` contains neither `export const dynamic` nor
  `force-dynamic`;
- walking every `.ts`/`.tsx` file under `src/`, the set of files containing the
  literal `force-dynamic` is exactly `['src/app/api/dev/profiles/route.ts']`.

The second assertion is an explicit allowlist with a comment explaining that a
later task may extend it deliberately for a segment that genuinely needs
per-request rendering, but that the root layout may never be in it. Two `it()`
blocks are enough; keep the file well under the 800-line test `max-lines` cap
and use no `catch (x: any)` (the `errorHandlingStyle` guard walks it too).

The file lives under `src/lib/__tests__/`, which `coverage.include` excludes via
`**/__tests__/**`, so it adds nothing to the coverage denominator - and since no
file inside the coverage universe (`src/lib/**`, `src/app/actions/*.ts`,
`src/hooks/**`, `src/proxy.ts`) is modified by this task, the coverage numbers
must not move except for the noise of one more test file executing.

**4. `docs/suggestions-log.md`** - append the suggestions raised during this
task, following the existing file's format.

**5. `package.json`** - bump `version` to `0.1.91-YYYYMMDDHHmm`.

**Landing Page Rule decision.** This task ships a rendering-mode change. It adds
no user-facing capability a musician or band would choose the app for, so it is
**not** a selling point and the landing copy must not change. ER11 asserts that
mechanically.

## Expected Results

ER1 - `grep -c 'force-dynamic' src/app/layout.tsx` prints `0`, `grep -c 'export const dynamic' src/app/layout.tsx` prints `0`, and `grep -c 'nothing useful to prerender' src/app/layout.tsx` prints `0` (the stale comment that justified the directive is gone with it). `grep -c '' src/app/layout.tsx` prints `39` (it printed `46` at `65cadd8`), `grep -c 'AppShell' src/app/layout.tsx` prints `3` and `grep -c 'export const metadata' src/app/layout.tsx` prints `1`, confirming that only the directive and its comment block were removed and the rest of the layout is intact.

ER2 - `grep -rln 'force-dynamic' src/` prints exactly one line, `src/app/api/dev/profiles/route.ts`, and `grep -n 'force-dynamic' src/app/api/dev/profiles/route.ts` still prints line `5`. In other words the only segment that declares per-request rendering is the dev-only route handler that needs it; no page segment and no layout declares `dynamic` or `revalidate`, which `grep -rc "export const revalidate" src/ | grep -v ':0$'` confirms by printing nothing.

ER3 - `test -f src/lib/__tests__/rootLayoutRendering.test.ts` exits `0` (the file exists; it does not exist at `65cadd8`), its first line is not `// @vitest-environment jsdom`, and `rtk proxy npx vitest run src/lib/__tests__/rootLayoutRendering.test.ts` exits `0` printing `Test Files  1 passed (1)` and `Tests  N passed (N)` with `N` greater than or equal to `2` and `0 failed`. Reverting only ER1's edit (restoring `export const dynamic = "force-dynamic";` to `src/app/layout.tsx`) and rerunning that same command makes it exit non-zero with at least one failing test, proving the guard actually guards.

ER4 - From a clean build (`rm -rf .next && npx next build`) the command exits `0`, its output contains exactly one line matching `grep -c '(Static)   prerendered as static content'` and exactly one line matching `grep -c '(Dynamic)  server-rendered on demand'`, and it reports `Generating static pages` with a count of `19` completed (`grep -c 'static pages using 7 workers (19/19)'` prints `1` on a 7-worker machine; on any machine the completed count printed is `19/19`).

ER5 - After that build, `node -e "const r=Object.keys(require('./.next/prerender-manifest.json').routes).sort();console.log(r.length);console.log(r.join(' '))"` prints exactly two lines: `14`, then `/ /_global-error /_not-found /admin/moderation /bands /forgot-password /icon.jpg /login /playlists /profile /reset-password /settings /signup /songs/search`. Those are the routes Next classifies as "prerendered as static content", and the list contains `/`, `/login`, `/signup`, `/forgot-password` and `/reset-password`.

ER6 - After the same build, `node -e "const a=Object.values(require('./.next/app-path-routes-manifest.json'));const s=new Set(Object.keys(require('./.next/prerender-manifest.json').routes));const d=a.filter(x=>!s.has(x)).sort();console.log(d.length);console.log(d.join(' '))"` prints exactly two lines: `14`, then `/api/auth/[...all] /api/auth/spotify/authorize /api/auth/spotify/callback /api/auth/spotify/disconnect /api/dev/profiles /api/spotify/playlists /api/spotify/playlists/[id]/import /api/spotify/playlists/[id]/sync /api/spotify/playlists/[id]/tracks /api/spotify/search /bands/[id] /join/[code] /playlists/[id] /songs/[id]/fast-view`. Every data route stays server-rendered on demand. Additionally `ls .next/server/app/index.html .next/server/app/login.html .next/server/app/signup.html .next/server/app/forgot-password.html .next/server/app/reset-password.html` exits `0` (all five prerendered documents were written to disk; at `65cadd8` none of these files existed).

ER7 - With `BETTER_AUTH_SECRET` exported from `.env.local` (because `.env.production.local` sets it empty) and `npx next start -p 3000 -H 127.0.0.1` serving the build from ER4: `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/login` prints `200`; `curl -sS -D - -o /dev/null http://127.0.0.1:3000/login | grep -ci '^x-nextjs-prerender: 1'` prints a number greater than or equal to `1`; `curl -sS -D - -o /dev/null http://127.0.0.1:3000/login | grep -ci '^set-cookie'` prints `0`; `curl -sS -D - -o /dev/null http://127.0.0.1:3000/login | grep -c 'Cache-Control: s-maxage=31536000'` prints `1`. The same four commands against `http://127.0.0.1:3000/` print the same four values. `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/profile` still prints `307`, proving the middleware session gate is unaffected by static prerendering.

ER8 - `PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1" npx playwright test e2e/ssr-smoke.spec.ts` (same `BETTER_AUTH_SECRET` precondition, Postgres reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations applied, so `e2e/global-setup.ts` can create the e2e user) exits `0` and prints `4 passed`, with all four named tests green: `GET / signed out returns a 200 SSR document`, `signed-out / renders the landing page in a browser`, `GET /profile signed in returns a 200 SSR document`, `/profile renders the app shell in a browser`.

ER9 - Under the same server and preconditions, `PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1" npx playwright test e2e/auth.spec.ts --grep "credentials"` exits `0` and prints `2 passed`, covering `valid credentials redirect to home` and `invalid credentials show an error message`, which proves the sign-in flow still works through the now statically prerendered `/login`. The other two tests in that file (`unauthenticated user is redirected to /login` and `redirect param is honoured after login`) are excluded on purpose: they already fail at `65cadd8` because they assume `/` is a protected route, and this task neither fixes nor worsens them.

ER10 - Static gates hold at their `65cadd8` pins: `rtk proxy npx eslint .` prints `22 problems (8 errors, 14 warnings)`; `./node_modules/.bin/tsc --noEmit` exits `0` printing nothing; `npm run lint:dead` exits `0` with no unused file, export or dependency reported; `npm run lint:dup` exits `0` and reports at most `19` clones and a duplication percentage of at most `0.71 %`; `npm run audit` exits `0` with `0` high or critical advisories; and `rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts` exits `0` (which is what enforces that the override list between the `BEGIN:complexity-budget-overrides` and `END:complexity-budget-overrides` markers still holds exactly `23` entries and that no new budget violation was introduced).

ER11 - With Postgres reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (migrations applied) and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`, `rtk proxy npx vitest run` exits `0` reporting `Test Files` passed greater than or equal to `93` (was 92; the ER3 guard is the new file), `Tests` passed greater than or equal to `1066` (was 1064), `0 failed` and `0 skipped`; and `npm run test:coverage` exits `0` with all four thresholds met (statements at least `80`, branches at least `65`, functions at least `78`, lines at least `80`). Also: `package.json` version is `0.1.91-YYYYMMDDHHmm` with a real local timestamp and sorts above `0.1.90-202609091102`; `git diff 65cadd8 -- src/components/landing src/i18n/dictionaries` prints nothing (this task ships no selling point, so the Landing Page Rule requires no copy change); and `git diff --name-only 65cadd8 | sort` lists only paths drawn from this closed set and no others: `docs/suggestions-log.md`, `docs/tasks/RH-61-spec.md`, `package.json`, `src/app/layout.tsx`, `src/lib/__tests__/rootLayoutRendering.test.ts` - any other path fails this result. In particular that list contains no `src/proxy.ts`, no `next.config.ts`, no path under `src/components/` or `src/hooks/`, no other path under `src/app/`, and no `docs/plans/code-quality-review.md`.

## Out of Scope

- Any page-body change. Not one line of `src/app/**/page.tsx`,
  `src/app/AppShell.tsx`, `src/components/**` or `src/hooks/**` may change.
- `src/proxy.ts`, including its matcher and its public-path list (F10, RH-41
  part 5).
- Converting `/bands`, `/admin/moderation` or `/playlists` to Server Components
  (RH-41 parts 2-3).
- Redesigning `useBandAdmin` (RH-41 part 4) and decomposing
  `src/app/playlists/[id]/page.tsx` (RH-53).
- Fixing the pre-existing red e2e specs (`songs-crud`, `fast-view-mobile`,
  `bands-confirm`, and the two `/`-assumes-protected tests in `auth.spec.ts`).
- Updating `docs/plans/mobile-app-analysis.md`, which repeats the false
  "force-dynamic exists to prevent a real prerender crash" claim in several
  places; that document is now stale but is not on this task's whitelist.
- Adding a `Status:` line for F15 in `docs/plans/code-quality-review.md`.
- Any `next.config.ts` change, including `serverExternalPackages` (RH-32).

## Post-merge checks (orchestrator)

After the Vercel deployment of the merge commit, the build summary should list
`/`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/profile`,
`/settings`, `/bands`, `/playlists`, `/admin/moderation`, `/songs/search`,
`/_not-found` and `/icon.jpg` as static and the fourteen routes of ER6 as
dynamic, and a production `curl -sS -D - -o /dev/null https://<host>/login`
should carry a CDN cache hit header. No expected result above depends on this.

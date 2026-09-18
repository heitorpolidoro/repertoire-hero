# RH-78 — Convert `/` to a Server Component to fix the HomePage hydration mismatch

> **Filename mapping.** This repository's spec filenames run one ahead of the
> Meridian board id: the board task is **RH-77**, its spec is
> `docs/tasks/RH-78-spec.md`. Commit scope stays `RH-77`.

## Scope

`src/app/page.tsx` is a 640-line `"use client"` file holding two things: the
`HomePage` session gate (lines 624-640) and the `RepertoireDashboard` it renders
when signed in (lines 112-622), plus the `SongResultItem` row (lines 38-89).
The gate returns `Loading...` while `authClient.useSession()` is pending, and on
the server `isPending` is *always* true, which produces two distinct defects:

1. **A hydration mismatch.** Measured at `25be664`: 5 `Hydration failed` browser
   errors in the dev-server log across the full Playwright suite, 4 with the
   stack at `RepertoireDashboard (page.tsx:306)` and 1 at
   `LandingPage (LandingPage.tsx:41)`, both under `HomePage (page.tsx:624)`.
2. **A landing page with no HTML.** `/` is a prerendered static route whose
   document is the placeholder. Verified live at `cc31134`:
   `curl -s http://127.0.0.1:3000/` returns 27,659 bytes containing
   `<div class="min-h-screen flex items-center justify-center bg-gray-50"><p …>Loading...</p></div>`
   and **zero** occurrences of `href="/signup"`. The marketing page a crawler
   sees contains none of the marketing page. This is a first-class goal of this
   task, not a side effect of (1).

This task converts `/` to the async Server Component pattern already used four
times (`/bands`, `/playlists`, `/admin/moderation`, `/playlists/[id]`), moves
the dashboard into a client island under `src/components/songs/`, and proves
both defects gone by measurement.

**Not one PR? It is.** The 639 lines are one component being *relocated*, not
rewritten: the JSX, handlers and state of `RepertoireDashboard` move verbatim.
Splitting the move from the conversion would leave an intermediate commit where
the page is a Server Component importing a `"use client"` file that still
imports Server Actions directly (an F21 violation), so the two halves cannot
ship separately.

## Approach

### Behavior

**B1 — the page.** `src/app/page.tsx` loses `"use client"` and becomes
`export default async function HomePage()`. It awaits `getSession()` from
`@/lib/auth-session`; with no `session.user.id` it renders `<LandingPage />`,
otherwise `<RepertoireDashboard actions={…} />`. It does **not** call
`redirect("/login")` — unlike the four precedents, the signed-out branch of `/`
is the product's public marketing page, and `/` is deliberately absent from
`src/proxy.ts`'s matcher. Both branches are `"use client"` islands rendered
through the normal SSR pass, so both ship real HTML.

**B2 — route classification.** `getSession()` awaits `headers()`, so `/` becomes
dynamic by construction and moves out of the prerendered set in the `next build`
route table (10 static / 17 dynamic at `66d9442` becomes 9 static / 18 dynamic).
No `export const dynamic` is added anywhere — `rootLayoutRendering.test.ts`'s
allowlist stays exactly `['src/app/api/dev/profiles/route.ts']`. The trade is
deliberate and is the point of the task: a per-request render in exchange for a
document that actually contains the landing page.

**B3 — where `RepertoireDashboard` goes.** Wholesale into
`src/components/songs/RepertoireDashboard.tsx` (the existing `songs` area — no
new component directory, no AGENTS.md area-list change), with `SongResultItem`
split into its own `src/components/songs/SongResultItem.tsx` to keep the
one-component-per-file convention that applies under `src/components`. Because
F21 forbids `src/components/**` importing `@/app/*`, the seven Server Actions it
imports today (`createAndAddSongAction`, `addSongAction`,
`searchGlobalSongsAction`, `updateSongAction`, `updateSongStatusAction`,
`updateSongTagsAction`, `submitGlobalSongEditAction`) become one injected
`RepertoireDashboardActions` object built in `page.tsx`, exactly as
`BANDS_VIEW_ACTIONS` / `PLAYLISTS_VIEW_ACTIONS` do; the island keeps passing a
`SongFormActions` slice down to `SongForm`. `src/store/repertoireStore.ts` is
**not** covered by F21 (the rule's globs are `src/components/**`, `src/lib/**`,
`src/hooks/**`) and keeps importing its actions directly — do not touch it.

**B4 — signed-in first paint: the dashboard still loads on mount.** Its read is
keyed by the **band context**, which lives only in the browser
(`src/store/bandContextStore.ts`, `zustand/persist` → `localStorage`). The
server cannot know which repertoire to read, so a server read would necessarily
be the personal one and would be wrong — and visibly wrong in the HTML — for a
band-mode user. `useRepertoireStore`'s initial state is deterministic and not
persisted (`songs: []`, `isLoading: false`), so the server render and the
client's first render are identical and the mount-effect fetch happens strictly
after hydration: no mismatch. Moving the read to the server is a follow-up
blocked on moving band context into a cookie, and is out of scope.

**B5 — the band-context hydration guard (required, or ER4 does not hold).**
`persist` with `localStorage` rehydrates synchronously at store creation, so a
band-mode user's first client render already carries
`{ type: 'band', … }` while the server rendered the `{ type: 'user' }` default.
The island therefore must gate every band-context-derived output — the header
title, the read-only vs. clickable status badge, the empty-state copy and the
`?bandId=` query on each song link — behind a "has the client hydrated yet"
flag. Pre-hydration the island renders the personal variant.

The flag is a new `useHydrated()` hook in `src/hooks/useHydrated.ts`, built on
`useSyncExternalStore` with a never-firing `subscribe`, a `getSnapshot` of
`true` and a `getServerSnapshot` of `false`. It must **not** copy `AppLayout`'s
`useState(false)` + `useEffect(() => { setMounted(true); }, [])` shape: both
occurrences of that shape in `AppLayout`
(`src/components/layout/AppLayout.tsx:48` and `:165`) are themselves
`react-hooks/set-state-in-effect` **errors** in the 8-error baseline, so copying
it would add a ninth and break ER8. The `useSyncExternalStore` shape was linted
in this tree against the project config and reports **0 errors / 0 warnings**,
and the whole-tree count with the hook file present is still exactly 8/12.
`AppLayout` itself is not touched — fixing its two errors is out of scope.

**B6 — `LandingPage` is unchanged.** Its `useState<Locale>("pt-BR")` plus
cookie-reading effect is mismatch-free by construction (the initial state is a
constant, so server and first client render agree); server-resolving the locale
is a different task. Its `LandingPage.tsx:41` stack disappears because the
subtree above it stops mismatching, not because the file changes.

**B7 — explicitly unchanged.** `AppShell`/`AppLayout` stay client-resolved, so
the raw document for a signed-out `/` still contains the chrome
`nav[aria-label="Main navigation"]` (2 occurrences today, before and after).
That is a pre-existing `AppShell` wart, not this task's, and it produces no
hydration error because `isPending` is true on the client's first render too.

### Files touched

- `src/app/page.tsx` — drops `"use client"`; becomes an async Server Component
  (~40-60 lines) holding only the session read, the branch and the actions
  bundle.
- `src/components/songs/RepertoireDashboard.tsx` — **new**; the dashboard moved
  verbatim, plus the injected-actions prop and the `useHydrated()` guard of B5.
- `src/components/songs/SongResultItem.tsx` — **new**; the row component moved out.
- `src/hooks/useHydrated.ts` — **new**; the `useSyncExternalStore` hydration flag
  of B5. Imports only `react`, so it is F21-clean under `src/hooks/**`.
- `src/components/songs/__tests__/repertoireDashboard.test.tsx` — **new** DOM
  test (see TC3).
- `eslint.config.mjs` — the `complexity-budget/override` entry for
  `src/app/page.tsx` is **re-pinned, not added**: its `files` becomes the
  island's path and its three ceilings are recomputed to the island's exact
  worst numbers (they will be lower — `SongResultItem` and the actions bundle
  leave the file). The list stays at **18 entries**, so `MAX_OVERRIDES` is
  unchanged; `src/app/page.tsx` must end up under the base budget with no entry
  of its own. If the island happens to fit the base budget, delete the entry
  instead and lower `MAX_OVERRIDES` to 17.
- `e2e/ssr-smoke.spec.ts` — the signed-out `/` test is **strengthened** (TC2).
- `docs/plans/code-quality-review.md` — a new `**Addendum (RH-77).**` at the end
  of F15's Status, leaving every existing sentence standing (ER11).

### Test criteria

- **TC1 — hydration count.** The criterion is the **full** suite; the ssr-smoke
  run is the cheap probe. Playwright will not capture this for you:
  `playwright.config.ts` sets `webServer.stdout: 'ignore'` and
  `reuseExistingServer: !CI`, so the dev server must be started **outside**
  Playwright with stderr redirected to a file, and the file must be proven
  non-empty before any `grep -c` is believed (a `grep -c` over a missing file
  also returns `0`, which is the pass value).
  ```
  rm -f /tmp/rh77-dev.log
  npm run dev > /tmp/rh77-dev.log 2>&1 &
  # wait for http://127.0.0.1:3000 to answer
  npx playwright test                       # full suite  → baseline 5
  # or: npx playwright test e2e/ssr-smoke.spec.ts   # probe → baseline 1
  grep -c "GET / 200" /tmp/rh77-dev.log     # POSITIVE CONTROL, must be >= 1
  grep -c "Hydration failed" /tmp/rh77-dev.log
  grep -cE "^ *at (RepertoireDashboard|LandingPage) \(" /tmp/rh77-dev.log
  ```
  Measured this run against `cc31134` with exactly this recipe, the ssr-smoke
  probe gives `GET / 200` = 5, `Hydration failed` = 1 and one frame
  `    at LandingPage (src/components/landing/LandingPage.tsx:41:7)` under
  `    at HomePage (src/app/page.tsx:636:12)` — that indented `at <Name> (` form
  is the only shape these stacks take, and it is what the greps must anchor on.
  A bare identifier grep is **not** acceptable after this task, because
  `RepertoireDashboard` will also appear in Turbopack's dev compilation output
  for the new island file. Required after the change: positive control >= 1,
  `Hydration failed` = 0, stack frames = 0. Use a **fresh** log per measurement.
- **TC2 — the document.** `e2e/ssr-smoke.spec.ts`'s signed-out `/` test keeps its
  current assertions and adds two on the raw body: it contains `href="/signup"`
  (0 occurrences today) and does not contain `>Loading...<` (1 today). The
  browser-level test in the same file is unchanged and must still pass.
- **TC3 — the band-context guard.** A jsdom test renders the island through
  `renderToString` (which runs no effects, so it is exactly the first render)
  with `useBandContextStore` pre-set to a band, and asserts the output contains
  `My Repertoire` and not the band name. File opens with
  `// @vitest-environment jsdom` and registers `afterEach(cleanup)` per AGENTS.md.
- **TC4 — untouched guards.** `src/lib/__tests__/rootLayoutRendering.test.ts` and
  `src/lib/__tests__/namingConventions.test.ts` must pass **without edits**: the
  first because no rendering-mode export is added, the second because it computes
  the `'use client'` census from source with no hardcoded count.
  `complexityBudget.test.ts` passes on the re-pinned entry.
  `e2e/helpers.ts`'s `goHome()` waits on `[aria-label="Song list"]`, which the
  moved island must keep rendering verbatim — do not rename it.
- **TC5 — lint.** `npx eslint -f json .` must report **8 errors / 12 warnings**
  with the same `(file, rule)` pairs as `cc31134` (re-measured this run):
  `src/app/profile/page.tsx:630`, `src/app/reset-password/page.tsx:21`,
  `src/app/settings/page.tsx:25` (`react-hooks/set-state-in-effect`) and `:109`
  (`@next/next/no-html-link-for-pages`),
  `src/components/landing/LandingPage.tsx:26`,
  `src/components/layout/AppLayout.tsx:48` **and** `:165`,
  `src/components/layout/LanguageSelector.tsx:17` — every one except the
  `settings:109` entry is `react-hooks/set-state-in-effect`, the two `AppLayout`
  lines included. **None** of the 8 lives in `src/app/page.tsx`, so the
  relocation moves zero existing errors. Do not fix the baseline here, and do
  not introduce a ninth error: this is why B5's guard is `useSyncExternalStore`
  and not a `setState`-in-effect flag. Verification that the prescribed shape is
  clean was done in this tree, not assumed — the hook file lints to 0/0 and the
  whole-tree count with it present is 8/12.

## Expected Results

- [ ] ER1 `src/app/page.tsx` carries no `'use client'` and its default export is
      `export default async function HomePage()` that awaits `getSession()` and
      chooses between `LandingPage` and `RepertoireDashboard` on the server.
- [ ] ER2 `grep -nE "isPending|Loading\.\.\." src/app/page.tsx` returns nothing.
- [ ] ER3 With the dev server up and no session cookie, `curl -s http://127.0.0.1:3000/`
      returns a body containing `href="/signup"` and containing no `>Loading...<`
      (baseline at `cc31134`: 0 and 1 respectively).
- [ ] ER4 With the dev server started **outside Playwright** and its output
      redirected to a fresh log (`rm -f /tmp/rh77-dev.log; npm run dev >
      /tmp/rh77-dev.log 2>&1 &` — Playwright's own `webServer` sets
      `stdout: 'ignore'` and captures nothing), after a full `npx playwright
      test` run: the POSITIVE CONTROL `grep -c "GET / 200" /tmp/rh77-dev.log`
      is `>= 1` (proving the log really captured the run; it was 5 for the
      ssr-smoke probe alone at `cc31134`), **and** `grep -c "Hydration failed"
      /tmp/rh77-dev.log` is `0` (baseline 5). Repeating the same procedure with
      a fresh log and only `npx playwright test e2e/ssr-smoke.spec.ts` gives the
      same two values: control `>= 1`, `Hydration failed` `0` (baseline 1).
- [ ] ER5 In that same log, captured the same way and with the same positive
      control `grep -c "GET / 200" /tmp/rh77-dev.log` `>= 1`,
      `grep -cE "^ *at (RepertoireDashboard|LandingPage) \(" /tmp/rh77-dev.log`
      is `0`. The grep is anchored to stack frames of the form
      `    at LandingPage (src/components/landing/LandingPage.tsx:41:7)`, never
      to the bare identifiers, which after this task also appear in Turbopack's
      dev compilation output for `src/components/songs/RepertoireDashboard.tsx`.
      Baseline at `cc31134`: 4 `at RepertoireDashboard (` frames over the full
      suite, 1 `at LandingPage (` frame over the ssr-smoke probe.
- [ ] ER6 `npx playwright test` passes, 35 specs, 0 failures.
- [ ] ER7 `RUN_DB_TESTS=1 npx vitest run` passes with 0 skipped test files.
- [ ] ER8 `npx eslint -f json .` reports exactly 8 errors and 12 warnings, with the
      same `(file, rule)` pairs as `cc31134`.
- [ ] ER9 `eslint.config.mjs`'s `complexity-budget/override` list has no entry for
      `src/app/page.tsx`, has at most 18 entries, and
      `src/lib/__tests__/complexityBudget.test.ts` passes.
- [ ] ER10 `src/components/songs/__tests__/repertoireDashboard.test.tsx` exists and
      passes: with a band pre-set in `useBandContextStore`, the island's first
      render (`renderToString`, no effects) contains `My Repertoire` and not the
      band name.
- [ ] ER11 `docs/plans/code-quality-review.md`'s F15 Status ends with a new
      `**Addendum (RH-77).**` recording that `/` is no longer one of the five
      deferred `'use client'` pages (four remain) and that `/` moved from the
      prerendered set to server-rendered-on-demand, with every pre-existing
      sentence of F15 left verbatim.

- [ ] ER12 `src/hooks/useHydrated.ts` exists, uses `useSyncExternalStore`, and
      contains no `useEffect`; `npx eslint -f json src/hooks/useHydrated.ts`
      reports 0 errors and 0 warnings.

## Out of Scope

- Fixing the 8 existing eslint errors / 12 warnings.
- Server-resolving the app chrome (`AppShell` / `AppLayout`), so the signed-out
  `/` document keeps its two `nav[aria-label="Main navigation"]` occurrences.
- Server-resolving the landing-page locale, or any i18n change.
- Reading the repertoire on the server / moving band context to a cookie.
- Decomposing `RepertoireDashboard` beyond extracting `SongResultItem`; it moves
  as it is.
- Any visual change. The rendered UI is byte-identical post-hydration, which is
  why this spec ships no HTML mockup.

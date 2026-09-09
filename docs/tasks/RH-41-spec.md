# RH-41 - Carregar dados de pagina em Server Components e enxugar os controllers client (integration and close-out)

RH-41 was split once, into RH-61, RH-62, RH-63, RH-64 and RH-65. All five are
`done` and merged (`57bc60a`, `6e32874`, `35d6f66`, `6aa099c`, `66d9442`). A task
is split at most once, so this is not a second split: it is the reduced-scope
spec for what is left after the five parts, which is integration verification
plus the documentation close-out. The task's own `justification` field fixes that
scope in as many words - confirm the final `npx next build` route table, and
close F10, F14 and F15 in `docs/plans/code-quality-review.md` section 5, T8 -
and states that F13 is not part of any of it and stays with RH-53.

Baseline: `66d9442`, version `0.1.95-202609091654`, clean tree
(`git status --porcelain` prints nothing). Every number below was measured from
the repository root at that commit while writing this spec.

## Scope

This task covers exactly two things.

1. **Integration verification.** Prove that the five parts compose at `66d9442`:
   that the `npx next build` route table is the one the conversion was supposed
   to produce (static auth and landing routes, dynamic data routes, nothing
   silently forced back to per-request rendering); that the three converted
   pages, the proxy's twelve-entry allow-list and the slimmed band controller
   hold simultaneously rather than one at a time; that the guard suites the five
   parts introduced pass together in one run alongside every static gate, the
   whole suite, coverage, the production build and the SSR smoke spec at the same
   commit. Nothing here changes behaviour; the verification is the deliverable
   and its evidence is the Expected Results below.
2. **Documentation close-out.** Mark F10, F14, F15 and task T8 (section 5) as
   resolved in `docs/plans/code-quality-review.md`, with the commit ids and the
   measured numbers, and record with a dated additive note the one claim in F14
   that measurement disproves, so a later reader does not conclude the finding
   was under-delivered.

**This task changes no code.** The work was delivered by RH-61 (root layout
`force-dynamic` removal), RH-62 (`/bands` and `/admin/moderation` as Server
Components), RH-63 (`/playlists` as a Server Component), RH-64 (`useBandAdmin`
reduced to data plus intent commands) and RH-65 (`src/proxy.ts` as a narrow,
documented redirect convenience). Not one line under `src/`, `migrations/`,
`e2e/`, `eslint.config.mjs` or `vitest.config.ts` moves here; ER9 states that as
a checkable result.

## Audit at 66d9442

### The route table

`npx next build` exits 0 and prints a 27-route table: **10 prerendered as static
content** (`○`) and **17 server-rendered on demand** (`ƒ`), plus one
`ƒ Proxy (Middleware)` line under it.

The ten static routes are `/`, `/_not-found`, `/forgot-password`, `/icon.jpg`,
`/login`, `/profile`, `/reset-password`, `/settings`, `/signup` and
`/songs/search`. The seventeen dynamic ones are `/admin/moderation`,
`/api/auth/[...all]`, `/api/auth/spotify/authorize`, `/api/auth/spotify/callback`,
`/api/auth/spotify/disconnect`, `/api/dev/profiles`, `/api/spotify/playlists`,
`/api/spotify/playlists/[id]/import`, `/api/spotify/playlists/[id]/sync`,
`/api/spotify/playlists/[id]/tracks`, `/api/spotify/search`, `/bands`,
`/bands/[id]`, `/join/[code]`, `/playlists`, `/playlists/[id]` and
`/songs/[id]/fast-view`.

That is the shape the conversion was aiming at, and it is worth reading closely
because two of its entries are the whole point of the exercise:

- `/` and `/login` are `○`. The landing page and the auth routes prerender
  again; that is RH-61's deliverable and it is only visible in this table.
- `/bands`, `/playlists` and `/admin/moderation` are `ƒ`, but they are dynamic
  *by construction* rather than by directive - each awaits `getSession()`, which
  awaits `headers()`. No page segment carries `export const dynamic`, so the
  remediation's "move `force-dynamic` down to the segments that need it" was
  satisfied by needing it nowhere.

Two properties of the build output are traps for a naive Expected Result and are
pinned here so the ER can be written correctly. First, the build prints eleven
`[Error [BetterAuthError]: You are using the default secret. ...]` lines during
`Collecting page data` when `BETTER_AUTH_SECRET` is not exported; they are
diagnostics from the prerender workers, the build still exits 0, and they do not
match `^Error` because each line begins with `[`. Second, this Next version
prints `✓ Compiled successfully in 4.5s`, so unlike some earlier versions the
phrase *is* available - but the reliable success signal is still the exit code
plus the absence of `^Error|^Failed|Failed to compile`.

The route lines *are* countable with `grep -c '○ /'` and `grep -c 'ƒ /'` (the
legend lines read `○  (Static)` and `ƒ  (Dynamic)` with two spaces before a
parenthesis, and the middleware line reads `ƒ Proxy (Middleware)`, so none of the
three is matched; a bracket expression over the box-drawing prefixes,
`grep -cE '^[├└┌] ○ '`, does **not** work in this environment - it printed `0`).
But those counts require non-ASCII literals in the command, and the persisted
`expected_results` must be ASCII-only, so **ER4 reads the split out of the build
manifests instead**, exactly as RH-61, RH-62 and RH-63 did. Measured on a
`rm -rf .next && rtk proxy npx next build` at `66d9442`:
`Object.keys(.next/prerender-manifest.json .routes)` has **11** entries - the ten
static routes above plus `/_global-error` - and the entries of
`.next/app-path-routes-manifest.json` not in that set number **17** and are
exactly the seventeen dynamic routes above, out of **28** app paths in total.

**Why the manifest says 11 and the printed table says 10, and why RH-63's QA
recorded 11.** The printed `Route (app)` table has 27 rows because it omits
`/_global-error`, which the prerender manifest counts; 11 and 10 are the same
tree counted in two places. Separately, RH-63's QA reported "11 prerendered / 17
dynamic" from the *table* at `35d6f66`, and that 11 was the legend line counted
as a route: `grep -c '○'` without the trailing ` /` also matches
`○  (Static)`. No route moved between `35d6f66` and `66d9442` - the set of
route-defining files under `src/app` is identical at both commits and the two
intervening commits touch only `useBandAdmin`, `src/proxy.ts` and
`eslint.config.mjs`. Nothing regressed; the three numbers in circulation (10, 11
from the manifest, 11 from a legend-inclusive grep) all describe the same build.

### F10 - `src/proxy.ts`

All three compounding defects the finding names are gone.

- **The root special case.** `pathname === '/'` does not appear in the file.
  There is no path special case at all: the file compares `pathname` against a
  four-element `AUTH_PAGES` array and otherwise redirects, and `/` is simply
  absent from the matcher.
- **The self-`fetch`.** Gone with its `AbortController` and its 3000 ms timeout.
  `proxy()` is a synchronous function that resolves the session from the request
  headers alone, via `getSessionCookie` from `better-auth/cookies`. There is no
  round trip left to cache and no timeout left to fail open on, so the "slow
  database turns the whole app into a redirect loop" failure mode no longer has
  a mechanism.
- **The matcher.** Now an explicit twelve-entry allow-list rather than a negated
  catch-all: `/login`, `/signup`, `/forgot-password`, `/reset-password`,
  `/profile`, `/settings`, `/bands/(.*)`, `/playlists/(.*)`, `/songs/(.*)`,
  `/admin/(.*)`, `/bands`, `/playlists`. Twelve entries, confirmed by counting
  the quoted lines in the `matcher` array and asserted by the guard suite.

The remediation also asked for an explicit declaration, in AGENTS.md and in the
file, that this is not an authorization boundary. Both exist. `src/proxy.ts`
opens with a 22-line header comment whose second line is
`NOT AN AUTHORIZATION BOUNDARY (RH-65, code-quality review F10)` and which spells
out that a present cookie proves nothing because the cookie is never validated.
AGENTS.md says the same in three places: the architecture diagram
(`├─ src/proxy.ts  (Next.js Proxy — redirects an allow-list of routes; not an
authorization boundary)`), the directory map at the bottom, and a named
convention bullet, **Redirect convenience, not an authorization boundary
(RH-65)**. The old, now-false claims are gone: `grep -c "session gate on every
request" AGENTS.md` and `grep -c "calls the Better Auth session endpoint via"
AGENTS.md` both print `0`.

Guarded by `src/lib/__tests__/proxy.test.ts`: seventeen tests across two
`describe` blocks, including `resolves the session without ever calling fetch`,
`lists exactly twelve matcher entries, each a valid regular-expression source`,
`does not match /, the invite route or any route under /api`, and
`passes a present but unvalidated session cookie through to the page, which owns
the authorization decision`.

### F14 - `src/hooks/useBandAdmin.ts`

The return object went from **39 members, ten of them raw setters**, to **19
members and no setter at all**. Measured with
`awk '/^  return \{/,/^  \}/' src/hooks/useBandAdmin.ts | grep -c '^    [a-zA-Z]'`:
`39` at `246313f`, `19` at `66d9442`; the same slice piped to `grep -c 'set[A-Z]'`
gives `10` then `0`.

The nineteen are `currentUserId`, `band`, `playlists`, `loading`, `error`,
`isAdmin`, `isMember`, `editDraft`, `saving`, `invite`, `pending`,
`newPlaylist`, `dismissError`, `reportError`, `startEdit`, `updateDraft`,
`pickCoverFile`, `saveEdit` and `cancelEdit`. The edit-modal fields are grouped
into one `editDraft` with `updateDraft(patch)`, exactly as the remediation asked;
the invite, pending-action and new-playlist controllers became sub-objects
carrying their own intent commands (`BandInviteController`,
`NewPlaylistController`, and the `BandAdminController`/`BandEditController`
interfaces) rather than loose primitives. Both pages keep their own markup, as
the remediation required.

The hook itself shrank from 370 to 288 lines, with the pure transitions moved to
`src/lib/bandAdminState.ts` and the load semantics to `src/lib/bandAdminLoad.ts`.
Its longest function went from 298 lines to 173 and its complexity is 13, under
the base budget of 15, so its `complexity-budget/override` entry in
`eslint.config.mjs` was **deleted rather than relaxed**.

**One claim in the finding does not survive measurement**, and this is the only
thing in this close-out that needs a `**Correction**` line. F14's last sentence
says the 39-member surface "is also why `BandDetailPage` and `BandProfileView`
score complexity 30 and 23". After the surface shrank to 19 with no setters,
both scores are exactly unchanged. Measured on this tree with
`rtk proxy npx eslint 'src/app/bands/[id]/page.tsx' 'src/app/profile/page.tsx' --rule '{"complexity":["error",1]}'`:
`Function 'BandDetailPage' has a complexity of 30` and
`Function 'BandProfileView' has a complexity of 23`. The `eslint.config.mjs`
diff confirms it independently - `6aa099c` tightened those two entries'
`max-lines-per-function` and `max-lines` (490/508 to 469/487, and 394/723 to
385/714) while leaving `complexity` at 30 and 23, which is what the RH-39 ratchet
does when the measured value has not moved. The components' branch count lives in
their own markup, not in how the hook hands them state. F14's remediation - the
part that actually prescribes work - is fully delivered; only its causal aside is
wrong, and the honest fix is a dated additive line, not a rewrite.

Guarded by `src/hooks/__tests__/useBandAdmin.test.tsx` (54 `it(` blocks) and
`src/lib/__tests__/bandAdminState.test.ts`.

### F15 - Server Components and `force-dynamic`

Both halves of the remediation landed.

**The three read-only routes it names are async Server Components.** Each reads
through `src/lib` directly instead of in a mount effect, resolves its own
session, calls `redirect("/login")` itself rather than trusting the proxy, and
injects its Server Actions into a `"use client"` island under
`src/components/<area>/` as a single typed actions object - which also keeps the
F21 import direction, since `src/components` never imports from `@/app/*`.

| Page | Lines | Reads | Island |
|---|---|---|---|
| `src/app/bands/page.tsx` | 41 | `getBands` | `src/components/bands/BandsView.tsx` |
| `src/app/playlists/page.tsx` | 58 | `getUserPlaylists`, `hasSpotifyConnection` | `src/components/playlists/PlaylistsView.tsx` |
| `src/app/admin/moderation/page.tsx` | 77 | `getPendingGlobalSongEdits` | `src/components/admin/ModerationQueue.tsx` |

All three carry a doc comment saying they are dynamic by construction because
`getSession()` awaits `headers()`, so no `export const dynamic` is needed, and
that the `redirect` is defence in depth on top of the proxy rather than a
replacement for it. `src/app/admin/moderation/page.tsx` additionally keeps the
non-admin path at HTTP 200 by discriminating on the unwrapped `Access denied`
message (convention L1a) and rendering an `AccessDeniedPanel`.

**The page census.** There are 15 `page.tsx` files under `src/app`, both at
`13da8b2` (the commit the review measures) and now. At `13da8b2`, 13 of them
carried `'use client'` and 2 were Server Components (`join/[code]`,
`songs/search`); today 10 carry `'use client'` and 5 are Server Components. The
finding's headline "twelve of fourteen" is the same observation with a slightly
different census - it is off by one page in each column, is not load-bearing for
anything, and I state the measured pair (13 of 15, then 10 of 15) in the
`**Status:**` line rather than opening a separate `**Correction**` for an
approximate count. That is the same disposal RH-40 gave F16's "~44 such casts
overall".

**`force-dynamic`.** `export const dynamic = "force-dynamic"` is gone from
`src/app/layout.tsx` and was not pushed down to any page segment. The only
`force-dynamic` left anywhere under `src/` is `src/app/api/dev/profiles/route.ts:5`,
a dev-only route handler, and no segment declares `export const revalidate`
either. Guarded by `src/lib/__tests__/rootLayoutRendering.test.ts`.

**Not every client page was converted, and that is correct.** The ten remaining
`'use client'` pages, measured at `66d9442`, are `/`, `/bands/[id]`,
`/forgot-password`, `/login`, `/playlists/[id]`, `/profile`, `/reset-password`,
`/settings`, `/signup` and `/songs/[id]/fast-view`. They fall into three groups,
and the F15 `**Status:**` line records all three by name because "what remains
and where it is tracked" is the part of a close-out that has to be right:

1. **Four auth forms** - `/login`, `/signup`, `/forgot-password`,
   `/reset-password`. They have nothing to read on the server; they post
   credentials, and all four are in the prerendered set. `/forgot-password` and
   `/signup` contain no page-level `useEffect` at all; `/login`'s single effect
   is a development-only fetch of `/api/dev/profiles` that returns immediately
   when `NODE_ENV !== 'development'`, and `/reset-password`'s reads the reset
   token out of the query string. None of the four reads application data on
   mount, so none of them can be "still fetching in a client effect".
2. **One large client component already owned elsewhere** - `/playlists/[id]`,
   which is F11's and is RH-53 (`backlog`). F15's own remediation sequences it
   alongside F11; it is not orphaned. This group holds exactly one page.
   `/songs/[id]/fast-view` does **not** belong here, for two independent
   reasons measured below.
3. **Five pages with no named owner** - `/`, `/bands/[id]`, `/profile`,
   `/settings` and `/songs/[id]/fast-view`. The first four are interactive
   dashboards; F6 and F11 do **not** cover them (F6's `**Location:**` is only
   `src/app/songs/[id]/fast-view/page.tsx`, F11's only
   `src/app/playlists/[id]/page.tsx`), so attributing them to those findings
   would be false - and F6 could not take them anyway, being closed. They read *and* mutate, and their data already arrives
   through session-resolving code: `/`, `/profile` and `/bands/[id]` read
   through Server Actions in `src/app/actions/` (`repertoire.ts`, `profile.ts`,
   `bands.ts`), each of which calls `getRequiredUserId()` directly or through
   `resolveOwner()` (whose first statement is
   `const userId = await getRequiredUserId()`), and `/settings` through the
   `/api/spotify/playlists` route handler, which calls `getRequiredUserId()` and
   answers `{ connected: false }` when it throws. Every one of those paths fails
   closed on its own, so none of the four depends on the proxy for
   authorization.

   **`/songs/[id]/fast-view` is the fifth, and this is the round-2 correction.**
   It is neither large nor owned. Measured at `66d9442`,
   `src/app/songs/[id]/fast-view/page.tsx` is **222 lines** and contains
   **zero** `useState` and **zero** `useEffect` calls: it is a composition root,
   not a controller. And F6 is **closed** - its own `**Status:**` line at L289
   of `docs/plans/code-quality-review.md` reads "Resolved by RH-48 (`a49a295`)
   ... and RH-52 (`e985ba5`)" and describes the same 222 lines at complexity 6
   "where it holds no `useState`, no `useEffect` and no data access at all". A
   finding carrying a `**Status:** Resolved` line cannot own future work, RH-38
   and RH-48..RH-52 are all `done`, and no other task in `.meridian/tasks.json`
   covers that page. Its reads did not move to the server, though: they sit in
   `src/hooks/useSongEntry.ts`, whose `useEffect` at L58 calls
   `getSongEntryAction` and `getPersonalEntryForSongAction` (injected through
   `src/app/fastViewEntryActions.ts`). Both resolve a session first -
   `getSongEntryAction` via `resolveOwner()` -> `getRequiredUserId()`, which
   throws without one, and `getPersonalEntryForSongAction` via
   `getRequiredUserId()` directly, returning `null` when it throws - so the page
   fails closed exactly as the four dashboards do and is equally acceptable as
   it stands. Client page, fetching in an effect, guarded, **no named owner**:
   that is group 3, not group 2.

   All five are therefore **deferred with no named owner**, recorded as a
   follow-up suggestion in Out of Scope below rather than silently folded into
   F6 or F11.

F15's remediation says "starting with the pages that only read (`/bands`,
`/playlists`, `/admin/moderation`)" and names exactly the three that were
converted; it does not ask for the rest.

The measured `useEffect` picture, for the record: six of the ten contain any
page-level `useEffect` call - `/` (2), `/login` (1), `/playlists/[id]` (6),
`/profile` (2), `/reset-password` (1), `/settings` (1) - counted with
`grep -c "useEffect("`, which excludes the import line. No reading of this tree
yields "seven pages still fetching in a client effect", and the `**Status:**`
line must not claim one.

### Integration gaps left by the five children

I looked for them specifically, with
`grep -rn "force-dynamic\|session gate\|get-session" docs AGENTS.md README.md`
plus a read of AGENTS.md's architecture bullets against each other and of the
review document's section 5 wording.

**AGENTS.md is internally consistent.** The architecture diagram (L28, L32), the
convention bullets (L48 for the proxy, L49 for the Server Component page
pattern) and the directory map (L157-L159) all say the same three things: the
proxy is a redirect convenience on a twelve-entry allow-list and not an
authorization boundary; `/bands`, `/admin/moderation` and `/playlists` are async
Server Components that inject actions into islands; new read-only page routes
follow that pattern and new private page routes must be added to the matcher by
hand. Nothing in AGENTS.md mentions `force-dynamic`, a session gate on every
request, or the Better Auth session endpoint. **No AGENTS.md edit is needed and
AGENTS.md is not on the ER9 whitelist.**

**The review document's own section 5 wording is stale but must not be edited.**
T8's `**Justification:**` still says "twelve of fourteen routes", "keeps
`force-dynamic` on the whole tree" and "39 members including ten raw setters".
Those are descriptions of the state at `13da8b2` inside a proposal block that
records why the task was proposed; the same is true of T4, T5 and T7, which
RH-37, RH-38 and RH-40 left untouched and closed with an appended
`**Status:**` line. This task does the same.

**One genuine stale claim exists, in a different document.**
`docs/plans/mobile-app-analysis.md` still asserts, in **seven** places, that
`src/app/layout.tsx:10` declares `force-dynamic` and "globally disabl[es] static
prerendering for every route" - L17, L29, L137, L169, L181, L311, L330, which is
also what `grep -c "force-dynamic" docs/plans/mobile-app-analysis.md` prints. A
second, separate claim on **one** line, L39, says `src/proxy.ts` "gates **every**
non-public request by `fetch`-ing `/api/auth/get-session` ... with a 3 s abort
timeout". Both are now false; keeping the two line lists apart matters, because
they are different assertions falsified by different commits (`57bc60a` and
`66d9442`).
This was already spotted during RH-61's code review and logged as item 4 of the
`[RH-61] ... (code review 1)` entry in `docs/suggestions-log.md`, correctly
excluded from RH-61's scope. It stays excluded here too: that document is a
decision record for a mobile strategy whose §3.2 conclusion ("`output: "export"`
is structurally impossible") rests partly on those two claims, so correcting it
means re-checking whether the conclusion still follows - analysis, not a text
edit, and not something to smuggle into a docs close-out whose whole value is a
four-file diff. It is recorded in Out of Scope below and in Post-merge checks as
a follow-up.

**No code gap.** Nothing in the five parts is half-wired: the twelve matcher
entries cover every route that still needs a redirect, all three islands receive
their actions, the two `useBandAdmin` consumers both compile against the new
19-member interface, and the whole suite is green with zero skips.

### Gate baselines, all measured at 66d9442

- `rtk proxy npx vitest run`: exit 0, `Test Files  100 passed (100)`,
  `Tests  1148 passed (1148)`, 0 skipped, 0 failed. Needs Postgres at
  `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations
  applied and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`; without
  them the DB-backed files skip.
- `npm run test:coverage`: exit 0, `All files` row reads
  `97.56 | 86.22 | 99.73 | 98.06` against thresholds 80 / 65 / 78 / 80, no
  `does not meet threshold` line.
- `./node_modules/.bin/tsc --noEmit`: exits 0, prints nothing.
- `rtk proxy npx eslint .`: final summary line `22 problems (8 errors, 14 warnings)`.
  The 8 errors are 7x `react-hooks/set-state-in-effect` plus 1x
  `@next/next/no-html-link-for-pages`; none is in a file this work touched.
- `npm run lint:dead` (knip): exit 0, clean.
- `npm run lint:dup` (jscpd): `Found 18 clones.`, Total row `231 (0.64%)`,
  against the 2 % threshold. (RH-40 measured 19 clones / `242 (0.71%)` at
  `ca91de2`; the five parts reduced it.)
- `npm run audit`: exit 0, `found 0 vulnerabilities`.
- `rtk proxy npx next build`: exit 0, route table as above.
- `PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1" rtk proxy npx playwright test e2e/ssr-smoke.spec.ts`:
  `4 passed`.
- `grep -c 'complexity-budget/override' eslint.config.mjs`: `20` (24 at
  `246313f`, 23 at `ca91de2`; RH-62 deleted the `admin/moderation/page.tsx`
  entry, RH-63 the `playlists/page.tsx` entry, RH-64 the `useBandAdmin.ts`
  entry).
- `grep -c "^\*\*Status:\*\* Resolved" docs/plans/code-quality-review.md`: `7`.
  `grep -c "^\*\*Status:\*\* Delivered"`: `3`. `grep -c "^\*\*Correction"`: `4`.
  `grep -c "RH-41" docs/plans/code-quality-review.md`: `0`.

**No flake reproduced.** RH-40 and RH-58 had to tolerate a named
`complexityBudget.test.ts` 5000 ms timeout under full-suite load; RH-59
(`65cadd8`) fixed it, and the full run above is `1148 passed` with nothing
failed and nothing skipped. The ERs below therefore carry **no** flake
tolerance: any failing or skipped test fails the result.

**Tooling note.** A shell hook in this environment rewrites the output of
`npx eslint`, `npx tsc`, `npx vitest`, `npx next` and `npx playwright`. Every
ESLint, vitest, build and Playwright result below must be produced with
`rtk proxy npx ...`, and TypeScript with the exact binary path
`./node_modules/.bin/tsc --noEmit`.

## Approach

### 1. `docs/plans/code-quality-review.md` - five added lines, nothing removed

The edit is **purely additive**: five new lines, no line deleted, no line
reworded. ER8 checks that with `git diff --numstat`. Each new line is a single
physical line in the file, appended at the end of the block it belongs to, so
every closed finding ends with a `**Status:**` line, exactly as RH-37, RH-38 and
RH-40 left F8, F21, F22, F6, F26, F16, F17, T4, T5 and T7.

Insertion points, by line number at `66d9442`: after L323 (F10's
`**Remediation:**`), after L355 (F14's `**Remediation:**`), after L363 (F15's
`**Remediation:**`), after L555 (T8's `**Covers:** F10, F13, F14, F15`).

**After F10's `**Remediation:**` line (L323), append this line:**

```
**Status:** Resolved by RH-65 (`66d9442`), on top of the server-side checks RH-62 (`6e32874`) and RH-63 (`35d6f66`) put in place. All three compounding defects are gone. There is no path special case left at all - `pathname === '/'` does not appear in the file and `/` is simply absent from the matcher, which is now an explicit twelve-entry allow-list (`/login`, `/signup`, `/forgot-password`, `/reset-password`, `/profile`, `/settings`, `/bands/(.*)`, `/playlists/(.*)`, `/songs/(.*)`, `/admin/(.*)`, `/bands`, `/playlists`) rather than a negated catch-all. The self-`fetch` to `/api/auth/get-session` is gone with its `AbortController` and its 3000 ms timeout: `proxy()` is now a synchronous function that answers from the request headers alone via `getSessionCookie` from `better-auth/cookies`, so there is no round trip left to cache for the request and no timeout left to fail open on. Because the cookie is read but never validated, the file's own header comment declares in its second line that it is NOT AN AUTHORIZATION BOUNDARY, and AGENTS.md says the same in the architecture diagram, the directory map and a named convention bullet; no page, Server Action or route handler may rely on it, each resolving its own session and answering for itself, and a new private page route has to be added to the matcher by hand. Guarded by `src/lib/__tests__/proxy.test.ts`, whose seventeen tests assert the twelve matcher entries, that `/`, the invite route and everything under `/api` are not matched, that `fetch` is never called, and that a present but unvalidated cookie is passed through to the page rather than treated as authorization. Verified in place at `66d9442` by the RH-41 close-out.
```

**After F14's `**Remediation:**` line (L355), append these two lines, in this
order:**

```
**Correction (RH-41):** The last sentence above does not survive measurement. It says the 39-member surface "is also why `BandDetailPage` and `BandProfileView` score complexity 30 and 23"; after RH-64 (`6aa099c`) shrank that surface to 19 members with no setters, both scores are exactly unchanged. `npx eslint 'src/app/bands/[id]/page.tsx' 'src/app/profile/page.tsx' --rule '{"complexity":["error",1]}'` still reports `Function 'BandDetailPage' has a complexity of 30` and `Function 'BandProfileView' has a complexity of 23`, and the same commit that tightened those two files' `max-lines-per-function` and `max-lines` ceilings in `eslint.config.mjs` left their `complexity` entries at 30 and 23, which is what the RH-39 ratchet does when the measured value has not moved. The two components' branch count lives in their own markup, not in how the hook hands them state, so the interface fix and the component decomposition are independent pieces of work and only the first is covered by this finding.
**Status:** Resolved by RH-64 (`6aa099c`). `useBandAdmin` now returns 19 members and not one state setter - `currentUserId`, `band`, `playlists`, `loading`, `error`, `isAdmin`, `isMember`, `editDraft`, `saving`, `invite`, `pending`, `newPlaylist`, `dismissError`, `reportError`, `startEdit`, `updateDraft`, `pickCoverFile`, `saveEdit`, `cancelEdit` - against 39 members including ten setters at `246313f`. The edit-modal fields are grouped into one `editDraft` with `updateDraft(patch)` exactly as the remediation asked, and the invite, pending-action and new-playlist controllers became sub-objects carrying their own intent commands rather than loose primitives, so the hook's invariants are no longer maintained only while callers behave. The pure transitions moved to `src/lib/bandAdminState.ts` and the load semantics to `src/lib/bandAdminLoad.ts`, taking the hook from 370 to 288 lines and its longest function from 298 to 173 at complexity 13, under the base budget, so its `complexity-budget/override` entry in `eslint.config.mjs` was deleted rather than relaxed. Both pages keep their own markup, as the remediation required. Covered by `src/hooks/__tests__/useBandAdmin.test.tsx` and `src/lib/__tests__/bandAdminState.test.ts`. Verified in place at `66d9442` by the RH-41 close-out.
```

**After F15's `**Remediation:**` line (L363), append this line:**

```
**Status:** Resolved by RH-61 (`57bc60a`), RH-62 (`6e32874`) and RH-63 (`35d6f66`). Both halves of the remediation landed. The three read-only routes named above are async Server Components that read through `src/lib` directly instead of in a mount effect - `src/app/bands/page.tsx` (41 lines, `getBands`), `src/app/playlists/page.tsx` (58 lines, `getUserPlaylists` plus `hasSpotifyConnection`) and `src/app/admin/moderation/page.tsx` (77 lines, `getPendingGlobalSongEdits`) - each resolving its own session, calling `redirect("/login")` itself rather than trusting the proxy, and injecting its Server Actions into a `"use client"` island under `src/components/<area>/` as one typed actions object, which also keeps the F21 import direction. By the `use client` census the client-page count moves from 13 of 15 `page.tsx` files at `13da8b2` to 10 of 15 (the finding's "twelve of fourteen" is the same observation with a slightly different count). `export const dynamic = "force-dynamic"` is gone from `src/app/layout.tsx` and was not pushed down to any page segment: the only `force-dynamic` left under `src/` is the dev-only route handler `src/app/api/dev/profiles/route.ts:5`, no segment declares `export const revalidate`, and the three converted pages are dynamic by construction because `getSession()` awaits `headers()`. Measured on the `npx next build` route table at `66d9442`: 27 routes, of which 10 are prerendered as static content - `/`, `/_not-found`, `/forgot-password`, `/icon.jpg`, `/login`, `/profile`, `/reset-password`, `/settings`, `/signup`, `/songs/search` - and 17 are server-rendered on demand, so the landing page and the auth routes are static again. The ten `page.tsx` files that still carry `'use client'` at `66d9442` fall into three groups. The four auth forms - `/login`, `/signup`, `/forgot-password`, `/reset-password` - have nothing to read on the server and none of them reads application data on mount, and all four are in the prerendered set. One is a large client component already owned elsewhere: `/playlists/[id]`, which is F11's and is RH-53, exactly where the remediation above sequences it. The remaining five have no named owner. Four of them - `/`, `/bands/[id]`, `/profile` and `/settings` - are interactive dashboards that neither F6 nor F11 covers; they read and mutate through code that resolves its own session and fails closed (Server Actions in `src/app/actions/` calling `getRequiredUserId()`, directly or through `resolveOwner()`, and for `/settings` the `/api/spotify/playlists` route handler, which answers `{ connected: false }` when that call throws), so none of them relies on the proxy for authorization and they are acceptable as they stand. The fifth is `/songs/[id]/fast-view`, which was decomposed and closed by F6 in RH-52 (`e985ba5`) down to 222 lines at complexity 6 holding no `useState`, no `useEffect` and no data access of its own; it is still a `'use client'` page and its reads did not move to the server but into `src/hooks/useSongEntry.ts`, whose mount effect calls `getSongEntryAction` and `getPersonalEntryForSongAction`, both of which resolve a session through `getRequiredUserId()` - the first via `resolveOwner()`, which throws without one, the second directly, returning `null` when it throws - so that page fails closed exactly as the four dashboards do and is equally acceptable as it stands, but F6 is closed and no open finding or task covers it, which puts it with them rather than with F11. Those five are deferred with no named owner, recorded as a follow-up suggestion in `docs/tasks/RH-41-spec.md` rather than attributed to a finding that does not cover them. Guarded by `src/lib/__tests__/rootLayoutRendering.test.ts` and the island suites `src/components/bands/__tests__/BandsView.test.tsx`, `src/components/playlists/__tests__/PlaylistsView.test.tsx` and `src/components/admin/__tests__/ModerationQueue.test.tsx`. Verified in place at `66d9442` by the RH-41 close-out.
```

**After T8's `**Covers:** F10, F13, F14, F15` line (L555), append this line:**

```
**Status:** Delivered by RH-61 (`57bc60a`), RH-62 (`6e32874`), RH-63 (`35d6f66`), RH-64 (`6aa099c`) and RH-65 (`66d9442`); integrated and verified by RH-41. Three of the four findings it covers are closed: F10, F14 and F15. F13 is deliberately not part of it and stays open - it is a single derived-state pair inside `src/app/playlists/[id]/page.tsx` (the session at L277, `const [currentUserId, setCurrentUserId]` at L291, the copy at L343), and that 1344-line component is owned end to end by RH-53 (F11), which is where both the one-line fix and the "sweep the other large pages for the same shape" half of F13's remediation belong.
```

As in RH-37, RH-38 and RH-40, the T8 marker uses `Delivered` rather than
`Resolved`, so that `grep -c "^\*\*Status:\*\* Resolved"` counts findings only
(7 today, 10 after this edit) and `grep -c "^\*\*Status:\*\* Delivered"` counts
tasks only (3 today, 4 after). `grep -c "^\*\*Correction"` goes from 4 to 5, with
`grep -c "^\*\*Correction (RH-41):\*\*"` going from 0 to 1.

**Every one of the five new lines names RH-41, and that is load-bearing.** The
three finding `**Status:**` lines each end with the sentence "Verified in place
at `66d9442` by the RH-41 close-out."; the T8 line says "integrated and verified
by RH-41"; the correction is tagged `**Correction (RH-41):**`; and the F15 line
additionally cites `docs/tasks/RH-41-spec.md` as where the unowned pages are
recorded.
`grep -c` counts matching *lines*, so
`grep -c "RH-41" docs/plans/code-quality-review.md` goes from `0` at `66d9442`
to exactly `5`, which is what ER8 pins. Do not drop those attributions while
transcribing the fenced blocks: without them the document records what the five
children delivered but never records which task verified that they compose, and
ER8 fails.

Do not touch any other finding, the section 2 measurement tables, the section 4
priority table (rows 10, 13, 14 and 15 stay exactly as measured), F13's block, or
any other T-task block. In particular, T8's `**Justification:**` line keeps its
`13da8b2`-era wording: it records why the task was proposed, and RH-37, RH-38 and
RH-40 left the equivalent lines on T4, T5 and T7 untouched.

### 2. AGENTS.md - no change

See the Audit. RH-65 already made the architecture diagram, the directory map and
the convention bullets agree with the delivered code, and RH-62/RH-63 already
added the **The Server Component page pattern (RH-62, RH-63)** bullet naming all
three routes and the island rule. There is nothing left to state. A restatement
would widen this task's diff for no mechanical gain, so **AGENTS.md is not edited
and is not on the ER9 whitelist.**

### 3. `docs/plans/mobile-app-analysis.md` - deliberately not corrected here

See the Audit: that document repeats the pre-RH-61 `force-dynamic` claim and the
pre-RH-65 proxy description, and both are now false. It is not corrected in this
task because a correct fix is not a text edit: the document's §3.2 conclusion
about `output: "export"` rests on those claims and has to be re-derived. It is
already logged in `docs/suggestions-log.md` under RH-61's code review, and it is
carried into Out of Scope and Post-merge checks below as a follow-up task.

### 4. Version bump

`package.json` goes from `0.1.95-202609091654` to `0.1.96-YYYYMMDDHHmm` with the
local-time stamp of the commit. The Version Bumping Rule in AGENTS.md applies to
every commit that merges to master, documentation-only ones included.

### 5. Running the verification

Everything in the Expected Results is a re-run, not a change. Run the whole set
once after the documentation edit and the version bump are in the tree, so the
evidence describes the commit that will actually merge. The database
precondition in ER5 and ER6 is not optional: without Postgres and
`SUPABASE_SERVICE_ROLE_KEY`, the DB-backed files skip and neither the suite
counts nor the coverage number can be reached.

## Expected Results

ER1 - F10's final state holds at the merge commit: `src/proxy.ts` is a synchronous, header-only redirect convenience on a twelve-entry allow-list, and it says so. Run every command from the repository root. `grep -c "pathname === '/'" src/proxy.ts` prints `0`. `grep -cE "fetch\(|AbortController|setTimeout|get-session|async |await " src/proxy.ts` prints `0`, so the self-`fetch` to the app's own session endpoint, its 3000 ms abort and the `catch` that failed open on timeout are all gone. `grep -c "better-auth/cookies" src/proxy.ts` prints `1` and `grep -c "getSessionCookie" src/proxy.ts` prints a number greater than or equal to `1`, so the session is resolved from the request headers instead. `grep -c "@/lib/auth" src/proxy.ts` prints `0`, so the Postgres-backed Better Auth instance is still not imported into the proxy. The matcher is an explicit allow-list of exactly twelve entries: `awk '/matcher: \[/,/\]/' src/proxy.ts | grep -c "^    '"` prints `12`, and `awk '/matcher: \[/,/\]/' src/proxy.ts | grep -o "'[^']*'" | sort` lists exactly `'/admin/(.*)'`, `'/bands'`, `'/bands/(.*)'`, `'/forgot-password'`, `'/login'`, `'/playlists'`, `'/playlists/(.*)'`, `'/profile'`, `'/reset-password'`, `'/settings'`, `'/signup'`, `'/songs/(.*)'`. The declaration required by the remediation is present in both places: `grep -c "NOT AN AUTHORIZATION BOUNDARY" src/proxy.ts` prints `1`, `grep -c "not an authorization boundary" AGENTS.md` prints a number greater than or equal to `1`, `grep -c "session gate on every request" AGENTS.md` prints `0` and `grep -c "calls the Better Auth session endpoint via" AGENTS.md` prints `0`. Behaviourally, `rtk proxy npx vitest run src/lib/__tests__/proxy.test.ts` exits 0 and reports `Test Files  1 passed (1)` and `Tests  17 passed (17)`, with no failed and no skipped test. Every one of these values is the value measured at the `66d9442` baseline; this task changes no file under `src/`, so any difference is a regression.

ER2 - F14's final state holds: `useBandAdmin` exposes data plus intent commands and not one state setter. From the repository root, `awk '/^  return \{/,/^  \}/' src/hooks/useBandAdmin.ts | grep -c '^    [a-zA-Z]'` prints `19` (the same command run against `git show 246313f:src/hooks/useBandAdmin.ts` prints `39`), and `awk '/^  return \{/,/^  \}/' src/hooks/useBandAdmin.ts | grep -c 'set[A-Z]'` prints `0` (it prints `10` at `246313f`). `awk '/^  return \{/,/^  \}/' src/hooks/useBandAdmin.ts | grep -oE '^    [a-zA-Z]+' | tr -d ' ' | sort` lists exactly these nineteen names: `band`, `cancelEdit`, `currentUserId`, `dismissError`, `editDraft`, `error`, `invite`, `isAdmin`, `isMember`, `loading`, `newPlaylist`, `pending`, `pickCoverFile`, `playlists`, `reportError`, `saveEdit`, `saving`, `startEdit`, `updateDraft`. None of the ten setters the finding names survives in the hook's public surface: `awk '/^  return \{/,/^  \}/' src/hooks/useBandAdmin.ts | grep -cE "setBand|setEditing|setEditName|setEditDesc|setEditColor|setCopied|setShowNewPlaylist|setNewPlaylistName|setPendingAction"` prints `0`. Scoping that grep to the returned object is deliberate and is the whole point of the finding: `setBand`, `setCopied` and `setNewPlaylistName` still exist as module-internal `useState` setters inside the hook body (an unscoped grep over the file prints `9`), and that is correct - F14 is about which of them the hook hands to its callers, not about whether the hook has state. The extraction is real rather than a rename: `test -f src/lib/bandAdminState.ts` and `test -f src/lib/bandAdminLoad.ts` both succeed, `wc -l < src/hooks/useBandAdmin.ts` prints `288` (`git show 246313f:src/hooks/useBandAdmin.ts | wc -l` prints `370`), and the hook no longer needs a size waiver: `grep -c "src/hooks/useBandAdmin.ts" eslint.config.mjs` prints `0`. `rtk proxy npx vitest run src/hooks/__tests__/useBandAdmin.test.tsx src/lib/__tests__/bandAdminState.test.ts` exits 0 with no failed and no skipped test.

ER3 - F15's final state holds: the three read-only routes render on the server and no segment forces dynamic rendering. From the repository root, none of `src/app/bands/page.tsx`, `src/app/playlists/page.tsx` and `src/app/admin/moderation/page.tsx` is a client component - `grep -c "use client" src/app/bands/page.tsx`, `grep -c "use client" src/app/playlists/page.tsx` and `grep -c "use client" src/app/admin/moderation/page.tsx` each print `0` - and each is an async Server Component that reads through `src/lib` and redirects for itself: `grep -c "export default async function" <page>` prints `1`, `grep -c 'redirect("/login")' <page>` prints `1`, and `grep -c "@/lib/auth-session" <page>` prints `1`, for each of the three paths. Each reads its own data directly: `grep -c "from \"@/lib/bands\"" src/app/bands/page.tsx` prints `1`, `grep -c "from \"@/lib/playlists\"" src/app/playlists/page.tsx` prints `1`, and `grep -c "from \"@/lib/moderation\"" src/app/admin/moderation/page.tsx` prints `1`. Each injects its Server Actions into a client island rather than letting the island import them: `grep -c "@/components/bands/BandsView" src/app/bands/page.tsx`, `grep -c "@/components/playlists/PlaylistsView" src/app/playlists/page.tsx` and `grep -c "@/components/admin/ModerationQueue" src/app/admin/moderation/page.tsx` each print `1`, while `grep -rc "@/app/" src/components/bands/BandsView.tsx src/components/playlists/PlaylistsView.tsx src/components/admin/ModerationQueue.tsx` prints `:0` for all three files. The census is 10 of 15: `find src/app -name page.tsx | wc -l` prints `15` and `grep -rl "use client" src/app --include=page.tsx | wc -l` prints `10` (the same two commands at `13da8b2` print `15` and `13`). `force-dynamic` survives in exactly one place, a dev-only route handler: `grep -c "force-dynamic" src/app/layout.tsx` prints `0`, `grep -rl "force-dynamic" src/` prints exactly the one line `src/app/api/dev/profiles/route.ts`, `grep -rc "export const revalidate" src/ | grep -v ":0$"` prints nothing, and no page or layout segment declares either directive - `grep -rcE "^export const dynamic" src/app --include=page.tsx | grep -v ":0$"` and `grep -rcE "^export const (dynamic|revalidate)" src/app --include=layout.tsx | grep -v ":0$"` both print nothing. `rtk proxy npx vitest run src/lib/__tests__/rootLayoutRendering.test.ts src/components/bands/__tests__/BandsView.test.tsx src/components/playlists/__tests__/PlaylistsView.test.tsx src/components/admin/__tests__/ModerationQueue.test.tsx` exits 0 with no failed and no skipped test.

ER4 - the integration result: the production build at the merge commit splits the routes the way the conversion was supposed to, and the app still serves them. From the repository root, `rm -rf .next && rtk proxy npx next build 2>&1 | tee /tmp/rh41-build.log` exits 0 and `grep -cE '^Error|^Failed|Failed to compile' /tmp/rh41-build.log` prints `0` (the build also prints eleven `[Error [BetterAuthError]: You are using the default secret. ...]` diagnostic lines from the prerender workers when `BETTER_AUTH_SECRET` is not exported; those begin with `[`, do not match that pattern, and do not affect the exit code). Read the static/dynamic split out of the build manifests rather than out of the printed route table, so that no box-drawing or legend character has to be matched. `node -e "const r=Object.keys(require('./.next/prerender-manifest.json').routes).sort();console.log(r.length);console.log(r.join(' '))"` prints exactly two lines: `11`, then `/ /_global-error /_not-found /forgot-password /icon.jpg /login /profile /reset-password /settings /signup /songs/search`. That is the whole point of RH-61 and it is visible nowhere else: the marketing landing page `/` and all four auth routes are prerendered again instead of rendered per request. `node -e "const a=Object.values(require('./.next/app-path-routes-manifest.json'));const s=new Set(Object.keys(require('./.next/prerender-manifest.json').routes));const d=a.filter(x=>!s.has(x)).sort();console.log(d.length);console.log(d.join(' '))"` prints exactly two lines: `17`, then `/admin/moderation /api/auth/[...all] /api/auth/spotify/authorize /api/auth/spotify/callback /api/auth/spotify/disconnect /api/dev/profiles /api/spotify/playlists /api/spotify/playlists/[id]/import /api/spotify/playlists/[id]/sync /api/spotify/playlists/[id]/tracks /api/spotify/search /bands /bands/[id] /join/[code] /playlists /playlists/[id] /songs/[id]/fast-view` - so the three converted routes `/bands`, `/playlists` and `/admin/moderation` are all in the dynamic set, and no route named in the static list above appears here. `node -e "console.log(Object.values(require('./.next/app-path-routes-manifest.json')).length)"` prints `28`, which is 11 + 17 with no route unaccounted for. (The printed `Route (app)` table shows 27 rows, 10 static and 17 dynamic, because it omits `/_global-error`, which the prerender manifest counts; 11 and 10 are the same tree counted in two places, and RH-63's QA figure of "11 prerendered" came from a legend line being counted as a route. None of the three numbers indicates a regression.) The three converted routes are dynamic by construction rather than by directive: `grep -rcE "^export const dynamic" src/app --include=page.tsx | grep -v ':0$'` prints nothing (anchor that pattern: an unanchored `export const dynamic` also matches the explanatory doc comment in `src/app/playlists/page.tsx`, which says no such directive is needed). Immediately afterwards, with `export BETTER_AUTH_SECRET="$(grep '^BETTER_AUTH_SECRET=' .env.local | cut -d= -f2-)"` and `export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`, `PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1" rtk proxy npx playwright test e2e/ssr-smoke.spec.ts` exits 0 and prints `4 passed`. All of these are the values measured at the `66d9442` baseline.

ER5 - the five parts' guard suites pass together in one run, and so does the whole suite. With Postgres running at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations applied (`npm run db:migrate`) and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in the environment or `.env.local` (for example `set -a; . ./.env.local; set +a`), `rtk proxy npx vitest run src/lib/__tests__/proxy.test.ts src/lib/__tests__/rootLayoutRendering.test.ts src/hooks/__tests__/useBandAdmin.test.tsx src/lib/__tests__/bandAdminState.test.ts src/lib/__tests__/playlistList.test.ts src/lib/__tests__/spotifyConnection.test.ts src/components/bands/__tests__/BandsView.test.tsx src/components/playlists/__tests__/PlaylistsView.test.tsx src/components/playlists/__tests__/CreatePlaylistModal.test.tsx src/components/admin/__tests__/ModerationQueue.test.tsx src/lib/__tests__/complexityBudget.test.ts` exits 0 and reports exactly `Test Files  11 passed (11)` and `Tests  126 passed (126)`, with no `failed` and no `skipped` segment on either line; all eleven paths must exist, because a missing path makes vitest fail rather than silently pass. Separately, `rtk proxy npx vitest run` exits 0 and reports at least 100 test files passed and at least 1148 tests passed with 0 skipped and 0 failed; those are the exact counts at `66d9442` and, since this task adds no test, they are equalities in practice, stated as floors only so an unrelated concurrent addition cannot fail the result. Unlike RH-38 and RH-40, this task tolerates **no** named flake: RH-59 (`65cadd8`) fixed the `complexityBudget.test.ts` 5000 ms timeout, and the baseline run was clean, so any failing or skipped test fails ER5.

ER6 - the coverage gate and every static gate are exactly at their `66d9442` baseline, run from the repository root. With the same database precondition as ER5, `npm run test:coverage` exits 0 and its `All files` row shows statements >= 80, branches >= 65, functions >= 78 and lines >= 80 - measured `97.56 | 86.22 | 99.73 | 98.06` at `66d9442` - with no `does not meet threshold` line anywhere in the output. `./node_modules/.bin/tsc --noEmit` writes nothing to stdout or stderr and exits 0 (use that exact binary path; `npx tsc` is intercepted by a shell hook in this environment). `rtk proxy npx eslint .` prints a final summary line reading exactly `22 problems (8 errors, 14 warnings)`, unchanged, because this task edits no file ESLint lints; use `rtk proxy`, because the same hook rewrites plain `npx eslint` output. `npm run lint:dead` exits 0 and reports no unused files, exports, types or dependencies. `npm run lint:dup` exits 0 and prints `Found 18 clones.` with a Total row showing `231 (0.64%)` duplicated lines, below the 2 % threshold. `npm run audit` exits 0 and prints `found 0 vulnerabilities`. The RH-39 ratchet is untouched and still carries the three deletions the parts made: `grep -c 'complexity-budget/override' eslint.config.mjs` prints `20` (24 at `246313f`, 23 at `ca91de2`), `grep -cE "src/app/admin/moderation/page.tsx|src/app/playlists/page.tsx|src/hooks/useBandAdmin.ts" eslint.config.mjs` prints `0`, and `git diff 66d9442 -- eslint.config.mjs` prints nothing.

ER7 - the two claims this close-out corrects are still true of the tree, so the `**Correction (RH-41):**` line of ER8 is accurate rather than stale. From the repository root, `rtk proxy npx eslint 'src/app/bands/[id]/page.tsx' 'src/app/profile/page.tsx' --rule '{"complexity":["error",1]}' 2>&1 | grep -c "Function 'BandDetailPage' has a complexity of 30"` prints `1`, and the same command with `grep -c "Function 'BandProfileView' has a complexity of 23"` also prints `1` - the two consumer complexity scores F14 attributes to the hook's 39-member surface are unchanged after that surface shrank to 19. Consistently with that, `eslint.config.mjs` still waives those two files at exactly those numbers while their size ceilings were tightened by `6aa099c`: `grep -c 'bands.*complexity: \["error", 30\]' eslint.config.mjs` prints `1` and `grep -c 'profile/page.tsx.*complexity: \["error", 23\]' eslint.config.mjs` prints `1`, and `git diff ca91de2 66d9442 -- eslint.config.mjs` shows those two entries changing only their `max-lines-per-function` and `max-lines` values (490/508 to 469/487 and 394/723 to 385/714) with `complexity` left alone. The second correction is the page census: `find src/app -name page.tsx | wc -l` prints `15` and `git ls-tree -r --name-only 13da8b2 -- src/app | grep -c page.tsx` also prints `15`, so the review's "fourteen" is a slightly different count of the same set and the `**Status:**` line's measured pair (13 of 15 then, 10 of 15 now) is the reproducible one.

ER8 - the review document records the close-out and F14's correction, additively. From the repository root, `grep -c "^\*\*Status:\*\* Resolved" docs/plans/code-quality-review.md` prints `10` (it prints `7` at `66d9442`); the three new lines are the ones appended to `### F10 - The middleware session gate treats the root route as public and fails open on timeout`, to `### F14 - useBandAdmin returns 39 members, ten of them raw state setters` and to `### F15 - Twelve of fourteen pages are client components that fetch in useEffect`, and between them they name the commit ids `57bc60a`, `6e32874`, `35d6f66`, `6aa099c` and `66d9442` (the F15 line names one further id, `e985ba5`, when it records that `/songs/[id]/fast-view` was decomposed and closed by F6 in RH-52; that is a citation of already-closed work, not a claim about what resolved F15). `grep -c "^\*\*Status:\*\* Delivered" docs/plans/code-quality-review.md` prints `4` (it prints `3` at `66d9442`); the new one is on `### T8 - Load page data in Server Components and slim the client controllers` in section 5, names all five of those commit ids, and states in the same line that F10, F14 and F15 are closed while F13 stays open with RH-53. All five added lines carry the close-out's own attribution, so `grep -c "RH-41" docs/plans/code-quality-review.md` prints exactly `5` (it prints `0` at `66d9442`) - one match per added line, `grep -c` counting lines - and `grep -c "RH-53" docs/plans/code-quality-review.md` prints `2` (also `0` at `66d9442`): the F15 `**Status:**` line, which hands `/playlists/[id]` to F11/RH-53, and the T8 `**Status:**` line, which records F13 as still open with RH-53. `grep -c "^\*\*Correction (RH-41):\*\*" docs/plans/code-quality-review.md` prints `1`, that line sits inside the F14 block, and it states that the two consumer complexity scores are unchanged at 30 and 23 after the hook's surface shrank to 19 members. The F15 line records what remains and who owns it, rather than the unreproducible claim the draft carried: `grep -c "deferred with no named owner" docs/plans/code-quality-review.md` prints `1`, `grep -c "decomposed and closed by F6" docs/plans/code-quality-review.md` prints `1` (both print `0` at `66d9442`) and `grep -c "The seven pages still fetching" docs/plans/code-quality-review.md` prints `0`; the same F15 `**Status:**` line matches both of the first two patterns, which is the mechanical check that its group membership is the corrected one. Reading that line end to end, it names the four auth forms - `/login`, `/signup`, `/forgot-password`, `/reset-password` - as having nothing to read on the server; it assigns exactly one page, `/playlists/[id]`, to F11 (RH-53); and it puts the other five - `/`, `/bands/[id]`, `/profile`, `/settings` and `/songs/[id]/fast-view` - in one group with no named owner, four of them interactive dashboards that neither F6 nor F11 covers and the fifth already decomposed and closed by F6 in RH-52 (`e985ba5`) yet still a `'use client'` page reading through `src/hooks/useSongEntry.ts`, all five reaching their data through session-resolving code that fails closed, deferred with no named owner and recorded as a follow-up in `docs/tasks/RH-41-spec.md`. The line must not assign `/songs/[id]/fast-view` to F6 as an owner: F6 carries a `**Status:** Resolved` line of its own in the same document, so it is closed and cannot own future work. 4 + 1 + 5 = 10, and those ten routes correspond one-to-one with the ten files `grep -rl "use client" src/app --include=page.tsx | sort` prints, so the line is checkable against the tree rather than being an assertion about it. The earlier corrections are untouched: `grep -c "^\*\*Correction" docs/plans/code-quality-review.md` prints `5` (it prints `4` at `66d9442`). No finding other than F10, F14, F15 and T8 gained a marker and nothing was reworded: `git diff --numstat 66d9442 -- docs/plans/code-quality-review.md` prints exactly `5	0	docs/plans/code-quality-review.md` - five insertions, zero deletions - so F13's block, T8's `**Justification:**` line, the section 2 measurement tables and rows 10, 13, 14 and 15 of the section 4 summary table all stand exactly as measured at `13da8b2`.

ER9 - the version was bumped and the blast radius is documentation only. From the repository root, `node -p "require('./package.json').version"` prints a string matching `^0\.1\.96-20[0-9]{10}$` - patch 96, then a 12-digit `YYYYMMDDHHmm` local-time stamp - which is strictly greater than the `0.1.95-202609091654` at `66d9442`. `git diff --name-only 66d9442 | sort` lists only paths drawn from this closed set of four and no others: `docs/plans/code-quality-review.md`, `docs/suggestions-log.md`, `docs/tasks/RH-41-spec.md`, `package.json` (it is a subset rather than an exact set because a review round that ends with nothing to append leaves `docs/suggestions-log.md` out of the diff; the first three of the four are always present). `git diff 66d9442 -- src` prints nothing, and `git diff --name-only 66d9442 -- src migrations e2e eslint.config.mjs vitest.config.ts AGENTS.md README.md docs/plans/mobile-app-analysis.md` prints nothing, so no source file, migration, end-to-end spec, lint config, test config or other document was touched: `AGENTS.md` is deliberately absent because RH-62, RH-63 and RH-65 already made its architecture diagram, directory map and convention bullets agree with the delivered code, and `docs/plans/mobile-app-analysis.md` is deliberately absent because correcting its stale `force-dynamic` and proxy claims requires re-deriving its section 3.2 conclusion and is a follow-up task, not a text edit here. This task ships no user-facing feature - it is an internal architecture close-out plus documentation - so under the AGENTS.md Landing Page Rule it is not a selling point: `git diff --stat 66d9442 -- src/components/landing src/i18n/dictionaries` prints nothing. No command in any Expected Result of this task moves git state.

## Out of Scope

- **Any code change at all.** ER9 forbids touching `src/`, `migrations/`, `e2e/`,
  `eslint.config.mjs` and `vitest.config.ts`. The five parts are merged; this is
  verification and documentation.
- **F13.** The task's `justification` says so explicitly: F13 is not part of any
  RH-41 part and stays with RH-53. It is one derived-state pair inside
  `src/app/playlists/[id]/page.tsx` (session at L277, the `useState` at L291, the
  copy at L343), and RH-53 owns that 1344-line component end to end. The T8
  `**Status:**` line records that F13 is open rather than silently closing T8.
- **Converting the remaining ten client pages.** F15's remediation names exactly
  `/bands`, `/playlists` and `/admin/moderation` as the starting set. Of the ten
  that remain, the four auth forms (`/login`, `/signup`, `/forgot-password`,
  `/reset-password`) have nothing to read on the server, and exactly one,
  `/playlists/[id]`, is owned elsewhere - it is F11's, which is RH-53.
  **Suggestion for a follow-up task:** the other five - `/`, `/bands/[id]`,
  `/profile`, `/settings` and `/songs/[id]/fast-view` - have no owner at all.
  Neither F6 nor F11 covers the four dashboards, and F6, which did own
  `/songs/[id]/fast-view`, is closed: it carries a `**Status:** Resolved` line
  naming RH-48..RH-52, and RH-52 (`e985ba5`) left that page at 222 lines,
  complexity 6, with no `useState`, no `useEffect` and no data access of its
  own. This close-out deliberately does not pretend a closed finding owns the
  remaining work. All five are acceptable as they stand, because each reads
  through code that resolves its own session and fails closed (Server Actions in
  `src/app/actions/` calling `getRequiredUserId()` directly or through
  `resolveOwner()`; for `/settings`, the `/api/spotify/playlists` route handler;
  for `/songs/[id]/fast-view`, `getSongEntryAction` and
  `getPersonalEntryForSongAction` called from the `useEffect` in
  `src/hooks/useSongEntry.ts`), so nothing about them depends on the proxy. A
  later task could hoist the read half of `/profile` and `/bands/[id]` onto the
  server the way RH-62 did for `/bands`; `/settings` would need the Spotify
  status read moved out of the route handler into `src/lib`;
  `/songs/[id]/fast-view` would need `useSongEntry`'s initial read lifted into
  the page's server segment, which is a small change now that the page is a
  222-line composition root; and `/` is the largest of the five and worth sizing
  separately.
- **Lowering `BandDetailPage`'s complexity 30 or `BandProfileView`'s 23.** ER7
  measures both and the `**Correction (RH-41):**` line records that they did not
  move. Both are component decomposition, not interface design, and neither is
  what F14 asks for. Worth a new finding or folding into T6's ratchet, not this
  diff.
- **Correcting `docs/plans/mobile-app-analysis.md`.** It still claims on seven
  lines (L17, L29, L137, L169, L181, L311, L330) that the root layout declares
  `force-dynamic`, and separately on one line (L39) that `src/proxy.ts` gates
  every non-public request by `fetch`ing `/api/auth/get-session` behind a 3 s
  abort. The first is false as of `57bc60a`, the second as of `66d9442`; the
  staleness was already logged as item 4 of the
  `[RH-61] ... (code review 1)` entry in `docs/suggestions-log.md`. It is not
  fixed here because that document's §3.2 conclusion - that `output: "export"` is
  structurally impossible - is argued partly from those two claims, so a correct
  fix has to re-derive the conclusion. **Suggestion for a follow-up task:** update
  `docs/plans/mobile-app-analysis.md` to the post-RH-41 architecture and re-check
  whether §3.2 and the Option B recommendation still hold now that the auth and
  landing routes prerender and the proxy makes no network call.
- **Rewriting the review's measured baseline.** Section 2's tables, the headings
  and "Why it matters" prose of F10, F14 and F15, T8's `**Justification:**` line,
  and rows 10, 13, 14 and 15 of section 4 describe `13da8b2` and stay as
  measured. The one correction is an additive, dated line in section 3.
- **Closing any other finding.** Only F10, F14, F15 and T8 get markers. F13 and
  every other open finding keeps its current text even where later tasks have in
  fact addressed it; sweeping the whole document is separate work with its own
  evidence requirements.
- **Adding a guard for the Server Component page pattern.** AGENTS.md states the
  convention and the three pages have island tests, but nothing mechanically
  stops a new read-only route from being written as a `'use client'` page that
  fetches in an effect. A source-scan test in the style of
  `rootLayoutRendering.test.ts` would ratchet it; it needs an explicit
  allow-list for the interactive pages, which makes it its own task.

## Post-merge checks (orchestrator)

- RH-41 is fully delivered once this merges: RH-61, RH-62, RH-63, RH-64, RH-65
  and this close-out together satisfy T8 for three of its four findings, and
  F10, F14 and F15 are closed.
- **T8 is not fully closed.** F13 remains open and is owned by RH-53
  (`backlog`). When RH-53 lands, F13 needs its own `**Status:**` line and the T8
  line should be revisited, because at that point all four covered findings are
  closed.
- **One follow-up is worth capturing as a new task:** correcting
  `docs/plans/mobile-app-analysis.md`, which still describes the pre-RH-61
  `force-dynamic` tree and the pre-RH-65 fetching proxy, and re-checking its
  §3.2 `output: "export"` conclusion against the current architecture. Already
  logged in `docs/suggestions-log.md` under RH-61's code review; not fixed here
  for the reason in Out of Scope.
- **A second, smaller follow-up:** a guard that a new read-only page route is
  written as a Server Component rather than a `'use client'` page fetching in an
  effect. The convention is in AGENTS.md and the three converted pages have
  tests, but nothing ratchets it. The allow-list such a guard would need is
  known and is exactly the ten pages that still carry `'use client'` at
  `66d9442`: `/`, `/bands/[id]`, `/forgot-password`, `/login`, `/playlists/[id]`,
  `/profile`, `/reset-password`, `/settings`, `/signup`, `/songs/[id]/fast-view`.
  Agreeing that list, and deciding whether entries leave it as RH-53 (F11) and
  the five-page follow-up above land, is what makes it its own task rather than
  a line in this one.
- **A third follow-up, from the F15 breakdown:** `/`, `/bands/[id]`, `/profile`,
  `/settings` and `/songs/[id]/fast-view` are the five client pages no open
  finding owns - the first four were never covered by F6 or F11, and the fifth
  was covered by F6, which RH-52 (`e985ba5`) closed. See Out of Scope.
- The `complexityBudget.test.ts` flake that RH-38 and RH-40 had to tolerate by
  name is gone: RH-59 (`65cadd8`) fixed it and the `66d9442` full run is
  `Test Files 100 passed (100)` / `Tests 1148 passed (1148)` with 0 skipped. No
  ER in this task carries a flake tolerance, and none should be re-added without
  a reproduction.

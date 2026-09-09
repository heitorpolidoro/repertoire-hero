# RH-62 — Server Components parte 2/5: converter /bands e /admin/moderation em Server Components com ilhas client

Parent: RH-41 (F15, part 2 of 5). Depends on RH-61 (`57bc60a`, done).
Baseline for every measurement in this document: `57bc60a`
(`perf(RH-61): drop force-dynamic from the root layout so auth and landing routes prerender`).

## Scope

Convert exactly two routes from `'use client'` pages that fetch in a mount
effect into `async` Server Components that read through `@/lib` and hand the
data to a `'use client'` island:

- `src/app/bands/page.tsx` — reads through `getBands(userId)` from
  `@/lib/bands`; the island keeps the create-band form
  (`createBandAction` + `uploadBandCoverAction`) and the list rows.
- `src/app/admin/moderation/page.tsx` — reads through
  `getPendingGlobalSongEdits(userId)` from `@/lib/moderation`; the island keeps
  the approve / reject interaction (`reviewGlobalSongEditAction`).

Both pages lose their `'use client'` directive, their mount `useEffect`, their
hand-written `loading` flag and their loading placeholder text, and both move
from the prerendered set to the dynamic (`f`) set of the `next build` route
table. Observable behaviour is preserved: same markup, same error banners, same
success message, same disabled-while-processing buttons, same navigation after
a create, same Access Denied panel for a non-admin.

Nothing else changes. No Server Action signature changes, no `src/lib` change,
no `src/proxy.ts` change, no `useBandAdmin` change, no `/playlists` change.

## Audit at 57bc60a

### `src/app/bands/page.tsx` — 227 lines, `"use client"` on line 1

- Imports (lines 3-10): `useEffect`/`useState` from react, `useRouter`,
  `next/image`, `getBandsAction as getBands`, `createBandAction as createBand`,
  `uploadBandCoverAction` from `@/app/actions/bands`, `compressImageFile` from
  `@/lib/imageCompressor`, `BandColorPicker` from
  `@/components/bands/BandColorPicker`, `DEFAULT_BAND_COLOR` from
  `@/lib/bandColors`, `Band` from `@/types/database`.
- Three module-level presentational sub-components: `BandImage` (11-26),
  `BandInfo` (28-37), `BandListItem` (39-55, uses `useRouter().push`).
- `BandsPage` (57-227). Nine `useState` calls (59-68): `bands`, `loading`
  (initial `true`), `showCreate`, `newName`, `newDesc`, `newColor`,
  `coverFile`, `coverPreview`, `creating`, `error`.
- One mount effect (70-75): `getBands().then(setBands).catch(e =>
  setError(e.message)).finally(() => setLoading(false))`. This is the only data
  read on the page.
- `handleFileChange` (77-84): compresses the picked file and sets
  `coverFile` / `coverPreview` (browser-only, must stay client-side).
- `handleCreate` (86-111): optional `uploadBandCoverAction(formData)` whose
  `{ error }` envelope is surfaced inline, then
  `createBand(name, desc, coverUrl, color)` and `router.push('/bands/<id>')`.
  On throw it sets `error` and clears `creating`.
- JSX (113-226): header + `+ New Band` toggle; the create form rendered only
  when `showCreate`; the `error` paragraph lives **inside** that form
  (184-188), so a load error today is invisible unless the form is open;
  then `loading ? "Loading bands..." : bands.length === 0 ? empty state : <ul>`.
- eslint: `rtk proxy npx eslint src/app/bands/page.tsx` exits `0` with no
  output. The file contributes **nothing** to the repo total of
  `22 problems (8 errors, 14 warnings)`, and it has **no** complexity override.

### `src/app/admin/moderation/page.tsx` — 306 lines, `"use client"` on line 1

- Imports (3-10): `useEffect`/`useState`, `next/link`,
  `getPendingGlobalSongEditsAction` + `reviewGlobalSongEditAction` from
  `@/app/actions/moderation`, `AlertBanner` from `@/components/ui/AlertBanner`,
  `GlobalSongEdit` from `@/types/database`.
- `AdminModerationPage` (12-306). Seven `useState` calls (13-21): `edits`,
  `loading` (initial `true`), `error`, `success`, `rejectingId`,
  `rejectionReason`, `processingId`.
- One mount effect (24-47) with an `isMounted` guard:
  `getPendingGlobalSongEditsAction()` -> `setEdits` / `setError` /
  `setLoading(false)`. The only data read on the page.
- `handleApprove` (49-63) and `handleConfirmReject` (65-85): both set
  `processingId`, clear `error`/`success`, call
  `reviewGlobalSongEditAction(...)`, **filter the reviewed edit out of local
  state**, set a success message, and clear `processingId` in `finally`.
- Early returns: `loading` -> the string `Loading moderation queue...`
  (87-93); `error && error.includes("Access denied")` -> a red panel with the
  heading `Access Denied`, the copy `You must be a System Administrator to
  access this page.` and a `Return Home` link (95-118).
- Main JSX (120-305): header with the `{edits.length} Pending Request(s)`
  badge; `AlertBanner tone="error"` and `AlertBanner tone="success"` (141-147);
  empty-queue panel (`Queue is empty`); otherwise one card per edit
  (162-301) containing the requester line, the current-vs-proposed diff grid,
  and either the rejection-reason form or the two action buttons.
- eslint: `rtk proxy npx eslint src/app/admin/moderation/page.tsx` exits `0`
  with no output. It contributes nothing to the repo total either.
- Complexity override (`eslint.config.mjs`, first entry between the markers):
  `{ files: ["src/app/admin/moderation/page.tsx"], rules: { complexity:
  ["error", 16], "max-lines-per-function": ["error", 295] } }`. The `16` is the
  `edits.map((edit) => { ... })` callback: 1 + 4 (the
  `requester?.full_name || requester?.email || edit.requested_by` chain) + 8
  (four `song?.x || "N/A"` pairs) + 1 (`isRejecting ?`) + 2 (two
  `isProcessing ?`) = 16. That arithmetic is what dictates the island split
  below: ESLint's `complexity` counts `?.`, `||` and `??` as branches, so a
  single new file holding the whole card would land on 16 and blow the base
  budget of 15.

### Actions and revalidation

`src/app/actions/bands.ts` and `src/app/actions/moderation.ts` are A2 thin
actions: each resolves `getRequiredUserId()` and delegates to `src/lib`, with
no `try/catch` (except `uploadBandCoverAction`, which returns an A1 envelope).
**Neither file imports `next/cache` and neither calls `revalidatePath`** —
`grep -rn "revalidatePath" src/` at `57bc60a` returns hits only in
`src/app/actions/repertoire.ts` (8 calls) and its test. Their fail-closed modes
are pinned by `src/app/actions/__tests__/actionSessionGuard.test.ts`:
`createBandAction`, `getBandsAction`, `getPendingGlobalSongEditsAction` and
`reviewGlobalSongEditAction` are `throws`; `uploadBandCoverAction` is
`envelope`. **No action file is modified by this task**, so that guard and
`actionAuthorizationGuard` / `actionDataAccessGuard` are untouched.

`src/lib/moderation.ts:30-36` `checkSystemAdmin` throws
`Access denied: User is not a system admin`, and `getPendingGlobalSongEdits`
(38-82) re-throws it unwrapped (convention L1a) while wrapping every other
failure as `Failed to fetch pending global song edits: ...`. So
`message.startsWith('Access denied')` is a reliable discriminator on the
server, and it is the same discriminator the client page uses today
(`error.includes("Access denied")`).

`src/lib/bands.ts:7` is `export const getBands = async (userId: string):
Promise<Band[]>`, wrapped L1 (`Failed to fetch bands: ...`).

### Session helpers, middleware and the app chrome

`src/lib/auth-session.ts` exports `getSession()` (13 lines total) and
`getRequiredUserId()`; both `await headers()`, so any page calling either is
dynamic by construction and needs no `export const dynamic` of its own — this
is exactly how `src/app/join/[code]/page.tsx:85` works and why that route is
already `f` in the route table.

`src/proxy.ts` matches everything that is not a static asset
(`'/((?!_next/static|_next/image|favicon.ico|pdf\\.worker\\.min\\.mjs|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'`),
and `PUBLIC_PATHS` does **not** contain `/bands` or `/admin`. Verified against
a production server built from `57bc60a`
(`npx next start -p 3210`, no cookie):

```
/bands             -> 307  Location: /login?redirect=%2Fbands
/admin/moderation  -> 307  Location: /login?redirect=%2Fadmin%2Fmoderation
/login             -> 200
```

So an unauthenticated HTTP request never reaches either page component. The
page-level `redirect('/login')` specified below is defence in depth for the
case the middleware matcher ever changes, and it is what keeps the
`getSession()` result narrowed for TypeScript.

`src/app/layout.tsx:32` renders `<AppShell>{children}</AppShell>`.
`src/app/AppShell.tsx:1` is `'use client'` (it calls `authClient.useSession()`
and fetches bands in an effect — RH-41 part 1 corrected the record on this).
`children` is passed from the **server** layout into that client component as a
slot, so an `async` Server Component page still renders on the server and its
output is threaded through `AppShell` -> `ConditionalLayout` -> `AppLayout`
untouched. `ConditionalLayout` bypasses the chrome only for `/login`,
`/signup`, `/forgot-password`, `/reset-password` and `/join/`, so both routes
in scope keep their chrome. **No layout file needs to change.**

### Route table baseline (clean `rm -rf .next && npx next build`, exit 0)

`/bands` and `/admin/moderation` are both `o` (prerendered static shells), and
their documents exist on disk:

```
.next/server/app/bands.html               13.5K, contains "Loading bands..."
.next/server/app/admin/moderation.html    13.7K, contains "Loading moderation queue..."
```

Prerender manifest — 14 routes:
`/ /_global-error /_not-found /admin/moderation /bands /forgot-password
/icon.jpg /login /playlists /profile /reset-password /settings /signup
/songs/search`

Dynamic set (app paths minus prerendered) — 14 routes:
`/api/auth/[...all] /api/auth/spotify/authorize /api/auth/spotify/callback
/api/auth/spotify/disconnect /api/dev/profiles /api/spotify/playlists
/api/spotify/playlists/[id]/import /api/spotify/playlists/[id]/sync
/api/spotify/playlists/[id]/tracks /api/spotify/search /bands/[id]
/join/[code] /playlists/[id] /songs/[id]/fast-view`

### Other gates at 57bc60a

- `rtk proxy npx vitest run`: 93 files / 1067 tests / 0 skipped (Postgres at
  `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations
  applied and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`).
- `rtk proxy npx eslint .`: `22 problems (8 errors, 14 warnings)`.
- `npm run lint:dup`: 19 clones / 242 lines / 0.71 %. `knip` clean.
  `./node_modules/.bin/tsc --noEmit` clean. `npm run audit`: 0 high/critical.
- Coverage thresholds 80 / 65 / 78 / 80. `src/app/**/page.tsx` and
  `src/components/**` are outside `coverage.include`, so nothing this task adds
  enters the coverage denominator.
- `eslint.config.mjs` holds exactly 23 override entries;
  `src/lib/__tests__/complexityBudget.test.ts` sets `MAX_OVERRIDES = 23` and
  holds 6 tests, one of them named `lists at most 23 per-file overrides, each
  naming a file that exists`.
- e2e, verified at `57bc60a` against `npx next start -p 3000 -H 127.0.0.1`:
  `e2e/ssr-smoke.spec.ts` 4 passed and `e2e/bands-confirm.spec.ts` 3 passed
  (7 passed together, exit 0). `bands-confirm` **does** visit `/bands`: its
  `createBand` helper (`e2e/bands-confirm.spec.ts:39`) does
  `page.goto('/bands')`, clicks `+ New Band`, fills the `The Rolling Stones`
  placeholder, clicks `Create Band` and waits for `/bands/<id>` — i.e. it
  exercises the new island's whole create path, three times.
- The e2e user (`e2e-test@example.com`, created by `e2e/global-setup.ts` via
  sign-up) gets a `profiles` row with the default `is_system_admin = false`, so
  it is a **non-admin** and is the right fixture for asserting the Access
  Denied path.
- `package.json` version `0.1.91-202609091203`.

## Approach

### Where the islands live: `src/components`, with injected actions

Both islands go under `src/components/`, not next to the page as
`*Client.tsx`. Justification against AGENTS.md:

1. The import-direction rule (F21) forbids `@/app/*` under `src/components`, so
   each island declares its own `…Actions` interface and receives one injected
   object as a prop. That is precisely the pattern AGENTS.md names
   (`src/app/bandAdminActions.ts`, `src/app/fastView*Actions.ts`) and that
   `src/components/songs/SongForm.tsx:40` (`export interface SongFormActions`)
   already implements.
2. It is what makes the islands unit-testable at all. A jsdom test of an island
   that imported `@/app/actions/bands` directly would pull `'use server'`,
   `@vercel/blob` and `pg` into the test graph; injected `vi.fn()`s need none
   of that. `SongForm.test.tsx` is the working precedent.
3. `src/components/bands/` already exists (`BandColorPicker.tsx`), so the bands
   island lands beside its own dependency.

The composition root is the page itself: a module-scope `const` in the page
file that imports the actions and satisfies the island's interface. That is the
`src/app/page.tsx:104` (`const SONG_FORM_ACTIONS: SongFormActions = { ... }`)
precedent. No new `src/app/*Actions.ts` file is created — there is exactly one
consumer per object, and a separate module would add indirection knip cannot
justify.

### New files

- `src/components/bands/BandsView.tsx` — `"use client";` on line 1. Exports
  `BandsView` and `export interface BandsViewActions { createBand(name: string,
  description?: string | null, coverUrl?: string | null, color?: string |
  null): Promise<string>; uploadBandCover(formData: FormData):
  Promise<{ coverUrl?: string; error?: string }> }`. Props:
  `{ bands: Band[]; initialError: string | null; actions: BandsViewActions }`.
  Holds `BandImage`, `BandInfo`, `BandListItem` and everything from today's
  `BandsPage` **except** `bands`/`loading`: `showCreate`, `newName`, `newDesc`,
  `newColor`, `coverFile`, `coverPreview`, `creating`, and
  `error` seeded with `useState(initialError)`. Markup is moved verbatim; the
  `loading ? ... :` arm and its `Loading bands...` string are deleted, leaving
  `bands.length === 0 ? emptyState : <ul>`.
- `src/components/bands/__tests__/BandsView.test.tsx` — jsdom.
- `src/components/admin/ModerationQueue.tsx` — `"use client";` on line 1.
  Exports `ModerationQueue` and `export interface ModerationQueueActions {
  reviewGlobalSongEdit(editId: string, action: 'approve' | 'reject', reason?:
  string): Promise<GlobalSongEdit> }`. Props: `{ initialEdits:
  GlobalSongEdit[]; initialError: string | null; actions:
  ModerationQueueActions }`. Holds `edits` (`useState(initialEdits)`), `error`
  (`useState(initialError)`), `success`, `rejectingId`, `rejectionReason`,
  `processingId`, both handlers verbatim, the header badge, both
  `AlertBanner`s, the empty-queue panel, and the `edits.map` that renders one
  `PendingEditCard` per edit. No `loading` state and no `Loading moderation
  queue...` string.
- `src/components/admin/PendingEditCard.tsx` — presentational, no state. Props:
  `{ edit, isProcessing, isRejecting, rejectionReason, onRejectionReasonChange,
  onStartReject, onCancelReject, onConfirmReject, onApprove }`. Holds the card
  frame, the requester line, `<PendingEditDiff …/>`, the rejection-reason form
  and the two action buttons.
- `src/components/admin/PendingEditDiff.tsx` — presentational, no state. Props:
  `{ song: GlobalSongEdit['song']; proposed: Record<string, unknown> }`. Holds
  the two-column current-vs-proposed grid, i.e. the four
  `song?.x || "N/A"` pairs and the `Object.entries(proposed).map` block.

The three-file split of the moderation island is **required arithmetic**, not
taste: the single card function measures 16 against a base `complexity` budget
of 15, and a new file may not take an override (the list is a ratchet that may
only shrink). After the split the worst numbers are approximately: card
1 + 4 + 1 + 2 = 8, diff 1 + 8 = 9, queue 1 + 2 (`error &&`, `success &&`) +
1 (`length !== 1 ?`) + 1 (`length === 0 ?`) = 5. The implementer must confirm
with eslint rather than trust these estimates, and split further if any file
reports.

- `src/components/admin/__tests__/ModerationQueue.test.tsx` — jsdom.
- `e2e/server-pages.spec.ts` — two Playwright tests, below.

### The two server pages

`src/app/bands/page.tsx` becomes roughly:

```tsx
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-session";
import { getBands } from "@/lib/bands";
import { createBandAction, uploadBandCoverAction } from "@/app/actions/bands";
import { BandsView, type BandsViewActions } from "@/components/bands/BandsView";
import type { Band } from "@/types/database";

const BANDS_VIEW_ACTIONS: BandsViewActions = {
  createBand: createBandAction,
  uploadBandCover: uploadBandCoverAction,
};

export default async function BandsPage() {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  let bands: Band[] = [];
  let loadError: string | null = null;
  try {
    bands = await getBands(userId);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    loadError = err.message;
  }

  return <BandsView bands={bands} initialError={loadError} actions={BANDS_VIEW_ACTIONS} />;
}
```

`src/app/admin/moderation/page.tsx` is the same shape with
`getPendingGlobalSongEdits(userId)`, plus one branch before the island:

```tsx
  if (loadError?.startsWith("Access denied")) {
    return ( /* the Access Denied panel, markup moved verbatim from lines 96-117 */ );
  }
  return <ModerationQueue initialEdits={edits} initialError={loadError} actions={MODERATION_ACTIONS} />;
```

Notes on that shape:

- **Unauthenticated.** `redirect('/login')` from `next/navigation`. In practice
  it is unreachable over HTTP because `src/proxy.ts` already answers `307`
  with `Location: /login?redirect=<path>` (measured above, and pinned by ER6);
  the page-level redirect exists so the page cannot leak data if the matcher
  changes, and because `redirect()` returns `never`, which narrows `userId` to
  `string` for `getBands`/`getPendingGlobalSongEdits` without a non-null
  assertion. `getSession()` rather than `getRequiredUserId()` precisely because
  the latter throws (a 500 error document) where a redirect is wanted.
- **Non-admin.** The page does **not** rethrow. It catches, narrows with
  `instanceof Error`, and branches on
  `loadError.startsWith("Access denied")` to render the same Access Denied
  panel the client page renders today (same heading, same copy, same
  `Return Home` link), with HTTP status 200. Any other failure keeps
  `loadError` and is handed to the island as `initialError`, which seeds the
  `AlertBanner tone="error"` — exactly today's behaviour, where a non-access
  error renders the queue plus an error banner. The catch adds no
  `logger.error` call: `src/lib/moderation.ts` and `src/lib/bands.ts` already
  log at L1 before throwing, and a second log would double-report to Sentry.
  No `catch (x: any)`, no `console.error` — the
  `src/lib/__tests__/errorHandlingStyle.test.ts` guard walks these files.
- **Bands load failure** is handled the same way and seeds `BandsView`'s
  `error` state, so it renders in the same place as today (inside the create
  form). This is deliberate: without the catch, a `getBands` throw would turn
  today's silent degradation into a 500 error document.
- Both pages stay dynamic with no `export const dynamic`: `getSession()` awaits
  `headers()`.

### Refresh strategy after a mutation

Neither `createBandAction` nor `reviewGlobalSongEditAction` calls
`revalidatePath` today, and this task does **not** add one — touching an action
file would drag `actionSessionGuard` / `actionAuthorizationGuard` /
`actionDataAccessGuard` into a refactor whose subject is the page layer, and
`revalidatePath` on a route that is dynamic-by-session buys nothing.

The chosen strategy is **optimistic local state plus `router.refresh()`**:

- `BandsView.handleCreate`: on success call `router.refresh()` and then
  `router.push('/bands/' + bandId)`. The `push` is today's behaviour verbatim;
  the `refresh()` invalidates the router cache entry for `/bands` so a
  back-navigation re-runs the Server Component and shows the new band.
- `ModerationQueue.handleApprove` / `handleConfirmReject`: keep today's
  `setEdits(prev => prev.filter(...))` so the card disappears immediately and
  the `N Pending Requests` badge updates in the same tick, then call
  `router.refresh()` so the server-rendered list behind the initial props is
  re-read. Local state is the source of truth for what the user sees;
  `refresh()` only re-seeds what a later mount would receive, so the two cannot
  disagree (a `useState` initialiser is ignored on re-render).

Both islands get the router from `useRouter()` (`next/navigation`), which the
jsdom tests mock. No `useEffect` appears in either island.

### eslint, override and budget consequences

- Neither page reports an eslint problem today, so the repo total stays
  `22 problems (8 errors, 14 warnings)`. **No problem is removed by this
  task** — the `react-hooks/set-state-in-effect` errors in the tree live in
  `/profile`, `/reset-password` and `/settings`, none of which is in scope.
- `src/app/admin/moderation/page.tsx` drops to roughly 55 lines with a worst
  complexity well under 15, so its override entry **must be deleted** from
  `eslint.config.mjs`: `complexityBudget.test.ts`'s "pins every override
  ceiling to the current worst number in its file" test fails if a 16/295
  ceiling survives on a file that no longer needs it.
- With the entry gone the list holds 22 entries. `MAX_OVERRIDES` in
  `src/lib/__tests__/complexityBudget.test.ts` is lowered `23 -> 22` and the
  test title updated to `lists at most 22 per-file overrides, each naming a
  file that exists`, per the ratchet comment at that constant ("Lower this
  number when an override is removed; never raise it"). `AGENTS.md:94` ends on
  "and on the list growing past 23 entries"; that number documents the guard's
  actual ceiling, so it becomes "past 22 entries" in the same commit. This is
  the RH-55 precedent exactly: `b024a87` lowered `MAX_OVERRIDES` 24 -> 23 and
  rewrote the same sentence 24 -> 23, for a numstat of one insertion and one
  deletion in AGENTS.md and nothing more. The edit here is **one word on one
  line and nothing else** — no other AGENTS.md sentence changes, and if
  `next build` regenerates the `<!-- BEGIN:nextjs-agent-rules -->` block at
  lines 317-325, that regeneration must be reverted before the commit so the
  file's numstat stays at one insertion and one deletion.
- No new file may take an override. Every new file must be clean under
  complexity 15 / max-depth 4 / max-lines-per-function 200 / max-params 4 /
  max-lines 400. Component props arrive as one object, so `max-params` is 1
  everywhere.

### Test plan

**`src/components/bands/__tests__/BandsView.test.tsx`** — first line
`// @vitest-environment jsdom`, `import { cleanup } from
'@testing-library/react'` + `afterEach(cleanup)` (globals are off), and
`vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }))`
with module-scope `vi.fn()`s. Tests, by exact name:

1. `renders one row per band from its props`
2. `renders the empty state when the band list prop is empty`
3. `never renders a loading placeholder`
4. `creates a band through the injected action and navigates to it`
5. `refreshes the router before navigating after a successful create`
6. `disables the submit button while the create action is pending`
7. `surfaces the upload envelope error without calling createBand`
8. `renders the initialError prop in the create form`

**`src/components/admin/__tests__/ModerationQueue.test.tsx`** — same jsdom
preamble and the same `next/navigation` mock. Tests, by exact name:

1. `renders one card per pending edit from its props`
2. `renders the empty-queue panel when there are no pending edits`
3. `approves an edit through the injected action and removes its card`
4. `rejects an edit with the typed reason through the injected action`
5. `disables the approve and reject buttons while a review is in flight`
6. `shows an error banner when the injected review action rejects`
7. `renders the initialError prop in an error banner`
8. `refreshes the router after a successful review`

**Server Component pages.** A vitest render of an `async` Server Component is
not feasible here: the page awaits `headers()` through `getSession()` and imports
`'use server'` modules, and `src/app/**/page.tsx` is outside the coverage
universe by policy (AGENTS.md). The server halves are therefore verified by
build-manifest inspection (ER4, ER5), by `curl` against `next start` (ER6), and
by two Playwright tests in a **new** `e2e/server-pages.spec.ts` that assert on
the raw HTTP document with no JavaScript executed, in the style of
`e2e/ssr-smoke.spec.ts`:

- `GET /bands signed in is server-rendered with no loading placeholder` —
  `request.get('/bands')` with `AUTH_STATE_PATH` storage state: status 200,
  body does not contain `Loading bands...`, does not contain
  `id="__next_error__"`.
- `GET /admin/moderation signed in as a non-admin renders Access Denied` —
  status 200, body contains `Access Denied`, does not contain
  `Loading moderation queue...`, does not contain `id="__next_error__"`.

Both strings are present in the prerendered documents at `57bc60a`, so these
tests are red before the change and green after.

### Whitelist

```
AGENTS.md
docs/suggestions-log.md
docs/tasks/RH-62-spec.md
e2e/server-pages.spec.ts
eslint.config.mjs
package.json
src/app/admin/moderation/page.tsx
src/app/bands/page.tsx
src/components/admin/ModerationQueue.tsx
src/components/admin/PendingEditCard.tsx
src/components/admin/PendingEditDiff.tsx
src/components/admin/__tests__/ModerationQueue.test.tsx
src/components/bands/BandsView.tsx
src/components/bands/__tests__/BandsView.test.tsx
src/lib/__tests__/complexityBudget.test.ts
```

**Landing Page Rule decision.** This task is an internal rendering refactor. It
adds no capability a musician or band would choose the app for (and a
moderation queue is explicitly named in AGENTS.md as a non-selling-point), so
the landing copy must not change. ER12 asserts that mechanically.

**Version.** Bump `package.json` to `0.1.92-YYYYMMDDHHmm` with a real local
timestamp (from `0.1.91-202609091203`).

## Expected Results

ER1 - `src/app/bands/page.tsx` is an async Server Component: `grep -c "use client" src/app/bands/page.tsx` prints `0`; `grep -c "useEffect\|useState" src/app/bands/page.tsx` prints `0`; `grep -c "getRequiredUserId\|getSession" src/app/bands/page.tsx` prints a number greater than or equal to `1`; `grep -c "export default async function" src/app/bands/page.tsx` prints `1`; `grep -c "@/lib/bands" src/app/bands/page.tsx` prints `1`; `grep -c "redirect(" src/app/bands/page.tsx` prints a number greater than or equal to `1`; `grep -c "Loading bands" src/app/bands/page.tsx` prints `0`; and `grep -c "" src/app/bands/page.tsx` prints a number less than or equal to `45` (it printed `227` at `57bc60a`).

ER2 - `src/app/admin/moderation/page.tsx` is an async Server Component: `grep -c "use client" src/app/admin/moderation/page.tsx` prints `0`; `grep -c "useEffect\|useState" src/app/admin/moderation/page.tsx` prints `0`; `grep -c "getRequiredUserId\|getSession" src/app/admin/moderation/page.tsx` prints a number greater than or equal to `1`; `grep -c "export default async function" src/app/admin/moderation/page.tsx` prints `1`; `grep -c "@/lib/moderation" src/app/admin/moderation/page.tsx` prints `1`; `grep -c "Loading moderation queue" src/app/admin/moderation/page.tsx` prints `0`; `grep -c "Access denied" src/app/admin/moderation/page.tsx` prints a number greater than or equal to `1` and `grep -c "Access Denied" src/app/admin/moderation/page.tsx` prints a number greater than or equal to `1` (the page still classifies the authorization failure and still renders the panel, rather than throwing); and `grep -c "" src/app/admin/moderation/page.tsx` prints a number less than or equal to `80` (it printed `306` at `57bc60a`).

ER3 - The five island files exist and respect the import-direction rule: `test -f src/components/bands/BandsView.tsx && test -f src/components/admin/ModerationQueue.tsx && test -f src/components/admin/PendingEditCard.tsx && test -f src/components/admin/PendingEditDiff.tsx` exits `0` (none of them exists at `57bc60a`); `head -1 src/components/bands/BandsView.tsx` and `head -1 src/components/admin/ModerationQueue.tsx` each print exactly `"use client";`; `grep -c "useState\|useEffect" src/components/admin/PendingEditCard.tsx` and `grep -c "useState\|useEffect" src/components/admin/PendingEditDiff.tsx` each print `0`; `grep -c "useEffect" src/components/bands/BandsView.tsx` and `grep -c "useEffect" src/components/admin/ModerationQueue.tsx` each print `0` (the mount effects are gone, not relocated); `grep -c "export interface BandsViewActions" src/components/bands/BandsView.tsx` prints `1` and `grep -c "export interface ModerationQueueActions" src/components/admin/ModerationQueue.tsx` prints `1`; and `grep -rn "@/app/" src/components src/lib src/hooks | grep -v __tests__` prints nothing at all.

ER4 - From a clean build, `rm -rf .next && npx next build` exits `0`, and `node -e "const r=Object.keys(require('./.next/prerender-manifest.json').routes).sort();console.log(r.length);console.log(r.join(' '))"` prints exactly two lines: `12`, then `/ /_global-error /_not-found /forgot-password /icon.jpg /login /playlists /profile /reset-password /settings /signup /songs/search`. At `57bc60a` that command printed `14` and a list that additionally contained `/admin/moderation` and `/bands`; those two names must be absent now. Additionally `ls .next/server/app/bands.html` and `ls .next/server/app/admin/moderation.html` each exit non-zero (both files existed at `57bc60a`, at 13.5K and 13.7K).

ER5 - After the same build, `node -e "const a=Object.values(require('./.next/app-path-routes-manifest.json'));const s=new Set(Object.keys(require('./.next/prerender-manifest.json').routes));const d=a.filter(x=>!s.has(x)).sort();console.log(d.length);console.log(d.join(' '))"` prints exactly two lines: `16`, then `/admin/moderation /api/auth/[...all] /api/auth/spotify/authorize /api/auth/spotify/callback /api/auth/spotify/disconnect /api/dev/profiles /api/spotify/playlists /api/spotify/playlists/[id]/import /api/spotify/playlists/[id]/sync /api/spotify/playlists/[id]/tracks /api/spotify/search /bands /bands/[id] /join/[code] /playlists/[id] /songs/[id]/fast-view`. That list is the `57bc60a` dynamic set of 14 plus exactly `/admin/moderation` and `/bands`, no other route having moved in either direction. Consistently, the `Route (app)` table printed by that build marks `/bands` and `/admin/moderation` with `f`.

ER6 - With `export BETTER_AUTH_SECRET=test-secret DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres` and `npx next start -p 3210` serving the ER4 build, and with no cookie sent: `curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://127.0.0.1:3210/bands` prints `307 http://127.0.0.1:3210/login?redirect=%2Fbands`; `curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://127.0.0.1:3210/admin/moderation` prints `307 http://127.0.0.1:3210/login?redirect=%2Fadmin%2Fmoderation`; and `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3210/login` prints `200`. These are the `57bc60a` values unchanged: the `src/proxy.ts` session gate, not the page, is what answers an unauthenticated request, and converting the pages must not alter that.

ER7 - `e2e/server-pages.spec.ts` exists (it does not exist at `57bc60a`) and, run as `PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1" npx playwright test e2e/server-pages.spec.ts --reporter=list` with `BETTER_AUTH_SECRET` exported from `.env.local`, Postgres reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations applied, and the ER4 build present, it exits `0` and prints `2 passed`, with both tests named and green: `GET /bands signed in is server-rendered with no loading placeholder` (status `200`, body does not contain `Loading bands...`, body does not contain `id="__next_error__"`) and `GET /admin/moderation signed in as a non-admin renders Access Denied` (status `200`, body contains `Access Denied`, body does not contain `Loading moderation queue...`, body does not contain `id="__next_error__"`). Checked out at `57bc60a` with only this file added, both tests fail, because both placeholder strings are present in the prerendered documents there.

ER8 - Under the same server and preconditions, the pre-existing e2e suites stay green at their `57bc60a` counts: `npx playwright test e2e/ssr-smoke.spec.ts` exits `0` printing `4 passed`; `npx playwright test e2e/bands-confirm.spec.ts` exits `0` printing `3 passed`, with `delete band via the inline confirmation`, `cancel keeps the band` and `Escape dismisses the confirmation` all green (each of the three drives the converted `/bands` create form end to end: `page.goto('/bands')`, `+ New Band`, fill the `The Rolling Stones` placeholder, `Create Band`, land on `/bands/<id>`); and `npx playwright test e2e/auth.spec.ts --grep "credentials"` exits `0` printing `2 passed`. No file under `e2e/` other than the new `e2e/server-pages.spec.ts` is modified.

ER9 - `rtk proxy npx vitest run src/components/bands/__tests__/BandsView.test.tsx` exits `0` printing `Test Files  1 passed (1)` and `Tests  8 passed (8)` with `0 failed`. The file's literal first line is `// @vitest-environment jsdom`, it calls `afterEach(cleanup)`, it imports nothing from `@/app/`, and its eight tests are named exactly: `renders one row per band from its props`, `renders the empty state when the band list prop is empty`, `never renders a loading placeholder`, `creates a band through the injected action and navigates to it`, `refreshes the router before navigating after a successful create`, `disables the submit button while the create action is pending`, `surfaces the upload envelope error without calling createBand`, `renders the initialError prop in the create form`.

ER10 - `rtk proxy npx vitest run src/components/admin/__tests__/ModerationQueue.test.tsx` exits `0` printing `Test Files  1 passed (1)` and `Tests  8 passed (8)` with `0 failed`. The file's literal first line is `// @vitest-environment jsdom`, it calls `afterEach(cleanup)`, it imports nothing from `@/app/`, and its eight tests are named exactly: `renders one card per pending edit from its props`, `renders the empty-queue panel when there are no pending edits`, `approves an edit through the injected action and removes its card`, `rejects an edit with the typed reason through the injected action`, `disables the approve and reject buttons while a review is in flight`, `shows an error banner when the injected review action rejects`, `renders the initialError prop in an error banner`, `refreshes the router after a successful review`.

ER11 - Static gates hold, and the complexity ratchet has shrunk by exactly one entry: `rtk proxy npx eslint .` prints `22 problems (8 errors, 14 warnings)`, unchanged from `57bc60a` (neither converted page contributed a problem there, so this task removes none and must add none); `rtk proxy npx eslint src/components/bands/BandsView.tsx src/components/admin/ModerationQueue.tsx src/components/admin/PendingEditCard.tsx src/components/admin/PendingEditDiff.tsx src/app/bands/page.tsx src/app/admin/moderation/page.tsx` exits `0` with no output; `./node_modules/.bin/tsc --noEmit` exits `0` printing nothing; `npm run lint:dead` exits `0` with no unused file, export or dependency reported; `npm run lint:dup` exits `0` reporting at most `19` clones and a duplication percentage of at most `0.71 %`; `npm run audit` exits `0` with `0` high or critical advisories; `grep -c "src/app/admin/moderation/page.tsx" eslint.config.mjs` prints `0`; the count of lines matching `complexity-budget/override` in `eslint.config.mjs` is `22` (it was `23`); `grep -c "MAX_OVERRIDES = 22" src/lib/__tests__/complexityBudget.test.ts` prints `1`; `rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts` exits `0` printing `Tests  6 passed (6)`, including the test now named `lists at most 22 per-file overrides, each naming a file that exists`; and the AGENTS.md sentence that documents that ceiling moves with it, exactly as `b024a87` moved it 24 -> 23 for RH-55: `grep -c "past 22 entries" AGENTS.md` prints `1`, `grep -c "past 23 entries" AGENTS.md` prints `0`, and `git diff --numstat 57bc60a -- AGENTS.md` prints exactly one line, whose three tab-separated fields are `1`, `1` and `AGENTS.md` - one insertion, one deletion, no other line touched, so if `next build` regenerated the `nextjs-agent-rules` block it was reverted before the commit.

ER12 - Whole-suite and release hygiene, with Postgres reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (migrations applied) and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`: `rtk proxy npx vitest run` exits `0` reporting `Test Files` passed greater than or equal to `95` (was 93; the two new jsdom suites), `Tests` passed greater than or equal to `1083` (was 1067; 16 new tests), `0 failed` and `0 skipped`; `npm run test:coverage` exits `0` with all four thresholds met (statements at least `80`, branches at least `65`, functions at least `78`, lines at least `80`). `package.json` version is `0.1.92-YYYYMMDDHHmm` with a real local timestamp, sorting above `0.1.91-202609091203`. `git diff 57bc60a -- src/components/landing src/i18n/dictionaries` prints nothing (an internal rendering refactor is not a selling point). `git diff 57bc60a -- src/app/actions src/proxy.ts src/hooks src/store next.config.ts src/lib ':(exclude)src/lib/__tests__/complexityBudget.test.ts'` prints nothing (that pathspec is verified to work under both `sh` and `zsh`; the one excluded file is the ratchet constant of ER11, and `AGENTS.md` is excluded from this check because ER11 pins its one-line edit instead). And `git diff --name-only 57bc60a | sort` lists only paths drawn from this closed set and no others: `AGENTS.md`, `docs/suggestions-log.md`, `docs/tasks/RH-62-spec.md`, `e2e/server-pages.spec.ts`, `eslint.config.mjs`, `package.json`, `src/app/admin/moderation/page.tsx`, `src/app/bands/page.tsx`, `src/components/admin/ModerationQueue.tsx`, `src/components/admin/PendingEditCard.tsx`, `src/components/admin/PendingEditDiff.tsx`, `src/components/admin/__tests__/ModerationQueue.test.tsx`, `src/components/bands/BandsView.tsx`, `src/components/bands/__tests__/BandsView.test.tsx`, `src/lib/__tests__/complexityBudget.test.ts` - any other path fails this result. In particular that list contains no `src/app/playlists/page.tsx`, no `src/hooks/useBandAdmin.ts`, no `src/proxy.ts`, no `src/app/layout.tsx`, no `src/app/AppShell.tsx` and no `docs/plans/code-quality-review.md`.

## Out of Scope

- `/playlists` (`src/app/playlists/page.tsx`) — RH-63, part 3 of 5. It cannot
  be converted mechanically anyway: it reads `useBandContextStore` (zustand +
  `persist`, i.e. localStorage) at line 692, which no Server Component can see,
  and it has a second read through `/api/spotify/playlists`.
- `src/hooks/useBandAdmin.ts` and its consumers `/bands/[id]` and `/profile` —
  RH-64, part 4 of 5.
- `src/proxy.ts`, including its matcher, its `PUBLIC_PATHS` list and its
  session-over-fetch strategy — RH-65, part 5 of 5.
- `src/app/page.tsx`, `src/app/AppShell.tsx`, `src/app/layout.tsx`,
  `src/app/settings/page.tsx`, `src/app/reset-password/page.tsx` and every
  other page not named in the whitelist.
- Any change to `src/app/actions/*.ts` (no new `revalidatePath`, no signature
  change) and to `src/lib/*` (no new lib module, no `getBands` /
  `getPendingGlobalSongEdits` change).
- The four eslint errors under `src/app` and the four under `src/components`
  that make up today's `8 errors` — none of them is in a file this task
  touches.
- Decomposing `src/app/playlists/[id]/page.tsx` (RH-53).
- Adding a `Status:` line for F15 in `docs/plans/code-quality-review.md`: F15
  is resolved only when all five parts have landed, and part 5 owns that line.
- Any AGENTS.md edit other than the single word `23` -> `22` in the F20
  complexity-budget sentence on line 94. In particular the architecture bullet
  that should eventually name the converted pages as the server-read precedent
  is **not** touched here (recorded as a suggestion instead), and the
  `nextjs-agent-rules` block is left byte-identical to `57bc60a`.
- Fixing the pre-existing red e2e specs (`songs-crud`, `fast-view-mobile`, and
  the two `/`-assumes-protected tests in `auth.spec.ts`).

## Post-merge checks (orchestrator)

After the Vercel deployment of the merge commit, the build summary should list
`/bands` and `/admin/moderation` among the `f` routes and the twelve routes of
ER4 as static, and a production `curl -sS -o /dev/null -w '%{http_code}\n'
https://<host>/bands` with no cookie should print `307`. No expected result
above depends on this.

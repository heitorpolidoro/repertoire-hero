# RH-23 — Extract / remove code duplication in the project

Baseline commit for every measurement, quotation and diff in this spec: **`fe300d4`**
(`chore(RH-22): remove dead code and unused deps, add knip lint:dead guard`), the current `master`
HEAD. Every number below was produced by actually running the tool on that tree.

## Scope

A single, behaviour-preserving duplication sweep: run a real duplication detector over `src/`,
classify **every** clone it reports, extract the ones that are genuine duplication into shared
modules, leave the ones that are not (with reasons recorded), and install a `jscpd` gate so the
duplication level cannot silently regress — the same shape RH-22 used for `knip`.

In scope:

1. Nine extractions (A1–A9 below), covering 22 of the 41 clones jscpd reports at `fe300d4`.
2. Four new `src/lib` unit-test files plus additions to `src/lib/__tests__/linkFetcher.test.ts`,
   covering the *pure* parts of the extractions (the vitest environment is `node`, so nothing that
   needs a DOM is unit-tested).
3. A committed `.jscpd.json`, an `npm run lint:dup` script and a CI job, with `jscpd` added as a
   devDependency **via `npm install --save-dev jscpd@5.1.2`** so `package-lock.json` stays in sync.
4. `AGENTS.md` touch-ups: the new `src/hooks/` directory in the tree, and `jscpd` in
   "Testing & quality".

Not in scope: any behaviour change, any visual change, any new product feature, renaming or
reformatting untouched code, the 19 clones classified **(B) leave** below, and refactoring
`src/app/playlists/**` or `src/app/login|signup` JSX.

**Landing Page Rule** (AGENTS.md): this task ships **no** user-facing feature. A duplication sweep
is an internal refactor with zero observable product change — explicitly **not a selling point**.
`src/components/landing/LandingPage.tsx`, `src/i18n/dictionaries/en.json` and
`src/i18n/dictionaries/pt-BR.json` MUST be byte-identical to `fe300d4` when this task lands.

**NO Browser Alerts** (AGENTS.md): the sweep touches the Toast and the confirmation plumbing. No
`alert()`/`confirm()` may appear; `src/lib/__tests__/noBrowserDialogs.test.ts` keeps enforcing this
and must keep passing (it is itself edited by A7 — see the constraint there).

**Error Handling Conventions** (AGENTS.md): catches are *moved*, never reshaped. A `try/catch` that
moves from a route handler into `src/lib` keeps the exact pattern it had (`R1` stays `R1` in the
route; the extracted lib helpers keep the plain `throw new Error('Spotify tracks fetch failed: …')`
they have today — they are not upgraded to the `L1` log-then-wrap form, because their callers'
`R1` handlers already log with the route tag and the message is not user-visible).
`src/lib/__tests__/errorHandlingStyle.test.ts` must keep passing (it too is edited by A7).

## Survey evidence

Tool actually run on the `fe300d4` tree:

```
npx jscpd@5.1.2 src --min-tokens 50 --min-lines 8 --reporters console
```

Baseline totals (`statistics.total` of the JSON reporter, same settings):

| metric | value at `fe300d4` |
|---|---|
| files analysed | 95 |
| total lines | 19805 |
| clones found | **41** |
| duplicated lines | **747 (3.77 %)** |
| duplicated tokens | **4180 (4.05 %)** |

Targeted greps run in addition to jscpd (things below the 50-token threshold that the task
justification named explicitly):

- Toast pattern — `grep -rn "fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-sm" src` → 3 hits
  (`bands/[id]/page.tsx:699`, `profile/page.tsx:638`, `songs/[id]/fast-view/page.tsx:1590`);
  `setTimeout(() => setToast(null), 4000)` → the same 3 files. Note the *state + effect* half is
  clone #11 and the *JSX* half is clone #21, but the `showToast` helpers differ in signature, which
  is why the whole block never shows as one clone.
- Dismissible alert banner — `grep -rn "border-red-200 bg-red-50 px-4 py-3 flex items-center justify-between" src`
  → 5 hits (`settings`, `admin/moderation`, `profile` ×2, `playlists`); the green `role="status"`
  twin → 2 hits (`admin/moderation`, `profile`).
- `ConfirmPanel` usage — already a shared component (`src/components/ui/ConfirmPanel.tsx`, added by
  RH-16); the remaining per-site JSX is 4–10 lines of props. **Nothing to extract.**
- Actions prologue — `resolveOwner(bandId)` is already the single shared prologue in
  `src/app/actions/*.ts`. **Nothing to extract.**
- Route prologue — the `getRequiredUserId()` + `getSpotifyAccessToken()` + two 401s block appears
  verbatim in the three `api/spotify/playlists/[id]/*/route.ts` files (A6). The fourth Spotify route
  (`api/spotify/playlists/route.ts`) returns `{ connected: false }` instead of 401 — different
  contract, left alone.
- Spotify helper definitions —
  `grep -rn "function fetchAllSpotifyTracks\|function fetchAllTracks\|function findOrCreateGlobalSong\|function ensureInRepertoire" src`
  → **7** hits at `fe300d4`: three in `import/route.ts` (35, 80, 126), three in `sync/route.ts`
  (38, 78, 121) and one in `tracks/route.ts` (31, the differently-named `fetchAllTracks`;
  `tracks/route.ts` has no `findOrCreateGlobalSong`/`ensureInRepertoire`). A2 takes this to 3, all in
  `src/lib/spotifyPlaylistSync.ts`.

### Classification of all 41 clones

**(A) Extract now — 22 clones**

| # | sites (`src/…`) | L/T | extraction |
|---|---|---|---|
| 1 | `app/actions/repertoire.ts 68-79` ↔ `lib/songs.ts 203-214` | 12/50 | A8 |
| 2 | `app/admin/moderation/page.tsx 139-156` ↔ `app/profile/page.tsx 293-303` | 18/63 | A4 |
| 3 | `app/admin/moderation/page.tsx 156-173` ↔ `app/profile/page.tsx 771-788` | 18/64 | A4 |
| 4 | spotify `import 11-35` ↔ `sync 11-38` | 25/101 | A2 |
| 5 | spotify `import 39-49` ↔ `tracks 35-45` | 11/57 | A2 |
| 6 | spotify `import 41-185` ↔ `sync 44-175` | **145/757** | A2 |
| 7 | spotify `import 49-62` ↔ `tracks 45-60` | 14/119 | A2 |
| 8 | spotify `import 185-200` ↔ `sync 175-190` | 16/78 | A2/A6 |
| 9 | spotify `import 185-198` ↔ `tracks 78-91` | 14/77 | A2/A6 |
| 10 | `app/bands/[id]/page.tsx 42-54` ↔ `app/profile/page.tsx 48-60` | 13/100 | A3 |
| 11 | `bands 73-82` ↔ `profile 75-84` (toast state + effect) | 10/59 | A1 |
| 12 | `bands 96-114` ↔ `profile 104-121` | 19/108 | A3 |
| 13 | `bands 132-196` ↔ `profile 121-186` | **65/366** | A3 |
| 14 | `bands 196-231` ↔ `profile 186-220` | 36/151 | A3 |
| 15 | `bands 243-260` ↔ `profile 229-246` | 18/82 | A3 |
| 16 | `bands 265-282` ↔ `profile 250-265` | 18/68 | A3 |
| 21 | `bands 702-713` ↔ `profile 645-656` (toast JSX) | 12/52 | A1 |
| 27 | `profile 293-301` ↔ `profile 755-770` (self) | 9/62 | A4 |
| 31 | `__tests__/errorHandlingStyle 46-65` ↔ `__tests__/noBrowserDialogs 45-64` | 20/118 | A7 |
| 32 | `__tests__/errorHandlingStyle 95-105` ↔ `__tests__/noBrowserDialogs 93-103` | 11/75 | A7 |
| 40 | `lib/bands.ts 101-116` ↔ `lib/playlists.ts 70-86` | 16/83 | A5 |
| 41 | `lib/linkFetcher.ts 20-29` ↔ `lib/linkFetcher.ts 49-58` (self) | 10/62 | A9 |

**(B) Leave — 19 clones**

| # | sites | why it stays |
|---|---|---|
| 17,18,19,20 | `bands/[id]/page.tsx` ↔ `profile/page.tsx` JSX (`ConfirmPanel` blocks, "Leave band", edit modal) | The two views are *deliberately* different designs (the profile view is band-themed via `getBandThemeStyles`, different sizes, `Link` vs `router.push`). A shared component would have to take a dozen styling props to stay pixel-identical, which is coupling, not reuse. A3 removes the duplicated **logic**; the markup stays per-page. |
| 22 | `login/page.tsx 112-129` ↔ `signup/page.tsx 88-105` | An email `<input>` + label. Extracting a `<FormField>` would couple the two auth pages for 18 lines of markup with no logic. Incidental similarity of a standard form field. |
| 23 | `page.tsx 154-162` ↔ `playlists/[id]/page.tsx 371-377` | Incidental: `Promise.all` + `setState` in unrelated features. |
| 24,25 | `playlists/[id]/page.tsx` self (song row as `Link` vs plain row) | Real but out of scope: a `<PlaylistSongRow>` extraction touches the largest playlist page and its drag-and-drop ordering, with no e2e coverage. Logged as a follow-up suggestion. |
| 26 | `playlists/page.tsx` self (personal vs band `PlaylistCard` list) | 12 lines of `.map()` around an already-shared `PlaylistCard`; extracting it saves nothing meaningful. |
| 28 | `songs/[id]/fast-view/page.tsx` self (drawer vs sidebar setlist item) | AGENTS.md pins the mobile bottom-sheet and desktop sidebar as *separately specified* layouts, and the class lists already differ (`ring-1 ring-emerald-400/20`, `hover:border-gray-200`). Merging them behind a variant prop risks the exact UI the directive fixes. |
| 29,30,33,34,35,36,37,38 | `__tests__/{bands,moderation,songs,spotify}.test.ts` self-clones | Arrange blocks inside tests. Explicit, redundant setup is what makes a failing test readable; hoisting it into helpers hides the fixture from the assertion. |
| 39 | `__tests__/test-helpers.ts` self (insert vs upsert branches of the Supabase-era mock query builder) | Legacy test scaffolding deliberately retained by RH-22. Refactoring the mock risks every suite that depends on it for zero product benefit. |

Two additional non-jscpd findings left alone, both recorded in the suggestions log:

- `src/components/songs/SongForm.tsx:134,562,568` has its own ad-hoc toast (`fixed bottom-4 right-4`,
  no dismiss button, different markup). Migrating it to `useToast`/`<Toast>` would **move it on
  screen**, which this behaviour-preserving task must not do.
- `src/app/settings/page.tsx:47` and `src/app/playlists/page.tsx:792` are near-copies of the alert
  banner but with different dismiss affordances (`x` glyph; a `Dismiss` text button with
  `aria-label`). Converting them to `<AlertBanner>` would change visible markup.

## Approach

Nine extractions. Each is a *move*: the moved code keeps its class strings, timings, SQL text,
parameter order and error messages. Where two copies had already drifted, the difference becomes an
explicit option with the current value passed by each caller — never a silent unification.

### A1 — `useToast` + `<Toast>` (3 sites)

New `src/lib/uiTones.ts` (pure, no React, node-testable):

```ts
export type ToastTone = 'success' | 'error' | 'warning' | 'info'
export const TOAST_TONE_CLASSES: Record<ToastTone, string> = {
  success: 'bg-emerald-950/90 text-emerald-100 border-emerald-800',
  error:   'bg-red-950/90 text-red-100 border-red-800',
  warning: 'bg-amber-950/90 text-amber-100 border-amber-800',
  info:    'bg-gray-900/90 text-white border-gray-700',
}
```

(the four toast strings are copied verbatim from `fast-view/page.tsx:1592-1599`.)

`uiTones.ts` holds the **toast** tones only. The alert-banner tone strings deliberately do **not**
live here — see the rationale in A4.

New `src/hooks/useToast.ts` — public contract:

```ts
export function useToast(): {
  toast: { message: string; tone: ToastTone } | null
  showToast: (message: string, tone?: ToastTone) => void   // default 'info'
  dismissToast: () => void
}
```

It owns exactly today's auto-dismiss behaviour — same 4000 ms timing, same cleanup — but is written so
that the literal string the three pages share today (`setTimeout(() => setToast(null), 4000)`) does
**not** survive anywhere in `src`, which is what ER10's second grep asserts. Write it exactly like
this:

```ts
const TOAST_DISMISS_MS = 4000   // module-local, not exported (knip)

export function useToast() {
  const [toast, setToastState] = useState<{ message: string; tone: ToastTone } | null>(null)
  const dismissToast = useCallback(() => setToastState(null), [])
  const showToast = useCallback(
    (message: string, tone: ToastTone = 'info') => setToastState({ message, tone }),
    [],
  )
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(dismissToast, TOAST_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [toast, dismissToast])
  return { toast, showToast, dismissToast }
}
```

The state setter is named `setToastState` and the timer callback is the named `dismissToast`
callback precisely so that `grep -rn "setTimeout(() => setToast(null), 4000)" src` returns **0**
lines after the sweep (ER10). The observable behaviour is unchanged: a toast still clears itself
4000 ms after it is set, and the timer is still cleared when the toast changes or the component
unmounts.

New `src/components/ui/Toast.tsx` (`"use client"`), purely presentational, rendering byte-identical
markup:

```tsx
<div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[90%] mx-auto pointer-events-auto">
  <div className={`rounded-xl px-4 py-3 shadow-xl border flex items-center justify-between gap-3 text-xs font-semibold backdrop-blur-md ${TOAST_TONE_CLASSES[tone]}`}>
    <span>{message}</span>
    <button onClick={onDismiss} className="text-white/70 hover:text-white text-sm font-bold shrink-0">✕</button>
  </div>
</div>
```

Call-site tones must reproduce today's colours exactly:

| call site | today | after |
|---|---|---|
| `bands/[id]/page.tsx` (`showToast(msg)`, always emerald) | hard-coded emerald | `showToast(msg, 'success')` at both call sites (lines 124, 259) |
| `profile/page.tsx` `BandProfileView` (`type` defaults to `success`) | red / emerald | `showToast(msg, 'success')` at line 245 |
| `songs/[id]/fast-view/page.tsx` (`type` defaults to `'info'`) | 4 tones | each existing `showToast(msg, 'x')` call keeps its literal; the two calls that pass nothing keep the `'info'` default |

### A2 — Spotify playlist import/sync helpers (3 route files)

New `src/lib/spotifyPlaylistSync.ts`, moved verbatim out of
`api/spotify/playlists/[id]/import/route.ts` (the canonical copy):

- `export interface SpotifyRawTrack` (`spotifyTrackId, title, artist, album, albumArt, spotifyUrl, durationSeconds`)
- `export async function fetchAllSpotifyTracks(playlistId, accessToken): Promise<SpotifyRawTrack[]>`
- `export async function findOrCreateGlobalSong(track): Promise<string>`
- `export async function ensureInRepertoire(songId, owner: { userId?: string; bandId?: string }): Promise<void>`
- `export function buildPlaylistSongsInsert(playlistId: string, songIds: string[]): { sql: string; values: unknown[] }`
  — the `($1, $2, $3), ($4, $5, $6) …` builder that `import/route.ts:264-277` and
  `sync/route.ts:249-262` both hand-roll; positions stay `i + 1`, the statement text stays
  `INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES …`. Pure and node-testable;
  it also removes two `// eslint-disable-next-line @typescript-eslint/no-explicit-any` lines.

`tracks/route.ts` drops its own `fetchAllTracks`/`SpotifyTracksPage` and calls the shared one, then
maps to its **existing** response shape so the JSON payload is unchanged:
`{ tracks: raw.map(({ spotifyTrackId, title, artist, album, albumArt, spotifyUrl }) => ({ … })) }`
— `durationSeconds` must NOT be added to that payload. The only behavioural delta in the whole of A2
is that the thrown text on a failed page fetch becomes `Spotify tracks fetch failed: ${status}`
instead of `… ${status} ${statusText}`; that string never reaches a client (the route returns the
fixed `'Failed to fetch playlist tracks'` R1 message) and only changes one `logger.error` payload.
Call it out in the PR description.

### A3 — `useBandAdmin` (2 sites, already drifted)

New `src/hooks/useBandAdmin.ts` holding the band-detail controller logic that
`app/bands/[id]/page.tsx:37-291` and `app/profile/page.tsx:45-271` (`BandProfileView`) duplicate:

```ts
export function useBandAdmin(options: {
  bandId: string
  showToast: (message: string, tone?: ToastTone) => void
  onNotFound: () => void          // bands page: router.replace('/bands'); profile: setError('Band not found.')
  loadPolicy: BandAdminLoadPolicy // see "load() semantics" below — required, no default
  onGone: () => void              // after delete/leave succeed — both pages: router.replace('/bands')
  onNavigateToPlaylist: (id: string) => void   // both pages: router.push(`/playlists/${id}`)
  messages?: { save?: string; load?: string }  // 'Failed to save' | 'Failed to save band profile'
})
```

#### `load()` semantics — the one place the two copies really differ

`loading` and `error` become hook-owned state, so the hook must reproduce **both** of today's load
behaviours rather than pick one. The two copies differ in exactly two decisions, and each becomes a
required option value — never a default, so neither page can inherit the other's behaviour by
omission. This is the same "explicit option with the current value passed by each caller" rule the
rest of A3 follows; **no** load behaviour is unified, and no named delta is accepted here.

New pure module `src/lib/bandAdminLoad.ts` (no React import, node-testable — this is what pins the
divergence mechanically):

```ts
export interface BandAdminLoadPolicy {
  /** true → load() wraps everything in try/catch/finally; false → a rejection propagates unhandled. */
  catchLoadErrors: boolean
  /** true → the not-found branch calls setLoading(false) before returning; false → it does not. */
  clearLoadingOnNotFound: boolean
}
export const BANDS_PAGE_LOAD_POLICY: BandAdminLoadPolicy =
  { catchLoadErrors: false, clearLoadingOnNotFound: false }
export const BAND_PROFILE_LOAD_POLICY: BandAdminLoadPolicy =
  { catchLoadErrors: true,  clearLoadingOnNotFound: true }
/** Reproduces profile/page.tsx:100 exactly: an Error contributes its message, anything else the fallback. */
export function resolveLoadErrorMessage(err: unknown, fallback: string): string
```

The hook's `load` is then, literally:

```ts
const runLoad = async () => {
  const [bandData, playlistData] = await Promise.all([
    getBandWithMembers(bandId),
    getBandPlaylists(bandId),
  ])
  if (!bandData) {
    onNotFound()
    if (loadPolicy.clearLoadingOnNotFound) setLoading(false)
    return
  }
  setBand(bandData)
  setPlaylists(playlistData)
  setLoading(false)
}

const load = useCallback(async () => {
  if (!loadPolicy.catchLoadErrors) { await runLoad(); return }   // rejection escapes, as today
  try { await runLoad() }
  catch (err) { setError(resolveLoadErrorMessage(err, messages?.load ?? 'Failed to load band profile')) }
  finally { setLoading(false) }
}, [...])
```

Note that the success path ends in `setLoading(false)` for both pages, so hoisting it out of the
`finally` changes nothing on the happy path — the profile view's `finally` only ever *adds*
`setLoading(false)` on the catch and not-found branches, and both of those are covered above.

Per-page option values (these are the current, observable behaviours and must not move):

| option | `app/bands/[id]/page.tsx` | `app/profile/page.tsx` (`BandProfileView`) |
|---|---|---|
| `loadPolicy` | `BANDS_PAGE_LOAD_POLICY` | `BAND_PROFILE_LOAD_POLICY` |
| `catchLoadErrors` | `false` — today's `load` (lines 82–96) has **no** `try/catch`; a failing `getBandWithMembers` rejects unhandled, `error` is never set and `loading` stays `true` | `true` — today's `load` (lines 84–104) wraps everything, setting `error` from the rejection |
| `clearLoadingOnNotFound` | `false` — `router.replace('/bands')` and `return`, still `loading`, so the page keeps rendering `Loading...` (line 296) until the navigation lands; it must **not** fall through to `if (!band) return null` (line 301) and blank the screen | `true` — `setError('Band not found.'); setLoading(false)` so the view can reach `if (!band)` (line 281) and render `Band not found or inaccessible.` (line 284) |
| `onNotFound` | `() => router.replace('/bands')` | `() => setError('Band not found.')` |
| `messages.load` | **not passed** (unreachable: with `catchLoadErrors: false` there is no catch branch to read it) | `'Failed to load band profile'` — the fallback for a non-`Error` rejection, exactly today's literal at `profile/page.tsx:100` |
| `messages.save` | `'Failed to save'` | `'Failed to save band profile'` |

Consequences that this pins down, and that a reviewer/QA can check: the bands page's `{error && …}`
banner must **not** start showing load failures it has never shown, and the bands page must **not**
render a blank screen during `router.replace('/bands')`; the profile view's
`Band not found or inaccessible.` state must still render.

Returns the whole state bag both pages already declare (`band`, `setBand`, `playlists`, `loading`,
`error`, `setError`, `editing`, `editName`, `setEditName`, `editDesc`, `setEditDesc`,
`editCoverPreview`, `editColor`, `setEditColor`, `saving`, `copied`, `showNewPlaylist`,
`setShowNewPlaylist`, `newPlaylistName`, `setNewPlaylistName`, `creatingPlaylist`, `pendingAction`,
`setPendingAction`, `actionBusy`, `currentMember`, `isAdmin`, `inviteUrl`) plus the handlers
(`handleCopyInvite`, `openEdit`, `handleEditCoverChange`, `handleSaveEdit`, `handleDelete`,
`handleLeave`, `handleRemoveMember`, `confirmPendingAction`, `handleCreatePlaylist`). The
`PendingAction` union moves into the hook and is re-exported.

Behaviour that must be preserved exactly:

- Error strings per site via `messages` (`'Failed to save'` vs `'Failed to save band profile'`);
  every other message (`'Failed to delete band'`, `'Failed to leave band'`, `'Failed to remove
  member'`, `'Failed to create playlist'`) is already identical and becomes a constant.
- The member-removed toast text stays
  `` `${member.profile?.full_name ?? 'This member'} removed from the band.` `` and stays
  `'success'`-toned.
- Delete/leave still call `setPendingAction(null)` **before** navigating, and still fire no toast
  (keep the existing comment: navigation is the feedback).
- `handleCopyInvite` keeps its 2000 ms `copied` reset; `inviteUrl` keeps the
  `typeof window !== 'undefined'` guard.
- The two `load()` behaviours, exactly as tabulated above: whether `load` catches, and whether the
  not-found branch clears `loading`. Both are required options, both are pinned by ER21.
- The load effect carries the existing
  `// eslint-disable-next-line react-hooks/set-state-in-effect` comment with it (this is why the
  ESLint **error** count may drop from 13 to 12 — see ER4).
- **No JSX moves.** Both pages keep their own markup verbatim; only the `const [...] = useState(...)`
  block and the handler bodies are replaced by the hook call.

The band page keeps its single-site invite-regeneration state (`confirmingRegenerate`,
`regenerating`, `handleRegenerateInvite`) — one site, not duplication.

### A4 — `<AlertBanner>` (5 usages)

New `src/components/ui/AlertBanner.tsx` (`"use client"`), props `{ tone: 'error' | 'success';
message: string; onDismiss: () => void; className?: string }`.

The tone strings are a **module-local, non-exported** const declared inside `AlertBanner.tsx`
itself — not in `src/lib/uiTones.ts`, and not re-asserted in any test file:

```tsx
type AlertTone = 'error' | 'success'
const ALERT_TONES: Record<AlertTone, { role: string; panel: string; text: string; button: string }> = {
  error: {
    role: 'alert',
    panel: 'rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-center justify-between gap-3',
    text: 'text-sm text-red-700',
    button: 'text-red-400 hover:text-red-600 text-xs focus:outline-none',
  },
  success: {
    role: 'status',
    panel: 'rounded-lg border border-green-200 bg-green-50 px-4 py-3 flex items-center justify-between gap-3',
    text: 'text-sm text-green-700',
    button: 'text-green-500 hover:text-green-700 text-xs focus:outline-none',
  },
}
```

(both bundles copied verbatim from `admin/moderation/page.tsx:139-173`.) The component renders
`<div role={t.role} className={…}><p className={t.text}>{message}</p><button className={t.button}>✕</button></div>`,
byte-identical to today's markup.

**Why local and untested-by-string.** ER11's gate is a `grep` count over `src`, and it only stays
exact if each alert class literal occurs in exactly one file that the gate names. Putting the
bundles in `src/lib/uiTones.ts` would move the literal out of `AlertBanner.tsx` (grep hits
`uiTones.ts` instead), and asserting the literal in `src/lib/__tests__/uiTones.test.ts` would add a
second hit. Both would break the count while proving nothing extra: the grep itself is the
mechanical guard that these exact strings survive the extraction and appear once. The toast tones
are different — their strings are consumed by a component whose own container class is what ER10
counts, so they can stay in `uiTones.ts` and be asserted in the unit test without collision.

Converted: `app/admin/moderation/page.tsx` (error + success), `app/profile/page.tsx`
`BandProfileView` error (line 295) and `PersonalProfileView` error + success (lines 759, 774).
`settings/page.tsx` and `playlists/page.tsx` are **not** converted (different dismiss affordance —
see (B)).

### A5 — `buildUpdateSet` (2 sites)

New `src/lib/sqlUpdate.ts` (pure, node-testable):

```ts
export function buildUpdateSet(
  data: Record<string, unknown>,
  columns: readonly string[],
  startIndex = 1,
): { setClauses: string[]; values: unknown[]; nextIndex: number }
```

For each column *in the given order*, when `data[column] !== undefined`, push `` `${column} = $${i++}` ``
and the value. Used by `lib/bands.ts#updateBand` with `['name','description','cover_url','color']`
and `lib/playlists.ts#updatePlaylist` with `['name','description','sync_with_spotify','tags']`, so
the generated SQL text and parameter order are byte-identical to today. Each caller keeps its own
tail: both append `updated_at = now()`, **only `updatePlaylist`** keeps its
`if (setClauses.length === 1) return // Only updated_at` guard, and both keep their own
`WHERE id = $${nextIndex}` and `L1` catch. Removes two more `no-explicit-any` disables.

### A6 — Spotify route auth prologue (3 sites)

New `src/lib/spotifyRouteAuth.ts`:

```ts
export type SpotifyRouteAccess =
  | { ok: true; userId: string; accessToken: string }
  | { ok: false; response: NextResponse }

export async function resolveSpotifyRouteAccess(): Promise<SpotifyRouteAccess>
```

Same two 401 bodies as today, verbatim: `{ error: 'Unauthorized', code: 401 }` and
`{ error: 'Spotify not connected', code: 401 }`. Each of the three routes becomes
`const access = await resolveSpotifyRouteAccess(); if (!access.ok) return access.response`.
`api/spotify/playlists/route.ts` is untouched (it answers `{ connected: false }`).

### A7 — shared source-tree scanner for the two guard tests

The two guard tests duplicate **two** blocks, and A7 must remove both — clone #31
(`errorHandlingStyle 46-65` ↔ `noBrowserDialogs 45-64`: `stripComments` + `listSourceFiles`) **and**
clone #32 (`errorHandlingStyle 95-105` ↔ `noBrowserDialogs 93-103`: the scan loop inside
`describe('src/ tree')`, identical in both files except the `it(...)` title and the regex
identifier). Moving only the two functions kills #31 and leaves #32, which would fail ER8 — measured:
with just that move, jscpd still reports 1 clone (11 lines / 75 tokens) between the two files. So the
**scan loop is shared too**.

**Added to `src/lib/__tests__/test-helpers.ts`** (which gains `import fs from 'fs'` and
`import path from 'path'`; its existing Supabase-era mock content is untouched — clone #39 stays as
classified in (B)):

```ts
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const SRC_DIR = path.join(REPO_ROOT, 'src')

/** Removes `//` line comments and block comments; block comments are blanked so
 *  line numbers are preserved. */
export function stripComments(source: string): string

/** Recursively lists every `.ts`/`.tsx` file under `dir`. Module-local: only
 *  `findViolations` uses it, and an exported-but-unimported symbol risks knip. */
function listSourceFiles(dir: string): string[]

/** One line of `src/` that matched a guard pattern. Module-local for the same
 *  knip reason; it is only referenced in `findViolations`'s return type. */
interface SourceViolation {
  /** Repo-relative, `/`-separated path, e.g. `src/lib/db.ts`. */
  file: string
  /** 1-based line number within that file. */
  line: number
  /** The offending line, trimmed. */
  text: string
}

/** Scans every `.ts`/`.tsx` file under `src/` with comments stripped, one entry
 *  per line matching `pattern`. `options.skip` is a repo-relative path excluded
 *  from the scan — each guard test passes its own path. */
export function findViolations(
  pattern: RegExp,
  options: { skip?: string } = {},
): SourceViolation[]

/** Renders violations as `path:line — text`, the guard tests' message format. */
export function formatViolations(violations: SourceViolation[]): string[]
```

`stripComments` and `listSourceFiles` are the current bodies, moved verbatim. `findViolations` is
the current loop, moved verbatim except that the skip comparison and the relative path are computed
inside it:

```ts
const violations: SourceViolation[] = []
for (const full of listSourceFiles(SRC_DIR)) {
  const file = path.relative(REPO_ROOT, full).split(path.sep).join('/')
  if (file === options.skip) continue
  stripComments(fs.readFileSync(full, 'utf8'))
    .split('\n')
    .forEach((line, index) => {
      if (pattern.test(line)) {
        violations.push({ file, line: index + 1, text: line.trim() })
      }
    })
}
return violations
```

`formatViolations` is one line:

```ts
return violations.map((v) => `${v.file}:${v.line} — ${v.text}`)
```

— the exact string shape today's loop pushes (`src/lib/db.ts:42 — offending text`), so **both
failure messages stay byte-identical**.

**Resulting guard-test files.** Each keeps its header comment, its `ANY_TYPED_CATCH` /
`DIALOG_CALL` regex, its exported detector (`findAnyTypedCatches` / `findBrowserDialogCalls`, now
calling the imported `stripComments`), and its whole `describe('…(detector)')` block unchanged. Each
drops `import fs`/`import path`, `REPO_ROOT` and `SRC_DIR`, and redefines `SELF` as the
repo-relative string the new `skip` option takes:

```ts
import { describe, it, expect } from 'vitest'
import { stripComments, findViolations, formatViolations } from './test-helpers'

const SELF = 'src/lib/__tests__/errorHandlingStyle.test.ts'   // resp. noBrowserDialogs.test.ts
```

`describe('src/ tree')` becomes, in `errorHandlingStyle.test.ts`:

```ts
describe('src/ tree', () => {
  it('contains no `any`-typed catch bindings', () => {
    const violations = formatViolations(findViolations(ANY_TYPED_CATCH, { skip: SELF }))

    expect(
      violations,
      `\`any\`-typed catch bindings are forbidden (see AGENTS.md, ` +
        `"Error Handling Conventions"). Narrow the error instead — ` +
        `\`error instanceof Error ? error : new Error(String(error))\`, or a ` +
        `scoped \`(err as { code?: string })\` when only a Postgres code is ` +
        `needed. Offending locations:\n` +
        violations.join('\n'),
    ).toEqual([])
  })
})
```

and in `noBrowserDialogs.test.ts`:

```ts
describe('src/ tree', () => {
  it('contains no native browser dialog calls', () => {
    const violations = formatViolations(findViolations(DIALOG_CALL, { skip: SELF }))

    expect(
      violations,
      `Native browser dialogs are forbidden (see AGENTS.md). Use an in-page ` +
        `confirmation panel plus a Toast instead. Offending locations:\n` +
        violations.join('\n'),
    ).toEqual([])
  })
})
```

The longest run of identical lines left between the two files is 4 (`violations.join('\n'),` and the
three closers), well under the 8-line floor, because the differing failure-message literal splits it.

**Measured, not assumed.** Copies of the three post-change files (extended `test-helpers.ts` plus
both rewritten guard tests) were placed in an isolated directory and scanned with
`npx jscpd@5.1.2 . --min-tokens 50 --min-lines 8`:

| tree | clones between the two guard tests | other clones |
|---|---|---|
| `fe300d4` originals | **2** — #31 (20 lines / 118 tokens), #32 (11 lines / 75 tokens) | 1: `test-helpers.ts` self, `[89:42-100:22] ↔ [113:42-124:22]` (clone #39, **(B) leave**) |
| after A7 as specified above | **0** | 1: the same `test-helpers.ts` self-clone, unmoved (the appended scanner introduces no new clone) |

So ER8's `errorHandlingStyle ↔ noBrowserDialogs` term reaches 0 and ER7's ceilings are untouched —
A7 now removes 31 duplicated lines instead of 20, which can only lower the totals.

Constraints that survive the move:

- `noBrowserDialogs.test.ts` documents that the banned identifiers never appear next to `(` inside
  it — the new `SELF` literal and the `DIALOG_CALL` regex keep that true, and `test-helpers.ts`
  itself contains no banned pattern (`pattern.test(line)` is generic) and no `catch (x: any)`, so
  neither suite gains a violation. Verified by running the post-change `findViolations` over the real
  `src/` tree (97 files): both patterns return `[]`, with and without `skip`.
- Both tests keep skipping themselves, keep every assertion they make today, and keep both failure
  messages character-for-character. ER15 must still pass.

### A8 — `SongUpdateInput` type (2 sites)

`src/lib/songs.ts` exports `export interface SongUpdateInput { title; artist; album?; key; status;
tags; links; cover_url?; duration_seconds? }` (the literal already written twice, field-for-field)
and uses it in `updateSong`; `src/app/actions/repertoire.ts#updateSongAction` imports it as its
`data` parameter type. `import type` only — no runtime import is added to the `'use server'` file.

### A9 — `fetchOembedTitle` (3 uses inside `linkFetcher.ts`)

New module-private helper in `src/lib/linkFetcher.ts`:

```ts
async function fetchOembedTitle(endpoint: string, headers: Record<string, string>): Promise<string | null>
```

`fetch(endpoint, { headers, signal: AbortSignal.timeout(4000) })` → on `res.ok`, parse
`{ title?: string }` and return `data.title.trim()` when non-empty, else `null`; a thrown fetch is
swallowed with an `S1` comment ("oEmbed is best-effort — the caller falls through"). Used for the
YouTube oEmbed, noembed and Spotify oEmbed strategies; each call site keeps its own one-line comment
saying what it falls through to. The generic HTML `<title>` strategy is not touched.

Export it (`export async function`) only if the new unit tests need it directly; if it stays
module-private, test it through `fetchUrlTitle` with `vi.stubGlobal('fetch', …)` so `knip` stays
clean (an exported-but-unimported symbol would fail `npm run lint:dead`).

### New unit tests (vitest, `node` env — pure logic only)

- `src/lib/__tests__/uiTones.test.ts` — five tests: one per toast tone asserting
  `TOAST_TONE_CLASSES[tone]` is exactly the string listed in A1, plus one asserting the record's keys
  are exactly `['success','error','warning','info']` (guards the "UI-identical" promise
  mechanically). It must **not** contain the alert class strings — those are guarded by ER11's grep
  count, which a second copy in a test file would break (see A4).
- `src/lib/__tests__/bandAdminLoad.test.ts` — at least **three** tests, and specifically all four of
  these assertions:
  1. `BANDS_PAGE_LOAD_POLICY` deep-equals `{ catchLoadErrors: false, clearLoadingOnNotFound: false }`;
  2. `BAND_PROFILE_LOAD_POLICY` deep-equals `{ catchLoadErrors: true, clearLoadingOnNotFound: true }`;
  3. a dedicated test asserting the two policy constants are **not** equal to each other —
     `expect(BANDS_PAGE_LOAD_POLICY).not.toEqual(BAND_PROFILE_LOAD_POLICY)` — so that collapsing the
     two divergent load behaviours into one shared policy fails the suite even if someone edits both
     deep-equal expectations to match;
  4. `resolveLoadErrorMessage(new Error('boom'), 'fallback') === 'boom'` and
     `resolveLoadErrorMessage('boom', 'fallback') === 'fallback'`.
- `src/lib/__tests__/sqlUpdate.test.ts` — order preserved; `undefined` skipped; numbering contiguous
  from `startIndex`; `nextIndex` correct; empty input → `{ setClauses: [], values: [], nextIndex: startIndex }`.
- `src/lib/__tests__/spotifyPlaylistSync.test.ts` — with `vi.mock('@/lib/db', () => ({ query: vi.fn() }))`
  and `vi.stubGlobal('fetch', …)`: `fetchAllSpotifyTracks` follows `page.next` across two pages,
  skips `null` tracks, and converts `duration_ms` to whole seconds; `findOrCreateGlobalSong` returns
  the existing id and appends the Spotify link only when absent, and inserts the *sanitized* title
  for a new song; `ensureInRepertoire` inserts for every band member and swallows a `23505` error
  while re-throwing any other code; `buildPlaylistSongsInsert` numbers `($1, $2, $3), ($4, $5, $6)`
  and assigns positions `1..n`.
- `src/lib/__tests__/linkFetcher.test.ts` — add oEmbed cases: a YouTube URL resolves via the oEmbed
  title; a failing oEmbed response falls through to noembed; a blank title is treated as a miss.

### Duplication gate

`.jscpd.json` at the repo root:

```json
{
  "path": ["src"],
  "minTokens": 50,
  "minLines": 8,
  "threshold": 2,
  "reporters": ["console"],
  "ignore": ["**/node_modules/**"]
}
```

`package.json`: `"lint:dup": "jscpd"`, with `jscpd@5.1.2` installed as a devDependency through
`npm install --save-dev` (so `package-lock.json` is updated in the same commit). `knip` resolves the
binary from the script, so the dependency stays "used" and `npm run lint:dead` keeps exiting 0.

`.github/workflows/ci.yml`: a `duplication` job named `"Duplication (jscpd)"`, copied from the
existing `dead-code` job (checkout → setup-node 24.x with npm cache → `npm ci` → `npm run lint:dup`).

Threshold rationale: the post-sweep duplicated-lines percentage lands near **1.3 %** (ER7 caps it at
2.20 % of tokens / 1.80 % of lines, well above that landing point);
`threshold: 2` fails the build on a real regression while tolerating normal churn.

### Verification runs the implementer owes

Beyond the unit suites above, the sweep must be checked end to end before it lands, because none of
the extracted UI is unit-tested (the vitest environment is `node`):

- `npx next build && npx next start`, then `npx playwright test e2e/bands-confirm.spec.ts` — the
  existing 3-test suite exercises the bands page confirmation flow that A1/A3 rewire, and it must
  report 3 passed / 0 failed (ER18). Run it against the production build: the dev-mode SSR 500 on
  `GET /` is a known unrelated issue (RH-32) and is out of scope here.
- The jscpd JSON report from ER7/ER8 must be produced and read, not assumed — ER8 names the exact
  clone pairs that have to disappear, and a sweep that hits the totals while leaving one of those
  pairs behind has not done the job.

### Version bump

`package.json` version must go **up** from the highest ever used, `0.1.63-202609030716`:
`0.1.64-YYYYMMDDHHmm` with the local-timezone timestamp of the commit.

## Expected Results

This section is the task's `expected_results`, reproduced verbatim and in the persisted order. The
Meridian task and this file carry the identical 21 items; QA receives only this list and nothing
else from this spec, so each item is self-contained and mechanically checkable. Every in-prose
`ER<n>` reference elsewhere in this document uses this numbering.

ER1 - The ten new files exist and are non-empty on the post-change tree: src/lib/uiTones.ts, src/lib/sqlUpdate.ts, src/lib/spotifyPlaylistSync.ts, src/lib/spotifyRouteAuth.ts, src/lib/bandAdminLoad.ts, src/hooks/useToast.ts, src/hooks/useBandAdmin.ts, src/components/ui/Toast.tsx, src/components/ui/AlertBanner.tsx, .jscpd.json. Verify from the repo root with: ls -l src/lib/uiTones.ts src/lib/sqlUpdate.ts src/lib/spotifyPlaylistSync.ts src/lib/spotifyRouteAuth.ts src/lib/bandAdminLoad.ts src/hooks/useToast.ts src/hooks/useBandAdmin.ts src/components/ui/Toast.tsx src/components/ui/AlertBanner.tsx .jscpd.json

ER2 - Scope whitelist: git diff --name-only fe300d4 lists only paths from this set and nothing else - .jscpd.json, .github/workflows/ci.yml, AGENTS.md, package.json, package-lock.json, docs/suggestions-log.md, docs/tasks/RH-23-spec.md, anything under .meridian/, src/hooks/useToast.ts, src/hooks/useBandAdmin.ts, src/components/ui/Toast.tsx, src/components/ui/AlertBanner.tsx, src/lib/uiTones.ts, src/lib/sqlUpdate.ts, src/lib/spotifyPlaylistSync.ts, src/lib/spotifyRouteAuth.ts, src/lib/bandAdminLoad.ts, src/lib/bands.ts, src/lib/playlists.ts, src/lib/songs.ts, src/lib/linkFetcher.ts, src/lib/__tests__/uiTones.test.ts, src/lib/__tests__/sqlUpdate.test.ts, src/lib/__tests__/spotifyPlaylistSync.test.ts, src/lib/__tests__/bandAdminLoad.test.ts, src/lib/__tests__/linkFetcher.test.ts, src/lib/__tests__/test-helpers.ts, src/lib/__tests__/errorHandlingStyle.test.ts, src/lib/__tests__/noBrowserDialogs.test.ts, src/app/actions/repertoire.ts, src/app/api/spotify/playlists/[id]/import/route.ts, src/app/api/spotify/playlists/[id]/sync/route.ts, src/app/api/spotify/playlists/[id]/tracks/route.ts, src/app/bands/[id]/page.tsx, src/app/profile/page.tsx, src/app/songs/[id]/fast-view/page.tsx, src/app/admin/moderation/page.tsx

ER3 - npx vitest run exits 0 and its summary reports at least 29 test files and at least 263 tests, with 0 failed (baseline at fe300d4: 25 files / 249 tests passed)

ER4 - npx eslint . final line is 'N problems (E errors, W warnings)' with E at most 13 and W at most 19 (baseline at fe300d4: 13 errors, 19 warnings, all pre-existing; E may legitimately fall to 12 because the band load effect and its eslint-disable comment move into src/hooks/useBandAdmin.ts). ESLint is NOT required to exit 0.

ER5 - npx tsc --noEmit exits 0 and prints no output (no errors reported), and npm run lint:dead (knip) exits 0 with no unused files, exports or dependencies reported

ER6 - npx next build exits 0

ER7 - Running npx jscpd@5.1.2 src --min-tokens 50 --min-lines 8 --reporters json --output /tmp/rh23-jscpd and then node -e "console.log(require('/tmp/rh23-jscpd/jscpd-report.json').statistics.total)" reports clones at most 20, duplicatedLines at most 300, percentage at most 1.80, percentageTokens at most 2.20 (baseline at fe300d4: clones 41, duplicatedLines 747, percentage 3.77, percentageTokens 4.05)

ER8 - In that same jscpd JSON report, listing each clone's two file paths shows: 0 clones between any two of src/app/api/spotify/playlists/[id]/{import,sync,tracks}/route.ts (was 6), 0 clones naming src/app/admin/moderation/page.tsx (was 2), 0 clones naming src/app/actions/repertoire.ts (was 1), 0 clones between src/lib/bands.ts and src/lib/playlists.ts (was 1), 0 clones naming src/lib/linkFetcher.ts (was 1), 0 clones between src/lib/__tests__/errorHandlingStyle.test.ts and src/lib/__tests__/noBrowserDialogs.test.ts (was 2), 0 clones with src/app/profile/page.tsx on both sides (was 1), and at most 4 clones naming both src/app/bands/[id]/page.tsx and src/app/profile/page.tsx (was 12)

ER9 - npm run lint:dup exits 0; package.json contains a "lint:dup" script and jscpd 5.1.2 in devDependencies; package-lock.json contains jscpd; .jscpd.json contains "minTokens": 50, "minLines": 8 and "threshold": 2; .github/workflows/ci.yml contains a job whose name is "Duplication (jscpd)" and which runs npm run lint:dup

ER10 - Toast markup exists in exactly one place: grep -rn "fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-sm" src returns exactly 1 line, in src/components/ui/Toast.tsx (was 3 lines, in bands/[id]/page.tsx, profile/page.tsx and songs/[id]/fast-view/page.tsx); grep -rn "setTimeout(() => setToast(null), 4000)" src returns 0 lines; and grep -rl "useToast" src/app returns exactly src/app/bands/[id]/page.tsx, src/app/profile/page.tsx and src/app/songs/[id]/fast-view/page.tsx

ER11 - Alert-banner markup is single-sourced in the component that renders it: grep -rn "border-red-200 bg-red-50 px-4 py-3 flex items-center justify-between" src returns exactly 3 lines - src/components/ui/AlertBanner.tsx, src/app/settings/page.tsx and src/app/playlists/page.tsx (the two deliberately-unconverted sites) and no line in src/app/admin/moderation/page.tsx or src/app/profile/page.tsx (was 5 lines); grep -rn "border-green-200 bg-green-50 px-4 py-3 flex items-center justify-between" src returns exactly 1 line, in src/components/ui/AlertBanner.tsx (was 2). The alert tone strings are a module-local const inside AlertBanner.tsx: grep -rn "border-red-200 bg-red-50\|border-green-200 bg-green-50" src/lib returns 0 lines (they are NOT in src/lib/uiTones.ts and NOT copied into any test file).

ER12 - Spotify helpers are defined exactly once: grep -rn "function fetchAllSpotifyTracks\|function fetchAllTracks\|function findOrCreateGlobalSong\|function ensureInRepertoire" src returns exactly 3 lines, all in src/lib/spotifyPlaylistSync.ts (baseline at fe300d4: 7 lines - 3 in import/route.ts, 3 in sync/route.ts, 1 in tracks/route.ts)

ER13 - Band mutations run only through the shared hook: grep -rn "deleteBandAction\|leaveBandAction\|removeBandMemberAction" src returns lines only in src/app/actions/bands.ts (definitions) and src/hooks/useBandAdmin.ts, and 0 lines in src/app/bands/[id]/page.tsx and src/app/profile/page.tsx (each of those two files had 3)

ER14 - Landing copy untouched: git diff --stat fe300d4 -- src/components/landing src/i18n/dictionaries/en.json src/i18n/dictionaries/pt-BR.json prints nothing (this task is an internal refactor and is explicitly not a selling point)

ER15 - Guard tests still pass on the refactored files: npx vitest run src/lib/__tests__/noBrowserDialogs.test.ts src/lib/__tests__/errorHandlingStyle.test.ts exits 0 with 0 failed, and grep -rn "catch (\w*: any" src returns 0 lines

ER16 - The Spotify tracks endpoint payload is unchanged: src/app/api/spotify/playlists/[id]/tracks/route.ts still returns NextResponse.json({ tracks }) and grep -c durationSeconds src/app/api/spotify/playlists/[id]/tracks/route.ts returns 0

ER17 - New unit tests exist and pass: npx vitest run src/lib/__tests__/uiTones.test.ts src/lib/__tests__/sqlUpdate.test.ts src/lib/__tests__/spotifyPlaylistSync.test.ts exits 0 with at least 12 tests and 0 failed, including a test asserting the exact toast tone class strings ("bg-emerald-950/90 text-emerald-100 border-emerald-800", "bg-red-950/90 text-red-100 border-red-800", "bg-amber-950/90 text-amber-100 border-amber-800", "bg-gray-900/90 text-white border-gray-700"), a test that buildUpdateSet skips undefined fields and numbers placeholders contiguously, and a test that ensureInRepertoire swallows Postgres error code 23505 but re-throws any other code

ER18 - UI identity end to end against a production build (dev-mode SSR 500s are a known unrelated issue, RH-32): with npx next build && npx next start running, npx playwright test e2e/bands-confirm.spec.ts reports 3 passed, 0 failed

ER19 - package.json "version" is 0.1.64-YYYYMMDDHHmm (a real local-time timestamp), which is strictly greater than the highest version used so far, 0.1.63-202609030716

ER20 - grep -n "^## \[RH-23\]" docs/suggestions-log.md returns at least 1 line, and that section records the deliberate leave-alone decisions (SongForm's own toast; the settings/ and playlists/ alert banners; the playlists song-row clones)

ER21 - The two band pages keep their different load() behaviours after the useBandAdmin extraction: src/lib/bandAdminLoad.ts exports BANDS_PAGE_LOAD_POLICY deep-equal to { catchLoadErrors: false, clearLoadingOnNotFound: false } and BAND_PROFILE_LOAD_POLICY deep-equal to { catchLoadErrors: true, clearLoadingOnNotFound: true }; npx vitest run src/lib/__tests__/bandAdminLoad.test.ts exits 0 with at least 3 tests and 0 failed, including one test asserting the two policy constants are NOT equal to each other and one asserting resolveLoadErrorMessage(new Error("boom"), "fallback") === "boom" while resolveLoadErrorMessage("boom", "fallback") === "fallback"; grep -c "BANDS_PAGE_LOAD_POLICY" "src/app/bands/[id]/page.tsx" returns at least 1 and grep -c "Failed to load band profile" "src/app/bands/[id]/page.tsx" returns 0; grep -c "BAND_PROFILE_LOAD_POLICY" src/app/profile/page.tsx returns at least 1 and grep -c "Failed to load band profile" src/app/profile/page.tsx returns at least 1

## Out of Scope

- The 19 **(B)** clones above, and the two non-jscpd findings (SongForm's own toast; the `settings`
  and `playlists` alert banners) — each is deliberate, and each is recorded in
  `docs/suggestions-log.md` as a candidate follow-up.
- Any change to `src/app/playlists/**` beyond nothing (the file is not in the whitelist).
- Fixing pre-existing ESLint errors/warnings, the `set-state-in-effect` errors in
  `reset-password`, `settings`, `LandingPage`, `AppLayout`, `LanguageSelector`, or the SSR-500 on
  `GET /` under `next dev` (RH-32).
- Adding rendering-library tests: the vitest environment is `node` and installing jsdom /
  Testing Library is a separate decision.

# RH-80 — Serve the Fast View from the snapshot offline and prove cold start end to end

> **Filename mapping.** This is the spec for board task **RH-80**, written to
> `docs/tasks/RH-81-spec.md`. In this repository the spec filename runs one
> ahead of the board id: `docs/tasks/RH-80-spec.md` is RH-79's spec, and RH-79's
> shipped source comments already point at it. The mapping is stated here so a
> later reader does not chase a missing file.

Parent: **RH-28**. Part 3 of 3, after RH-78 (`56db96f`, the PWA shell) and
RH-79 (`b34810a`, the snapshot and the download). Design authority:
`docs/superpowers/specs/2026-09-20-offline-mode-design.md`.

Measured at HEAD `b34810a`.

## Scope

This task is the **read path**: the Fast View, served from an RH-79 snapshot
when the network is gone, proven by a cold start in Playwright.

It covers:

1. `src/lib/offlineFirst.ts` — one generic decorator over an injected action
   bundle, returning the same interface and answering from the snapshot store.
2. Wrapping the Fast View's seven bundles in **one** new composition-root file.
3. One runtime route in `src/app/sw.ts` so a cached tab PDF is readable
   offline through its own same-origin cache key.
4. The four offline UI states in the Fast View: a read-only banner, two
   disabled edit controls, an explicit "not downloaded" empty state, and an
   offline panel in `TabViewer` in place of the unreachable gview iframe.
5. `e2e/offline-mode.spec.ts` — the acceptance test.
6. The landing-page selling point (AGENTS.md "Landing Page Rule").

It does **not** cover: a write queue, background sync, offline support for any
route other than `/songs/[id]/fast-view`, change detection or staleness
prompts, any change to the RH-79 snapshot shape or store interface, and any
change to the download control or `/settings` aggregate view.

## Approach

### 1. The inherited contract (do not re-open)

Settled in RH-79's review and already implemented:

- `OfflineTabSnapshot.createdAt` is mandatory and `offlineTabToRepertoireTab`
  produces a `RepertoireTab`; `mergeTabs` sorts on `created_at`, so offline tab
  order equals online order for free.
- Personal-repertoire tabs are **not** captured. `getPersonalEntryForSong` must
  answer `null` offline, which makes `shouldLoadPersonalEntry`
  (`src/lib/songEntry.ts:45-50`) leave the second `getTabs` unfired
  (`src/hooks/useTabLibrary.ts:87`).
- `new Set(snapshot.songs.map(s => s.repertoireId))` is the
  captured-vs-never-captured predicate: an id inside it with an empty `tabs`
  array is a genuinely tab-less song (`[]`); an id outside it was never
  captured, and also resolves to `[]`.

### 2. `src/lib/offlineFirst.ts` — behavior

One exported decorator, so ER2's grep has a single literal to find:

```
offlineFirst<T extends object>(bundle: T, ports?: OfflineFirstPorts): T
```

It returns a new object carrying **exactly the same own method names** as
`bundle`, each replaced by a wrapper. `ports` defaults to
`{ store: OFFLINE_STORE, isOffline: () => typeof navigator !== 'undefined' && !navigator.onLine }`
and is injected in tests, which is what keeps the module pure and its suite
mock-free. **It does not use `useOfflineStatus`** — that hook is React-only and
this is not a React context; both read the same `navigator.onLine` signal, and
`useOfflineStatus` stays the UI's reader.

`store` is typed as `Pick<OfflineStore, 'listOfflinePlaylists' | 'readOfflineSnapshot'>`.
No new store method: the two RH-79 methods are sufficient.

**The policy table.** A module-level record maps each known bundle method name
to one of three behaviours. An **unknown** name defaults to `rejectWrite` —
the safe default: offline it never reaches the network and never serves data.

| Kind | Method names | Offline behaviour |
|---|---|---|
| reader | `getPlaylistDetailsWithEntries`, `getSongEntry`, `getTabs`, `getPersonalEntryForSong`, `getAnnotations` | answer from the snapshot (below) |
| envelopeWrite | `uploadTab`, `deleteTab`, `saveAnnotations`, `updateLinks` | resolve a result envelope carrying `OFFLINE_WRITE_MESSAGE` (and `success: false` where `success` is required) |
| rejectWrite | `updateStatus`, `updateLyrics`, `fetchLyrics`, `fetchUrlTitle`, `addSong` | reject with `new Error(OFFLINE_WRITE_MESSAGE)` |

The split follows each method's declared return type in its `*Actions`
interface: a method declared to return a result envelope must resolve one,
because its hook does not `catch`; a method declared `Promise<void>` /
`Promise<T>` rejects, and its hook already catches and raises a Toast
(`useSongStatus.ts:49-53`, `useLyricsEditor.ts:111-114`).

**When it falls back — both conditions, in this order.**

1. `ports.isOffline()` is true → the real action is **never called**; the
   offline behaviour is applied directly.
2. Otherwise the real action is called. If it **rejects** and
   `isNetworkFailure(error)` is true **and** the method is a `reader`, the
   offline reader is run and its answer returned. If the offline reader itself
   throws, **the original error is rethrown**.
3. Any other rejection — a non-network failure while online, or any failure of
   a write — is **rethrown unchanged**. Stale snapshot data is never served in
   place of a real error. This is the rule reviewers should check first.

`isNetworkFailure(error)` is pure and exported: true when the value is (or is
structurally) a `TypeError` whose message matches
`/failed to fetch|networkerror|network request failed|load failed/i`, false for
everything else including `AbortError`.

**The offline readers**, all pure functions over a snapshot, exported and unit
tested individually:

- `getPlaylistDetailsWithEntries(playlistId, bandId)` → `readOfflineSnapshot(playlistId)`;
  present → `{ name: snapshot.playlistName, entries: snapshot.songs.map(s => s.entry) }`;
  absent → **throws** `OfflineUnavailableError` (an exported `Error` subclass),
  which is what `usePlaylistNav`'s existing `.catch` already absorbs into
  `nav === null`.
- `getSongEntry(repertoireId)` → the matched song's `repertoire`, else `null`.
- `getTabs(repertoireId)` → the matched song's tabs, each
  `{ ...offlineTabToRepertoireTab(tab), file_url: tab.cacheKey }`; no match → `[]`.
  Overriding `file_url` with the cache key is deliberate and is §4 below;
  `offlineSnapshot.ts` is not modified.
- `getPersonalEntryForSong(songId)` → `null`, always.
- `getAnnotations(tabId, repertoireId)` → `{ data: {} }`, so Stage Mode renders
  the PDF with no strokes and no error panel.

### 3. Which snapshot answers a Fast View route

The Fast View is per-song and snapshots are per-playlist, so the decorator
resolves the snapshot **from the action's own arguments** — never from page
state. That is what lets the wrapping happen once, at module scope, with stable
object identities (the `bandAdminActions.ts` rule the seven controllers depend
on).

- `getPlaylistDetailsWithEntries` carries the `playlistId`: a direct read.
- `getSongEntry` / `getTabs` carry only the `repertoireId`. The decorator calls
  `listOfflinePlaylists()`, orders the summaries with the exported pure
  `orderSnapshotCandidates` — **`savedAt` descending, ties broken by
  `playlistId` ascending** — and reads snapshots in that order, stopping at the
  first whose `songs` contain the `repertoireId`.
  - **Song in two downloaded playlists:** the most recently downloaded one
    wins, deterministically. The two snapshots hold the same `repertoire` row
    for the same owner context, so the choice is about freshness only.
  - **Song in none:** `getSongEntry` resolves `null`, `useSongEntry` sets
    `notFound`, and §5's offline empty state renders.

### 4. The PDF offline — one runtime route in `src/app/sw.ts`

RH-79 caches each PDF under the synthetic same-origin key
`/__offline-tab/<playlistId>/<tabId>` in the `rh-offline-tabs-v1` cache. Offline
the remote `file_url` is unreachable, so `getTabs` hands the UI the cache key
instead, and the worker answers it.

Add exactly one `runtimeCaching` entry to `src/app/sw.ts`:
a matcher on `url.pathname.startsWith('/__offline-tab/')` handled by serwist's
**`CacheOnly`** with `cacheName: OFFLINE_TAB_CACHE`. `CacheOnly` is required
rather than `CacheFirst`: it never touches the network and never writes, so the
worker's existing "this task writes nothing to a runtime cache" invariant
survives literally. The `fallbacks.entries` matcher is `isDocument`, which is
false for a PDF subresource, so a miss does not serve the `/offline` document
as a chart.

**Where the worker gets the cache name — a leaf constants module.** The worker
must **not** import from `@/lib/offlineStore`. That module imports
`@/lib/logger` (`offlineStore.ts:24`), which imports `@sentry/nextjs`
(`logger.ts:13`), which reaches `next/constants` and then the node builtins
`fs`, `stream` and `zlib`. A browser-target esbuild bundle of `sw.ts` with that
import fails with three `Could not resolve` errors inside
`node_modules/next/dist/compiled/gzip-size` — and `serwist build` is the last
stage of `npm run build`, so the import breaks the production build outright,
ER6's own invocation included. **`npm run typecheck:sw` does not catch this**:
`tsc` resolves types without bundling and stays green while the build is
broken. It is not a sufficient guard.

So:

- New file `src/lib/offlineCacheNames.ts`, a leaf with **no imports of its
  own**, exporting `OFFLINE_TAB_CACHE = 'rh-offline-tabs-v1'`. `sw.ts` imports
  it from there. Verified: the same bundle command succeeds against a leaf
  module.
- `src/lib/offlineStore.ts` changes by exactly **one line** — its
  `export const OFFLINE_TAB_CACHE = …` becomes
  `export { OFFLINE_TAB_CACHE } from '@/lib/offlineCacheNames'`. The constant
  keeps a single definition and every existing importer
  (`offlineBackends.ts:18`) is untouched. **This is the one deliberate
  exception to the Out of Scope line below forbidding changes to
  `offlineStore.ts`**, and that line is amended to name it.

**The guard that actually catches it** is a new node-environment test,
`src/lib/__tests__/swBundle.test.ts`, which calls `esbuild.build` (already a
direct dependency, `esbuild@^0.28.2`) on `src/app/sw.ts` with
`bundle: true, platform: 'browser', format: 'esm', tsconfig: 'tsconfig.sw.json',
write: false` and asserts it resolves. Verified against HEAD: green on the
current worker, and it fails with the `offlineStore` import appended while
`typecheck:sw` passes. Precedent for a config-guard test of this shape is
`src/lib/__tests__/devBundler.test.ts` (RH-72).

**The inline viewer offline — fixed, not merely recorded.** `TabViewer.tsx:41`
embeds `https://docs.google.com/gview?url=…`, a cross-origin iframe that cannot
load without network. Offline `getTabs` hands it `file_url: tab.cacheKey`
(§2), `TabLibrarySection.tsx:30-35` passes it straight through, and the result
is a blank 550px card. That card is also the **only** `TabViewer` call site and
its `Stage` button is the only `onOpenStage` trigger, so leaving it blank hides
the one renderer that does work offline.

`TabViewer` is presentational and takes one new optional prop, `offline?:
boolean` (default `false`). When `offline` is true it renders the header row
unchanged — `Stage` and `Close` still reachable — and **replaces the `<iframe>`**
with a panel (`data-testid="tab-viewer-offline"`) carrying English copy
directing the reader to Stage Mode. `TabLibrarySection` gains the same optional
pass-through prop, and the page passes `offline={isOffline}` from the single
`useOfflineStatus()` call it already makes in §5. No presentational component
reads `navigator.onLine` itself. Stage Mode remains the offline renderer
(`TabDrawingStage`'s `react-pdf` `<Document file={fileUrl}>` fetches the
same-origin cache key, which the route above answers); the difference is that
offline the user is now told so instead of being shown a blank card.

### 5. The composition root and the three UI states

**One new file, `src/app/fastViewOfflineActions.ts`** — the only place
`offlineFirst(` appears outside `src/lib/offlineFirst.ts`'s own definition and
its tests. It imports the seven existing bundles and re-exports wrapped
constants at module scope (`OFFLINE_FIRST_PLAYLIST_NAV_ACTIONS`, and one per
bundle for `TAB_LIBRARY_ACTIONS`, `LYRICS_EDITOR_ACTIONS`, `PDF_STAGE_ACTIONS`,
`SONG_ENTRY_ACTIONS`, `SONG_STATUS_ACTIONS`, `SONG_LINKS_ACTIONS`). The Fast
View page imports from this file **instead of** the four `fastView*Actions.ts`
files; those files are unchanged and keep their other consumers.

`src/app/offlineActions.ts` (the download bundle) is **not** wrapped — a
download is meaningless offline.

**The page** (`src/app/songs/[id]/fast-view/page.tsx`) calls `useOfflineStatus()`
once and does three things with it:

- renders `<OfflineBanner />` (new, `src/components/fastview/OfflineBanner.tsx`,
  `data-testid="offline-read-only-banner"`, English inline copy naming
  read-only) above the back-button row while offline;
- replaces the `song.notFound || !entry` branch with
  `<OfflineUnavailable onBack={…} />` (new,
  `src/components/fastview/OfflineUnavailable.tsx`,
  `data-testid="offline-unavailable"`) when offline, keeping `<SongNotFound />`
  when online;
- passes `readOnly={isOffline}` down to `SongIdentityHeader` (forwarded to
  `StatusDropdown`) and to `LyricsSection`.

**ER4's mechanism is decided: `disabled` is passed down from the page.** No
presentational component calls `useOfflineStatus` itself — that keeps
`src/components/fastview/**` presentational (RH-38/RH-52) and lets the two
component tests set the state through a prop instead of through
`navigator.onLine`. `StatusDropdown`'s trigger button and `LyricsSection`'s
`Edit`/`Add` button each render `disabled={readOnly}`; `readOnly` is optional
and defaults to `false`, so no other call site changes.

The page is at 222 lines with a ~177-line component and is **not** in the
`complexity-budget/override` list: everything above must stay under
`max-lines-per-function: 200` / `max-lines: 400`, which is why both new states
are their own components.

### 6. Files touched

- `src/lib/offlineFirst.ts` — new. The decorator, the policy table, the pure
  readers and helpers, `OfflineUnavailableError`, `OFFLINE_WRITE_MESSAGE`.
- `src/lib/__tests__/offlineFirst.test.ts` — new. Node environment, in-memory
  fakes only (reuse `src/lib/__tests__/offlineStoreFakes.ts`), no `vi.mock` /
  `vi.fn` / `vi.spyOn`.
- `src/app/fastViewOfflineActions.ts` — new. The single wrapping site.
- `src/app/sw.ts` — one `runtimeCaching` entry (`CacheOnly` over `/__offline-tab/`),
  importing `OFFLINE_TAB_CACHE` from the leaf module below.
- `src/lib/offlineCacheNames.ts` — new. Leaf constants module, no imports.
- `src/lib/offlineStore.ts` — one line: the `OFFLINE_TAB_CACHE` definition
  becomes a re-export from the leaf module.
- `src/lib/__tests__/swBundle.test.ts` — new. Node environment; esbuild
  browser-target bundle of `sw.ts` must succeed.
- `src/components/fastview/TabViewer.tsx`, `TabLibrarySection.tsx` — optional
  `offline` prop; offline panel replaces the gview iframe.
- `src/components/fastview/__tests__/TabViewer.test.tsx` — new jsdom test for
  the offline panel.
- `src/app/songs/[id]/fast-view/page.tsx` — import the wrapped bundles; one
  `useOfflineStatus()`; banner, offline empty state, two `readOnly` props.
- `src/components/fastview/OfflineBanner.tsx` — new.
- `src/components/fastview/OfflineUnavailable.tsx` — new.
- `src/components/fastview/SongIdentityHeader.tsx`, `StatusDropdown.tsx`,
  `LyricsSection.tsx` — optional `readOnly` prop, `disabled` on the two controls.
- `src/components/fastview/__tests__/OfflineBanner.test.tsx`,
  `.../offlineReadOnlyControls.test.tsx` — new jsdom component tests
  (`// @vitest-environment jsdom` first line, explicit `afterEach(cleanup)`).
- `e2e/offline-mode.spec.ts` — new.
- `src/i18n/dictionaries/en.json`, `pt-BR.json` — `landing.f7Title` /
  `landing.f7Desc`; `src/components/landing/LandingPage.tsx` — the seventh card.
- `package.json` — version bump (AGENTS.md Version Bumping Rule).

### 7. ER6 — how the acceptance test gets a service worker and a playlist

**Service worker: copy `e2e/pwa-shell.spec.ts` verbatim in shape.** `public/sw.js`
is emitted only by the `serwist build` stage of `npm run build`, and
`ServiceWorkerRegistrar` only registers when `NODE_ENV === 'production'`. So
`e2e/offline-mode.spec.ts` opens with the same
`test.skip(!process.env.E2E_PROD, …)` guard, waits for
`registration.active.state === 'activated'` **and** for
`navigator.serviceWorker.controller`, and carries its full invocation in its
own header comment. CI runs `npm run test:e2e` with neither `E2E_PROD` nor
`PLAYWRIGHT_WEB_SERVER`, so CI's outcome set is unchanged — and a *skipped*
run is therefore a configuration failure, not a pass.

`.env.production.local` carries an empty `BETTER_AUTH_SECRET` that shadows
`.env.local` under `next start`; export a non-empty `BETTER_AUTH_SECRET` in the
shell for the run. Never edit an `.env` file.

**The downloaded playlist: both ways, in two tests of the one file.**

- **Test 1 — through the real UI control.** Build a playlist with one song
  using the existing `e2e/helpers.ts` (`addSong`, `createPlaylist`,
  `openPlaylist`), click the real `Available offline` control on
  `/playlists/[id]`, wait for the `Available offline` downloaded state, then
  `context.setOffline(true)`, `page.reload()` on
  `/songs/<repertoireId>/fast-view?returnTo=/playlists/<playlistId>`, and
  assert: the setlist shows the song, `offline-read-only-banner` is visible,
  the status control and the lyrics `Edit`/`Add` control both carry `disabled`,
  and a Fast View URL for a song in **no** snapshot renders
  `offline-unavailable`. No tab PDF here: uploading one needs a Vercel Blob
  token this suite does not have.
- **Test 2 — a seeded snapshot, for the PDF.** `page.evaluate` writes one
  `OfflineSnapshotRecord` into `repertoire-hero-offline`/`snapshots` and puts a
  small inline base64 one-page PDF into `caches.open('rh-offline-tabs-v1')`
  under `/__offline-tab/<playlistId>/<tabId>` with
  `content-type: application/pdf`. Then `setOffline(true)`, `reload()`, select
  the tab, and assert first that the inline card shows
  `tab-viewer-offline` and renders **no** `iframe[src*="docs.google.com"]`
  (ER11's end-to-end half), then open Stage Mode from that card and assert
  `canvas.react-pdf__Page__canvas` is visible and the `Failed to load PDF.`
  panel is absent. This is the only way to
  exercise the §4 worker route without a Blob token, and it is the direct test
  of it.

## Expected Results

- [ ] ER1 — `src/lib/offlineFirst.ts` decorator + pure mock-free suite.
- [ ] ER2 — `offlineFirst(` appears only at the composition root.
- [ ] ER3 — read-only banner, present offline, absent online.
- [ ] ER4 — lyric-edit and status controls carry `disabled` offline.
- [ ] ER5 — explicit empty state for a never-downloaded playlist.
- [ ] ER6 — `e2e/offline-mode.spec.ts` passes under `E2E_PROD`.
- [ ] ER7 — landing selling point in both dictionaries, same key set.
- [ ] ER8 — no new lint problem against the `b34810a` baseline.
- [ ] ER9 — coverage gate passes; override list still 18 entries.
- [ ] ER10 — the worker bundles for the browser; the cache name has one definition.
- [ ] ER11 — offline, `TabViewer` shows the Stage Mode panel, not the gview iframe.

The authoritative, mechanically checkable wording of all eleven lives on the
Meridian task's `expected_results`.

## Out of Scope

- Rendering the PDF itself inline offline. `TabViewer` gains an offline panel
  pointing at Stage Mode (§4); it does not gain a `react-pdf` renderer of its
  own, and the gview iframe is kept unchanged for the online path.
- Any change to `offlineStore.ts` beyond the **single** re-export line named in
  §4; its behaviour, its interface and its own imports are untouched.
- Disabling the tab upload form, the tab delete or the link add/delete controls.
  The decorator already refuses those writes offline and each hook surfaces the
  failure through the existing Toast; ER4 names two controls and only two.
- Any change to `offlineSnapshot.ts`, `offlineBackends.ts`,
  `useOfflinePlaylist.ts`, `useOfflineLibrary.ts` or `OfflineDownloadButton.tsx`.
  (`offlineStore.ts` is covered by the bounded exception above.)
- `AGENTS.md:108`, `AGENTS.md:203` and `README.md:22-27` are stale about
  poli-runner after `7f657dc`. Separately owned — do not fix them here.

# RH-79 — Build the offline snapshot store and the per-playlist download

> **Filename mapping.** This file is `docs/tasks/RH-80-spec.md` but specifies
> board task **RH-79**. Spec filenames in this repository run one ahead of the
> board id; the `RH-80-spec.md` slot was free and the board task RH-80 (part 3)
> will take the next free slot. The mockup follows the same offset:
> `docs/tasks/RH-80-mock.html`.

Parent: RH-28. Design of record:
`docs/superpowers/specs/2026-09-20-offline-mode-design.md` (at `c418719`,
including both correction notes). Sibling RH-78 is done at `56db96f`.

## Scope

This task builds the **store and the download**: assembling a versioned
snapshot of one playlist, fetching its tab PDFs, persisting both, showing what
is stored, removing one playlist, and purging everything on sign-out.

It covers:

- `src/lib/offlineSnapshot.ts` — pure snapshot shape, build and version check.
- `src/lib/offlineStore.ts` (+ a thin default adapter) — the browser storage
  boundary: IndexedDB for the JSON, Cache Storage for the PDFs.
- `src/hooks/useOfflinePlaylist.ts` — the all-or-nothing download controller.
- `src/hooks/useOfflineLibrary.ts` — the aggregate view `/settings` renders.
- `src/app/offlineActions.ts` — the injected action bundle (F21).
- The "Available offline" control on the `/playlists/[id]` island, the
  `/settings` storage section, and the sign-out purge in `AppLayout.tsx`.

It explicitly does **not** cover (RH-80 owns all of it): `src/lib/offlineFirst.ts`,
the Fast View offline read path, the read-only banner, the never-downloaded
empty state, and the cold-start Playwright test. **Nothing reads the snapshot
back into the UI in this task** beyond the store's own `readOfflineSnapshot`
and its unit tests.

### `src/app/sw.ts` is not touched, and does not need to be

Caching tab PDFs is **purely app-side Cache Storage work**. The download runs
in the page and writes to its own named cache; the service worker never opens
it. RH-78's worker has exactly two routes — the allow-listed precache and a
document-scoped `NetworkOnly` — and a PDF request has
`destination !== 'document'`, so it matches neither. RH-80 will read the bytes
with `caches.match()` from the app, not through the worker's fetch handler.
`src/app/sw.ts`, `serwist.config.js` and `src/app/manifest.ts` must appear
unchanged in `git diff`.

### Language of the control label

The design and the board wrote the control as "Disponível offline". AGENTS.md
(F25) makes the application UI English-only with copy written inline, so the
control ships with the accessible name **"Available offline"**. This is the
same control the design describes; only the literal changes, to obey the
repository rule. If the operator wants the Portuguese literal, that is a
one-word change.

## Approach

### 1. The snapshot shape — the contract RH-80 reads

`src/lib/offlineSnapshot.ts`, pure: no `caches`, no `indexedDB`, no `window.`,
no `navigator.`. It exports `OFFLINE_SCHEMA_VERSION = 1` and these types, whose
per-song members are shaped so RH-80 can answer the three Fast View reads
(`getPlaylistDetailsWithEntries`, `getSongEntry`, `getTabs`) directly from them:

- `OfflineTabSnapshot` — `{ id, repertoireId, title, fileUrl, createdAt,
  cacheKey, bytes }`. `createdAt` is mandatory and carries the tab row's
  `created_at` verbatim: `RepertoireTab` (`src/types/database.ts:139-146`)
  requires it, and `mergeTabs` (`src/lib/tabLibrary.ts:41-53`) sorts the merged
  list on `new Date(created_at)`. Without it RH-80's reader would not type-check
  against `getTabs: (repertoireId) => Promise<RepertoireTab[]>`
  (`src/hooks/useTabLibrary.ts:26`) and the offline tab order would differ from
  the online one.
- `OfflineSongSnapshot` — `{ repertoireId: string; entry: PlaylistEntrySummary;
  repertoire: Repertoire; tabs: OfflineTabSnapshot[] }` (`entry` mirrors
  `src/lib/playlists.ts`'s exported interface; `repertoire` mirrors
  `src/types/database.ts`'s `Repertoire` including its `song` and `lyrics`,
  which is where personal key, status, tags and lyrics live). `repertoireId`
  equals `entry.repertoireId` and `repertoire.id`, and is named separately
  because it is **the lookup key `getTabs` is called with** — it is what makes
  the set of captured repertoire ids readable without reaching into two
  different members.

`offlineTabToRepertoireTab(tab: OfflineTabSnapshot): RepertoireTab` is exported
from the same module and is the only mapping between the two shapes
(`id`, `repertoire_id`, `title`, `file_url`, `created_at`; `annotations`
omitted, as it is optional and out of scope). RH-80's reader answers `getTabs`
with `snapshot.songs.find(s => s.repertoireId === id)?.tabs.map(offlineTabToRepertoireTab)`.
Declaring and unit-testing the mapper here, rather than leaving RH-80 to invent
it, is what makes the contract executable from this spec alone.

#### Personal tabs: decided — not captured, and the reader never has to answer

Fast View calls `getTabs` twice: once for `repertoireId` and once for
`personalRepertoireId` (`src/hooks/useTabLibrary.ts:134-137`). The second id is
not on the playlist read path at all — it is `personalEntry?.id ?? null`
(`src/hooks/useSongEntry.ts:133`), and `personalEntry` is produced by a fourth
action, `getPersonalEntryForSong` (`src/hooks/useSongEntry.ts:19,74-76`), which
this task's bundle deliberately does not include.

So: **the member's own repertoire row and its tabs are Out of Scope for the
snapshot** — an offline playlist is the band's (or the owner context's)
photograph of the setlist, not a merge of two contexts. Two consequences are
part of the contract, not left to RH-80:

1. RH-80's offline entry reader must answer `getPersonalEntryForSong` with
   `null`. `useSongEntry` then leaves `personalRepertoireId === null`, and
   `useTabsFetch` returns early on a null id (`useTabLibrary.ts:87`) — **the
   second `getTabs` call never fires offline.**
2. Defensively, should it fire anyway, `getTabs` for any id outside
   `new Set(snapshot.songs.map(s => s.repertoireId))` resolves to `[]`. That set
   is precisely the "was this captured?" predicate: an id **in** the set with an
   empty `tabs` array is a genuinely tab-less song, an id **outside** it was
   never captured. Nothing is silently conflated.
- `OfflineSnapshot` — `{ schemaVersion: number; playlistId: string;
  playlistName: string; bandId: string | null; savedAt: string /* ISO-8601 UTC */;
  songs: OfflineSongSnapshot[] }`.

`schemaVersion` lives **on the snapshot object** and is mirrored onto the stored
record (below) so a listing need not parse the JSON; the store writes the mirror
from the snapshot, so the two can never disagree.

Exported functions (declarations, per the guarded naming rule):
`buildOfflineSnapshot(input)` (takes playlist id/name/bandId, `savedAt` as an
argument — never `Date.now()` inside, so the module stays pure and the test
needs no mock — and the per-song material, and returns one `OfflineSnapshot`);
`readValidSnapshot(value: unknown): OfflineSnapshot | null`, which returns
`null` for anything whose `schemaVersion !== OFFLINE_SCHEMA_VERSION` or whose
shape does not validate; and `offlineTabCacheKey(playlistId, tabId): string`,
the pure key derivation used below. Annotations (`getTabAnnotations`) are not
part of the snapshot.

### 2. Where the PDFs live and how they are keyed

Cache Storage, cache name **`rh-offline-tabs-v1`**. Each PDF is stored under a
**synthetic, stable, same-origin key**, not under the Blob URL:

```
/__offline-tab/<playlistId>/<tabId>
```

That path is never routed by the app — it exists only as a Cache Storage key —
and it is a same-origin URL, which `cache.put` requires. Keying this way buys
two things: per-playlist removal is a prefix scan of `cache.keys()`, which is
what makes ER10 true; and a tab whose `file_url` changes after a download does
not silently orphan bytes. When a `file_url` does change, the stored snapshot
keeps pointing at the old bytes under the same key until the musician taps
refresh, which re-downloads and overwrites the same key — the design's
"photograph with a date", stated deliberately, not an oversight. Two playlists
holding the same tab store the bytes twice; that is accepted, because correct
independent removal is worth more than the duplication.

The PDFs are fetched **directly from the Vercel Blob `file_url`** (measured
CORS-enabled — see the design's second correction note). Each response is
asserted with `response.type !== 'opaque'` **and** `response.ok` before it is
cached; a failure of either aborts the whole download. No same-origin streaming
route handler is added.

IndexedDB: database `repertoire-hero-offline`, version 1, one object store
`snapshots` with `keyPath: 'playlistId'`. A record is
`{ playlistId, playlistName, savedAt, bytes, schemaVersion, snapshot }`.
`bytes` is the sum of every cached PDF's real byte length plus the UTF-8 length
of the serialized snapshot JSON.

### 3. The storage boundary and its fake

`src/lib/offlineStore.ts` talks to two small ports rather than to `indexedDB`
and `caches` directly, and takes them as one optional trailing argument that
defaults to the real adapter:

- a record port (`get` / `put` / `delete` / `list`),
- a blob port (`put(key, response)` / `match(key)` / `deleteByPrefix(prefix)` /
  `clear()`),
- `fetch`.

The real adapter (IndexedDB + `caches.open('rh-offline-tabs-v1')`) is a thin,
decision-free translation layer and may live in `src/lib/offlineBackends.ts`.
Unit tests inject in-memory fakes and use no mocking library — this is the
design's "storage fake". Only if the coverage thresholds actually drop may
`offlineBackends.ts` be added to `coverage.exclude` in `vitest.config.ts`, with
a comment in the same style as the existing `imageCompressor.ts` exclusion
("needs `indexedDB`/`caches`"); `offlineStore.ts` and `offlineSnapshot.ts` stay
inside the gate unconditionally.

`src/lib/offlineStore.ts` exports an **`OfflineStore` interface** with six
members — `saveOfflinePlaylist`, `readOfflineSnapshot` (returns `null` on a
schema mismatch, delegating to `readValidSnapshot`), `listOfflinePlaylists`,
`removeOfflinePlaylist`, `matchOfflineTab`, `clearAllOfflineData` — plus
`createOfflineStore(ports?: OfflineStorePorts): OfflineStore` and one module-scope
default instance `OFFLINE_STORE = createOfflineStore()` (stable identity, the
`bandAdminActions.ts` pattern). `clearAllOfflineData` empties the record store
and the whole tab cache and **never throws**: it narrows and logs through
`@/lib/logger` and resolves, so a sign-out can always await it.

**The default ports must be lazy.** `createOfflineStore()` captures nothing at
construction; the real adapter touches `indexedDB` / `caches.open(...)` only
inside a call. Importing `@/lib/offlineStore` under the `jsdom` test
environment — which implements neither, and this repository carries no
`fake-indexeddb` (`package.json`) — must therefore be inert. This is what lets
every hook and component test import the real module and inject its own store.

#### The store is an injected dependency of the hooks and the components

Nothing below ever reaches `OFFLINE_STORE` implicitly; each layer names it,
defaults it to the real one, and lets a test override it:

- `useOfflinePlaylist({ playlistId, playlistName, bandId, actions, store = OFFLINE_STORE })`
  — `actions: OfflineDownloadActions` (§5) and `store: OfflineStore` are the
  hook's two injected dependencies.
- `useOfflineLibrary({ store = OFFLINE_STORE })` — the module-level cache behind
  its `useSyncExternalStore` (§7) is keyed by nothing and refreshed *through the
  passed store*, so a test that injects a fake reads that fake's rows.
- `OfflineDownloadButton` takes `actions` and an optional `store?: OfflineStore`
  prop, and passes both straight to `useOfflinePlaylist`.
- `OfflineStorageSection` takes an optional `store?: OfflineStore` prop and
  passes it to `useOfflineLibrary`.

Both props default to `OFFLINE_STORE`, so `/playlists/[id]/page.tsx` and
`/settings/page.tsx` pass neither and are unchanged in that respect.

### 4. All-or-nothing rollback

`saveOfflinePlaylist` writes in this order, and the order is the mechanism:

1. fetch and `put` every PDF under its key (idempotent overwrite on a refresh);
2. serialize the snapshot, compute `bytes`;
3. `put` the IndexedDB record **last**.

The IndexedDB record is the *only* thing that makes a playlist count as
downloaded, so a failure before step 3 already leaves the playlist "not
downloaded". On any throw at any step, the whole call catches, awaits
`removeOfflinePlaylist(playlistId)` — which deletes every `/__offline-tab/<id>/`
key and the record — and rethrows. A *failed refresh therefore also discards the
previous good copy*: deliberate, because the design says a half-written snapshot
is worse than none, and after a rollback the UI shows "not downloaded", which is
true.

`useOfflinePlaylist` holds `status: 'idle' | 'downloading' | 'downloaded'` plus
`progress`, `summary` and `error`, and never moves to `downloaded` unless
`saveOfflinePlaylist` resolves.

**Forcing `QuotaExceededError` in a test**: the fake blob port's `put` (and, in
a second case, the fake record port's `put`) is configured to throw
`new DOMException('quota', 'QuotaExceededError')` on the Nth call.

Both the store test and the hook test use **the real store over those fake
ports** — `createOfflineStore(fakePorts)` — never a hand-written store double.
That distinction is the whole point: a double performs no rollback, so asserting
"nothing survives" against one would be vacuous. The store test drives
`saveOfflinePlaylist` directly and asserts `listOfflinePlaylists()` is empty and
the fake cache holds no `/__offline-tab/<playlistId>/` key. The hook test passes
that same real-store-over-fake-ports instance as `store` and asserts, in one
test, both that the hook lands in `idle` with an error and never reports
`downloaded`, **and** that the fake ports are empty of that playlist afterwards —
the rollback itself, observed through the hook.

### 5. The injected action bundle

`src/app/offlineActions.ts` exports `OFFLINE_DOWNLOAD_ACTIONS:
OfflineDownloadActions` at module scope (stable identity, the
`bandAdminActions.ts` pattern), composed from **existing** Server Actions — no
new action and no new SQL:

- `getPlaylistDetailsWithEntries` → `getPlaylistDetailsWithEntriesAction`
- `getSongEntry` → `getSongEntryAction`
- `getTabs` → `getTabsAction`

The interface type is declared in `src/hooks/useOfflinePlaylist.ts` and imported
by the bundle, exactly as `TabLibraryActions` is. It is the hook's **second**
injected dependency; the first is `store: OfflineStore` (§3), which unlike
`actions` does carry a default. `/playlists/[id]/page.tsx`
imports the bundle and passes it to `PlaylistDetailView` as a new prop;
nothing under `src/components`, `src/hooks` or `src/lib` imports `@/app/*`.

### 6. The playlist control

`src/components/playlists/OfflineDownloadButton.tsx`, rendered by
`PlaylistDetailView` (the island), driven by `useOfflinePlaylist`. Three states,
each with a distinct accessible name / live-region text: **idle** ("Available
offline"), **in progress** (a busy control with `aria-busy="true"` and an
`x / y` song counter), **downloaded** (size, "downloaded <relative time>",
a refresh affordance and a remove affordance). An error renders as an inline
alert banner — never `alert()`/`confirm()`.

### 7. `/settings`

`src/components/settings/OfflineStorageSection.tsx`, rendered by the existing
`'use client'` page. The aggregate total is **the sum of the stored `bytes`
across the snapshot records** — never the Storage API — so the total always
agrees with the per-playlist figures beside it and is always available. If
`navigator.storage.estimate()` resolves with a numeric `quota`, a secondary
"x of y used" line may be shown; when the API is absent, rejects, or returns no
`quota`, that line is simply omitted — no placeholder, no spinner, and the total
is unaffected. Each row carries a remove control calling
`removeOfflinePlaylist`.

The section must not introduce a `react-hooks/set-state-in-effect` error (ER12:
`src/app/settings/page.tsx` already carries one and must carry no more). Load
the library through `useOfflineLibrary`, built on `useSyncExternalStore` over a
module-level cache plus a `refresh()` that writes to that cache and notifies
subscribers — the `useOfflineStatus.ts` / `useHydrated.ts` precedent. The mount
effect calls `refresh()` and writes no React state.

### 8. Sign-out purge

In `src/components/layout/AppLayout.tsx`, the sign-out sequence becomes a
**module-scope** async helper in the same file, taking the router structurally
(`{ push: (href: string) => void }`), and the in-component `handleSignOut`
becomes the single line that calls it. `await clearAllOfflineData()` is the
**first** statement of that helper, before
`useBandContextStore.getState().setUserContext()` and before
`await authClient.signOut()`: the purge blocks and completes before the sign-out
does, because the offline cache answers before the network and therefore
bypasses `src/proxy.ts`'s redirect entirely. Since `clearAllOfflineData` never
throws, a purge failure can never strand the user signed in.

Hoisting, rather than adding a line in place, is required by the budget:
`AppLayout.tsx` carries a `complexity-budget/override` pinned at
`complexity 21, max-lines-per-function 201`, and
`src/lib/__tests__/complexityBudget.test.ts` fails unless a ceiling is *exactly*
the file's current worst number. After the change, re-measure and re-pin that
existing entry to the new exact numbers, dropping any key that has fallen to or
below the base budget (`complexity 15`, `max-lines-per-function 200`). Never
raise a ceiling and never add an entry — the list stays at 18 or shrinks.

### Files touched

- `src/lib/offlineSnapshot.ts` — new; pure types (`OfflineTabSnapshot` with `createdAt`, `OfflineSongSnapshot` with `repertoireId`), `OFFLINE_SCHEMA_VERSION`, build, validate, cache-key derivation, `offlineTabToRepertoireTab`.
- `src/lib/offlineStore.ts` — new; the `OfflineStore` interface, `createOfflineStore(ports)` over the two injectable lazy ports, and the `OFFLINE_STORE` default instance.
- `src/lib/offlineBackends.ts` — new; the decision-free IndexedDB + Cache Storage adapter.
- `src/hooks/useOfflinePlaylist.ts` — new; download controller, `OfflineDownloadActions` type.
- `src/hooks/useOfflineLibrary.ts` — new; `useSyncExternalStore` view of the stored playlists.
- `src/app/offlineActions.ts` — new; `OFFLINE_DOWNLOAD_ACTIONS` composed from three existing actions.
- `src/app/playlists/[id]/page.tsx` — injects the bundle into the island.
- `src/components/playlists/PlaylistDetailView.tsx` — new prop, renders the control.
- `src/components/playlists/OfflineDownloadButton.tsx` — new; the three-state control.
- `src/components/settings/OfflineStorageSection.tsx` — new; total + per-playlist removal.
- `src/app/settings/page.tsx` — renders the new section.
- `src/components/layout/AppLayout.tsx` — sign-out helper hoisted; purge awaited first.
- `eslint.config.mjs` — re-pin the existing `AppLayout.tsx` override only if its worst numbers moved.
- `vitest.config.ts` — only if `offlineBackends.ts` has to be excluded from coverage.
- `src/lib/__tests__/offlineSnapshot.test.ts`, `src/lib/__tests__/offlineStore.test.ts`, `src/hooks/__tests__/useOfflinePlaylist.test.tsx`, `src/hooks/__tests__/useOfflineLibrary.test.tsx`, `src/components/playlists/__tests__/OfflineDownloadButton.test.tsx`, `src/components/settings/__tests__/OfflineStorageSection.test.tsx` — new. Every `.test.tsx` starts with the literal first line `// @vitest-environment jsdom` and calls `afterEach(cleanup)`; `useOfflinePlaylist.test.tsx` also carries ER6's "importing the store module under jsdom is inert" assertion, since it already imports it there.
- `package.json` — version bump per the AI Agent Workflow rule.
- `docs/tasks/RH-80-spec.md`, `docs/tasks/RH-80-mock.html` — this spec and its mockup.

### Test criteria

- Snapshot: a built snapshot round-trips through `JSON.parse`/`readValidSnapshot`; a snapshot with `schemaVersion: OFFLINE_SCHEMA_VERSION + 1` returns `null`; a malformed object returns `null`; a tab missing `createdAt` fails validation; `offlineTabCacheKey` is stable and prefix-scoped by playlist. A test maps two `OfflineTabSnapshot`s through `offlineTabToRepertoireTab` into `mergeTabs` and asserts the newest `created_at` comes first — the online order, reproduced offline. No mocks, node environment.
- Store: write/read/delete keyed by `playlistId`, with `savedAt`, `bytes` and `schemaVersion` on the record; a non-`ok` or `type === 'opaque'` response aborts the download; the mid-download `QuotaExceededError` leaves both stores empty for that playlist; `removeOfflinePlaylist` on one playlist leaves another playlist's record and cached keys intact; `clearAllOfflineData` leaves both stores empty and resolves even when a port throws.
- Hook: `idle → downloading → downloaded` on success with a progress count; `idle` plus an error, never `downloaded`, and nothing surviving in the injected ports when a port throws mid-download. Every hook and component test passes `store: createOfflineStore(fakePorts)`; none reaches the default adapter, and importing `@/lib/offlineStore` under `jsdom` touches neither `indexedDB` nor `caches`.
- Components: the three control states render distinguishable accessible names; the settings section shows the summed total and removes one playlist without disturbing the others. Both receive their store through the optional `store` prop.
- Guards: `npm run test:coverage` passes its thresholds; `src/lib/__tests__/complexityBudget.test.ts`, `namingConventions.test.ts`, `errorHandlingStyle.test.ts` and `actionDataAccessGuard.test.ts` pass; `npm run lint:dead` and `npm run lint:dup` pass.
- `grep -nE "caches|indexedDB|window\.|navigator\." src/lib/offlineSnapshot.ts` returns nothing.
- `git diff --stat` shows no new file under `src/app/api` and no change to `src/app/sw.ts`.

### Lint baseline

`npm run lint` does **not** exit 0 in this repository and must not be specified
as doing so. Measured at `56db96f` (this task's base): **8 errors, 12 warnings
across 12 files**, 14 distinct (file, rule, severity) pairs —
`src/lib/__tests__/edge_cases.test.ts` (no-unused-vars ×4),
`deduplicate-songs.mjs` (×3), `src/app/settings/page.tsx`
(set-state-in-effect ×1, no-html-link-for-pages ×1),
`src/components/layout/AppLayout.tsx` (set-state-in-effect ×2),
`src/components/layout/LanguageSelector.tsx` (no-unused-vars ×1,
set-state-in-effect ×1), `global-setup.ts` (×1), `migrate.mjs` (×1),
`src/app/profile/page.tsx` (×1), `src/app/reset-password/page.tsx` (×1),
`src/components/landing/LandingPage.tsx` (×1),
`src/lib/__tests__/errors.test.ts` (×1), `src/lib/__tests__/i18n.test.ts` (×1).
The criterion is: **no new problem** — the same counts and the same (file, rule)
pairs, warnings counted as well as errors.

## Expected Results

- [ ] ER1 — `src/lib/offlineSnapshot.ts` exists and is pure: `grep -nE "caches|indexedDB|window\.|navigator\." src/lib/offlineSnapshot.ts` returns no match, and it builds one versioned `OfflineSnapshot` carrying `schemaVersion`.
- [ ] ER2 — `src/lib/__tests__/offlineSnapshot.test.ts` runs with no mocks and asserts that a snapshot whose `schemaVersion` differs from `OFFLINE_SCHEMA_VERSION` is read back as absent (`null`).
- [ ] ER3 — `OfflineTabSnapshot` carries a mandatory `createdAt`, and `src/lib/offlineSnapshot.ts` exports `offlineTabToRepertoireTab` returning a value assignable to `RepertoireTab`; a test feeds two mapped tabs to `mergeTabs` from `@/lib/tabLibrary` and asserts the newest `created_at` is first.
- [ ] ER4 — `OfflineSongSnapshot` carries `repertoireId`; the spec records that personal-repertoire tabs are not captured, that RH-80's offline `getPersonalEntryForSong` returns `null`, and that a `getTabs` id outside `snapshot.songs.map(s => s.repertoireId)` resolves to `[]`. `grep -n "personalRepertoireId\|getPersonalEntryForSong" docs/tasks/RH-80-spec.md` matches.
- [ ] ER5 — `src/lib/offlineStore.ts` exports the `OfflineStore` interface, `createOfflineStore(ports)` and the `OFFLINE_STORE` default instance; it writes, reads and deletes a snapshot keyed by `playlistId` in a record carrying `savedAt`, `bytes` and `schemaVersion`, and a unit test covers all three operations against `createOfflineStore(fakePorts)`.
- [ ] ER6 — Importing `@/lib/offlineStore` under the `jsdom` environment constructs `OFFLINE_STORE` without touching `indexedDB` or `caches`: a `// @vitest-environment jsdom` test that imports the module and calls no store method passes with no `fake-indexeddb` dependency added to `package.json`.
- [ ] ER7 — Tab PDFs are cached by fetching the Vercel Blob `file_url` directly, and the download asserts both `response.type !== "opaque"` and `response.ok`; a test proves a failure of either aborts the download.
- [ ] ER8 — No same-origin blob streaming route handler is added: `git diff` shows no new file under `src/app/api` serving tab files, and `src/app/sw.ts` is unchanged.
- [ ] ER9 — `clearAllOfflineData`, exported from `src/lib/offlineStore.ts`, removes every snapshot record and every cached PDF; a test asserts both stores are empty afterwards.
- [ ] ER10 — `useOfflinePlaylist` takes `store: OfflineStore` (defaulting to `OFFLINE_STORE`) alongside `actions`, and is all-or-nothing: a test injecting `createOfflineStore(fakePorts)` — the REAL store over fake ports, not a store double — whose blob port throws `QuotaExceededError` on the Nth `put` asserts the hook lands in `idle` with an error and never `downloaded`, and that afterwards the fake record port holds no record and the fake blob port holds no `/__offline-tab/<playlistId>/` key.
- [ ] ER11 — `src/app/offlineActions.ts` exports the download action bundle at module scope following the F21 injection pattern, and `/playlists/[id]/page.tsx` injects it into the client island.
- [ ] ER12 — The `/playlists/[id]` client island renders an "Available offline" control (the design's "Disponível offline", in English per AGENTS.md F25); `OfflineDownloadButton` accepts an optional `store` prop defaulting to `OFFLINE_STORE`, and a component test passing `createOfflineStore(fakePorts)` asserts its three states: idle, in-progress, downloaded.
- [ ] ER13 — `/settings` renders the aggregate offline storage total and a per-playlist removal control; `OfflineStorageSection` accepts an optional `store` prop defaulting to `OFFLINE_STORE`, and a test passing `createOfflineStore(fakePorts)` seeded with two playlists asserts that removing one leaves the other's record and cached keys intact.
- [ ] ER14 — Signing out invokes `clearAllOfflineData` from the `src/components/layout/AppLayout.tsx` sign-out path, awaited before `authClient.signOut()` so the purge completes before the sign-out does.
- [ ] ER15 — `npm run lint` introduces no new problem against the `56db96f` baseline of 8 errors / 12 warnings in 12 files: same counts and same (file, rule) pairs, warnings counted as well as errors.
- [ ] ER16 — `npm run test:coverage` passes its thresholds with the new `src/lib` modules included, and `eslint.config.mjs` gains no new `complexity-budget/override` entry (18 or fewer, `complexityBudget.test.ts` green).

## Out of Scope

- Everything RH-80 owns: `src/lib/offlineFirst.ts`, the Fast View offline read
  path, the read-only banner, the never-downloaded empty state, the cold-start
  Playwright test.
- Any change to `src/app/sw.ts`, `serwist.config.js` or `src/app/manifest.ts`.
- A same-origin blob streaming route handler (ruled out by the measured CORS
  result; the design keeps it documented as the fallback if Vercel Blob ever
  changes).
- **The member's personal repertoire row and its tabs** (§1): not captured, and
  therefore not merged offline. Fast View's second `getTabs` call never fires,
  because RH-80's offline `getPersonalEntryForSong` returns `null`.
- Tab annotations in the snapshot; background or automatic download; change
  detection or staleness inference beyond the displayed `savedAt`; offline
  writes of any kind.
- **Landing page (AGENTS.md rule): decided — not this task.** Offline mode is a
  selling point, but it is only usable once RH-80 lands the read path, so the
  `landing.*` copy update in both dictionaries belongs to RH-80, not here.

## Mockup

Interactive HTML mockup of the three control states and the `/settings` section:
`docs/tasks/RH-80-mock.html`.

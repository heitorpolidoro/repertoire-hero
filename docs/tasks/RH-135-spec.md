# RH-134 — Fetch Fast View content in a window and invalidate on write

> Filename note: the repo convention is spec file = board id + 1, so RH-134's
> spec is `RH-135-spec.md`. `docs/tasks/RH-134-spec.md` is RH-133's spec.

Part 3 of 3 from the RH-109 split. It consumes the queue RH-133 introduced
(`src/lib/songQueue.ts`, read by `usePlaylistNav`). RH-115 (the practice
session) does not need this part: the window is a latency optimisation, and
every screen must work with the window fetch absent or failed.

Design source: `docs/use-cases.md` § *Walk a queue of songs* ("One request
fetches a window" and the write-invalidates rule) and § on offline navigation.

## Scope

**In scope.**
1. One read that returns the content of a window of up to three songs - the
   previous, the current and the next queue entry - in a single request.
2. A client-side, in-memory, per-tab cache of those windows, consulted by the
   two per-song readers before they go to the network.
3. One invalidation rule: a successful Fast View write to a song drops that
   song's cached copy, and a window fetch that was already in flight when the
   write happened cannot put the old copy back.

**Out of scope.** Any change to `songQueue.ts`'s stored shape or to the
queue's owner precedence; persisting the cache (it dies with a reload, which is
correct); prefetching beyond one neighbour either side; the offline snapshot's
shape; cache invalidation for *someone else's* edits (stale for seconds, by
decision); annotations (`getTabAnnotationsAction` is read per file on opening
a chart, not part of the window); any change to who may read or write.

## Decided (do not reopen)

- **Window size is three**, "a swipe finds its content in hand". Nothing
  measures it. At the ends of the queue the window is two; a queue of one is a
  window of one.
- **What a neighbour's file is** is decided by `isImageTab`
  (`src/lib/tabRenderer.ts`) and nowhere else. The window returns each song's
  file rows **including `content_type`**; an absent or unrecognised value reads
  as `application/pdf` by that module's documented design. The window code must
  not compare content types itself and must not default them itself.
- **A neighbour with no file at all** is navigated to and renders the song with
  an empty file library: the window answers `files: []` for it. It is never a
  blocked swipe and never an error.

## Approach

**Behaviour.**

- *The read.* A new Server Action takes the version ids of the window (at most
  three; more is refused) and the page's `?bandId=`, resolves the owner **once**
  through the same `resolveOwner` the single-song read uses (so
  `assertBandMember` is still the gate), and returns one record per id:
  `{ versionId, entry: ResolvedSongEntry | null, files: SongFile[] }`.
  `entry` is built by the same `getResolvedEntryForVersion` the route read uses
  and `files` by the same `listTabs(userId, song_id)` (the caller's own files -
  a file belongs to the person, RH-123). A version that does not exist yields
  `entry: null, files: []` for that id only; it must not fail the other two. It
  is a thin action (A2): no SQL in `src/app/actions`, the assembly lives in a
  new `src/lib` data module.
- *Injection.* The action reaches the hook through a typed `<Subject>Actions`
  object wired in `src/app/fastViewEntryActions.ts` (F21: no hook imports an
  action). If the bundle is wrapped by `offlineFirst`, the new method must be
  classified so that offline it is **not** attempted and never served from a
  snapshot (an unclassified method is refused offline, which is the right
  outcome here).
- *The cache.* A new client-safe, import-free-of-`pg` module `src/lib/songWindow.ts`
  holds the pure decisions - which ids make up the window around the current
  version in the queue, which of them are not cached yet, and the cache itself
  keyed by `(bandId or personal, versionId)` - plus the invalidation. Exports are
  function declarations.
- *The consumer.* A controller hook (`src/hooks/useSongWindow.ts`, returning a
  `SongWindowController`) fetches the window when the current version or the
  queue changes, issuing one request for the ids not yet cached, and is
  **best-effort**: a failure is logged through `logger` and swallowed. The
  existing `useSongEntry` and `useTabLibrary` loads read the cache first and, on
  a hit, apply it without a request; on a miss they behave exactly as today.
  The window fetch for the current song and the per-song load must not both go
  to the network for the same song.
- *Navigation without a queue.* A song opened alone has a window of one: the
  current song, one request, same code path.
- *The rule.* Every successful Fast View write calls one function,
  `invalidateSongWindow(versionId)`, from one seam in the page's composition
  (the writes are: lyrics save, status change, link add/delete, file upload,
  file delete). It drops the cached copy and bumps a per-version generation so
  a fetch started before the write is discarded on arrival. The page wires it;
  the five write sites do not each grow their own cache logic.

**Files touched.**

- `src/app/actions/repertoire.ts` - the window Server Action (thin).
- `src/lib/songWindowData.ts` - new, server-side assembly of one window (imports
  `@/lib/db` transitively, so never imported by a client file).
- `src/lib/songWindow.ts` - new, pure window ids + cache + `invalidateSongWindow`.
- `src/hooks/useSongWindow.ts` - new controller hook.
- `src/hooks/useSongEntry.ts`, `src/hooks/useTabLibrary.ts` - cache-first reads.
- `src/app/fastViewEntryActions.ts` - wire the new action into a typed bundle.
- `src/app/songs/[versionId]/fast-view/page.tsx` - wire the hook and the single
  invalidation seam; no state, effect or data access in the page (RH-38).
- `src/lib/offlineFirst.ts` - classify the method, if the bundle is wrapped.
- `AGENTS.md` / `docs/use-cases.md` - record the window and its rule in the
  Fast View paragraph (one line each).
- Do not add an `eslint.config.mjs` complexity override; the budget list is a
  shrink-only ratchet.

**Test criteria (named tests).**

- `src/lib/__tests__/songWindow.test.ts` - window ids at index n (middle, first,
  last, single); one fetcher call for the uncached ids; cache hit issues no
  call; invalidate-then-refetch; in-flight fetch discarded after an invalidate.
- `src/lib/__tests__/songWindowData.db.test.ts` (live Postgres, `RUN_DB_TESTS`)
  - the real action path, one named test per line: `returns three songs in one
  call`; `returns the image/png content_type of a neighbour file row`;
  `returns files: [] for a song with no file row`; `a nonexistent version
  yields entry null without failing the others`; `refuses more than three ids`;
  `refuses a band the caller is not a member of`.
- `src/lib/__tests__/songWindow.test.ts` also holds `window code contains no
  content-type literal and no isImageTab bypass` (source-level guard that the
  module neither compares nor defaults content types).
- `src/hooks/__tests__/useSongWindow.test.tsx` (jsdom) - `one request carrying
  n-1, n, n+1` with a counting stub action (two ids at the ends);
  `a failing window request surfaces no error and per-song loads still render`;
  `a neighbour with files: [] renders an empty file library without error`.
- `src/hooks/__tests__/useSongWindowInvalidation.test.tsx` - `edit song 4
  lyrics, go to 3 and back shows the new text` (song 4 prefetched from 3 before
  the write) and, in `songWindow.test.ts`, `in-flight fetch discarded after an
  invalidate`.

## Expected Results

- [ ] ER1 - `one request carrying n-1, n, n+1` passes: arriving at queue index n issues exactly one window request with those ids (two ids at the ends).
- [ ] ER2 - `returns the image/png content_type of a neighbour file row` passes: the window returns the row's `content_type` unchanged.
- [ ] ER3 - `returns files: [] for a song with no file row` passes: a neighbour without files answers an empty list, not an error.
- [ ] ER4 - `edit song 4 lyrics, go to 3 and back shows the new text` passes: the new text shows, not the prefetched copy.
- [ ] ER5 - `in-flight fetch discarded after an invalidate` passes: a fetch started before a write cannot restore the old copy.
- [ ] ER6 - `a failing window request surfaces no error and per-song loads still render` passes.
- [ ] ER7 - `refuses more than three ids` passes: the action rejects a window of four or more ids.
- [ ] ER8 - `refuses a band the caller is not a member of` passes: the action rejects a non-member band id.

## Out of Scope

See Scope. Nothing in this task is visual; no mock was written.

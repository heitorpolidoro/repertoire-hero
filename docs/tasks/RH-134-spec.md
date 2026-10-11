# RH-133 — Replace returnTo with a sessionStorage queue

> Filename note: the repo convention is spec file = board id + 1, so RH-133's
> spec is `RH-134-spec.md`. `docs/tasks/RH-133-spec.md` is RH-132's spec.

Part 2 of 3 from the RH-109 split, and the part RH-115 (the practice session)
needs. Part 3 is RH-134 ("Fetch Fast View content in a window and invalidate on
write"), which is `blockedBy: ['RH-133']` and consumes the module this task
introduces.

## Scope

**In scope.** A new client-safe queue module under `src/lib` holds an ordered
list of `{ versionId, title, artist }` plus an owner context and the href the
queue was built from. It is written on entry to Fast View from a playlist, read
by `usePlaylistNav` instead of fetching the playlist, and `?returnTo=` is
deleted from the Fast View URL and from every link that builds one. Back goes
to the recorded origin. The `?bandId=` / `localStorage` / queue owner-context
precedence is decided here and recorded in `docs/use-cases.md`.

**Out of scope.** RH-134's content window and write-invalidation; RH-115's
computed practice-session queue and its hand-picked sibling; any change to
`assertBandMember` (`src/lib/bands.ts:37`) or to who may write; any change to
the offline snapshot's shape; persisting a queue server-side; progress inside a
queue. `?bandId=` stays in the URL — only `?returnTo=` goes.

The design is not invented here. `docs/use-cases.md` § *Walk a queue of songs*
already decides it (locate it by that heading; the line numbers in the board's
justification have drifted): `sessionStorage`, survives a reload, dies with the
tab, no progress; prev/next simply absent at the ends with no wraparound; a song
opened alone has no queue and no setlist chrome; a song removed from a
repertoire mid-queue stays in the queue and reads at version defaults; the queue
holds no lyrics, because the staleness that matters is the musician's own edit.

That section's opening line calls the queue "an ordered list of versions, an
owner context, **and a position in it**", which reads as a conflict with "no
position" below. It is not one, and the task resolves it in writing: the
position is **derived** at read time by matching the current route's
`versionId` against the stored entries, never stored — which is exactly what
the section's own "No progress is kept" requires. One sentence saying so goes
into the section (ER6).

## Approach

### Behavior

1. **The queue is one `sessionStorage` entry.** A single key (`song-queue`)
   holds a JSON document: an ordered `entries` array of
   `{ versionId, title, artist }`, an `owner` context
   (`{ type: 'personal' } | { type: 'band'; bandId }`), an `originHref`, and a
   human `label` for the setlist chrome. Nothing else — no lyrics, key, tuning,
   map, files, status, tags, and **no stored position**. A malformed or absent
   value reads as "no queue" rather than throwing: the queue is optional chrome.

   **The chrome's entry type is its own** (round 2). The setlist components take
   a `SetlistEntry` — the three queue fields plus an *optional* `repertoireId`
   and `songId` — while `PlaylistEntry` stays strict. `PlaylistEntry` is also a
   **persisted** shape: `offlineStore.ts`, `offlineSnapshot.ts` and
   `offlineSnapshotV5.ts` all type the `entry` they write into IndexedDB as it,
   and their runtime validator checks only `isRecord`, so the type is the whole
   guarantee that a future snapshot writer cannot drop `songId`. Widening it for
   the chrome would have quietly spent that guarantee.

2. **Written on entry, read on arrival.** A click on a playlist row writes the
   whole playlist's queue with `originHref` `/playlists/<id>`, `owner` from the
   playlist's own `band_id`, and `label` the playlist name; then the existing
   `<Link>` navigation proceeds. `usePlaylistNav` reads the queue on mount and
   derives nav from it, and no longer calls `getPlaylistDetailsWithEntries`. The
   chrome therefore needs **no network at all**, which is the standing offline
   rule's requirement and the reason the queue carries only title and artist.

   **The written list is the playlist, not the view.** `PlaylistSongList` holds
   two props — `songs` (`:15`, every song of the playlist) and `filteredSongs`
   (`:17`, what survived the page's tag and text filters) — and renders
   `sortPlaylistSongs(filteredSongs)` at `:63`. The queue must be built from
   `songs`, in playlist order. Writing the variable already in scope on that
   render line is the obvious mistake and ships a setlist that silently
   shortens to whatever text was left in the filter box, so it is pinned by its
   own result (ER10) rather than left to review.

   **One row is left out, and only one** (round 2): a `PlaylistSong` whose
   catalog `song` did not join (`song?` is optional on the type). It has neither
   of the two strings a setlist row draws, so storing it would draw a blank,
   unidentifiable line. Every other row travels, filtered or not.

2a. **The store outlives the navigation, so "no queue" is enforced twice.**
   Added in review round 2, which found this missing. `sessionStorage` is
   tab-wide and dies only with the tab, so after one playlist walk the store is
   never empty again — and the entry point that opens a song *alone*
   (`RepertoireDashboard.tsx:364`, the only other Fast View link) writes nothing
   and so would simply inherit the previous walk. Two rules together are what
   make the use-case table's "one song, opened alone | no queue, and no setlist
   chrome" actually true:

   a. **`usePlaylistNav` scopes the whole queue to the route.** A stored queue
      that does not list `currentVersionId` is treated as no queue at all —
      `nav` null, `entries` empty, and Back walking history rather than pushing
      the recorded origin. Before this, a queue absent the current version still
      leaked its `originHref` into Back (§ 5 covered the chrome and not the Back
      target). This rule needs nothing of future entry points.

   b. **The dashboard link clears the queue as it is followed.** Rule (a) cannot
      cover the one case where the stale queue happens to list the very song
      being opened: the same song, reached from a playlist and then from the
      dashboard, would come back with the playlist's setlist, prev/next and Back
      target. `clearSongQueue()` on that `<Link>`'s `onClick` covers it, and is
      the exported function's one production caller.

   Neither rule is sufficient alone, and that is recorded under **Decided** in
   `docs/use-cases.md` § *Walk a queue of songs* rather than left in a review
   thread. `RepertoireDashboard.tsx` is pinned by the complexity ratchet, so the
   two lines this costs oblige raising that entry's `max-lines` and
   `max-lines-per-function` in the same change — clause (e) requires each pin to
   equal its file's current worst number, which permits growth as long as the
   pin grows with it.

3. **Back goes to `originHref`, with no special case for a playlist.** No
   queue, or a queue with no `originHref`, walks history back as today. An
   implementation that reconstructs `/playlists/<id>` from anything other than
   the recorded origin is a defect: it satisfies "back works" for the only
   origin that exists today and strands RH-115.

4. **Ends are absent, never wrapped.** At index 0 there is no previous entry; at
   the last index there is no next one. Swipe, arrow keys and the prev arrow all
   already treat `null` as "nowhere to go" and keep that behaviour.

5. **A version not in the queue renders no chrome.** Matching is by
   `versionId`. A version absent from the queue leaves `nav` at `null`, which is
   what every setlist component already renders as nothing. A song whose
   repertoire row was removed mid-queue is still in the queue and still
   navigable — the queue entry is a version, and the page already renders
   version defaults when the owner holds no row (RH-132).

6. **Owner-context precedence — decided, with the real mechanism recorded.**
   Three sources can now name an owner: `?bandId=` in the URL, the queue's
   `owner`, and the `localStorage` band context (`bandContextStore`). The order
   is:

   **`?bandId=` wins whenever it is present. The queue's recorded `owner`
   applies only when the URL carries no `bandId`. Fast View never reads the
   `localStorage` band context itself.**

   The reason the round-1 spec gave for that last clause was measured from the
   import graph and was wrong in substance. The store *does* reach Fast View,
   laundered through the URL, on the second of the two entry paths:

   - **Playlist path** — `src/app/playlists/[id]/page.tsx:52` takes
     `const bandId = playlist.band_id` on the server; `PlaylistSongRow.tsx:69`
     puts it in the href. Resource-derived; no UI preference involved.
   - **Dashboard path** — `RepertoireDashboard.tsx:66` reads
     `useBandContextStore((s) => s.context)`, `:73` resolves it to
     `bandContext`, and `:364` renders
     `` href={`/songs/${song.version_id}/fast-view${bandContext.type === 'band' ? `?bandId=${bandContext.id}` : ''}`} ``.
     Here `?bandId=` **is** the `localStorage` preference, serialised at the
     moment the link was rendered.

   So the true statement is about the **channel**, not about absence: the URL is
   the single channel through which any owner choice — a stored preference or a
   server-derived `playlist.band_id` — reaches Fast View, and the page reads it
   once at `page.tsx:79` (`searchParams.get('bandId')`). Reading the store
   *again* inside Fast View would read the same source twice and would let a
   drifting preference override a URL the musician explicitly opened (a shared
   or bookmarked link, or a playlist link whose band came from the row). Hence
   the resolver takes exactly two inputs — the URL's `bandId` and the queue's
   `owner` — and the queue module imports `bandContextStore` nowhere (ER6).

   The frame "never contributes to a Fast View **read**" is also wrong and is
   dropped: `?bandId=` is a **write** argument too — `useSongStatus.ts:66`
   passes it to `actions.updateStatus`, `useLyricsEditor.ts:159` to
   `actions.updateLyrics`. That is precisely why the next point exists.

7. **The resolver's one caller, and why a client-writable value is still
   safe.** `resolveQueueOwner` is called from **exactly one production site**,
   `src/hooks/usePlaylistNav.ts`, and its result feeds **only** `fastViewHref`'s
   `bandId` — the prev/next/select hrefs the setlist chrome pushes. It is **not**
   called from `src/app/songs/[versionId]/fast-view/page.tsx`, which keeps
   taking `queryBandId` from `searchParams` alone and keeps threading that one
   value into its four controllers; the page does not import the queue module at
   all, and `PlaylistNavController` gains no owner or `bandId` field (ER9).

   The decision matters because `sessionStorage` is client-writable, so the
   question "can a musician forge a band id?" has to be answered rather than
   assumed. The answer: the resolved owner can only ever become a **URL
   parameter on a subsequent navigation**, which is no more than the musician
   can already do by typing `?bandId=` into the address bar today; and every
   band-scoped read and write re-checks membership server-side through
   `assertBandMember` (`src/lib/bands.ts:37`), which fails closed with "Access
   denied: not a member of this band". The queue carries context, not
   authority. Nothing in the authority or write path is edited by this task, and
   that is pinned against the baseline commit rather than asserted (ER9).

   **Corrected in review round 2.** An earlier draft of this section claimed the
   fallback is "unreachable on both live paths — the playlist row href still
   carries `?bandId=`, so the URL always wins where a queue exists". That is
   false. The playlist path is indeed always decided by the URL, but the
   *dashboard* path is the reachable case: its personal-context href carries no
   `bandId` at all, while a queue written earlier in the same tab is still in
   `sessionStorage`. A stale **band** queue would therefore have put
   `?bandId=<stale band>` on the prev/next/select hrefs of a song the queue has
   nothing to do with, flipping Fast View to that band's rows unasked. Not an
   authorization break — the paragraph above still holds, and `assertBandMember`
   is untouched — but the decided precedence misfiring on an unrelated song.

   That is a symptom of the queue outliving its navigation, and it is fixed
   where the cause is, not in the resolver: the dashboard link clears the queue,
   and `usePlaylistNav` treats a stored queue that does not hold the route's own
   version as no queue at all (§ 2a below). With both in place the resolver's
   fallback is again reached only by a queue that is genuinely about the song on
   screen — which today means the playlist path, where the URL wins anyway. The
   rule therefore still preserves current behaviour exactly, and exists wired
   and tested for RH-115, which will build queues with no URL `bandId`.

   Record the decision, the channel reason and the authority sentence in
   `docs/use-cases.md` § *Walk a queue of songs* → **Decided**, replacing the
   matching "Not investigated" note in `docs/plans/repertoire-rework.md:301`.

8. **`returnTo` disappears from the code entirely — including comments.** The
   identifier must not survive anywhere under `src/`, so a comment explaining
   the change must describe it in words ("the deleted playlist return
   parameter") and must not spell the old parameter name. `src/lib/playlistNav.ts:96`
   is today a **comment** occurrence, which is what makes this ban load-bearing:
   the absence check is then a plain grep with no comment-stripping, and the
   historical account lives in `docs/` where it belongs.

9. **No dead code is left behind.** Dropping the injected nav action bundle
   leaves `src/app/fastViewNavActions.ts` with no consumer at all — delete the
   file — plus `OFFLINE_FIRST_PLAYLIST_NAV_ACTIONS` (`fastViewOfflineActions.ts:33`)
   and the `PlaylistNavActions` type. `npm run lint` is `eslint . --max-warnings=0`
   and does **not** see this; `npm run lint:dead` (knip) is the separate gate the
   `dead-code` CI job runs (`AGENTS.md:98`), it exits 0 at the baseline today,
   and ER13 reads its exit code. `getPlaylistDetailsWithEntriesAction` itself
   stays — `src/app/offlineActions.ts:25` still consumes it.

### Files touched

- `src/lib/songQueue.ts` — **new.** The queue: its types, the `sessionStorage`
  read/write/clear, the neighbour lookup and the two-input owner resolver.
  Client safe: imports neither `react`/`react-dom` nor `pg`, nothing from
  `@/app/*` (F21), and **not** `@/store/bandContextStore`. `export function`
  declarations, camelCase module name, per `AGENTS.md`. Browser-API access is
  guarded so an import under the `node` test environment neither throws on
  import nor on call. Named exports: `readSongQueue`, `writeSongQueue`,
  `clearSongQueue`, `queueNeighbours`, `resolveQueueOwner`. `queueNeighbours` is
  the surface RH-134's window fetch will consume; this task does not fetch.
- `src/lib/__tests__/songQueue.test.ts` — **new.** `// @vitest-environment jsdom`
  as the literal first line (jsdom supplies `sessionStorage`; `src/lib` tests
  default to `node`, which has none, and `scrollHost.test.ts` is the only
  existing `src/lib` file opting into jsdom — this is the second).
- `src/lib/__tests__/songQueueNodeEnv.test.ts` — **new.** Deliberately carries
  **no** environment pragma, so it runs in the default `node` environment and
  proves the guard: importing the module and calling its readers there must not
  throw (ER12). Separate file because a pragma is per-file.
- `src/lib/playlistNav.ts` — delete `playlistIdFromReturnTo` (`:61`) and the
  return parameter from `fastViewHref` (`:103`, keeps `bandId`); `backTarget`
  (`:197`) takes the recorded origin href; `computePlaylistNav` is fed queue
  entries and its `PlaylistNav` drops the unused `playlistId` and renames
  `playlistName` to `queueLabel` so a non-playlist queue can label itself; the
  `:96` docblock loses the old parameter name.
- `src/hooks/usePlaylistNav.ts` — the setlist effect (`:89-109`) reads the queue
  instead of calling the injected action; the `PlaylistNavActions` interface
  (`:21-26`), the `actions` and `returnTo` options and the old href
  construction go; `resolveQueueOwner` is called here and its result reaches
  only `fastViewHref`; `PlaylistNavController` gains no owner field.
- `src/app/fastViewNavActions.ts` — **deleted**; `PLAYLIST_NAV_ACTIONS` has no
  other consumer.
- `src/app/fastViewOfflineActions.ts` — drop `OFFLINE_FIRST_PLAYLIST_NAV_ACTIONS`
  (`:33`) and its import, and correct the "seven action bundles" docblock to six.
- `src/lib/offlineFirst.ts` — drop the `getPlaylistDetailsWithEntries` entry
  from `OFFLINE_READERS` (`:206`) and correct the "The five reads Fast View
  makes" docblock (`:198`) to four. Leave the offline snapshot itself and
  `OFFLINE_DOWNLOAD_ACTIONS` (deliberately unwrapped, RH-79) alone.
- `src/lib/__tests__/offlineFirst.test.ts` — **the stale suite.** It still
  exercises the reader being removed: the "rethrows the original error when the
  offline reader itself throws" case (~`:285`) and both cases of the
  `describe('offlineFirst — the offline readers')` block (~`:298-320`). Delete
  or re-point them; leaving them is a red suite, not a warning.
- `src/app/songs/[versionId]/fast-view/page.tsx` — stops reading `returnTo`
  (`:78`) and stops passing it or the nav action bundle to `usePlaylistNav`.
  Keeps `queryBandId` (`:79`) and keeps threading it into the four controllers
  unchanged; does not import the queue module.
- `src/components/playlists/PlaylistSongRow.tsx` (`:69`) — the href loses its
  return parameter and keeps `?bandId=`.
- `src/components/playlists/PlaylistSongList.tsx` — writes the queue on a row
  click, built from `songs` (not `filteredSongs`), in playlist order.
- `src/components/fastview/SetlistPanel.tsx` (`:8`, `:26`, `:39-40`),
  `src/components/fastview/SetlistDrawer.tsx` (`:37`),
  `src/components/fastview/SetlistSidebar.tsx` (`:27`) — the renamed label prop.
  `playlistName` must survive nowhere under `src/` (ER11); the rename otherwise
  shows up only as a type error nobody runs.
- `src/lib/__tests__/playlistNav.test.ts`,
  `src/hooks/__tests__/usePlaylistNav.test.tsx`,
  `src/app/songs/__tests__/fastViewPage.test.tsx`,
  `src/components/playlists/__tests__/PlaylistSongList.test.tsx` (already
  jsdom), `src/components/fastview/__tests__/SetlistDrawer.test.tsx`,
  `src/components/fastview/__tests__/SetlistSidebar.test.tsx` — the existing
  suites that assert the old parameter or the old prop name; rewritten against
  the queue.
- `docs/use-cases.md` — § *Walk a queue of songs*: the owner-context precedence
  and its channel reason under **Decided**, the authority sentence, and the one
  sentence reconciling "a position in it" with "No progress is kept".
- `docs/plans/repertoire-rework.md` — the `:301` "Not investigated" note on
  `?bandId=` versus the store is replaced by a pointer to the decision.
- `package.json` — version bump, per the standing rule for a commit to master.
- `eslint.config.mjs` — **only** if a pinned file's worst number moves. The
  override block is a ratchet: a pinned file may grow if its pin is raised in
  the same change, simplifying a pinned file obliges lowering its pin, the entry
  count may only shrink, and no entry may be added for new code. None of the
  files this task touches is pinned today, so the expected edit here is none.
  The ratchet is compared against the **baseline commit `e070cdb`** (14
  entries), never against `HEAD`: this task commits to master, after which
  `HEAD:eslint.config.mjs` is the working-tree file and any comparison with it
  is vacuous, while `complexityBudget.test.ts:147` only caps the list at 17.

### Test criteria

Unit tests, all in the existing `vitest` setup, no DB:

- The queue round-trips through `sessionStorage`; an empty store (a fresh tab)
  and a malformed value both read as no queue, without throwing.
- A written queue entry has exactly the three navigation fields — the stored
  JSON is inspected directly, so field creep is caught.
- The queue written from a filtered playlist view holds **every** song, proven
  by breaking it: switching the write to the filtered list must turn a test red.
- Back pushes the recorded origin for a playlist origin **and** for a
  non-playlist origin, and walks history back with no queue.
- A version absent from the queue yields `nav === null` and no setlist chrome.
- Prev absent at index 0, next absent at the last index, no wraparound.
- The owner resolver with all three sources disagreeing, and the resolver's call
  site confined to href construction while the authority and write-path files
  stay byte-identical to `e070cdb`.
- The module imports and runs under the `node` environment without throwing.
- The whole suite; lint and `lint:dead` with their exit codes read out of band
  (the local `rtk` wrapper masks `npm run lint`'s); the coverage thresholds
  (a breach is an exit code, not a failed test); the ratchet against `e070cdb`;
  the version floor derived with `sort -V`.

## Mandated text for `docs/use-cases.md`

These four sentences are **copied verbatim**, unmodified, into
`docs/use-cases.md` section `## Walk a queue of songs`, under its **Decided**
heading. They are deliberately plain ASCII on one line each, with no backticks,
no smart quotes, no apostrophes and no wrapping, because ER6 checks each one with
`grep -F` inside a single-quoted shell argument, which is line-oriented and which
an apostrophe would break,
which is line-oriented: a reworded or wrapped sentence cannot match and fails
the result. Surrounding prose may be added freely; these four lines may not be
edited.

S1. When the URL carries a bandId query parameter, that value wins: it decides the owner for everything Fast View does, whatever else is stored.

S2. A recorded queue owner applies only when the URL carries no bandId at all.

S3. Fast View never reads the stored band context itself, because where that preference matters it has already been serialised into the bandId of the URL by the link that was clicked, which makes the URL the single channel through which any owner choice reaches this screen.

S4. A queue keeps no position: the current place is derived at read time by matching the versionId of the route against the stored entries.

The `S1.`-`S4.` labels are **not** part of the text to copy; they exist so this
spec and ER6 can refer to the sentences. S3 is the sentence that replaces the
false claim an earlier draft of this spec carried ("the store has never had a
say on this page"): that claim is true of the import graph and false of the
data flow, because `RepertoireDashboard.tsx:66` reads the store and `:364`
serialises it into the Fast View href.

## Expected Results

Thirteen results; the authoritative, self-contained wording of each is the
task's `expected_results` on the board — `meridian:qa` is given those and
nothing else.

- [ ] ER1 — the client-safe queue module exists with the named surface.
- [ ] ER2 — the queue round-trips through `sessionStorage`; a fresh tab reads none.
- [ ] ER3 — the old return parameter is gone from every file under `src/`.
- [ ] ER4 — back goes to the recorded origin from both origin kinds; no queue, no chrome.
- [ ] ER5 — prev absent at index 0, next absent at the last index, no wraparound.
- [ ] ER6 — the four mandated sentences are in `docs/use-cases.md` verbatim, and the resolver is tested with the sources disagreeing.
- [ ] ER7 — a stored queue entry carries only version id, title and artist.
- [ ] ER8 — breaking the resolver turns the precedence test red.
- [ ] ER9 — the resolver has one production caller, never reaches a write, and the authority path is untouched.
- [ ] ER10 — a queue written under an active filter still holds the whole playlist.
- [ ] ER11 — the label rename is complete and rendered. The absence grep is
      **scoped to the setlist surface**: `playlistName` is independently a persisted
      offline-snapshot key (`offlineStore.ts`, `offlineSnapshot.ts:317`'s validator,
      `offlineSnapshotV5.ts`), and in JS the identifier is the serialised key, so an
      unscoped rename would invalidate every snapshot already on a device.
- [ ] ER12 — the module imports and answers safely under the `node` environment.
- [ ] ER13 — lint, dead code, suite, coverage, ratchet and version gates hold.

## Out of Scope

RH-134's window fetch and write-invalidation; RH-115's computed and hand-picked
queues; server-side queue persistence; queue progress; any change to who may
write, to `assertBandMember`, to the offline snapshot, or to `?bandId=`'s
presence in the URL.

# RH-71 — PlaylistDetailPage part 6/6: `/playlists/[id]` as a Server Component, the override deleted, F11 closed

Parent: RH-53 (F11), part 6 of 6. Depends on RH-70 (`bd3c8cf`, done).
Baseline for every measurement in this document: `bd3c8cf`
(`refactor(RH-70): extract the header and Spotify sync, drop the focus effects, reduce panels`),
tree clean.

## Scope

Convert exactly one route — `src/app/playlists/[id]/page.tsx`, 323 lines,
`"use client"` on line 1 — into an `async` Server Component that resolves the
session itself, reads the playlist and the repertoire through `src/lib`, and
injects its Server Actions into one `"use client"` island,
`src/components/playlists/PlaylistDetailView.tsx`. This is what RH-41 deferred
to RH-53 in the Out of Scope of `docs/tasks/RH-63-spec.md`, and it is the last
part of the F11 split, so it also carries the close-out: the page's
`complexity-budget/override` entry is **deleted** (not re-homed), the ratchet
moves 20 -> 19 with AGENTS.md in lockstep, and
`docs/plans/code-quality-review.md` gets F11's `**Status:**` line and the
section-5 T6 row.

Four things come with the conversion and are part of this task:

1. **The owner-context decision** (see Approach): where the repertoire read's
   owner comes from once a Server Component renders the page, given that
   `src/store/bandContextStore.ts` is a zustand `persist` store in localStorage
   that no Server Component can read and that no island may read during a
   server-rendered paint.
2. **The mount effect** (page lines 79-92) and `refreshPlaylist`'s load role
   (64-77), both deleted. Post-mutation refresh becomes `router.refresh()` over
   RH-63's overlay pattern.
3. **The inline `// eslint-disable-next-line react-hooks/set-state-in-effect`**
   at line 83 (RH-67's QA suggestion), removed by deleting the effect it
   guards, never by relocating the comment.
4. **Two new lower layers**, because the island must fit inside the base
   complexity budget with no override of its own: the pure optimistic overlay in
   `src/lib/playlistOverlay.ts` and the controller hook
   `src/hooks/usePlaylistDetail.ts`. Measured numbers in the Approach.

Behaviour is preserved: same header with its rename, delete confirmation and
Spotify strip, same playlist tag bar with its ownership gate, same mastery
summary, same dismissable error banner, same in-playlist text filter and tag
filter bar, same song rows with their status badge, tag chips and remove
button, same add-song picker, same redirect to `/playlists` after a delete and
for a playlist the caller may not read. Every accessible name
`e2e/playlist-detail.spec.ts` reaches for survives unchanged.

Two visible differences are carved out of that preservation, and the second of
them is a **user-visible product change** with six numbered cases, on the
display side and on the write side. Both are accepted here, and approving this
spec approves them:

- The route no longer paints its own `Spinner` + `Loading...` state. The server
  ships finished markup, and the streamed fallback while it is produced is
  `src/app/loading.tsx`, the same one `/bands`, `/playlists` and
  `/admin/moderation` show.
- The repertoire shown beside the songs becomes the **playlist owner's**, not
  the browsing user's active band context, and the page's two repertoire writes
  are authorized against that same owner — where today they are authorized
  against the browsing user personally under every hat, never against the
  context (see Approach). For a personal playlist
  opened in the personal context — every case the e2e net exercises, and the
  common case in the product — this is byte-for-byte today's behaviour. In
  every other combination of hat and playlist it is not. The full delta against
  `bd3c8cf` has a display half and a write half; both are accepted here.

  **Display half — which repertoire the rows show.**

  1. **Personal playlist, band hat B on.** Today: band B's aggregate, rendered
     as a read-only `<span>` with the "Band status is computed from all members"
     tooltip, and every Fast View link carries `&bandId=B`
     (`PlaylistSongRow.tsx:55,69-75`). After: the user's own statuses, the
     cycling `<button>` back, and no `&bandId=` on the links.
  2. **Band playlist of band A, personal hat on.** Today: the user's own
     statuses with the cycling button. After: band A's aggregate as a read-only
     `<span>`, so from this route the user can no longer cycle their own status
     at all, and the Fast View links carry `&bandId=A`. Cycling a personal
     status remains available on `/` and through Fast View itself.
  3. **Band playlist of band A, band B's hat on (B != A).** Today: band B's
     repertoire is displayed beside band A's playlist — statuses and tag chips
     that belong to a band this playlist has nothing to do with. After: band A's
     repertoire, which is the only one this playlist's rows can be written to.
  4. **Switching the band context in `AppLayout` no longer changes this route.**
     Today `refreshPlaylist` lists `bandId` in its dependency array
     (`page.tsx:77`), so the ContextSwitcher re-runs the whole load. After, the
     route's owner is the playlist's own and the switcher is inert here. It
     keeps its meaning on the routes that do read it (`/`, `/bands`, Fast
     View), which is why it stays in the header. The page's own add-song picker
     is not one of them and never was: `SONG_PICKER_ACTIONS` binds
     `addSongAction` with no owner argument
     (`src/app/songPickerActions.ts:24`, called with one argument at
     `useSongPicker.ts:180`), so adding a song already writes the personal
     repertoire row under every hat, today and after this task (Out of Scope).

  **Write half — which repertoire row an edit lands on.** Today **every**
  repertoire write on this route passes no owner at all —
  `await updateSongStatus(cycle.entry.id, cycle.status)` (`page.tsx:144`) and
  `if (entry) await updateSongTags(entry.id, tags)` (`page.tsx:196`), both
  through wrappers whose third `bandId` parameter is optional
  (`src/app/actions/repertoire.ts:46,53`) — so every write is authorized as
  `{ userId }` whatever hat is on, while the entry ids it sends come from the
  repertoire that was *read* under the hat. After this task both calls carry
  `playlist.band_id`, and for the first time on this route the owner read and
  the owner written are the same one. Two consequences, and the second is the
  user-visible price. Both concern a song the displayed repertoire actually
  carries an entry for; for a song with no entry the tag row is a silent no-op
  today (`useTagEditor.ts:105-109,116`) and stays one.

  5. **Under any band hat, a song-tag edit stops failing (cases 1 and 3).**
     Today the ids in the rows are that band's rows and the write is personal,
     so adding or removing a song tag raises
     `Repertoire entry not found or access denied` (`src/lib/songs.ts:114,133`),
     which reaches the error banner wrapped as
     `Failed to update song tags: Repertoire entry not found or access denied`
     (`songs.ts:137`, surfaced verbatim by `useTagEditor.ts:97`).
     That is reachable in case 1 exactly as much as in case 3, because
     `TagEditRow` is rendered unconditionally (`PlaylistSongRow.tsx:114-120`);
     a *status* cycle is not reachable under any band hat at all, since
     `PlaylistSongRow.tsx:69` swaps the cycling button for a read-only `<span>`.
     After: the write is authorized against the owner the rows were read from,
     and it succeeds.
  6. **On a band playlist in the personal hat, a song-tag edit becomes a shared
     edit (case 2).** Today it writes the user's **own** repertoire row and
     succeeds privately. After this task it carries band A's id and writes band
     A's **shared** row, which every member of A then sees. Accepted, because
     the alternative is worse in the same breath: after case 2 the row already
     displays band A's tags, so a write that still landed on the user's private
     row would be an edit whose result never appears in the chip that triggered
     it.

  The single argument for all six: the repertoire the page **displays** must be
  the one its writes are **authorized against**, and that is the playlist's own
  owner — `getPlaylistWithSongs` already proved the caller may act as that
  owner. Cases 3 and 5 are bug fixes; cases 1, 2, 4 and 6 are the honest price
  of making the two halves agree. The e2e net tolerates all of them
  (`playlist-detail.spec.ts` never leaves the personal context and its fixtures
  are personal playlists, so the `Status: Unknown. Click to advance.` button
  branch it asserts on survives), so no assertion in it is weakened to
  accommodate this.

Nothing else changes: no Server Action signature changes, no
`src/app/actions/**` change, no `src/lib/playlists.ts` or `src/lib/songs.ts`
change, no `src/app/api/**` change, no `src/store/**` change, no `src/proxy.ts`
change (its matcher already carries `/playlists/(.*)`), and no change to any of
the components and hooks RH-66..RH-70 extracted.

## Audit at `bd3c8cf`

### `src/app/playlists/[id]/page.tsx` — 323 lines, `"use client"` on line 1

`grep -c "" 'src/app/playlists/[id]/page.tsx'` prints `323`.
`rtk proxy npx eslint 'src/app/playlists/[id]/page.tsx'` exits `0` with no
output: the file contributes nothing to the repo total of
`22 problems (8 errors, 14 warnings)`, because its one violation is absorbed by
its override, `eslint.config.mjs:74`:

```
{ name: "complexity-budget/override", files: ["src/app/playlists/\\[id\\]/page.tsx"],
  rules: { "max-lines-per-function": ["error", 282] } },
```

Forced measurement
(`--rule '{"complexity":["error",1],"max-lines-per-function":["error",1]}'`):
`PlaylistDetailPage` is **282 lines, complexity 10**; the largest nested arrow
is 14 lines at complexity 3. The file is under the base `max-lines` 400 and the
base `complexity` 15 already — **the 282-line function is the only thing keeping
the override alive**, which is why this part can delete the entry outright.

What the component holds, in file order: `useParams`/`useRouter` (43-45),
`authClient.useSession()` and the derived `currentUserId` (46-47, F13),
`useBandContextStore((s) => s.bandId())` (48), seven `useState`
(`playlist`, `songs`, `repertoireMap`, `loading`, `error`, `activeTagFilter`,
`songFilterQuery`, 50-58), RH-70's panel `useReducer` (62),
`refreshPlaylist` (64-77: `getPlaylistWithSongsAction`, a `router.replace("/playlists")`
when it answers `null`, then `getRepertoireAction(bandId)` into a `Map`), the
mount effect (79-92) with the inline `set-state-in-effect` disable at 83, two
`useMemo` (94-106), `useSpotifySync` (110-115), `useSongPicker` (118-125),
`handleRemoveSong` (127-136), `handleStatusCycle` (138-150), `handleRename`
(152-166), the two `useTagEditor` controllers (172-201), `handleDelete`
(203-211), the `loading` branch (213-220), `if (!playlist) return null` (222)
and 99 lines of JSX (224-322).

### The reads

- `getPlaylistWithSongs(id, userId)` (`src/lib/playlists.ts:206-262`) returns a
  `Playlist` with its `songs` array, or `null`. It is **access-scoped in SQL** —
  `WHERE p.id = $1 AND (p.user_id = $2 OR p.band_id IN (SELECT band_id FROM band_members WHERE user_id = $2))`
  — so a playlist the caller may not read is indistinguishable from one that
  does not exist, and a non-null answer proves either ownership or membership
  of the owning band. The page's client wrapper is
  `getPlaylistWithSongsAction(id)`, which resolves the session with
  `getRequiredUserId()` and delegates; the Server Component calls the lib
  function directly, exactly as `/playlists` and `/bands` do.
- `getRepertoireAction(bandId)` -> `resolveOwner(bandId)` ->
  `getRepertoire(owner)` (`src/lib/songs.ts:35`) returns the whole repertoire of
  one owner, which the page indexes into a `Map` by `song_id`. `resolveOwner`
  asserts band membership before returning `{ bandId }`.
- `bandId` from the store is read twice more, both inside `PlaylistSongRow`
  (`src/components/playlists/PlaylistSongRow.tsx:55,69`): the Fast View link's
  `&bandId=` suffix, and the band-mode branch that renders the mastery badge as
  a read-only `<span>` ("Band status is computed from all members") instead of
  the cycling `<button>`.

### Why the band context cannot stay a client read on this route

The repertoire map is rendered in the server paint (every song row's badge and
tag chips come out of it), so its owner has to be known on the server. The
store cannot supply it:

- No Server Component can read localStorage.
- An island that reads the store during render would render `bandId === null`
  on the server (the `persist` default) and the rehydrated value on the client,
  which is a hydration mismatch on the badge branch and on the Fast View href.
  Today's page is immune only because its `loading` branch masks the whole tree
  during the server paint — the branch this task deletes.
- The `mounted` flag `AppLayout.tsx:44-48,147-151` uses to dodge exactly that
  mismatch is a `setState` inside a `useEffect`: it is one of the eight eslint
  **errors** in today's `22 problems (8 errors, 14 warnings)`. Repeating it here
  would take the repo to 23 problems, which ER12 forbids.

So the owner has to come from data the server already holds. It does: the
playlist row itself.

## Approach

### Owner context: the playlist's own owner decides

**Decision.** `bandId = playlist.band_id ?? null`, resolved on the server from
the row `getPlaylistWithSongs` just returned, and the repertoire is read under
that owner: `getRepertoire(bandId ? { bandId } : { userId })`. The band-context
store is not read by this route at all — neither by the page nor by the island.

It needs no authorization of its own: `getPlaylistWithSongs` returned non-null,
which already proves the caller is a member of `playlist.band_id`. The two
repertoire writes carry the same `bandId` through the existing optional third
parameter of `updateSongStatusAction` / `updateSongTagsAction`, whose
`resolveOwner` re-asserts membership server-side and fails closed. Today
**neither call passes it** (`page.tsx:144,196`), so every write on this route is
authorized as `{ userId }` under any hat; after this task the owner the page
reads under and the owner it writes under are the same one, for the first time
on this route. That is the write half of Scope's delta — cases 5 and 6 — and it
is what makes the tag edit in cases 1 and 3 stop failing and the tag edit in
case 2 become a shared write.

The alternatives, and why not:

| | (a) keep the store read in the island | (b) always personal (`{ userId }`) | (c) `/playlists/<id>?bandId=` | **(d) the playlist's owner** |
|---|---|---|---|---|
| Server-resolvable | No — needs a mount effect or a `mounted` flag, i.e. a new eslint error | Yes | Yes, from `searchParams` | Yes, from the row already read |
| Hydration | Mismatch on the badge branch and the Fast View href | Clean | Clean | Clean |
| Behaviour delta | None, but unreachable | Band playlists lose the aggregate badge entirely — a live UI branch becomes dead | Per-URL semantics; every entry point (`PlaylistsView`, Fast View's `returnTo`, a bookmark) must carry the parameter or silently mean "personal" | **Six cases, all accepted** — Scope, cases 1-6: personal playlist under a band hat flips back to own statuses; band playlist in the personal hat becomes the aggregate `<span>` and loses status cycling from this route; a band playlist under another band's hat now reads its own band; the ContextSwitcher stops affecting this route; a song-tag edit under any band hat stops failing; and a song-tag edit on a band playlist in the personal hat moves from the user's own row to the band's shared row |
| Read/write agreement | Broken today, under **any** band hat: the row ids come from the band's repertoire but neither write on this route passes an owner (`page.tsx:144,196`), so a song-tag edit is authorized as `{ userId }` and rejected with `Repertoire entry not found or access denied` | Agrees | Agrees | Agrees |

(d)'s delta is the six cases enumerated in Scope — not one, and neither of the
two that cost something is merely cosmetic: a band playlist in the personal hat
loses own-status cycling from this route (case 2), and a song tag edited there
now lands on the band's shared row instead of the user's own (case 6). (b)
shares case 1 with (d) exactly, reaches cases 4 and 5 by its own route (the
switcher goes inert here too, and read and write agree, so the tag edit stops
failing), removes case 3's bug with a different result (band A's playlist under
band B's hat would show the browsing user's *personal* statuses, not band A's)
and adds one case of its own — a band playlist browsed
under its **own** band's hat, today the aggregate `<span>`, would show personal
statuses — which kills a live `PlaylistSongRow` branch outright and leaves the
"Band status is computed from all members" tooltip unreachable. (b) does reach
read/write agreement, but only by making this route incapable of showing or
editing band data at all, while (d) keeps every branch reachable and makes that
tooltip true wherever it renders. (a) is impossible without a new lint error,
and (c) was already rejected for `/playlists` by RH-63 for reasons that apply
here unchanged. The operator approves (d) with its six cases by approving this
spec; ER15 pins the decision mechanically so an implementation cannot quietly
fall back to (b).

### The server page

`src/app/playlists/[id]/page.tsx`, `async`, no `"use client"`:
resolve `getSession()` and `redirect("/login")` when there is no user id (the
`getSession()` rather than `getRequiredUserId()` choice is RH-62's: the latter
throws a 500 document where a redirect is wanted, and `redirect()` returns
`never`, which narrows the id to `string`); read `const { id } = await params`
in the Next.js 16 shape `src/app/join/[code]/page.tsx:11,16` uses; call
`getPlaylistWithSongs(id, userId)` and `redirect("/playlists")` when it answers
`null` — the same destination `refreshPlaylist` sends that case to today, not a
404; derive `bandId` as `const bandId = playlist.band_id ?? null` and read the
repertoire under it, with the owner expression written **inline on the call's
own physical line** (`getRepertoire(bandId ? { bandId } : { userId })`, not
hoisted into a separate `const owner = ...`, which is what makes ER15's greps
decidable); render the island with a
module-scope `PLAYLIST_DETAIL_ACTIONS` bundle plus the existing
`SONG_PICKER_ACTIONS`. The route is dynamic by construction because
`getSession()` awaits `headers()`; no `export const dynamic` is added. The
draft written while sizing this task measures **45 lines**.

### The island, the controller and the overlay

Three files, in the layers AGENTS.md prescribes, because a straight port of the
282-line body into one island measures over 200 lines and **no new file may take
an override** — the list is a ratchet that may only shrink:

- **`src/lib/playlistOverlay.ts`** — pure, no React, no `@/lib/db`. The overlay
  value, its reducer and the selector that applies it: `EMPTY_PLAYLIST_OVERLAY`,
  `playlistOverlayReducer(state, action)` over an explicit action union
  (rename, playlist tags, remove song, restore song, songs reported by the
  picker, repertoire entry), and
  `applyDetailOverlay(serverPlaylist, repertoire, overlay)` returning
  `{ playlist, songs, repertoireMap }`, over a `PlaylistDetailOverlay` value
  type. The names are deliberately **not** `applyPlaylistOverlay` /
  `PlaylistOverlay`: RH-63 already exports those from `src/lib/playlistList.ts`
  for `PlaylistsView`, and two same-named lib exports one import away from each
  other would confuse the next reader (no gate catches it — `knip` checks
  unused, not ambiguous, names). Exports are function declarations
  (guarded by `namingConventions.test.ts`); `EMPTY_PLAYLIST_OVERLAY` is a value,
  the `NO_PANEL` precedent. The selector builds the map through the existing
  `withRepertoireEntry` from `@/lib/playlistDetail`, whose only production
  callers are the three page lines this task deletes — if the implementation
  drops that reuse, `npm run lint:dead` fails on the orphaned export and it must
  be deleted together with its tests instead (ER12).
- **`src/hooks/usePlaylistDetail.ts`** — the controller: the error banner, the
  two filter selections, RH-70's panel reducer, the overlay reducer, the two
  `useMemo` derivations, `useSpotifySync`, `useSongPicker`, the two
  `useTagEditor` controllers and the five commands (`removeSong`, `cycleStatus`,
  `rename`, `remove`, plus the picker's `onSongsChanged`). Commands and values
  only, no raw `set*` members (F14). It takes `onRefresh` and `onDeleted`
  callbacks rather than importing `next/navigation`, so it is testable with
  `renderHook` and no router mock. `PlaylistDetailActions` — the injected-action
  shape — is exported from the hook rather than from the island, because the
  hook is what consumes it; the island only forwards. RH-63's
  `PlaylistsViewActions` lives in the island because RH-63 has no hook layer.
- **`src/components/playlists/PlaylistDetailView.tsx`** — `"use client";` on
  line 1, the only island the page imports. It owns `useRouter`, passes
  `onRefresh: () => router.refresh()` and
  `onDeleted: () => router.replace("/playlists")` into the hook, and wires the
  controller to `PlaylistDetailHeader`, `PlaylistTagBar`, `PlaylistSummary`, the
  error banner, the in-playlist filter input, `TagFilterBar`, `PlaylistSongList`
  and `SongPicker` — the composition root of everything RH-67..RH-70 built.

**Measured on the reference extraction** (probe files written under `src/`,
linted, then deleted): the island is **143 lines, its function 119 lines at
complexity 5**; the hook is **207 lines, its function 176 lines at complexity 1**
(every branch lives in a nested callback, the worst of which is 16 lines at
complexity 4). `rtk proxy npx eslint` on both with the real config printed
nothing at all, so both sit inside the base budget of `complexity` 15,
`max-depth` 4, `max-lines-per-function` 200, `max-params` 4 and `max-lines` 400
with no override — which is the proof that the six-part split succeeded.

**The comment budget is the tight one.** `max-lines-per-function` runs with
default options (`eslint.config.mjs:47`), so **comments count**, and the
reference hook already spends 176 of its 200 lines in a house style that
comments heavily. ER5 caps it at 195, i.e. 19 lines of headroom for the whole
hook's prose: the module-level doc comment sits at file scope and is free, but
per-command comments inside the function body are not. Spend them on the two
that need justifying (the revert asymmetry, the picker's `onSongsChanged`) and
keep the rest at file scope. If the ceiling is still hit, the fallback is a
fourth module — the two `useTagEditor` controllers and their five handlers move
to `src/hooks/usePlaylistTagEditors.ts` — never a new override entry, which the
ratchet forbids.

### Refresh strategy after a mutation: RH-63's overlay, not a state copy

No `revalidatePath` is added, for RH-62's and RH-63's reason: touching
`src/app/actions/**` would drag `actionSessionGuard` / `actionAuthorizationGuard`
/ `actionDataAccessGuard` into a refactor whose subject is the page layer, and
revalidating a route that is dynamic-by-session buys nothing.

The server props are the source of truth and are never copied into `useState` —
a `useState(initial)` initialiser is ignored on re-render, so a `router.refresh()`
would leave the copy stale forever. The hook keeps only the in-flight local
edits and re-applies them on top of the props at render time, exactly as
`PlaylistsView` does with `applyPlaylistOverlay`. Every mutation writes its
overlay entry first (which is what makes the optimistic assertions in
`e2e/playlist-detail.spec.ts` pass without a reload), then awaits the Server
Action, then calls `router.refresh()`:

- **Rename** -> `updatePlaylist(id, { name })`; failure leaves the banner and
  the panel as today.
- **Playlist tags / song tags** -> `updatePlaylist(id, { tags })` /
  `updateSongTags(entryId, tags, bandId)`; a rejection is reported through the
  banner **without** reverting, exactly as RH-69 left it.
- **Status cycle** -> `updateSongStatus(entryId, status, bandId)`; a rejection
  reverts to the entry captured before the write, as today.
- **Remove song** -> the id joins the removed set, then
  `removeSongFromPlaylist`, then `sync.pushIfNeeded()`; a rejection restores it.
- **Picker add** -> `useSongPicker` already reloads the playlist and reports the
  fresh list through `onSongsChanged`; the hook records the rows the server
  props do not carry yet and refreshes.
- **Spotify pull** -> `onSynced` becomes `router.refresh()` instead of
  `refreshPlaylist`.
- **Delete** -> `deletePlaylist` then `router.replace("/playlists")`, unchanged.

Every overlay entry is idempotent by construction, so nothing has to clear
them: after the refresh a removed id is already absent from the props, a
renamed playlist already carries the name, an added row is already in the list
(matched by `song_id`) and an overridden entry already equals the server row.

### eslint, override, ratchet and AGENTS.md

The inline `set-state-in-effect` disable disappears with the effect it guards;
nothing else on the page reported a problem, so the repo total stays
`22 problems (8 errors, 14 warnings)` — this task removes no problem from the
count (the suppressed one was never counted) and must add none. The page's
override entry is **deleted**, taking the list 20 -> 19,
`MAX_OVERRIDES = 20 -> 19`, the test title to
`lists at most 19 per-file overrides, each naming a file that exists`, and
AGENTS.md's F20 sentence from "past 20 entries" to "past 19 entries" — the
RH-55 / RH-62 / RH-63 precedent (24 -> 23 -> 22 -> 21). The second AGENTS.md
edit is the server-page bullet on line 49, which names `/bands`,
`/admin/moderation` and `/playlists` and must now name `/playlists/[id]` too.
Two lines changed, nothing else, and the `nextjs-agent-rules` block stays
byte-identical.

### Test plan

- **`src/lib/__tests__/playlistOverlay.test.ts`** — node environment, no mocks,
  12 tests (names in ER7).
- **`src/hooks/__tests__/usePlaylistDetail.test.tsx`** — literal first line
  `// @vitest-environment jsdom`, `afterEach(cleanup)`, `renderHook` against
  `vi.fn()` actions and a stubbed `global.fetch`, 12 tests (names in ER8), in
  the style of `src/hooks/__tests__/useSpotifySync.test.tsx`.
- **`src/components/playlists/__tests__/PlaylistDetailView.test.tsx`** — same
  jsdom preamble, `vi.mock('next/navigation')` with hoisted `vi.fn()`s in the
  style of `PlaylistsView.test.tsx`, 9 tests (names in ER9). One of them stubs
  `globalThis.fetch` and asserts a plain render never calls it — the mechanical
  proof that the mount read is gone rather than relocated.
- **The server half** is not unit-tested: an `async` Server Component that
  awaits `headers()` and imports `'use server'` modules is not renderable under
  vitest, and `src/app/**/page.tsx` is outside the coverage universe by policy.
  It is verified by the build manifests (ER10), by `curl` against `next start`
  (ER10) and by two Playwright tests appended to `e2e/server-pages.spec.ts`
  (ER11), which assert on the raw HTTP document with no JavaScript executed.
- **RH-66's characterization net keeps every assertion it has, and gains a
  hydration wait it cannot do without.** See the next subsection: this is the
  one place the task must edit `e2e/`, and it edits mechanics only.

### The hydration wait the deleted loading state was paying for

`openPlaylist` (`e2e/helpers.ts:243`) and `reopenPlaylist`
(`e2e/playlist-detail.spec.ts:102`) both return as soon as the playlist heading
is visible, and both document in prose why that is enough: "the detail route
renders a loading state until its data resolves". **This task deletes exactly
that loading state.** From RH-71 onward the heading is in the server document,
so both helpers return before React hydrates, and the tests act immediately:
`adds two catalog songs...` does `pickerToggle.click()` then a 5 s-default
`expect(pickerInput).toBeVisible()`, and `filters the playlist by title text`
does `filter.fill(...)` then a 5 s-default count assertion. A click swallowed
before hydration is simply lost, and a `fill` doubly so — React never re-runs
the handler — so these fail rather than flake. The repo already knows this
happens: `e2e/helpers.ts:220-226` carries a `toPass` retry wrapper added when
RH-63 server-rendered `/playlists`, with the comment "The header paints before
React hydrates, so a click can be swallowed on a cold route."

So this task hardens both helpers with that same pattern, and nothing else in
`e2e/` changes:

- **`e2e/helpers.ts` gains one exported helper**,
  `waitForPlaylistDetailHydrated(page)`, which proves an event handler ran on
  the detail route and leaves the page exactly as it found it. The affordance
  it uses is `SongPickerToggle` (`aria-label="Add songs"`,
  `aria-pressed={open}`, always rendered on a freshly loaded detail page —
  `PlaylistDetailHeader.tsx:143-147`): retry `toggle.click()` until
  `aria-pressed` reads `true` (`toPass`, 30 s, per-attempt assertion 2 s), then
  click once more and assert it reads `false` — **inside the same `toPass`
  shape**, because React can replay a discrete click queued during hydration
  and a bare final assertion could then be raced into leaving the panel open.
  Toggling the picker panel is
  pure client state — `playlistPanelReducer`'s `toggle-picker` returns
  `NO_PANEL` when already open (`src/lib/playlistPanels.ts:47`) — so it writes
  nothing to the database, issues no request (`SongPicker` queries only on
  typing, debounced) and restores the closed panel every test starts from. The
  `Add songs` toggle is the **prescribed** affordance, not one option among
  several: ER11 pins the helper's name and its `aria-pressed` assertions, so a
  probe built on anything else fails QA even if it is equally sound. (A probe
  built on `fill` would in any case be wrong, since that is the operation the
  race destroys.)
- **`openPlaylist` calls it** after its existing heading assertion, and its doc
  comment loses the sentence about the loading state.
- **`reopenPlaylist` calls it** after its existing heading assertion, and its
  doc comment loses the same sentence. It stays in
  `e2e/playlist-detail.spec.ts`.

Not one assertion, locator, timeout or test body changes: the only deletions in
either file are comment lines, the only insertions are the new helper, its two
call sites and one import line. ER11 pins that mechanically rather than pinning
the files byte-identical, and adds a `--repeat-each=3` run against `next start`
so the hardening is verified under the very condition it exists for.

**Landing Page Rule decision.** This is an internal rendering refactor: it adds
no capability a musician or band would choose the app for, and playlists are
already on the landing page as a selling point. The landing copy must not
change; ER14 asserts that mechanically.

**Version.** Bump `package.json` to `0.1.106-YYYYMMDDHHmm` with a real local
timestamp, up from `0.1.105-202609100646`.

### Post-merge note for the operator

This task ships a user-visible change, not only a rendering refactor. After it
merges, `/playlists/[id]` both reads **and** writes the repertoire of the
playlist's own owner, and the band ContextSwitcher no longer has any effect on
that route. Two things change for a real user, and both are worth watching for
in support traffic:

- A band member who opens a band playlist while the personal hat is on now sees
  the band aggregate and **cannot cycle their own mastery status from that
  page** (Scope, case 2); the way to do that is `/` or the song's Fast View,
  both unchanged. On the same page a song tag they add is now written to the
  **band's shared row** rather than to their own private one (case 6), so it
  becomes visible to every member of that band.
- In exchange, the read owner and the write owner finally agree. The failure
  that today follows a **song-tag** edit on this route under any band hat —
  `Repertoire entry not found or access denied` in the error banner, because
  the row ids are band rows and the write goes out as personal — is gone (cases
  1, 3 and 5). Note that a *status* cycle never produced that error, since
  under a band hat the row renders a read-only badge and there is no button to
  press; the tag row is the reachable one.

If the loss of in-playlist cycling for band playlists turns out to matter, the
follow-up is a product decision — a per-row "your status" control next to the
band aggregate — and belongs in its own task, not in a re-litigation of this
one.

## Expected Results

ER1 - `src/app/playlists/[id]/page.tsx` is an async Server Component that reads through the domain layer and injects its actions. `grep -c "use client" 'src/app/playlists/[id]/page.tsx'` prints `0`, `grep -c "useState" 'src/app/playlists/[id]/page.tsx'` prints `0`, `grep -c "useEffect" 'src/app/playlists/[id]/page.tsx'` prints `0` and `grep -c "useMemo\|useCallback\|useReducer\|useRef\|useParams\|useRouter\|authClient\|useBandContextStore" 'src/app/playlists/[id]/page.tsx'` prints `0`; at `bd3c8cf` those four commands print `1`, `8`, `2` and `12` respectively. `grep -c "export default async function" 'src/app/playlists/[id]/page.tsx'` prints `1`. `grep -c "" 'src/app/playlists/[id]/page.tsx'` prints a number less than or equal to `60` (`323` at `bd3c8cf`; the reference draft measures `45`). The reads are the real ones: `grep -c "getPlaylistWithSongs" 'src/app/playlists/[id]/page.tsx'` prints `2` (one import specifier line and one call), `grep -c "@/lib/playlists" 'src/app/playlists/[id]/page.tsx'` prints `1`, `grep -c "@/lib/songs" 'src/app/playlists/[id]/page.tsx'` prints `1`, `grep -c "getSession\|getRequiredUserId" 'src/app/playlists/[id]/page.tsx'` prints a number greater than or equal to `1`, and `grep -c "Action" 'src/app/playlists/[id]/page.tsx'` prints a number greater than or equal to `6` - the five Server Actions of the injected bundle plus `SONG_PICKER_ACTIONS`. Both redirects are present and are the ones today's page performs: `grep -c 'redirect("/login")' 'src/app/playlists/[id]/page.tsx'` prints `1` and `grep -c 'redirect("/playlists")' 'src/app/playlists/[id]/page.tsx'` prints `1`. The layers underneath are untouched: `git diff bd3c8cf -- src/app/actions src/app/api src/store src/proxy.ts src/lib/playlists.ts src/lib/songs.ts src/app/songPickerActions.ts src/hooks/useSongPicker.ts src/hooks/useSpotifySync.ts src/hooks/useTagEditor.ts src/lib/playlistPanels.ts src/lib/playlistSync.ts src/components/playlists/PlaylistDetailHeader.tsx src/components/playlists/PlaylistSpotifyStrip.tsx src/components/playlists/PlaylistSongRow.tsx src/components/playlists/PlaylistSongList.tsx src/components/playlists/PlaylistSummary.tsx src/components/playlists/PlaylistTagBar.tsx src/components/playlists/TagFilterBar.tsx src/components/playlists/SongPicker.tsx src/components/ui` prints nothing at all.

ER2 - The client island exists, is the only one the page imports, and respects the project's import and dialog rules. `test -f src/components/playlists/PlaylistDetailView.tsx && test -f src/components/playlists/__tests__/PlaylistDetailView.test.tsx` exits `0`; neither file exists at `bd3c8cf`. `head -1 src/components/playlists/PlaylistDetailView.tsx` prints exactly `"use client";`. `grep -c "export function PlaylistDetailView" src/components/playlists/PlaylistDetailView.tsx` prints `1` - a named function declaration, not an arrow const, which is both the house style and what makes ER5's forced measurement report `Function 'PlaylistDetailView' ...` rather than `Arrow function ...`. `grep -c "PlaylistDetailView" 'src/app/playlists/[id]/page.tsx'` prints `2` - one import specifier line and one JSX element - and the island is the only component the page knows about: `grep -o "@/components/[A-Za-z/]*" 'src/app/playlists/[id]/page.tsx' | sort -u` prints exactly one line, `@/components/playlists/PlaylistDetailView` (at `bd3c8cf` the same command prints seven lines). `grep -c "useEffect" src/components/playlists/PlaylistDetailView.tsx` prints `0`. `grep -rn "@/app/" src/components src/lib src/hooks | grep -v __tests__` prints nothing at all, exactly as at `bd3c8cf`. `grep -rnE "(^|[^A-Za-z.])(alert|confirm)\(" src/components/playlists src/hooks/usePlaylistDetail.ts 'src/app/playlists/[id]/page.tsx'` prints nothing at all, so the delete confirmation is still the inline `Sure? / Yes / No` affordance and never a browser dialog. `grep -rc "useBandContextStore" 'src/app/playlists/[id]/page.tsx' src/components/playlists/PlaylistDetailView.tsx src/hooks/usePlaylistDetail.ts src/lib/playlistOverlay.ts` prints `0` for every one of the four files, and `git diff bd3c8cf -- src/store` prints nothing at all: the band-context store is neither read by this route any more nor changed.

ER3 - The two lower layers exist, in the layers AGENTS.md prescribes. `test -f src/lib/playlistOverlay.ts && test -f src/hooks/usePlaylistDetail.ts` exits `0`; neither exists at `bd3c8cf`. `grep -c "export function playlistOverlayReducer\|export function applyDetailOverlay" src/lib/playlistOverlay.ts` prints `2` and `grep -c "export const EMPTY_PLAYLIST_OVERLAY" src/lib/playlistOverlay.ts` prints `1`; the selector is named `applyDetailOverlay` and its value type `PlaylistDetailOverlay`, so `grep -c "applyPlaylistOverlay\|PlaylistOverlay\b" src/lib/playlistOverlay.ts` prints `0` and the RH-63 exports of the same shape in `src/lib/playlistList.ts` keep their names to themselves - `src/lib` exports are function declarations and never arrow consts, and the empty overlay is a value, not a function. The lib module is pure: `grep -cE "from ['\"]react['\"]|useState|useEffect|@/lib/db|fetch\(" src/lib/playlistOverlay.ts` prints `0`. `grep -c "export function usePlaylistDetail" src/hooks/usePlaylistDetail.ts` prints `1`, `grep -c "export interface PlaylistDetailActions" src/hooks/usePlaylistDetail.ts` prints `1`, `grep -c "'use client'\|\"use client\"" src/hooks/usePlaylistDetail.ts` prints `0` like every other file in `src/hooks`, `grep -c "next/navigation" src/hooks/usePlaylistDetail.ts` prints `0` (the router stays in the island and reaches the hook as `onRefresh` / `onDeleted`), and `grep -cE "^\s+set[A-Z][A-Za-z]*:" src/hooks/usePlaylistDetail.ts` prints `0` while `grep -c "removeSong\|cycleStatus\|rename\|dismissError" src/hooks/usePlaylistDetail.ts` prints a number greater than or equal to `4`: the controller exposes commands, never a raw setter (F14).

ER4 - The mount read is gone, not relocated, and the post-mutation refresh is `router.refresh()`. `grep -c "refreshPlaylist" 'src/app/playlists/[id]/page.tsx' src/components/playlists/PlaylistDetailView.tsx src/hooks/usePlaylistDetail.ts src/lib/playlistOverlay.ts` prints `0` for every one of the four files (`grep -c "refreshPlaylist"` printed `5` on the page at `bd3c8cf`). `grep -rc "getPlaylistWithSongsAction\|getRepertoireAction" 'src/app/playlists/[id]/page.tsx' src/components/playlists/PlaylistDetailView.tsx src/hooks/usePlaylistDetail.ts` prints `0` for every one of the three files: the page reads through `src/lib` and the only surviving caller of `getPlaylistWithSongsAction` is `src/app/songPickerActions.ts`, which this task does not touch. `grep -c "router.refresh()" src/components/playlists/PlaylistDetailView.tsx` prints a number greater than or equal to `1` and `grep -c 'router.replace("/playlists")' src/components/playlists/PlaylistDetailView.tsx` prints `1`. The suppression the RH-67 QA pass asked about is gone with the effect it guarded: `grep -rc "set-state-in-effect" 'src/app/playlists/[id]/page.tsx' src/components/playlists/PlaylistDetailView.tsx src/hooks/usePlaylistDetail.ts src/lib/playlistOverlay.ts` prints `0` for every one of the four files (the page printed `1` at `bd3c8cf`), and `grep -c "eslint-disable" 'src/app/playlists/[id]/page.tsx'` prints `0`.

ER5 - The island and the hook are inside the base complexity budget with no override of their own, which is what makes the split a success rather than a relocation. `rtk proxy npx eslint src/components/playlists/PlaylistDetailView.tsx src/hooks/usePlaylistDetail.ts src/lib/playlistOverlay.ts 'src/app/playlists/[id]/page.tsx'` exits `0` with no output at all. Measured with the budgets forced, `rtk proxy npx eslint src/components/playlists/PlaylistDetailView.tsx --rule '{"complexity":["error",1],"max-lines-per-function":["error",1]}'` prints, among its lines, exactly one line containing `Function 'PlaylistDetailView' has too many lines` and that number is at most `170`, and exactly one line containing `Function 'PlaylistDetailView' has a complexity of` and that number is at most `12`; the same command aimed at `src/hooks/usePlaylistDetail.ts` prints exactly one line containing `Function 'usePlaylistDetail' has too many lines` and that number is at most `195`, and either no line or exactly one line containing `Function 'usePlaylistDetail' has a complexity of` with a number at most `12`. (The reference extraction measures the island at 143 file lines, 119 function lines and complexity 5, and the hook at 207 file lines, 176 function lines and complexity 1; the ceilings above are those numbers with headroom for comments, and every one of them is below the base budget of `complexity` 15 and `max-lines-per-function` 200.) `grep -c "" src/components/playlists/PlaylistDetailView.tsx`, `grep -c "" src/hooks/usePlaylistDetail.ts` and `grep -c "" src/lib/playlistOverlay.ts` each print a number less than or equal to `400`.

ER6 - The override is deleted, the ratchet shrinks by exactly one entry and the manifest follows it in lockstep. `grep -c "src/app/playlists" eslint.config.mjs` prints `0`: the entry is deleted outright, not re-pointed at the island, the hook or the lib module - `grep -c "src/components/playlists\|src/hooks/usePlaylistDetail\|src/lib/playlistOverlay" eslint.config.mjs` prints `0` too. `grep -c "complexity-budget/override" eslint.config.mjs` prints `19` (`20` at `bd3c8cf`). `grep -c "MAX_OVERRIDES = 19" src/lib/__tests__/complexityBudget.test.ts` prints `1` and `grep -c "MAX_OVERRIDES = 20" src/lib/__tests__/complexityBudget.test.ts` prints `0`. `rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts src/lib/__tests__/namingConventions.test.ts src/lib/__tests__/errorHandlingStyle.test.ts` exits `0` with `0` failed tests, the first file printing `Tests  6 passed (6)` and including the test now named exactly `lists at most 19 per-file overrides, each naming a file that exists`. `grep -c "past 19 entries" AGENTS.md` prints `1` and `grep -c "past 20 entries" AGENTS.md` prints `0`. AGENTS.md's server-page bullet names this route: `grep -c "/playlists/\[id\]" AGENTS.md` prints a number greater than or equal to `1`, on the line that also contains `The Server Component page pattern`. And `git diff --numstat bd3c8cf -- AGENTS.md` prints exactly one line whose three tab-separated fields are `2`, `2` and `AGENTS.md` - two insertions, two deletions, no other line touched, so the `nextjs-agent-rules` block is byte-identical to `bd3c8cf`.

ER7 - The optimistic overlay is proved pure and idempotent. `rtk proxy npx vitest run src/lib/__tests__/playlistOverlay.test.ts` exits `0` printing `Test Files  1 passed (1)` and `Tests  12 passed (12)`, its tests named exactly: `starts from an empty overlay that changes nothing`, `applies a renamed playlist over the server row`, `applies replacement playlist tags over the server row`, `hides a removed song and leaves the others in place`, `restores a song that was removed and then put back`, `appends a song the picker reported and the server does not carry yet`, `appends no duplicate for a song the server already carries`, `keeps the server order of the songs it does not touch`, `overrides a repertoire entry by song id and leaves the rest of the map alone`, `builds the repertoire map from the server rows when no entry is overridden`, `is idempotent once the server render already carries the same edits`, `returns the same overlay object for an action it does not handle`. The eleventh is the one that pins the pattern this task depends on: applying an overlay to a server render that already reflects it yields a result deep-equal to the server render itself, which is why no overlay entry ever has to be cleared. The file needs no `// @vitest-environment` line.

ER8 - The controller is tested where only a hook test can reach: the optimistic window, the revert asymmetry and the owner the writes carry. `rtk proxy npx vitest run src/hooks/__tests__/usePlaylistDetail.test.tsx` exits `0` printing `Test Files  1 passed (1)` and `Tests  12 passed (12)`. Its literal first line is `// @vitest-environment jsdom`, it calls `afterEach(cleanup)`, it imports nothing from `@/app/`, it drives the hook through `renderHook` against `vi.fn()` actions and a stubbed `global.fetch`, and its tests are named exactly: `reports the server playlist, songs and repertoire without issuing any request`, `renames optimistically, calls updatePlaylist and asks for a refresh`, `reports a rename failure in the error banner`, `removes a song optimistically, pushes to Spotify and asks for a refresh`, `restores a removed song and reports the failure when the write rejects`, `cycles a mastery status optimistically and reverts it when the write rejects`, `carries the playlist band id into the status and the tag writes`, `carries no band id for a personal playlist`, `adds a playlist tag optimistically and asks for a refresh after the write`, `reports a song tag rejection without reverting the chip`, `records the songs the picker reports and keeps the server rows`, `reports the deletion to its caller and issues no refresh`. The seventh and the eighth together pin the owner-context decision: for a playlist whose `band_id` is set, the third argument of `updateSongStatus` and `updateSongTags` is that band id, and for a personal playlist it is `null` or `undefined`.

ER9 - The island renders every state and every accessible name the e2e net reaches for, and fetches nothing. `rtk proxy npx vitest run src/components/playlists/__tests__/PlaylistDetailView.test.tsx` exits `0` printing `Test Files  1 passed (1)` and `Tests  9 passed (9)`. Its literal first line is `// @vitest-environment jsdom`, it calls `afterEach(cleanup)`, it imports nothing from `@/app/`, it mocks `next/navigation` with hoisted `vi.fn()`s, and its tests are named exactly: `renders the playlist name, its songs and its mastery summary from its props`, `issues no network request while rendering`, `renders the error banner and dismisses it`, `filters the song list by the in-playlist text filter`, `renders the add-song panel only while the picker panel is open`, `passes the server-resolved user id to the playlist tag bar`, `refreshes the route after a successful rename`, `navigates to the playlist list after the playlist is deleted`, `renders the band aggregate badge instead of the status button for a band playlist`. The ninth is the display half of the owner decision: rendered with a playlist whose `band_id` is set, the row shows the read-only badge carrying `Band status is computed from all members` and no `Click to advance` button, and rendered with a personal playlist it shows the button - the two cases Scope accepts, asserted on the DOM rather than on prose. The second stubs `globalThis.fetch` with a `vi.fn()` and asserts it was never called by a plain render, which is the mechanical proof that the mount read is gone rather than relocated into the island; the sixth asserts the tag bar receives the `currentUserId` prop the server resolved, which is what makes F13 structural rather than cosmetic.

ER10 - The route is still dynamic in the build, and an unauthenticated request is still answered by the proxy. From a clean build, `rm -rf .next && npx next build` exits `0`. `node -e "const r=Object.keys(require('./.next/prerender-manifest.json').routes).sort();console.log(r.length);console.log(r.join(' '))"` prints exactly two lines: `11`, then `/ /_global-error /_not-found /forgot-password /icon.jpg /login /profile /reset-password /settings /signup /songs/search`. `node -e "const a=Object.values(require('./.next/app-path-routes-manifest.json'));const s=new Set(Object.keys(require('./.next/prerender-manifest.json').routes));const d=a.filter(x=>!s.has(x)).sort();console.log(a.length);console.log(d.length);console.log(d.join(' '))"` prints exactly three lines: `28`, `17`, then `/admin/moderation /api/auth/[...all] /api/auth/spotify/authorize /api/auth/spotify/callback /api/auth/spotify/disconnect /api/dev/profiles /api/spotify/playlists /api/spotify/playlists/[id]/import /api/spotify/playlists/[id]/sync /api/spotify/playlists/[id]/tracks /api/spotify/search /bands /bands/[id] /join/[code] /playlists /playlists/[id] /songs/[id]/fast-view`. These are exactly the `bd3c8cf` numbers and the exact `bd3c8cf` sets - 11 static, 17 dynamic, 28 paths, with `/playlists/[id]` in the dynamic set before and after - so the conversion moved no route in either direction. The proxy still owns the signed-out answer, unchanged: `grep -c "'/playlists/(.*)'" src/proxy.ts` prints `1` and `git diff bd3c8cf -- src/proxy.ts` prints nothing at all; and with `export BETTER_AUTH_SECRET=test-secret DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres` and `npx next start -p 3210` serving that build, `curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://127.0.0.1:3210/playlists/00000000-0000-0000-0000-000000000000` with no cookie prints `307 http://127.0.0.1:3210/login?redirect=%2Fplaylists%2F00000000-0000-0000-0000-000000000000`.

ER11 - End to end, the server render is asserted on the raw document and RH-66's characterization net passes with every assertion it had, plus the hydration wait the deleted loading state used to provide. `git diff bd3c8cf -- e2e playwright.config.ts --name-only` prints exactly three lines, in some order: `e2e/helpers.ts`, `e2e/playlist-detail.spec.ts` and `e2e/server-pages.spec.ts`; `git diff bd3c8cf -- playwright.config.ts e2e/global-setup.ts` prints nothing at all. The two characterization files changed in mechanics only, and this is mechanical, as a positive test rather than a blacklist: `git diff bd3c8cf -- e2e/helpers.ts e2e/playlist-detail.spec.ts | grep "^-[^-]" | grep -vcE '^-\s*($|\*|//|/\*)'` prints `0` - every deleted line in both files either is comment prose (the two sentences about the route's loading state) or is blank, so no assertion, locator, timeout, import, navigation, helper call or test body was deleted or rewritten. Read the `0` on stdout, not the exit status: a `grep -c` / `grep -vc` that counts nothing exits `1`, which is the passing outcome here and in every other count in this ER set that is required to print `0`. The filter is positive on purpose: a blacklist of assertion patterns would let a deleted `await page.reload()` or `await deletePlaylistFromDetail(page)` through, and those weaken the net exactly as much as a deleted assertion. `git diff --numstat bd3c8cf -- e2e/helpers.ts e2e/playlist-detail.spec.ts` prints exactly two lines whose insertion counts are at most `45` and `12` respectively and whose deletion counts are at most `12` and `8` respectively. The insertions are the hydration wait and nothing else: `grep -c "export async function waitForPlaylistDetailHydrated" e2e/helpers.ts` prints `1`, `grep -c "waitForPlaylistDetailHydrated" e2e/helpers.ts` prints a number greater than or equal to `2` (its declaration and its use inside `openPlaylist`), `grep -c "waitForPlaylistDetailHydrated" e2e/playlist-detail.spec.ts` prints a number greater than or equal to `2` (its import line and its use inside `reopenPlaylist`; a doc comment naming the helper is allowed to raise it), `grep -c "toPass" e2e/helpers.ts` prints `3` (`2` at `bd3c8cf`), and `grep -rc "waitForPlaylistDetailHydrated" e2e/server-pages.spec.ts` prints `0` - not because that file may race, but because its signed-in test reaches the detail route through `openPlaylist` and deletes through `deletePlaylistFromDetail`, so the wait comes to it transitively from `e2e/helpers.ts` - and that route in is pinned rather than merely described: `grep -c "openPlaylist" e2e/server-pages.spec.ts` prints a number greater than or equal to `1` and `grep -c "deletePlaylistFromDetail" e2e/server-pages.spec.ts` prints a number greater than or equal to `1` (both `0` at `bd3c8cf`), so a new test that navigated with `page.goto` and clicked `Delete playlist` directly - satisfying every other grep here while reintroducing the race this subsection exists to close - fails this result. The probe leaves no state behind: `grep -c "aria-pressed" e2e/helpers.ts` prints a number greater than or equal to `2`, one assertion for `true` and one for `false`, and `git diff bd3c8cf -- src/components/playlists/SongPickerToggle.tsx src/lib/playlistPanels.ts` prints nothing at all, so the affordance it drives is the one that exists today. The number of tests in the net is unchanged: `npx playwright test e2e/playlist-detail.spec.ts --list` prints `Total: 11 tests in 1 file`, exactly as at `bd3c8cf`. `npx playwright test --list` prints `Total: 35 tests in 7 files` (`33 tests in 7 files` at `bd3c8cf`), and `npx playwright test e2e/server-pages.spec.ts --list` prints `Total: 6 tests in 1 file` (`4` at `bd3c8cf`). With Postgres reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (migrations applied), `.env.local` present with `BETTER_AUTH_SECRET` exported from it, nothing listening on port 3000 and the ER10 production build present, `PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1" npx playwright test --workers=1 --reporter=list` exits `0` and prints `35 passed`, with no `failed` and no `flaky` line. The two new tests in `e2e/server-pages.spec.ts` are named exactly `GET a playlist detail route signed in is server-rendered with the playlist name in the document` - which creates a uniquely named playlist through the UI, opens it, reads its path from the browser URL, and asserts that `request.get(path)` returns status `200`, a body containing that playlist name and no `id="__next_error__"`, then deletes the playlist through the detail page's `Delete playlist` / `Yes` affordance so the run leaves no fixture behind - and `GET a playlist detail route signed out is redirected to /login` - which, inside a `test.describe` that overrides the file's storage state with an empty one, asserts that `request.get('/playlists/00000000-0000-0000-0000-000000000000', { maxRedirects: 0 })` returns status `307` and a `location` header containing `/login?redirect=%2Fplaylists%2F`. Among the 35 are the eleven tests of `e2e/playlist-detail.spec.ts`, including the three that would break first if the optimistic overlay were dropped: `cycles the mastery status of a playlist song`, `adds a tag to a playlist song` and `removes a song from the playlist`, each of which asserts the DOM change before awaiting the Server Action response. Finally, the hydration hardening is verified under the exact condition it exists for - a cold, compiled, server-rendered route with no loading state to hide behind: against that same `next start` build, `PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1" npx playwright test e2e/playlist-detail.spec.ts --workers=1 --repeat-each=3 --reporter=list` exits `0` and prints `33 passed`, with no `failed`, no `flaky` and no `retry` line - three consecutive journeys through the fixture, each minting its own names through `uniqueFixtureName` and ending in its own teardown, so a click or a `fill` that lands before hydration cannot pass unnoticed.

ER12 - Every repository gate holds at its `bd3c8cf` value and the new modules are covered. With Postgres up and a non-empty `SUPABASE_SERVICE_ROLE_KEY`: `rtk proxy npx vitest run` exits `0` printing `Test Files  124 passed (124)` (`121` at `bd3c8cf`, plus the three new test files) and `Tests` passed at least `1408` (`1375` at `bd3c8cf`, plus 12 + 12 + 9 new), with `0` failed and `0` skipped. Either number moves if one of ER14's two conditional forks is taken, and taking a fork ER14 permits must not fail this result, so each fork has one exact pair. Fork 1 is at export granularity, not file granularity: `src/lib/playlistDetail.ts` itself cannot disappear, because `sortPlaylistSongs` is imported by `src/components/playlists/PlaylistSongList.tsx:7` and `summarisePlaylistMastery` by `src/components/playlists/PlaylistSummary.tsx:4`, both of which ER1 pins byte-identical; what can go is the `withRepertoireEntry` export together with its `describe` block, which holds exactly one `it` (`src/lib/__tests__/playlistDetail.test.ts:229-236`), so both files stay in the tree, the file count stays `124` and the test floor drops by exactly one, to `1407`. Fork 2 adds `src/hooks/usePlaylistTagEditors.ts` with a test file, which makes it `125` files and leaves the test floor at `1408`. Taking both makes it `125` files and at least `1407` tests. `rtk proxy npx eslint .` prints `22 problems (8 errors, 14 warnings)`, identical to `bd3c8cf`. `./node_modules/.bin/tsc --noEmit` exits `0` printing nothing. `npm run lint:dead` exits `0` reporting no unused file, export or dependency - in particular every export of `src/lib/playlistOverlay.ts` and `src/hooks/usePlaylistDetail.ts` has a caller under `src`, and `withRepertoireEntry` in `src/lib/playlistDetail.ts` either kept a production caller or had its export and its one-`it` `describe` block deleted together - the export, never the module, whose other exports keep the production callers ER1 pins byte-identical. `npm run lint:dup` exits `0` with its `Total:` row reporting at most `16` clones and at most `0.50 %` - the `bd3c8cf` numbers, `16` clones and `203 (0.49 %)` duplicated lines - and its output naming no file under `components/playlists`, `hooks/usePlaylistDetail.ts` or `lib/playlistOverlay.ts` (jscpd prints paths without the `src/` prefix). `npm run audit` exits `0` with no high or critical advisory. `npm run test:coverage` exits `0` with all four thresholds met (statements at least `80`, branches at least `65`, functions at least `78`, lines at least `80`), and `node -e "const c=require('./coverage/coverage-final.json');const pct=a=>a.length?Math.round(1000*a.filter(x=>x>0).length/a.length)/10:100;for (const k of Object.keys(c)) if (k.endsWith('/src/lib/playlistOverlay.ts')||k.endsWith('/src/hooks/usePlaylistDetail.ts')) console.log(k.split('/src/').pop(), pct(Object.values(c[k].f)), pct(Object.values(c[k].s)))"` prints exactly two lines, `lib/playlistOverlay.ts` and `hooks/usePlaylistDetail.ts` in some order, each followed by a function percentage and a statement percentage of at least `90`.

ER13 - F11 is closed in the code-quality review, F13's line is kept and the section-5 row follows. `git diff --numstat bd3c8cf -- docs/plans/code-quality-review.md` prints exactly one line whose three tab-separated fields are `2`, `0` and `docs/plans/code-quality-review.md`: two inserted lines, no deletion, so F13's `**Status:** Resolved by RH-66 ...` line and T8's paragraph about it survive byte-identical. `grep -c '^\*\*Status:\*\*' docs/plans/code-quality-review.md` prints `23` (`21` at `bd3c8cf`). The first insertion is F11's status, directly under its `**Remediation:**` line in the `### F11` section: it starts with `**Status:** Resolved by RH-66`, names all six commits of the split - the substrings `882806a`, `5c38206`, `acbbf83`, `a79abef`, `bd3c8cf` and the phrase `RH-71 (the commit carrying this line, on top of ` followed by `bd3c8cf` - and carries the measured close-out numbers of the whole series: the substrings `1344` and the page's final `grep -c ""` value from ER1, `complexity 34`, `24`, `19`, and the names `PlaylistDetailView`, `usePlaylistDetail`, `playlistOverlay` and `e2e/playlist-detail.spec.ts`. That same line also records the behaviour delta the conversion carried, so the review file does not read as if F11 closed with no user-visible consequence: it contains the substrings `band_id` and `write owner` - the second is the literal anchor for the half that matters most, so the write side of the record cannot be reduced to a reader's inference - and it states three things - that `/playlists/[id]` now scopes its repertoire to the playlist's own owner instead of the active band context, that it now **writes** under that same owner where every write on the route used to go out as the personal one, and that the band ContextSwitcher no longer affects this route. It states no failure mode that does not exist at `bd3c8cf`: in particular it must not claim that a status cycle failed under a band hat, because under a band hat the row renders a read-only badge and no status cycle is reachable at all (`src/components/playlists/PlaylistSongRow.tsx:69`); the failure the conversion removes is the one a song-tag edit produced. The second insertion is a `**Status:**` line directly under the `**Covers:** F11, F20` line of the `### T6` section, naming `RH-39` and `246313f` for F20 and the same six commits for F11, and stating that both findings T6 covers are now closed. Both lines are plain ASCII on a single line each, in the house format every other `**Status:**` line in that file uses.

ER14 - Release hygiene, a closed change set and no marketing drift. The `version` field of `package.json` is `0.1.106-YYYYMMDDHHmm` with a real local timestamp, up from `0.1.105-202609100646`. `git diff bd3c8cf -- src/components/landing src/i18n/dictionaries` prints nothing at all: moving a page's rendering to the server is not a selling point. `git diff --name-only a8485af | sort` (the tip this work is staged on: `bd3c8cf` plus `a8485af`, which only deletes the generated `meridian-*` agent files under `.agents/agents/` and `.claude/agents/` and touches no path this task owns, which is why every other clause here keeps `bd3c8cf`) lists only paths drawn from this closed set and no others: `AGENTS.md`, `docs/plans/code-quality-review.md`, `docs/suggestions-log.md`, `docs/tasks/RH-71-spec.md`, `e2e/helpers.ts`, `e2e/playlist-detail.spec.ts`, `e2e/server-pages.spec.ts`, `eslint.config.mjs`, `package.json`, `src/app/playlists/[id]/page.tsx`, `src/components/playlists/PlaylistDetailView.tsx`, `src/components/playlists/__tests__/PlaylistDetailView.test.tsx`, `src/hooks/__tests__/usePlaylistDetail.test.tsx`, `src/hooks/usePlaylistDetail.ts`, `src/lib/__tests__/complexityBudget.test.ts`, `src/lib/__tests__/playlistOverlay.test.ts`, `src/lib/playlistOverlay.ts`, and two conditional pairs: `src/lib/playlistDetail.ts` with `src/lib/__tests__/playlistDetail.test.ts`, only if `withRepertoireEntry` lost its last production caller and its export and its one-`it` `describe` block had to be deleted as ER12 allows - both files are edited and neither is removed, since their other exports keep production callers ER1 pins byte-identical, which is why ER12's fork 1 leaves the file count at `124`; and `src/hooks/usePlaylistTagEditors.ts` with `src/hooks/__tests__/usePlaylistTagEditors.test.tsx`, only if the hook could not be brought under ER5's 195-line ceiling and the tag-editor controllers had to move into a fourth module. Any other path fails this result; in particular the list contains no file under `e2e/` other than the three named above, no `e2e/global-setup.ts`, no `playwright.config.ts`, no `src/app/actions/`, no `src/app/api/`, no `src/store/`, no `src/proxy.ts`, no `src/lib/playlists.ts`, no `src/lib/songs.ts`, no `src/app/songPickerActions.ts` and no other file under `src/components/playlists/` or `src/hooks/`.

ER15 - The repertoire owner is the playlist's own owner, on the page source, and the same expression feeds the read and the writes. On the server page: `grep -c "band_id" 'src/app/playlists/[id]/page.tsx'` prints a number greater than or equal to `1` (`0` at `bd3c8cf`, where the owner came from `useBandContextStore((s) => s.bandId())` on line 48), `grep -cE "const bandId = playlist\.band_id" 'src/app/playlists/[id]/page.tsx'` prints `1` - the owner is derived from the row `getPlaylistWithSongs` just returned and from nothing else - and `grep -c "getRepertoire" 'src/app/playlists/[id]/page.tsx'` prints `2`, one import specifier line and one call. That call is owned by `bandId`: `grep -cE "getRepertoire\([^)]*bandId" 'src/app/playlists/[id]/page.tsx'` prints `1` (the call is written on a single line so this is decidable by grep), while `grep -cE "getRepertoire\(\s*\{\s*userId\s*\}\s*\)" 'src/app/playlists/[id]/page.tsx'` prints `0` and `grep -cE "getRepertoire\(\s*\{\s*bandId\s*\}\s*\)" 'src/app/playlists/[id]/page.tsx'` prints `0`: an implementation that reads the personal repertoire unconditionally - the rejected option (b) - fails this result, and so does one that reads a band repertoire unconditionally. On the client side of the same value: `grep -cE "playlist\.band_id" src/hooks/usePlaylistDetail.ts` prints a number greater than or equal to `1`, and `grep -rc "useBandContextStore\|bandContextStore" 'src/app/playlists/[id]/page.tsx' src/components/playlists/PlaylistDetailView.tsx src/hooks/usePlaylistDetail.ts` prints `0` for every one of the three files, so the write owner is read off the same `playlist.band_id` the server read under and never off the browsing hat. ER8's seventh and eighth tests execute that agreement (`carries the playlist band id into the status and the tag writes`, `carries no band id for a personal playlist`), and ER9's island tests render the aggregate branch a band playlist now reaches. Together these pin the decision the Approach argues for and the six behaviour cases Scope accepts, display half and write half alike.

## Out of Scope

- **Transport option (c), `/playlists/<id>?bandId=`.** Fast View's convention,
  rejected here for RH-63's reasons plus one more: every entry point into this
  route (`PlaylistsView`'s card click, Fast View's `returnTo`, a bookmark, a
  shared link) would have to carry the parameter or silently mean "personal",
  and the two that live outside this task's file set cannot be changed here.
- **Transport option (a), a cookie mirror of the band context.** Still the
  option to revisit if a route ever needs genuine server-side band scoping, and
  it should then be designed once for all routes by whoever owns the shared
  plumbing - not invented on this page.
- **Scoping the repertoire read to the playlist's songs.** The Server Component
  reads the owner's whole repertoire, exactly as `refreshPlaylist` did through
  `getRepertoireAction`, so the payload is at parity with today. A
  playlist-scoped SQL read would mean a new function in `src/lib/songs.ts`
  (pinned at `max-lines: 529` by the RH-39 ratchet, `eslint.config.mjs:83`) or in `src/lib/playlists.ts`,
  both of which this task does not touch. Recorded as a suggestion instead.
- **Carrying the band id into the picker's `addToRepertoire`.** `SONG_PICKER_ACTIONS`
  binds `addSongAction` with no owner argument, so adding a song from a band
  playlist writes the personal repertoire row - which is exactly what happens
  today in the band context. Parity is deliberate; changing it is a product
  decision, not a rendering one.
- **`revalidatePath` on the playlist actions**, and any other change to
  `src/app/actions/**`, which would drag the three action guards into a page-layer
  refactor.
- **Replacing the page's inline error banner with `src/components/ui/AlertBanner`.**
  The tone palettes there render a rounded card, not the full-width bar this page
  uses; swapping it is a visual change, not a rendering refactor.
- **Adding a `**Status:**` line to the `### F20` section**, which has none even
  though RH-39 (`246313f`) resolved it. ER13 records that fact on the T6 row,
  where this task's remit reaches; back-filling F20's own section is a separate
  documentation errand.
- **The other five `'use client'` pages** (`/`, `/bands/[id]`, `/profile`,
  `/settings`, `/songs/[id]/fast-view`), deferred with no named owner by RH-41.
- **Refreshing AGENTS.md's module map for `src/components/playlists/`** (line
  139), which still reads "PlaylistsView island, cards, Spotify import panel"
  and was not updated by RH-67..RH-70 either. ER6 pins this task's AGENTS.md
  diff at exactly two changed lines, so the map is a follow-up errand for the
  whole RH-66..RH-71 series rather than a line this task may spend.
- **A per-row "your status" control beside the band aggregate**, the follow-up
  the Post-merge note names for the cycling a band-playlist viewer loses on this
  route (Scope, case 2). It is a product decision about what a band playlist
  should show, not a rendering one.
- **Fixing the pre-existing eight eslint errors**, including the two
  `set-state-in-effect` errors in `AppLayout.tsx` and `LanguageSelector.tsx`.
  None of them is in a file this task touches.

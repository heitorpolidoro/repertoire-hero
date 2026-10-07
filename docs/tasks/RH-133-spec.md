# RH-132 — Address Fast View by version, everywhere the address is stored

> Spec file name is the board id + 1 (repo convention). The task is **RH-132**,
> part 1 of 3 from the RH-109 split. Every line/SHA reference below is measured
> at `2d244d3`, which is also this spec's diff baseline.

## Scope

The Fast View route param stops being a `user_songs` / `band_songs` row id and
becomes a `song_versions.id`. The owner comes from the context the page is
already in (`?bandId=`). Everything that *stores or resolves that address*
moves with it in the same PR: the route directory, the server read behind it,
the setlist navigation, the two hrefs that enter Fast View, and the offline
snapshot — which cannot be deferred, because
`OfflineSongSnapshot.repertoireId` (`src/lib/offlineSnapshot.ts:140`, docblock
at `:131`) **is** the `getSongEntry` lookup key, so a version-addressed route
with a row-keyed snapshot renders `OfflineUnavailable` for every downloaded
song.

The point of the change is that a version with **no owner row** becomes
addressable. `docs/use-cases.md` (*Walk a queue of songs*, Decided) requires
it: "A song removed from a repertoire mid-queue stays in the queue and stays
readable, at version defaults." Six sites in the tree currently encode the
opposite and all of them invert here.

**The personal side does not move.** `personalEntry`, its read, its type and
its create-my-first-version flow stay song-keyed and byte-identical in
semantics — see §3a, which walks the whole band-member path. Re-keying it was
considered and is rejected with a reason, not deferred for convenience.

Not in scope: the `sessionStorage` queue and the removal of `?returnTo=`
(RH-133); the neighbour window fetch (RH-134); creating an owner row from Fast
View; any schema migration (none is needed — `migrations/0016` already
declares `uq_user_songs_user_version` and `uq_band_songs_band_version`, so an
`(owner, version)` read returns at most one row by constraint; read
`migrations/` at implementation time and add nothing to it);
`getPersonalEntryForSong` and its lateral (see *Correction* below); landing
copy (this is plumbing, not a selling point — `AGENTS.md` Landing Page Rule,
decided NO).

## Correction to the task's justification

Two claims on the task are wrong against the tree and must not be implemented:

1. **No extraction from `src/lib/ownerSongs.ts` is needed.** The file is at
   400/400 with no override entry, but it needs **no new code**:
   `getResolvedEntryForVersion(owner, versionId)` already exists at line 334,
   already `LEFT JOIN`s the owner table on `(owner, version_id)`, and already
   answers `ownerRowId: null` with inherited `key`/`tuning`/`lyrics`/`map` for
   an owner holding no row. The only edit this file takes is the stale
   docblock at lines 287–296.
2. **`getPersonalEntryForSong`'s lateral is not deleted, and neither is the
   function.** It has two callers, both song-keyed by nature:
   `ensureOwnEntry` (`src/app/actions/tabs.ts:56`, because `song_files` is
   `(user_id, song_id)`) and Fast View's own personal read (§3a). Only the
   sentence in the docblock claiming RH-109 deletes it is rewritten.

## Approach

### 1. The route

`src/app/songs/[id]/fast-view/page.tsx` moves to
`src/app/songs/[versionId]/fast-view/page.tsx`; `useParams<{ id }>` (line 64)
becomes `useParams<{ versionId }>` and the four `currentRepertoireId={id}`
props (lines 138, 163, 200, 241) become the version. `?returnTo=` and
`?bandId=` are untouched. `src/app/sw.ts:133`'s `FAST_VIEW_PATH`
(`/^\/songs\/[^/]+\/fast-view$/`) matches on shape, not on segment name, and
must stay byte-identical.

### 2. The server read

`src/app/actions/repertoire.ts` gains **one** action and loses **one**.
`getResolvedEntryForVersionAction(versionId, bandId?)` resolves the owner
through the existing `resolveOwner` (`repertoire.ts:23-30`, which already
calls `assertBandMember`) and returns `getResolvedEntryForVersion`'s
`ResolvedSongEntry`. It never answers `null` and throws for a `versionId` that
does not exist, which is what drives the not-found screen.

`getSongEntryAction` is deleted once nothing references it —
`npm run lint:dead` (knip) is a CI job and exits 0 today, so a left-behind
export fails the build. **`getPersonalEntryForSongAction` is not touched**
(§3a). Every row `getSongEntryAction` holds in **three** matrices is **moved to
the replacement, never dropped** — those matrices are what keep each
`'use server'` export failing closed:

- `src/app/actions/__tests__/actionSessionGuard.test.ts` (the unauthenticated
  refusal);
- `src/app/actions/__tests__/authzRepertoire.db.test.ts:124` (the band-member
  refusal) — **DB-gated**, so it does not run under `npm run test:coverage`;
- `src/app/actions/__tests__/repertoire.test.ts`'s `DELEGATIONS` — the import
  at `:61`, the `adminGated` docblock at `:105` naming `getSongEntryAction` as
  one of the two `assertBandMember` reads, and the row itself at `:155-157`.
  This one is **not** DB-gated, which makes it the **only ungated proof** that
  the Fast View entry read authorizes through `assertBandMember` and delegates
  to `@/lib/ownerSongs`. Dropping it would leave that guarantee unverified in
  the default test run; the docblock sentence moves with it, naming
  `getResolvedEntryForVersionAction` in place of `getSongEntryAction`.

No helper taking a caller-supplied `userId` may be exported from any
`'use server'` module to make a test possible.

`src/lib/ownerSongs.ts` keeps `getSongEntry` (still the subject of
`errors.test.ts`, `songs.test.ts`, `ownerSongs.db.test.ts` and
`transactionAtomicity.db.test.ts`) and `getPersonalEntryForSong`.

### 3. Fast View's controller carries a resolved entry

`SongEntryController.entry` (`src/lib/songEntry.ts:77`) changes from
`Repertoire | null` to `ResolvedSongEntry | null`, and the controller exposes
`ownerRowId: string | null`. `withStatus`, `withSongLinks`, `withLyrics` and
`songIdentity` re-type to match; `ResolvedSongEntry.status` is nullable where
`Repertoire.status` was not, which `useSongStatus`'s
`entry?.status ?? 'unknown'` (`src/hooks/useSongStatus.ts:59-60`, **not** `:45`,
which is the status write — see §3d) already absorbs unchanged.

**`SongEntryController.personalEntry` stays `Repertoire | null`.**
`entryBandId` stops being `entry?.band_id ?? null`
(`src/hooks/useSongEntry.ts`, return object) and becomes the page's
`?bandId=` — the two are equal by construction, because `resolveOwner` derives
the owner from that very parameter, and `ResolvedSongEntry` carries no
`band_id` at all (`src/types/database.ts:110-123`).

`UseSongEntryOptions.repertoireId` becomes `versionId`;
`SongEntryActions.getSongEntry` becomes
`getResolvedEntryForVersion(versionId, bandId)`.
`SongEntryActions.getPersonalEntryForSong` is **unchanged**, and the
`shouldLoadPersonalEntry(bandId, data.song_id)` background read is unchanged.

**Three** injection roots swap to the new action, not two:
`src/app/fastViewEntryActions.ts` (`SONG_ENTRY_ACTIONS`, lines 22-25), the
offline-first wrapper in `src/lib/offlineFirst.ts` (§6), and
`src/app/offlineActions.ts` (`OFFLINE_DOWNLOAD_ACTIONS`, the import at `:2` and
the `getSongEntry:` member at `:20`), whose behaviour §6 covers. All three must
move, or `getSongEntryAction` cannot be deleted and `lint:dead` has nothing to
complain about because the export is still referenced.

#### 3a. The band-member-in-band-context path, before and after

Walked end to end, because three of the reviewer's findings are the same
class: a change here can silently remove a band member's personal lyrics while
every mechanical check still passes.

| Step | Before | After |
|---|---|---|
| Entry read | `getSongEntryAction(rowId, bandId)` → band's `Repertoire` or `null` → not-found | `getResolvedEntryForVersionAction(versionId, bandId)` → `ResolvedSongEntry`, `ownerRowId` = the band's row id **or `null`** when the band holds no row at that version; throws only for an unknown version |
| Personal read | `getPersonalEntryForSongAction(entry.song_id)`, gated by `shouldLoadPersonalEntry` | **identical** |
| `entryBandId` | `entry.band_id` | the page's `?bandId=` (equal by construction) |
| Band/Personal switcher | `hasPersonalVersion(entry, personalEntry)` reading `entry.band_id` | same function, same truth value, fed the adapter of §3b |
| Displayed lyrics | `selectDisplayedLyrics(entry, personalEntry, version)` | same, via the same adapter |
| Save target, personal | `resolveLyricsSaveTarget` returns `repertoireId: personalRepertoireId`, which is `null` for a member who has never saved one → `useLyricsEditor` calls `actions.addSong(entry.song_id)` and writes to the created row (the RH-83 create-my-first-personal-chart flow, documented at `src/lib/lyricsEditor.ts:99`) | **identical**, and pinned by ER11 |
| Save target, band | `repertoireId: entry.id`, always non-null | `repertoireId: entry.ownerRowId`, which is `null` exactly when the band holds no row at this version → the editor is read-only and the save refuses (§3c) |
| Destination modal | `personalRepertoireId === null` renders "Adds this song to your personal repertoire when you save" (`LyricsDestinationModal.tsx:66`) | **identical** |
| Offline personal | `OfflineSongSnapshot.personalRepertoire: Repertoire \| null`, captured through `getPersonalEntryForSong(repertoire.song_id)` in `gatherSongs` | **identical** |

**Why `personalEntry` is not re-keyed to the version.** A version-keyed
personal read (`getResolvedEntryForVersion({ userId }, versionId)`) would
change found-to-absent for any member who holds the song at a *different*
version than the band's: their lyrics would vanish from band-context Fast
View, the switcher would disappear, and the destination modal would start
disclosing "you hold no row". It would also break the create flow it depends
on, because `addSongToRepertoire` inserts against the song's
**representative** version (`src/lib/ownerSongs.ts:101-122`,
`representativeVersionSubquery`), not against the page's version — so a
version-keyed read would not find the row the create flow just made, and
re-keying the create would mean new SQL in a file that is at 400/400 with no
override. The personal side is song-scoped everywhere else in the tree
(`song_files` is `(user_id, song_id)`; `ensureOwnEntry` is song-keyed), so it
stays song-scoped here. Pinned by ER14.

#### 3b. The lyrics adapter (`entry.band_id` has no replacement field)

`src/lib/lyricsEditor.ts:57`, `:69` and `:79` read `entry?.band_id` through
`LyricsSource { band_id, lyrics }` and together decide whether the
Band/Personal switcher exists at all. `ResolvedSongEntry` has no `band_id`.

**Decision: adapt at the hook boundary.** `src/lib/lyricsEditor.ts` keeps all
four *parameter lists* unchanged, with **one widening**:
`resolveLyricsSaveTarget`'s `entryId: string` (`:108`) becomes
`entryId: string | null`, because the hook now passes `entry.ownerRowId`
(`string | null`) where it passed `entry.id`. `LyricsSaveTarget.repertoireId`
is already `string | null` (`:100`), so the band branch at `:116` type-checks
unchanged and a null owner row propagates as `repertoireId: null` with
`toPersonalEntry: false` — exactly the second of the two nulls §3c names.
**Do not write `entry.ownerRowId ?? ''`**: an empty string is truthy-false but
non-null, so it would skip §3c's refusal and route the save into
`updateLyrics('')`, which resolves no owner row and fails as an opaque toast
instead of a disabled control. Pinned by ER12.

`UseLyricsEditorOptions` re-types `entry` to
`ResolvedSongEntry | null` and gains `bandId: string | null` (the page's
`?bandId=`, already in scope at `page.tsx:68`). `useLyricsEditor` builds one
memoized `LyricsSource` — `entry ? { band_id: bandId, lyrics: entry.lyrics }
: null`, preserving null-ness because `selectDisplayedLyrics` branches on it —
and passes it to `useLyricsVersionChoice`, `seedLyricsDraft` and
`resolveLyricsSaveTarget`. The rejected alternative is letting `band_id` go
undefined and collapsing `resolveLyricsVersion` to always `'band'`: it removes
band members' personal lyrics from Fast View outright. Pinned by ER13.

#### 3c. Two different nulls, named apart

`src/hooks/useLyricsEditor.ts:118-123` has exactly one `repertoireId === null`
branch and it must now serve only one of two causes:

- **`personalRepertoireId === null`** — the member has no personal row yet.
  Legitimate and shipped (RH-83): the branch calls `addSong(entry.song_id)`,
  adopts the created row and writes to it. **Unchanged.**
- **`entry.ownerRowId === null`** — the *addressed owner* (the band in band
  context, the user outside one) holds no row at this version. Nothing may be
  created and nothing may be written. The save control is already disabled by
  the read-only rule below, so the hook's job is only to refuse rather than
  fall into the create branch: the create is taken only when
  `target.toPersonalEntry` is true; a `repertoireId === null` with
  `toPersonalEntry` false returns without calling `addSong` or `updateLyrics`.

The other three write call sites take `ownerRowId` and refuse a null one:
`src/hooks/useSongStatus.ts:45` and `src/hooks/useSongLinks.ts:97,124`. §3d
enumerates them with the field each reads before and after, because `:45` also
reads `entry.band_id` and that is a second, independent substitution.

**Behaviour for a version with no owner row**: the page renders — title,
artist, inherited key/tuning/lyrics/map, empty tags, status `unknown`, the
file library — with every write control **disabled**, through the same
`readOnly` prop offline already threads to five components in `page.tsx`
(lines 205, 213, 223, 227, 255), whose expression becomes
`isOffline || !song.ownerRowId`. The lyrics editor is read-only in this state
too, including its personal branch: that costs nothing shipped, because
`ownerRowId === null` means the *band* holds no row at this version, which is
a page that is unreachable in Fast View before this change. The common band
case — band holds the row, member does not — has `ownerRowId` non-null and
keeps the full create-my-first-version flow. Creating an owner row from Fast
View is deliberately not attempted here.

#### 3d. Every consumer of the retyped entry, field by field

`Repertoire` (`src/types/database.ts:83-98`) has **exactly three** fields that
`ResolvedSongEntry` (`:110-123`) does not: **`id`**, **`user_id`** and
**`band_id`**. Every other field — `song_id`, `version_id`, `key`, `tuning`,
`status`, `tags`, `last_practiced`, `lyrics`, `map`, `song` — is present on
both, with `status` widened to `SongStatus | null`. A reader of one of those
three fields is the whole risk surface of this retype, so all of them are
enumerated here with their replacement and the ER that pins it. The table is
the checklist: an implementation that leaves a row unaddressed is incomplete
even if every other ER passes.

**Readers of `entry.id`:**

| Site | Today | After | Pinned by |
|---|---|---|---|
| `src/hooks/useSongStatus.ts:45` | `actions.updateStatus(entry.id, next, entry.band_id)` | `actions.updateStatus(entry.ownerRowId, next, bandId)`, guarded by an early return when `ownerRowId === null` | ER10 |
| `src/hooks/useSongLinks.ts:97` | `actions.updateLinks(entry.id, updated)` (add) | `entry.ownerRowId`, with the same null guard | ER9 |
| `src/hooks/useSongLinks.ts:124` | `actions.updateLinks(entry.id, updated)` (delete) | `entry.ownerRowId`, same guard | ER9 |
| `src/hooks/useLyricsEditor.ts:110` | `entryId: entry.id` into `resolveLyricsSaveTarget` | `entryId: entry.ownerRowId`, with the signature widened per §3b | ER12 |
| `src/lib/offlineSnapshot.ts` `gatherSongs` / v5 `repertoire.id` | the snapshot's owner row id | becomes `repertoire.ownerRowId`; the v5 → v6 upgrade maps `s.repertoire.id → ownerRowId` (§6) | ER6(a) |

`personalEntry?.id` is **not** in this table: `personalEntry` stays
`Repertoire | null` (§3a), so `personalRepertoireId` at
`src/hooks/useSongEntry.ts:133` and `src/hooks/useLyricsEditor.ts:112,201` keep
reading `.id` unchanged. Likewise `useLyricsEditor.ts:122`'s `created.id` reads
the `Repertoire` that `addSong` returns, not the route entry. ER14 pins both.

**Readers of `entry.band_id`:** all of them are replaced by the page's
`queryBandId` (`page.tsx:68`), threaded as an explicit `bandId: string | null`
option. The two are equal by construction — `resolveOwner` derives the owner
from that very parameter — which is why the substitution is sound rather than
merely type-correct.

| Site | Today | After | Pinned by |
|---|---|---|---|
| `src/hooks/useSongStatus.ts:45` (3rd arg) | `entry.band_id` | **`UseSongStatusOptions` gains `bandId: string | null`**, fed `queryBandId` at `page.tsx:82-87` exactly as §3b does for `useLyricsEditor`; the write becomes `updateStatus(entry.ownerRowId, next, bandId)` | ER10 |
| `src/hooks/useSongEntry.ts:131` | `entryBandId: entry?.band_id ?? null` | the hook's own `bandId` option (already present, `UseSongEntryOptions.bandId`) | ER14 |
| `src/hooks/useLyricsEditor.ts:94` | `if (entry.band_id) choice.openChoice()` | `if (bandId)` — the new option | ER13 |
| `src/hooks/useLyricsEditor.ts:111` | `entryBandId: entry.band_id` | `entryBandId: bandId` | ER13 |
| `src/hooks/useLyricsEditor.ts:195` | `isBandEntry: !!entry?.band_id` | `isBandEntry: !!bandId` (and the `LyricsEditorController.isBandEntry` docblock at `lyricsEditor.ts:121` is rewritten off `entry.band_id`) | ER13 |
| `src/lib/lyricsEditor.ts:57,69,79` | `entry?.band_id` via `LyricsSource` | unchanged signatures, fed the memoized `LyricsSource { band_id: bandId, lyrics }` adapter of §3b | ER13 |

**Readers of `entry.user_id`:** `grep -rn "entry\.user_id\|entry?\.user_id"
src/hooks src/components/fastview src/lib/songEntry.ts` returns **nothing** at
`2d244d3`. The field is unread on Fast View's path, so its absence from
`ResolvedSongEntry` costs nothing. This row exists so the implementer re-runs
that grep rather than assuming it.

`src/lib/songEntry.ts`'s four helpers (`songIdentity:32`, `withStatus:53`,
`withSongLinks:61`, `withLyrics:67`) read only `song`, `key`, `status` and
`lyrics` — all present on both shapes — so they re-type and keep their bodies.
`shouldLoadPersonalEntry:45` takes `bandId` and `songId` as plain arguments and
does not touch the entry at all.

**Why `useSongStatus` gets its own option instead of inferring null.** With
`bandId` absent or null, `updateSongStatusAction` resolves the owner as
`{ userId }`, so `writeOwnerSongRow` (`src/lib/ownerSongs.ts:148-166`) runs
`UPDATE user_songs … WHERE id = <the band row's id> AND user_id = …` and
matches no row: a band admin tapping a mastery note in band-context Fast View
gets a silent no-op or "Failed to update status". The same reasoning applies to
`useSongLinks`, whose `updateLinks` takes no `bandId` and resolves the owner
server-side from the row id alone — so it needs no new option, only the
`ownerRowId` swap and the null guard.

### 4. Navigation inverts

`src/lib/playlistNav.ts`: `computePlaylistNav` matches on `versionId` instead
of `repertoireId`; `nearestAddressable` is **deleted** — prev/next are the
plain neighbours now, because every entry has an address; `slideDirection`,
`swipeTarget`, `keyboardTarget` and `fastViewHref` carry a version id. The two
docblocks at lines 23 and 84 are rewritten.

`src/hooks/usePlaylistNav.ts` and the five setlist components
(`SetlistRow.tsx`, `SetlistSelect.tsx`, `SetlistPanel.tsx`,
`SetlistDrawer.tsx`, `SetlistSidebar.tsx`) rename `currentRepertoireId` to
`currentVersionId` — **38** occurrences under `src/` at `2d244d3`, 9 of them in
the five test files, by `git grep -c currentRepertoireId 2d244d3 -- src`.

**A pure rename is not sufficient, and silently breaks the current-row
highlight.** Three of those occurrences compare the prop against a *field* of
the entry, and that field must move from `repertoireId` to `versionId` in the
same edit, or the comparison becomes permanently false:

| Site | Today | After | Pinned by |
|---|---|---|---|
| `SetlistPanel.tsx:53` | `isCurrent={entry.repertoireId === currentRepertoireId}` | `isCurrent={entry.versionId === currentVersionId}` — without this, **no row is ever marked current** in the drawer or the sidebar, since the prop now carries a version id and `entry.repertoireId` is an owner row id (or null) | ER4 |
| `SetlistSelect.tsx:27,30` | `value={currentRepertoireId}`, `targetId === currentRepertoireId` | the renamed prop, matching the `<option value>` that collapses to `entry.versionId` below — otherwise the select shows no selected option | ER4 |
| `usePlaylistNav.ts:130-131` | `if (repertoireId === currentRepertoireId) return` and `slideDirection(entries, currentRepertoireId, repertoireId)` | both carry version ids, consistent with `computePlaylistNav` and `slideDirection` matching on `versionId` (`playlistNav.ts:96,134`) — otherwise re-selecting the current song triggers a slide to itself | ER3 |

`SetlistRow`'s `UNADDRESSABLE_CLASSES`, its `disabled`,
its `title="Not in this repertoire yet"` and its `if (repertoireId && …)`
guard at line 51 all go — **and so does the second `repertoireId` guard, at
line 72**: `{repertoireId && isCurrent && (… ▶ NOW …)}`. That one is easy to
miss because it reads as part of the current-row highlight rather than part of
the unaddressable state. Left in place, the current song gets the emerald
`CURRENT_CLASSES` but **no ▶ NOW pill** whenever the owner holds no row — which
is exactly the case this task makes reachable. It becomes
`{isCurrent && (…)}`. **The muted `Not in repertoire` chip stays** — it is still true
and still the information RH-126's mock chose it for; only the dead/grey state
goes. `SetlistSelect`'s `value={entry.repertoireId ?? entry.versionId}` and
its `disabled` collapse to `value={entry.versionId}`.

### 5. The two doors into Fast View

`src/components/songs/RepertoireDashboard.tsx:364`: `${song.id}` becomes
`${song.version_id}` — a one-token swap inside one template literal, and the
file must come out at exactly 578 lines again (see §7).

`src/components/playlists/PlaylistSongRow.tsx:58`: the href keys on
`ps.version_id` (`PlaylistSong.version_id`, `src/types/database.ts:215`) and
the `entry ? <Link> : <plain identity>` branch collapses to an unconditional
link, so every playlist row is navigable. The `entry` prop stays — `StatusNotes`
still reads it.

### 6. The offline snapshot, re-keyed — with a lossless v5 → v6 upgrade

`src/lib/offlineSnapshot.ts`: `OFFLINE_SCHEMA_VERSION` goes **5 → 6**, with a
`5 -> 6` paragraph added to the docblock in the style of the four before it.
`OfflineSongSnapshot.repertoireId: string` (`:140`) becomes
`versionId: string` (= `entry.versionId`); `repertoire` becomes
`ResolvedSongEntry`; `isSongSnapshot` validates `versionId` in place of
`repertoireId`; `buildOfflineSnapshot` writes `entry.versionId`.
`isSongSnapshot` **stays module-private** (`:274`) — it is asserted through
`readValidSnapshot` with an explicitly `schemaVersion: 6` fixture, so the v6
validator is exercised without the upgrade path running (ER5(a)); a v5-tagged
fixture would be upgraded and accepted, which proves the opposite.
**`personalRepertoire` stays `Repertoire | null`** (§3a).

`src/lib/offlineFirst.ts`: `findSong` keys on the snapshot's `versionId`; the
`getSongEntry` reader becomes the `getResolvedEntryForVersion` reader.
**`findSongBySongId` stays, and so does the `getPersonalEntryForSong`
reader** — both are song-keyed (RH-123, §3a) and resolve through
`repertoire.song_id`, which `ResolvedSongEntry` carries.

`src/hooks/useOfflinePlaylist.ts`: the `if (!entry.repertoireId) continue` at
line 115 and the `actions.getSongEntry(entry.repertoireId, bandId)` at line
116 are replaced by a version-keyed read of `entry.versionId`, so the download
captures **every** entry of the playlist.

**Keep a per-entry `try`/`continue` around that read.** Today the two
`continue`s make one unreadable entry skippable; the replacement read throws
for an unknown `versionId` (`ownerSongs.ts:334`, "Song version not found"), so
a version deleted between the playlist read and the capture would abort the
whole download instead of dropping one song. ER7's 3-of-3 assertion does not
conflict with this: all three entries are readable in that fixture. The comment at line 118 is the
recorded guard against the RH-123 band-context defect (the capture taking the
band's files instead of the member's); it is **rewritten, not deleted** — it
now reads "the song id, never the owner row id" — and the executable guard
that replaces its wording is the already-present test
`useOfflinePlaylist.test.tsx:147`, "calls getTabs with the song id, never with
a repertoire id", which must keep passing. The docblock mention at line 25 is
rewritten with it. `OfflineDownloadActions` takes the version-keyed entry read
and keeps `getTabs` and `getPersonalEntryForSong` as they are.

**A v5 record is upgraded, not discarded.** A v5 `OfflineSongSnapshot` already
carries everything v6 needs, so:

```
upgradeSongV5(s) = {
  versionId:          s.entry.versionId,          // PlaylistEntry.versionId, non-null since RH-125
  entry:              s.entry,
  repertoire:         { ownerRowId: s.repertoire.id, ...the ten fields verbatim },
  personalRepertoire: s.personalRepertoire,       // shape unchanged
  tabs:               s.tabs,                     // cacheKeys unchanged, so the PDF bytes stay valid
}
```

`s.repertoire.id` is non-null by construction (documented at
`offlineSnapshot.ts:138-139`: `gatherSongs` skips entries without one,
`useOfflinePlaylist.ts:115`), and `version_id`, `song_id`, `status`, `key`,
`tuning`, `lyrics`, `map`, `tags`, `last_practiced` and `song` are all present
verbatim on the v5 `Repertoire`. The mapping is total and loses nothing; the
only widening is `status`, from `SongStatus` to `SongStatus | null`.

Files touched for it:

- `src/lib/offlineSnapshot.ts` gains a retained v5 song/snapshot shape, a v5
  validator, and a pure exported `upgradeSnapshotV5ToV6` — no DB, no network,
  no `window`, consistent with this module's purity contract. The file is 319
  lines today against the base `max-lines: 400`, so the headroom is **81
  lines**, and the v5 song/snapshot shapes, the v5 validator, the upgrade
  function and the `5 -> 6` docblock paragraph will consume most of it.
  **Named fallback, decided now rather than mid-change:** if the edit would
  exceed 400, move the retained v5 material — the v5 shapes, the v5 validator
  and `upgradeSnapshotV5ToV6` — into a new sibling `src/lib/offlineSnapshotV5.ts`
  which `offlineSnapshot.ts` imports, leaving `readValidSnapshot` as the only
  v6-side change. Adding an `eslint.config.mjs` override entry is **not** an
  option: §7's rule is that the override list may only shrink. The sibling is
  equally pure (no DB, no network, no `window`) and its tests live in the same
  `offlineSnapshot.test.ts`, so ER6 reads identically either way.
- `readValidSnapshot` (`:293-300`) upgrades before it compares: a value that
  validates as v5 is converted and then validated as v6; anything else keeps
  returning `null`.
- `src/lib/offlineStore.ts`: the purge at `:261` stops destroying v5. It
  rewrites the record at the new `schemaVersion` when `readValidSnapshot`
  yields a snapshot, and purges only when it yields `null`. The cached PDFs
  survive because `offlineTabCacheKey(playlistId, tabId)` and every
  `OfflineTabSnapshot.cacheKey` are untouched by the reshape.

This is the first schema bump that is a pure reshape of data already in the
record, which is why it does not follow the v1→v2 precedent
(`offlineSnapshot.ts:55-60`): that one discarded because the information was
*genuinely absent* ("cannot tell 'no personal version' from 'never
captured'"). Here nothing is absent, and the cost of discarding would be every
downloaded playlist and its cached PDF bytes destroyed on first launch,
recoverable only with a network connection.

### 7. Ceilings and stale references

- `src/lib/ownerSongs.ts` — **400/400**, no override entry. Base `max-lines`
  is 400 (`src/lib/__tests__/complexityBudget.test.ts:44`). Only the docblock
  at 287–296 changes; the file must not grow by one line.
- `src/components/songs/RepertoireDashboard.tsx` — **578/578** against an
  override entry pinned at `max-lines: 578`. `complexityBudget.test.ts`
  criterion (e) requires an override ceiling to equal its file's *current
  worst* number exactly, so if the file shrinks the entry must be lowered to
  match, and if a real number falls below the base budget the key is
  **deleted** from the entry rather than lowered (RH-128 precedent).
- The override block between `// BEGIN:complexity-budget-overrides` and
  `// END:complexity-budget-overrides` holds **exactly 14 entries**;
  `MAX_OVERRIDES` is **17**. The list may only shrink; `MAX_OVERRIDES` may
  only be lowered.
- `grep -rn "RH-109" src --include='*.ts' --include='*.tsx'` returns **9 lines
  across 8 files** today (`SetlistRow.tsx:32`, `SetlistSelect.tsx:18`,
  `__tests__/SetlistRow.test.tsx:79`, `ownerSongs.ts:295`,
  `playlists.ts:325`, `playlistNav.ts:23,84`,
  `__tests__/playlistNav.test.ts:227`,
  `__tests__/playlistVersionReads.db.test.ts:194`). All nine are forward
  references that this task makes false.
- `npx eslint` reports **8 errors and 9 warnings across 11 files** today, none
  in a file this task touches, and that set is the RH-129 baseline. No eslint
  job runs in CI (`.github/workflows/ci.yml` runs `test:e2e`, `lint:dead`,
  `test:coverage`, `lint:dup`, `audit`), so the budget bites only through
  `complexityBudget.test.ts`. The gate is stated relatively (ER17) because
  RH-108 is in flight and adds a file of its own to that output.

### Test criteria

Unit, node/jsdom, no DB: `playlistNav.test.ts` (neighbour matching by version,
no `nearestAddressable`), the setlist component suites (every row
interactive), `offlineSnapshot.test.ts` (v6 shape, v5 upgraded losslessly),
`offlineStore.test.ts` (a v5 record is rewritten, not purged),
`offlineFirst.test.ts` (version-keyed `findSong`, song-keyed `getTabs` and
`getPersonalEntryForSong` unchanged), `useOfflinePlaylist.test.tsx` (every
entry captured, `getTabs` still called with the song id),
`useSongEntry.test.tsx` (resolved entry, `ownerRowId` both null and non-null),
`lyricsEditor.test.ts` + `useLyricsEditor.test.tsx` (the two nulls apart, the
create-first-personal flow intact, the switcher fed from the page's `bandId`),
`useSongStatus.test.tsx` + `useSongLinks.test.tsx` (every write issued with
`ownerRowId`, and the status write's third argument the page's `bandId` — §3d),
`actionSessionGuard.test.ts` and `repertoire.test.ts` (the replacement action
fails closed and still delegates through `assertBandMember`), and a new
page-level render suite at `src/app/songs/__tests__/fastViewPage.test.tsx`
(`// @vitest-environment jsdom`, the `src/app/join/__tests__/joinPage.test.tsx`
precedent) for the read-only rendering of §3c.

DB-backed, gated on `RUN_DB_TESTS`: `ownerSongs.db.test.ts` and
`authzRepertoire.db.test.ts`. `npm run test:coverage` is plain
`vitest run --coverage` with no `RUN_DB_TESTS`, so these **skip** under it;
they must be run explicitly and must report 0 failed **and 0 skipped**.

E2E: `e2e/fast-view-mobile.spec.ts` navigates by clicking a real `/fast-view`
link and asserts the title renders — it is the end-to-end proof the new route
is wired, and it must pass unchanged in intent.

## Expected Results

See the task's `expected_results` (ER1–ER22), authored from this spec.

## Out of Scope

- `?returnTo=` and `?bandId=` (both survive verbatim; removing `returnTo` is RH-133).
- The `sessionStorage` queue (RH-133) — `grep -rn sessionStorage src/` must
  still return nothing after this task.
- The neighbour window fetch and write-invalidation (RH-134).
- Creating an owner row from Fast View.
- Re-keying `personalEntry`, `getPersonalEntryForSong` or
  `addSongToRepertoire` to a version (§3a).
- Any `migrations/` change.
- Landing page copy.

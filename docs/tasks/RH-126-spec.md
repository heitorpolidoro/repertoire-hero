# RH-125 — Point `playlist_songs` at `song_versions`

Part 5 of 6 from the RH-105 split. Spec file is `docs/tasks/RH-126-spec.md` (board id + 1).

`blockedBy: ["RH-124", "RH-103"]`. **RH-103 is a dependency, not a sibling** — this migration
deletes the constraint RH-103's ER2 asserts, so the order is forced; see §2. This task is
written against the tree RH-124
(`docs/tasks/RH-125-spec.md`) leaves behind, and every name below is the post-RH-124 name,
to be **read from the tree** rather than copied from a spec:

- `repertoire` is gone; `user_songs (user_id, version_id, …)` and
  `band_songs (band_id, version_id, …)` replace it, each unique on `(owner, version_id)`.
- `src/lib/songResolution.ts` holds the one cascade helper (`resolveSongFields`), and
  `src/lib/ownerSongs.ts` holds the owner-row data access, including
  `getResolvedEntryForVersion(owner, versionId)`, which **`LEFT JOIN`s** the owner table and
  resolves rather than throwing when there is no row.
- RH-124 §3 defines the representative-version ordering (`album_type = 'album'` first, then
  earliest `albums.release_date`, then earliest `song_versions.created_at`, then `id`, with
  `LEFT JOIN albums` everywhere and nulls last). RH-124 §3 also says, in as many words, that
  **this task deletes the `LEFT JOIN LATERAL` version picks** it added to the playlist reads.
- RH-121 renamed `global_songs` to `songs`; RH-122 added `albums`/`song_versions`, the title/label
  split, and deleted `scripts/deduplicate-songs.mjs` (so its `playlist_songs` rewrite is not this
  task's problem).

## Scope

`playlist_songs` stops naming a song and names a version instead, end to end:

- the column `song_id` becomes `version_id` referencing `song_versions`, backfilled for every
  existing entry, with `unique (playlist_id, version_id)` replacing `uq_playlist_song`;
- the four reads that project a playlist entry (`getUserPlaylists`, `getBandPlaylists`,
  `getPlaylistWithSongs`, `getPlaylistDetailsWithEntries`) and the two writes
  (`addSongToPlaylist`, `removeSongFromPlaylist`) work in versions;
- the client decisions keyed by song id — `src/lib/playlistDetail.ts`,
  `src/lib/playlistOverlay.ts`, `src/lib/songPicker.ts` and their hooks — re-key to version id;
- the Spotify import and sync routes carry versions: the pull's dedup, the bulk insert and the
  push's URL extraction;
- `getPlaylistDetailsWithEntries` stops dropping an entry whose owner holds no repertoire row.

**Why a version and not a repertoire row id** — the decision a reader will question, so it is
stated here and not only in `docs/use-cases.md` (*Resolving a value → Finding the owner's row*):
the playlist already names its owner (`playlists.user_id` xor `playlists.band_id`), so the pair
`(playlist owner, version_id)` is the unique key of `user_songs`/`band_songs` — one index hit, no
second copy of the owner that could disagree with the first. And the same version opened from a
personal playlist and from a band playlist must resolve to **two different rows**, with different
key, tuning, lyrics and map; a stored repertoire row id could only ever name one of them.

**Not covered:** re-addressing Fast View (and the offline snapshot) by version — that is **RH-109**,
and this task deliberately leaves the repertoire row id as the Fast View address (§3). Also out:
removing the band-playlist dual write (RH-126's deliverable), `song_links`, `catalog_suggestions`,
the version-aware expanded search card, and any change to `uq_playlist_song_position`'s
deferrability (RH-103's, §2).

## Approach

### Behavior

#### 1. The migration

One new file under `migrations/`, prefix **one above the highest present in the directory at
implementation time — re-read the directory; do not trust a number quoted in any spec.** Many
approved specs are queued ahead and
`src/lib/__tests__/migrationsSingleSource.test.ts` requires prefixes unique and contiguous from
`0001`. Earlier migrations are never edited, and no expected result below names the literal
filename: each resolves it by its name suffix.

Steps, in order:

1. **Call RH-122's idempotent catalog backfill function** (name read from the tree) so every
   `songs` row is guaranteed at least one `song_versions` row, including rows written between the
   two migrations. Same move as RH-124 §4 step 2, for the same reason.
2. `ALTER TABLE playlist_songs ADD COLUMN version_id uuid REFERENCES song_versions(id) ON DELETE
   CASCADE` — nullable for the duration of the backfill only.
3. Create `orphaned_playlist_entries (id, row_json jsonb NOT NULL, reason text NOT NULL,
   archived_at timestamptz NOT NULL DEFAULT now())` with a `COMMENT ON TABLE` saying what it is and
   that nothing reads it, exactly as RH-124 does for `orphaned_repertoire_rows`. A playlist entry
   that silently vanishes is as bad as a repertoire row that does, and `song_id` is dropped two
   steps later, so there is no second chance.
4. Archive, as whole-row jsonb with reason `no_version`, every entry whose song still has no
   version after step 1 (unreachable while step 1 runs; kept as the same kind of guard RH-124 §4
   step 4 keeps), and delete those entries.
5. Backfill `version_id` from `song_id` using **RH-124 §3's representative-version ordering,
   unchanged and not re-invented**. That ordering is restated here in full, because this is the
   one step whose result can diverge from RH-124's without any other assertion noticing, and
   ER2 is written against this restatement rather than against a section number in another
   file: among the song's `song_versions`, prefer `albums.album_type = 'album'` over any other
   value (`single`, `compilation` — RH-122's closed domain) and over a null, then the earliest
   `albums.release_date` (nulls last), then the earliest `song_versions.created_at`, then the
   lowest `song_versions.id`. The join onto `albums` is a `LEFT JOIN`, which is what keeps a
   version with no album row (`album_id IS NULL`, legal since RH-122) and an album with a null
   `release_date` from being classed `no_version` and archived. The two version-level tiebreakers
   make the pick total, so two runs cannot disagree. The pick is **asserted**, not inherited:
   ER2 seeds a song with an `album` version and a `single` version and a same-album pair that
   differs only by `created_at`, and names the version each entry must land on.
6. `ALTER COLUMN version_id SET NOT NULL`; drop `uq_playlist_song`; add
   `uq_playlist_song_version UNIQUE (playlist_id, version_id)`; `DROP COLUMN song_id`; add an index
   on `version_id` for the FK. `position` values are **not** touched: no renumbering, no reordering.

The new unique cannot be violated by the backfill: `uq_playlist_song` guarantees at most one source
entry per `(playlist, song)`, exactly one version is chosen per song, and a version belongs to one
song — so two surviving entries of one playlist cannot land on the same version. Conservation is
asserted rather than assumed (ER4).

The migration is **not** idempotent and is not required to be: it drops its own source column, and
the `_migrations` ledger is what stops a second run.

#### 2. The two uniques on this table, and why RH-103 lands first

RH-103 (*Make reordering a playlist possible*, approved, `ready_todo`, spec
`docs/tasks/RH-104-spec.md`) drops and re-adds `uq_playlist_song_position` as
`UNIQUE (playlist_id, position) DEFERRABLE INITIALLY IMMEDIATE` so a reorder can permute
positions in one statement. Both tasks alter constraints on `playlist_songs`, and the order
between them is **not** free: RH-103's ER2 reads "`uq_playlist_song (playlist_id, song_id)` is
still immediate: the same query for `conname = 'uq_playlist_song'` returns `f, f`"
(`docs/tasks/RH-104-spec.md:327`), and this migration **deletes `uq_playlist_song`** and puts
`uq_playlist_song_version` in its place. If this task landed first, RH-103's ER2 could never be
satisfied and its QA would fail on a constraint that is correctly gone.

So `RH-103` is in this task's `blockedBy`. RH-103 lands first, its ER2 is verified while
`uq_playlist_song` still exists, and only then does this migration replace it. Running against
the tree RH-103 leaves behind costs this task nothing: it names `uq_playlist_song_position`
nowhere — it does not drop it, re-create it or re-declare its deferrability — and it writes no
`position` value, so RH-103's deferrable declaration survives untouched. `ADD COLUMN`,
`DROP COLUMN` and `ADD CONSTRAINT` do not re-declare an unrelated constraint, and the backfill
`UPDATE` writes only `version_id`, so the position unique is not even evaluated.

`uq_playlist_song_version` is a **plain, immediate** unique — the default form, and the same
form `uq_playlist_song` has today, so this is a swap of columns and not a change of mode.
Nothing asks for more: only the *reorder* permutes a column inside one statement, which is why
`docs/plans/repertoire-rework.md` (*Create, reorder and delete a playlist*) makes the position
unique alone deferrable, and no path in this task permutes a playlist's versions.

**No `ON CONFLICT` clause is added to any `playlist_songs` insert, and the earlier claim that
the bulk import needs one is withdrawn as false.** Checked against the tree:
`buildPlaylistSongsInsert` (`src/lib/spotifyPlaylistSync.ts:170-186`) emits a bare positional
`INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES …` with no `ON CONFLICT`;
`addSongToPlaylist`'s insert (`src/lib/playlists.ts:180-184`) has none either; and the sync
route's pull `DELETE`s every row of the playlist before re-inserting
(`src/app/api/spotify/playlists/[id]/sync/route.ts:103-109`), so there is nothing for an arbiter
to absorb. RH-103's spec carries the same claim about this repository; it is wrong there too and
inherited, not observed. The instruction matters because adding `ON CONFLICT (playlist_id,
version_id) DO NOTHING` to a **positional** insert would silently skip rows and leave `position`
gaps behind the skipped ones, and a duplicate add would stop raising — neither of which any
other assertion in this task would catch. ER3 pins the constraint modes at `pg_constraint`; ER4
pins the absence of the clause.

#### 3. A playlist entry whose owner holds no repertoire row is not an error

`getPlaylistDetailsWithEntries` violates that rule today with an inner `JOIN repertoire`, and the
consequence is worse than one missing row: `computePlaylistNav` returns `null` when the current song
is not in the list, so losing one entry collapses the whole setlist. The join becomes a `LEFT JOIN`
onto the owner table on `(playlist owner, version_id)` — the owner branch it already selects with
`$1`/`$2` — and every entry of the playlist is returned, in position order, with its title and
artist, whether or not the owner holds a row. A missing row resolves exactly like a row whose
overrides are all null (*Resolving a value*).

That makes one id nullable, and the spec says exactly where it is allowed to go. `PlaylistEntrySummary`
(and its client-safe mirror `PlaylistEntry` in `src/lib/playlistNav.ts`) gains
`versionId: string` — **always non-null, the entry's identity** — and `repertoireId` becomes
`string | null`, meaning "the owner's row, if there is one". Only three consumers see the null, and
each gets a rule:

- **`computePlaylistNav` keeps matching the current song by `repertoireId`.** It is reached with the
  Fast View route param, which *is* an owner row id, so an entry that can be current always has a
  non-null one. The collapse mode disappears because the entry can no longer be absent from the
  list, not because the matching key changed — re-addressing Fast View by version is RH-109, and
  doing it here would make two tasks out of one. `prevId`/`nextId` keep their existing
  `string | null` type and become the nearest neighbour **with a non-null `repertoireId`**, skipping
  entries that have no address yet; a gap must not block the rest of the setlist. `position` and
  `total` count **every** entry, so the indicator matches the list the drawer draws.
- **The setlist drawer renders every entry**; one with a null `repertoireId` is rendered
  non-interactive, since there is nothing to navigate to until RH-109 (see the mockup — this is the
  one open question).
- **`useOfflinePlaylist`'s `gatherSongs` skips an entry with a null `repertoireId`**, with the same
  `continue` it already uses when `getSongEntry` answers `null`
  (`src/hooks/useOfflinePlaylist.ts:104-105`). `OfflineSongSnapshot.repertoireId` — the top-level
  field, the `getTabs` lookup key — stays non-null, because the entries that reach the snapshot are
  exactly the ones that survived that `continue`.

  **`OFFLINE_SCHEMA_VERSION` is bumped by one above whatever RH-124 left in the tree** (RH-124 §7
  already raises today's `2`). A stored snapshot *does* change shape, contrary to what an earlier
  draft of this spec asserted: `OfflineSongSnapshot` stores `entry: PlaylistEntry` whole
  (`src/lib/offlineSnapshot.ts:69-81`), not just its `repertoireId`, and this task gives
  `PlaylistEntry` a required `versionId: string` and makes its `repertoireId` nullable. Every
  snapshot already in a musician's IndexedDB would therefore read back with
  `entry.versionId === undefined` under a type that says `string`, and `isSongSnapshot` would not
  notice — it validates `entry` only as `isRecord` (`src/lib/offlineSnapshot.ts:188-197`). The
  bump is what discards those records instead, through the one `schemaVersion !==` check in
  `readValidSnapshot` (`src/lib/offlineSnapshot.ts:209`), on the module's own v1→v2 precedent: an
  indicator that might be wrong is worse than no offline copy. ER17 asserts it.

No other type gains a nullable field, and no component receives one.

![Mockup](RH-126-mock.html)

`docs/tasks/RH-126-mock.html` shows the resulting setlist — two takes of one song side by side —
and poses the single open question: how an entry whose owner holds no repertoire row looks.

#### 4. The playlist page

- **`getPlaylistWithSongs` re-points its joins and resolves nothing.** It projects `ps.version_id`
  instead of `ps.song_id`, joins `song_versions v ON v.id = ps.version_id` and
  `songs s ON s.id = v.song_id`, and carries the version's `label` and a `duration_seconds` that
  reads the version's, falling back to the song's while that column still exists, so the mastery
  summary's total time does not go blank. It does **not** join the owner table and does **not**
  fold through `resolveSongFields`.

  **The resolved truth has exactly one source on this page: the repertoire map.** An earlier draft
  required this read to resolve `key`, `tuning`, `lyrics` and `map` as well, which was wrong on
  three counts, each checked against the tree. (a) No consumer: `PlaylistSongRow.tsx` renders the
  cover, title, artist, album, `ps.song.duration_seconds`, the status chip and the tag row, and
  reads none of those four fields; nothing else on the page does either. (b) Two resolved copies of
  one truth: `src/app/playlists/[id]/page.tsx:50` already reads `getRepertoire(owner)` into the map
  the view receives, and after RH-124 that row carries `version_id` and the resolved overrides — a
  second resolution of the same `(owner, version_id)` would leave a renderer with two answers and
  no rule for choosing. (c) A projection nothing reads is dead weight on a `max-lines`-pinned
  module. So the map stays the single resolved source, keyed by `version_id`, and the entry stays a
  pointer plus display columns.
- **The version's `label` has a named consumer**, or it would be the same dead projection:
  `src/components/playlists/PlaylistSongIdentity.tsx` renders it under the artist, beside the album
  line it already draws, so a setlist showing two takes of one song is readable rather than two
  identical rows. That file is 57 lines against the global 400 and carries no
  `complexity-budget-overrides` entry, so the addition forces no extraction (ER18).
- An entry whose owner holds no row is simply absent from the map, which is what the pure helpers in
  `src/lib/playlistDetail.ts` already handle: `summarisePlaylistMastery` counts it `unknown`,
  `collectPlaylistTags` contributes nothing, and `cycleSongStatus` returns `null` so no write is
  attempted. Those three behaviours are **unchanged by this task** — `cycleSongStatus` already
  returns `null` on a map miss (`src/lib/playlistDetail.ts:137-145`) — so what ER11 asserts is the
  part that does change: the lookup key. **No status-insert path is invented here**: under *Add a
  song to a playlist* a playlist entry always has a row, so this is the residual case (a row removed
  from the repertoire while the song stayed in the setlist), and it must render, not error.
- `src/lib/playlistDetail.ts` and `src/lib/playlistOverlay.ts` re-key from song id to version id
  throughout: the repertoire map (`Map<string, …>` keyed by `version_id`, built from
  `entry.version_id`), the `ps.song_id` lookups inside `collectPlaylistTags`
  (`src/lib/playlistDetail.ts:31`), `summarisePlaylistMastery` and `cycleSongStatus`,
  `removedSongIds` → `removedVersionIds`, the `remove-song` / `restore-song` / `repertoire-entry`
  actions (`src/lib/playlistOverlay.ts:47,58-62`), and the `songs-reported` dedup set. The rename is
  part of the change, not optional: two lists keyed by different ids under the same name is the bug
  this re-key exists to prevent.
- `getUserPlaylists` (`src/lib/playlists.ts:23`) and `getBandPlaylists` (`src/lib/bands.ts:243-244`)
  each build their per-entry duration json through `JOIN global_songs s ON ps.song_id = s.id`; both
  join through `song_versions` instead, for the duration their cards sum. These are SQL strings, so
  a missed `ps.song_id` type-checks and fails only at runtime — hence ER16, which exercises both.

#### 5. The two writes, and the picker

- `addSongToPlaylist(playlistId, userId, versionId)` and
  `removeSongFromPlaylist(playlistId, userId, versionId)` take a version; the delete is by
  `(playlist_id, version_id)`. Their Server Actions in `src/app/actions/playlists.ts` follow, and the
  parameter is renamed, not merely re-typed. `assertPlaylistAccess` and the `assertBandAdmin` gate
  RH-124 added to the band branch are unchanged. The owner-row ensure inside `addSongToPlaylist` now
  receives the version it was given and **loses its representative-version pick** (RH-124 §3).
  The band-playlist dual write stays — RH-126's deliverable, named here so it is a decision.
- `src/lib/songPicker.ts` offers and returns a version: `visiblePickerCatalog` filters against the
  playlist's **version** ids, and `findRepertoireSongIdByTrack` becomes a version lookup returning
  the held `version_id`. A collapsed catalog card carries the representative version the search read
  already computed (RH-124 §3's ordering; the picker computes none of its own), and `addCatalogSong`
  adds exactly that version — which is what `docs/plans/repertoire-rework.md` *Interaction* says a
  collapsed card's `[+]` does. `useSongPicker` passes version ids through; the per-row error map and
  the `already in your repertoire` recovery are untouched.

#### 6. Spotify import and sync

- `findOrCreateSong` (`src/lib/spotifyPlaylistSync.ts` — today's tree still calls it
  `findOrCreateGlobalSong`; RH-121 is what renames it, so read the name from the tree) already
  upserts the album and the version after RH-122; it now **returns the version id** alongside the
  song id, so no caller re-derives it.
- `ensureInRepertoire` takes a `versionId` instead of a `songId` and keeps its set-based,
  `ON CONFLICT DO NOTHING` shape and its `db: Queryable = pool` parameter
  (`src/lib/spotifyPlaylistSync.ts:144-148`). That clause is on the **owner-table** insert and is
  unrelated to §2's instruction, which is about `playlist_songs`.
- `buildPlaylistSongsInsert(playlistId, versionIds)` writes `(playlist_id, version_id, position)`,
  positions still 1-based in argument order, and **stays a bare positional insert with no
  `ON CONFLICT` clause** (§2).
- **The pull's URL-equality dedup compares versions.** `findOrCreateSong` appends the track's Spotify
  URL to the song's links only when no link already carries that URL
  (`src/lib/spotifyPlaylistSync.ts:103`); two takes of one song that differ by album or label resolve
  to two versions under RH-122's `(song_id, album_id, label)` version identity, so both stay in the
  setlist (the looser unique is what allows it),
  while re-syncing the same track resolves to the version already there and adds nothing. The route's
  `existingSongIds` / `seenSpotifySongs` sets and the `SELECT song_id FROM playlist_songs` that feeds
  them become version-keyed, and so do the `added` / `removed` counts. The push reads `ps.version_id`
  and reaches the links through `song_versions` → `songs`.
- `src/lib/dbRows.ts`'s playlist row types follow (`PlaylistEntryRow:46-52` gains `version_id` and
  its `repertoire_id` becomes nullable; `PlaylistSongIdRow:55-57` and `PlaylistSongLinksRow:60-64`
  become version-id row types), and each keeps the doc comment naming the query it belongs to.

### Files touched

- `migrations/<next>_playlist_songs_version_id.sql` — new; §1.
- `src/lib/playlists.ts` — the four reads, the two writes, `PlaylistEntrySummary`; §3–§5.
- `src/lib/bands.ts` — `getBandPlaylists`'s entry join.
- `src/lib/playlistDetail.ts`, `src/lib/playlistOverlay.ts` — re-keyed to version id; §4.
- `src/lib/playlistNav.ts` — `PlaylistEntry` gains `versionId`, `repertoireId` nullable, prev/next
  skip unaddressable entries; §3.
- `src/lib/songPicker.ts`, `src/hooks/useSongPicker.ts` — version in, version out; §5.
- `src/hooks/usePlaylistDetail.ts`, `src/hooks/usePlaylistNav.ts`, `src/hooks/useOfflinePlaylist.ts`
  — the re-key and the one `continue`; §3–§4.
- `src/components/playlists/*`, `src/components/fastview/*` (the setlist drawer and the entry rows) —
  version-keyed props; the non-interactive no-row entry;
  `src/components/playlists/PlaylistSongIdentity.tsx` renders the version `label` (§4).
- `src/app/playlists/[id]/page.tsx`, `src/app/actions/playlists.ts`, `src/app/songPickerActions.ts`,
  `src/app/fastViewNavActions.ts` — parameter renames only.
- `src/app/api/spotify/playlists/[id]/import/route.ts`, `…/sync/route.ts`,
  `src/lib/spotifyPlaylistSync.ts` — §6.
- `src/lib/dbRows.ts`, `src/types/database.ts` — `PlaylistSong` loses `song_id`, gains `version_id`
  and the version's `label`; the row types of §6.
- `src/lib/offlineSnapshot.ts` — `OFFLINE_SCHEMA_VERSION` bumped one above RH-124's value, because
  the stored `entry` changes shape (§3).
- **`scripts/dev-seed` is not touched**, and the earlier draft's claim that it "seeds
  `playlist_songs` with versions" is withdrawn: checked against the tree, it writes `user`,
  `account`, `profiles`, `bands`, `band_members`, `global_songs` and `repertoire` rows and **no
  `playlist_songs` row at all** (its `repertoire` inserts are RH-124's to repoint). There is
  nothing here to re-key, so there is no deliverable and no expected result.
- `AGENTS.md` — the **Playlist** glossary entry (`AGENTS.md:222`, "An ordered collection of global
  songs (`playlist_songs`, ordered…)") says a playlist holds versions of songs;
  `docs/suggestions-log.md` if anything is deferred.
- `package.json` — version bump.
- Tests: new `src/lib/__tests__/playlistSongsVersionMigration.db.test.ts`; updated
  `src/lib/__tests__/playlists.test.ts`, `playlistDetail.test.ts`, `playlistOverlay.test.ts`,
  `playlistNav.test.ts`, `songPicker.test.ts`, `spotifyPlaylistSync.test.ts`, `spotify.test.ts`,
  `transactionAtomicity.db.test.ts`, `spotifySyncAtomicity.db.test.ts`,
  `spotifyPlaylistRouteAuthz.db.test.ts`, `offlineSnapshot.test.ts`,
  `src/app/actions/__tests__/authzPlaylists.db.test.ts`, the `usePlaylistDetail` /
  `useSongPicker` / `usePlaylistNav` jsdom tests, and `e2e/` specs that add or remove a playlist song.

### Test criteria

- **Migration (`*.db.test.ts`, `describe.skipIf(!RUN_DB_TESTS)`)** — resolves the migration file by
  its name suffix and executes it against seeded legacy-shaped rows inside a transaction it rolls
  back: entries carried with positions unchanged; `song_id` absent from
  `information_schema.columns`; conservation (`count` before `=` `count(playlist_songs) +
  count(orphaned_playlist_entries)` after); an entry whose only version has a null `album_id`, and
  one whose album has a null `release_date`, both carried rather than archived; an entry whose song
  has no version at all archived with a reason; two versions of one song inserted into one playlist;
  a repeat of the same `(playlist_id, version_id)` rejected; `condeferrable` false for
  `uq_playlist_song_version` and unchanged for `uq_playlist_song_position`; and **the
  representative pick named** — a song with an `album_type = 'album'` version and a `single`
  version migrates onto the album one, and a pair on the same album differing only by `created_at`
  migrates onto the earlier one.
- **Reads (`playlists` db test)** — `getPlaylistWithSongs` returns each entry with its
  `version_id`, the version's `label` and a non-null `duration_seconds`, and projects no owner-table
  column; an entry the owner holds no row for comes back from `getPlaylistWithSongs` **and** from
  `getPlaylistDetailsWithEntries` (`repertoireId` null) without a throw; `getUserPlaylists` and
  `getBandPlaylists` each return a playlist whose entries carry the version's duration.
- **Re-key (unit on `playlistDetail.ts` / `playlistOverlay.ts`)** — the three map readers find an
  entry in a map keyed by `version_id` and find nothing in one keyed by the song id, where "nothing"
  is `unknown` / no tag / `null`.
- **Nav (unit)** — `computePlaylistNav` returns non-null for a current entry when the list also holds
  an entry with a null `repertoireId`; `position`/`total` count every entry; prev/next skip the
  unaddressable one.
- **Picker and writes (jsdom)** — the add path calls through with a `version_id`, the remove path
  removes by `(playlist_id, version_id)`, and selecting a picker result yields a version id.
- **Spotify (unit on `spotifyPlaylistSync.ts`)** — two tracks resolving to different versions of one
  song are both inserted, in order; re-syncing the same track inserts nothing new; the built SQL
  names `version_id` and contains no `ON CONFLICT`.
- **Label (jsdom)** — a playlist holding two versions of one song renders two rows distinguishable
  by the version label.
- **Offline (`offlineSnapshot.test.ts`)** — `OFFLINE_SCHEMA_VERSION` is one above RH-124's value and
  `readValidSnapshot` rejects a snapshot written under the previous version.
- **Gates** — `npm run test:coverage` (all four thresholds), `npm run lint:dead`, `npm run build`,
  plus `migrationsSingleSource`, `complexityBudget` and `transactionGuard` unchanged. No
  `complexity-budget-overrides` entry is added (the ratchet may only shrink).

## Expected Results

- [ ] ER1 — A new migration under `migrations/`, numbered one above the highest prefix present in the
      directory at implementation time and resolved in tests by its name suffix (never by a literal
      filename), replaces `playlist_songs.song_id` with `version_id NOT NULL REFERENCES
      song_versions`, backfills every existing entry, replaces `uq_playlist_song` with
      `unique (playlist_id, version_id)`, and writes no `position` value; `npm run db:migrate` exits
      0 on a fresh database and `src/lib/__tests__/migrationsSingleSource.test.ts` passes.
- [ ] ER2 — The backfill picks the representative version, asserted by name and not by reference: a
      `RUN_DB_TESTS=1`-gated test seeds one song with a version on an album whose `album_type` is
      `'album'` and a second version on an album whose `album_type` is `'single'`, and a second song
      with two versions on the **same** album differing only by `song_versions.created_at`; after the
      migration the first song's entry carries the `album` version's id and the second song's entry
      carries the earlier-`created_at` version's id. The ordering the migration implements is
      `album_type = 'album'` first, then earliest `albums.release_date`, then earliest
      `song_versions.created_at`, then lowest `song_versions.id`, nulls last. Observed passing, not
      skipped.
- [ ] ER3 — The two uniques keep their intended modes: after the migration,
      `SELECT condeferrable, condeferred FROM pg_constraint WHERE conname =
      'uq_playlist_song_version'` returns `f, f`; the same query for `uq_playlist_song_position`
      returns whatever RH-103 left (unchanged by this migration); and the migration file contains no
      occurrence of `uq_playlist_song_position`, asserted by reading the file.
- [ ] ER4 — No `playlist_songs` insert acquires an `ON CONFLICT` clause: no `INSERT INTO
      playlist_songs` under `src/` contains `ON CONFLICT`, asserted by reading the sources, and a
      `RUN_DB_TESTS=1`-gated test asserts that adding a version already in the playlist **raises**
      rather than silently doing nothing. Observed passing, not skipped.
- [ ] ER5 — A `*.db.test.ts` gated `describe.skipIf(!RUN_DB_TESTS)` asserts two different versions of
      the same song both insert into one playlist, and that a second insert of the same
      `(playlist_id, version_id)` raises a unique violation; observed passing, not skipped.
- [ ] ER6 — `playlist_songs` carries no `song_id` column, asserted against
      `information_schema.columns` by the same gated test, and the `position` ordering of migrated
      entries is unchanged; observed passing, not skipped.
- [ ] ER7 — The migration loses no entry: the same gated test captures `count(*)` of the seeded
      `playlist_songs` rows before executing the file and asserts it equals
      `count(playlist_songs) + count(orphaned_playlist_entries)` afterwards, and that an entry whose
      song has no version is present in `orphaned_playlist_entries` as whole-row jsonb with a reason;
      observed passing, not skipped.
- [ ] ER8 — An entry whose version has **no album row** (null `album_id`), and one whose album carries
      a null `release_date`, are both carried against that version rather than archived — seeded by
      hand in the same gated test (observed passing, not skipped) — and every join onto `albums` in
      the migration's ordering is a `LEFT JOIN`.
- [ ] ER9 — `getPlaylistWithSongs` re-points its joins and resolves nothing: a `RUN_DB_TESTS=1`-gated
      test asserts each returned entry carries `version_id`, the version's `label` and a non-null
      `duration_seconds` (the version's, falling back to the song's), that the query joins
      `song_versions` and `songs` and projects **no** `user_songs` / `band_songs` column, and that no
      query under `src/` coalesces `key`, `tuning`, `lyrics` or `map` across levels in SQL. Observed
      passing, not skipped.
- [ ] ER10 — An entry whose owner holds no repertoire row is returned rather than dropped:
      `getPlaylistDetailsWithEntries`'s inner `JOIN repertoire` is gone, the owner table is
      `LEFT JOIN`ed on `(playlist owner, version_id)`, and a `RUN_DB_TESTS=1`-gated test asserts such
      an entry comes back with `repertoireId: null`, a non-null `versionId`, its title and artist, in
      position order, with no throw. Observed passing, not skipped.
- [ ] ER11 — `src/lib/playlistDetail.ts` and `src/lib/playlistOverlay.ts` are keyed by version id: a
      unit test builds the repertoire map keyed by `version_id` and asserts `summarisePlaylistMastery`,
      `collectPlaylistTags` and `cycleSongStatus` find the entry through `ps.version_id`, and that the
      same three, given a map keyed by the song id instead, report `unknown`, no tag and `null`
      respectively. `removedSongIds` is renamed `removedVersionIds` and no identifier under
      `src/lib/playlistOverlay.ts` or `src/lib/playlistDetail.ts` names a song id for a playlist entry.
- [ ] ER12 — A unit test on `src/lib/playlistNav.ts` asserts `computePlaylistNav` returns non-null for
      a current entry when the list also contains an entry with a null `repertoireId`, that `position`
      and `total` count every entry, and that `prevId`/`nextId` name the nearest entry with a non-null
      `repertoireId`.
- [ ] ER13 — The playlist page adds and removes a version rather than a song: a jsdom test asserts the
      add path calls through with a `version_id` and the remove path removes by
      `(playlist_id, version_id)`.
- [ ] ER14 — `src/lib/songPicker.ts` offers and returns a version: a jsdom test asserts selecting a
      picker result yields a `version_id`, and the already-in-playlist filter compares version ids.
- [ ] ER15 — The Spotify sync compares versions: a unit test on `src/lib/spotifyPlaylistSync.ts`
      asserts two tracks resolving to different versions of one song are both kept in playlist order,
      that re-syncing the same track adds nothing, and that the SQL `buildPlaylistSongsInsert`
      generates names `version_id` and contains no `ON CONFLICT`.
- [ ] ER16 — The playlist cards still sum a duration after the re-key: a `RUN_DB_TESTS=1`-gated test
      calls `getUserPlaylists` and `getBandPlaylists` for a playlist holding one entry and asserts
      each returns that entry with a non-null `duration_seconds` read through `song_versions` —
      neither query names `ps.song_id`. Observed passing, not skipped.
- [ ] ER17 — The offline copy of the previous entry shape is discarded, not misread:
      `OFFLINE_SCHEMA_VERSION` in `src/lib/offlineSnapshot.ts` is one above the value RH-124 leaves in
      the tree, and an `offlineSnapshot.test.ts` case asserts `readValidSnapshot` returns `null` for a
      snapshot written under the previous version while accepting one written under the new value.
- [ ] ER18 — Two takes of one song are distinguishable in the list: a jsdom test renders a playlist
      holding two versions of one song and asserts both rows appear with the version's `label` drawn
      by `src/components/playlists/PlaylistSongIdentity.tsx`, and no entry is added to the
      `complexity-budget-overrides` block for that file.
- [ ] ER19 — `AGENTS.md`'s **Playlist** glossary entry describes `playlist_songs` as an ordered
      collection of song **versions** rather than of global songs.
- [ ] ER20 — `npm run test:coverage` exits 0 with all four thresholds met, `npm run lint:dead` exits 0,
      `npm run build` exits 0, and no entry is added to the `complexity-budget-overrides` block.
- [ ] ER21 — `package.json`'s version is bumped following the `x.y.z-YYYYMMDDHHmm` rule.

## Out of Scope

- Re-addressing Fast View and the offline snapshot by version (**RH-109**). The Fast View address
  stays the repertoire row id here, which is why `repertoireId` survives on the entry as a nullable
  field.
- Removing the band-playlist dual write into the caller's own `user_songs` (**RH-126**).
- Any change to `uq_playlist_song_position`'s deferrability (**RH-103**, which lands first and is
  in this task's `blockedBy` — §2).
- `scripts/dev-seed`, which writes no `playlist_songs` row (§Files touched).
- Resolving `key`, `tuning`, `lyrics` or `map` inside `getPlaylistWithSongs`: the repertoire map the
  page already loads is the single resolved source (§4).
- `song_links`, `catalog_suggestions`, the expanded version-aware search card.

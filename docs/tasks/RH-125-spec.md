# RH-124 — Split `repertoire` into `user_songs` and `band_songs` keyed by `version_id`

Part 4 of 6 from the RH-105 split, and the one the other five point at. Spec file is
`docs/tasks/RH-125-spec.md` (board id + 1; verified against `docs/tasks/RH-124-spec.md`,
whose first line is `# RH-123 — Replace repertoire_tabs with song_files …`).

`blockedBy: ["RH-122", "RH-123", "RH-96"]`. All three have landed when this task runs and
this spec is written against the tree they leave behind:

- **RH-122** (`docs/tasks/RH-123-spec.md`) added `albums` and `song_versions`, added
  `songs.lyrics` / `songs.map`, and backfilled **one album and one version per catalog
  row** through an idempotent plpgsql function it keeps. `songs` still carries
  `album`, `standard_key`, `cover_url` and `duration_seconds`, and every screen still
  reads them — moving reads onto the version was out of its scope and is out of this one.
- **RH-123** (`docs/tasks/RH-124-spec.md`) replaced `repertoire_tabs` with
  `song_files (user_id, song_id, …)`, so **no table references `repertoire` any more**,
  and `assertRepertoireAccess` has exactly one caller left (`updateSongLinksAction`).
- **RH-96** (`docs/tasks/RH-97-spec.md`) dropped `sync_band_repertoire_on_member_update`
  and its trigger, exported `assertBandAdmin`, and gated two of the write actions on it.

Every symbol, index and function name those three leave behind must be **read from the
tree at implementation time**, never copied out of a spec.

Sources: `docs/plans/repertoire-rework.md` (`## The model`, `### Inheritance`, `### Rules`),
`docs/use-cases.md` (*Resolving a value*, *Writing a band's rows*, *What creates a personal
row in band context*, *Add a song to the repertoire*, *Remove a song from the repertoire*,
*Edit or clear an override*, *Set a song's status*).

## Scope

One table becomes two, keyed by a version instead of a song, and the walk-up that every
screen runs before it can show a song becomes one function.

Covered:

- the migration that creates `user_songs` and `band_songs`, carries every `repertoire` row
  into the right one against a version, archives anything it cannot carry, and drops
  `repertoire`;
- one pure resolution helper implementing both cascade depths, and the rule that no SQL
  under `src/` implements either;
- every owner-scoped read and write repointed: the owner-row data access that lives in
  `src/lib/songs.ts` today, the playlist-side owner-row ensure in `src/lib/playlists.ts`
  and `src/lib/spotifyPlaylistSync.ts`, the dashboard, the Fast View entry point, the
  offline snapshot, and the two scripts that touch the table;
- **band admin on every band write** — adding, removing, status, key, tuning, lyrics, map,
  tags — finishing what RH-96 started on two actions, **including `createAndAddSongAction`,
  which creates the catalog row and the owner's hold on it in one call**, and **the three
  paths that create a band repertoire row sideways**: adding a song to a band playlist,
  importing a Spotify playlist as a band's, and syncing one.

**This changes who may add a song to a band playlist.** Today `addSongToPlaylist` gates on
playlist access only (membership), and its band branch inserts a band repertoire row; after
this task that branch requires band admin, and a non-admin member adding to a band playlist
is refused with `Access denied: band admin required`. The same tightening reaches the
Spotify import and sync routes, whose band branch writes band rows through
`ensureInRepertoire` today under a membership check. Read it as a real behaviour change,
not a refactor. Three reasons it belongs here rather than in a later task:

- this is the task that creates `band_songs`, so it is the task that defines who may write
  to it; leaving a non-admin path open and hoping a later task closes it is how the rule
  gets quietly lost;
- `docs/use-cases.md`, *Writing a band's rows*, is unqualified — "Every write to a band's
  repertoire requires band admin. Adding, removing, status, key, tuning, lyrics, map, tags
  — all of them." Adding through a playlist is adding;
- RH-103 (*Make reordering a playlist possible*, approved) already makes reordering a band
  playlist admin-only on the same reasoning, with the same message and the same call-site
  shape. A band playlist a member may add to but not reorder would be incoherent.

Deliberately **not** covered, each with its destination named in **Out of Scope**:
`playlist_songs.version_id` (RH-125), enforcing one-write-one-owner (RH-126), the
TypeScript/route vocabulary rename, any new UI field, version-aware addressing and the
version picker.

### Two scope decisions that will look like omissions

**The TypeScript vocabulary keeps the word `Repertoire`.** The `Repertoire` interface, the
`repertoireId` parameters, the `/songs/[id]/fast-view` route param and the function names
(`getRepertoire`, `addSongToRepertoire`, `getSongEntry`) stay. Only what the SQL names
changes, plus the columns the schema forces (`personal_key` → `key`, new `version_id`,
`tuning`, `map`). Three reasons: "repertoire" is still the right *domain* word — the use
cases say *Remove a song from the repertoire* about the new model too; this repository
ships vocabulary renames as their own PR (RH-121 exists for exactly that); and a rename
across the ~40 files that mention the type would double this diff without changing one
behaviour. A follow-up rename task in RH-121's shape is the home for it, and
`docs/suggestions-log.md` records it.

**No new field appears on a screen.** `tuning` and `map` are resolved, carried in the
resolved row and writable through the gated owner-row write, but nothing renders them:
the only two files that could host a key/tuning display (`RepertoireDashboard.tsx`,
`SongForm.tsx`) sit **at** their complexity-ratchet ceilings, and the ratchet may only
shrink (AGENTS.md F20). Adding a field there forces an extraction that RH-102 and RH-118
are already going to do. So resolution is proved by unit and DB tests plus the two fields
a screen already renders — `status` on the dashboard and `lyrics` on the Fast View.

**Not a selling point** (AGENTS.md Landing Page Rule): a schema restructure with no
user-visible change. No landing copy changes.

## Approach

### Behavior

#### 1. The two tables

`user_songs (id, user_id, version_id, status, key, tuning, lyrics, map, tags,
last_practiced, created_at)` and `band_songs (id, band_id, version_id, …same columns)`.

- `id` uuid PK default `gen_random_uuid()`; `user_id` → `profiles(id)` / `band_id` →
  `bands(id)`, both `NOT NULL ON DELETE CASCADE`; `version_id` `NOT NULL` →
  `song_versions(id) ON DELETE CASCADE`.
- `status song_status NOT NULL DEFAULT 'unknown'` — the existing enum, reused. A row
  exists ⇒ it has a status; *absence* of a row is what "not in my repertoire" means, and
  that is expressed by there being no row, never by a null column.
- `key text`, `tuning text`, `lyrics text`, `map jsonb` all nullable with no default:
  null is what sends resolution up the chain (*Edit or clear an override* — clearing is
  writing null, there is no separate unset).
- `tags text[] NOT NULL DEFAULT '{}'`, `last_practiced timestamptz` nullable.
- `created_at timestamptz NOT NULL DEFAULT now()`, kept deliberately though the plan's DDL
  line omits it: the dashboard orders newest-first and today does it with `ORDER BY r.id
  DESC`, which is meaningless for a uuid. The new reads order `created_at DESC, id DESC`,
  which for migrated rows (all stamped at migration time) degrades to exactly today's
  order.
- `UNIQUE (user_id, version_id)` and `UNIQUE (band_id, version_id)` — plain uniques, not
  the partial indexes today's single table needs, because both columns are `NOT NULL`
  here. These are what refuse a version already held. Plus one index on `version_id` for
  the FK.
- Two tables rather than one with a CHECK: decided in the task's justification and in
  `## The model`. The `owners` supertype is **not** to be reopened.

#### 2. The resolution helper — the heart of the task

A new module `src/lib/songResolution.ts`, with **no `@/lib/db` import** (so it is pure,
client-safe and unit-testable), exports one function that takes the three levels and
returns the resolved row:

```
resolveSongFields({ owner: OwnerOverrides | null, version: VersionLevel, song: SongLevel })
```

Its rules, each of which is a silent correctness bug if got wrong:

- **`lyrics` and `map` walk three levels**: owner row → `song_versions` → `songs`. Words
  and structure belong to the composition, and a live take overrides them.
- **`key` and `tuning` walk two**: owner row → `song_versions`, and **no** fallback to
  `songs`. They are properties of a recording. Null at both levels resolves to null even
  when `songs` carries something.
- **`status` has no fallback at all.** It is the owner's or it is `null`.
- **`tags` and `last_practiced` are owner-only too**: `[]` and `null` when there is no row.
- **A missing owner row is not an error.** It resolves exactly like a row whose overrides
  are all null. The implementation makes that structural rather than coincidental: the
  first statement substitutes an all-null override literal for a null `owner`, so both
  inputs traverse the same code.
- "First non-null wins" means `null`, not falsy. An empty string and an empty jsonb
  object are authored values and stop the walk.

**This helper is the only place either cascade is written.** The SQL selects the three
levels' raw columns — the owner row's, the version's and the song's — and the TypeScript
folds them. Consequently no query under `src/` may `COALESCE` these six columns across
levels; a second implementation in SQL is the defect this rule exists to prevent.

#### 3. One deterministic version per song, for the paths that only know a song

Both the migration and several surviving code paths hold a song id and need a version
(the manual add, the song picker, the playlist-side ensure, the playlist read whose
`playlist_songs` row is still song-keyed until RH-125). The pick is the plan's
representative-version sort, spelled **once** as a shared ordering and reused by every
caller and by the migration: `album_type = 'album'` first, then earliest
`albums.release_date`, then earliest `song_versions.created_at`, then `id` — the last two
making it total, so two runs cannot disagree. Nulls sort last. It is a sort, never a
stored column (`### Rules`).

**It reads `albums`, and the join is a `LEFT JOIN`, everywhere it appears — the migration
included.** RH-122 made `song_versions.album_id` nullable on purpose (today's catalog holds
rows with no album), `album_type` and `release_date` live on `albums`, and an inner join
would silently drop every version whose album row is missing. In the migration that is not
a cosmetic bug: the row's song would be classed `no_version` at best and lost at worst,
after `repertoire` is dropped. So the ordering reads `LEFT JOIN albums a ON a.id =
v.album_id`, a null `album_type` sorts after `'album'`, a null `release_date` sorts last,
and the two version-level tiebreakers still make the pick total for a song whose every
version has no album. The migration's conservation assertion (§Test criteria, ER2) is what
proves no version was dropped this way.

For a *read* that must find the owner's row for a song, the same ordering is applied to
the owner's **own** rows for that song through a `LEFT JOIN LATERAL … LIMIT 1`, which
preserves today's one-row-per-song behaviour and prefers a version the owner actually
holds. RH-125 deletes those laterals when `playlist_songs` carries a `version_id`.

#### 4. The migration

One new file under `migrations/`, prefix **one above the highest present in the directory
at implementation time — re-read the directory; do not trust a number quoted in any spec**
(fourteen approved specs are queued ahead of this one, and
`src/lib/__tests__/migrationsSingleSource.test.ts` requires prefixes unique and contiguous
from `0001`). Earlier migrations are never edited.

Steps, in this order:

1. Create `user_songs` and `band_songs` as above.
2. **Call RH-122's idempotent catalog backfill function** (name read from the tree) so
   every `songs` row is guaranteed at least one `song_versions` row, including rows
   written between the two migrations. This is how "there is a target for each" stops
   being an assumption.
3. Create `orphaned_repertoire_rows (id, row_json jsonb NOT NULL, reason text NOT NULL,
   archived_at timestamptz NOT NULL DEFAULT now())` with a `COMMENT ON TABLE` saying what
   it is and that nothing reads it: the alternative to archiving is a row vanishing with
   a musician's status, tags and practice date in it, and `repertoire` is dropped three
   steps later, so there is no second chance. Same reasoning as RH-123's `abandoned_blobs`.
4. Archive, as whole-row jsonb with a reason, every `repertoire` row that cannot be
   carried: `two_owners` / `no_owner` (both or neither of `user_id`/`band_id` — the CHECK
   forbids it, so this is defensive, and defensive is the point: if the constraint was
   ever dropped by hand the row is recorded instead of lost) and `no_version` (its song
   still has no version after step 2 — unreachable while step 2 runs, kept as the same
   kind of guard).
5. Insert into `user_songs` every row with `user_id IS NOT NULL AND band_id IS NULL`, and
   into `band_songs` every row with `band_id IS NOT NULL AND user_id IS NULL`, each
   against the representative version of `repertoire.song_id`. Carry `status`, `tags`,
   `last_practiced`, `lyrics` verbatim and `personal_key` into `key`; `tuning` and `map`
   are null, having never existed. `uq_repertoire_user_song` / `uq_repertoire_band_song`
   guarantee at most one source row per `(owner, song)`, and one version per song is
   chosen, so neither new unique can be violated by the backfill.
6. `DROP TABLE repertoire` — which takes any trigger still defined on it with it. The
   migration names neither `sync_band_repertoire_on_member_update` nor its trigger: RH-96
   already dropped both, and re-naming them here would reintroduce the identifiers.

The migration is **not** idempotent and is not required to be: it drops its own source,
and the `_migrations` ledger is what stops a second run.

#### 5. Reads and writes repointed

- **`src/lib/ownerSongs.ts` is new** and receives the owner-row data access that lives in
  `src/lib/songs.ts` today (`getRepertoire`, `addSongToRepertoire`, `updateSongStatus`,
  `updateSongTags`, `updatePersonalKey` → `updateSongKey`, `removeSongFromRepertoire`,
  `getSongEntry`, `updateLyrics`, `getPersonalEntryForSong`, `assertRepertoireAccess`,
  `updateSong`'s owner-row half, and **`createAndAddSong`'s owner-row half**). The move is
  forced, not cosmetic: `src/lib/songs.ts`
  is pinned at `max-lines: 505`, which is its current length, and the ratchet may only
  shrink — the repointed SQL is longer than what it replaces. `songs.ts` keeps the catalog
  work and its override entry is **re-pinned to its new worst number** (its `max-lines`
  clause removed outright if the file lands at or below the global 400). No new override
  entry may be added: both new modules stay inside the plain budgets.
- Every function keeps its name and its signature shape, and **every function that throws
  today keeps the message it throws** — `Access denied: not allowed on this repertoire
  entry` (`assertRepertoireAccess`), `Repertoire entry not found or access denied` (the
  four owner-row writes `updateSongStatus`, `updateSongTags`, `updatePersonalKey` →
  `updateSongKey`, `removeSongFromRepertoire`, and *only* those: it is their `rowCount === 0`
  branch, not a read's), `Song already in your repertoire` (`createAndAddSong`),
  `Lyrics entry not found or not editable` (`updateLyrics`). The UI shows several verbatim
  and e2e specs assert them. **The two reads throw none of these**: `getSongEntry` and
  `getPersonalEntryForSong` each return `null` on no row and keep doing so (see the two
  bullets below) — no function gains or loses a throw in this task.
- **`createAndAddSong` splits along the same line as `updateSong`.** Its catalog half (the
  `global_songs` lookup by `LOWER(title)` ± album, and the insert when there is no match)
  stays in `src/lib/songs.ts`; its owner-row half moves to `src/lib/ownerSongs.ts` and
  re-keys: the "already held?" check reads the owner table by `(owner, version_id)` for the
  song's representative version instead of `SELECT id FROM repertoire … song_id = $1`, and
  the insert writes `user_songs` or `band_songs`. It keeps its name, its signature
  (`(owner: RepertoireOwner, data) => Promise<Repertoire>`) and
  `Song already in your repertoire`, including the `err.message.includes('already in')`
  passthrough its wrapper depends on.
- Each read branches on the owner (`{ userId }` or `{ bandId }`) to the matching table,
  joins `song_versions` and `songs`, projects the three levels plus the existing display
  json, and folds through `resolveSongFields`.
- **One new read is the shared core of that, and it is the read a missing owner row must
  not break**:

  ```
  getResolvedEntryForVersion(owner: { userId: string } | { bandId: string }, versionId: string): Promise<ResolvedSongEntry>
  ```

  `ResolvedSongEntry` (declared in `src/types/database.ts` beside `Repertoire`) carries
  `ownerRowId: string | null`, the version id, the resolved `status`, `key`, `tuning`,
  `lyrics`, `map`, `tags`, `last_practiced`, and the song display json. It reads the version
  and song levels unconditionally and **`LEFT JOIN`s** the owner table on
  `(owner, version_id)`, so it resolves rather than throws when the owner holds no row:
  `ownerRowId: null`, `status: null`, `tags: []`, `last_practiced: null`, and `key` /
  `tuning` / `lyrics` / `map` inherited exactly as §2 says. It never returns `null` and
  never throws for an absent owner row — only for a `versionId` that does not exist, and
  for a DB failure. **This is the function ER12 names.**

  It is not dead code: both surviving entry reads delegate to it after locating the row, so
  the three-level projection and the fold exist once. Each keeps its own contract, and
  neither is what ER12's first assertion is about:

  - `getSongEntry(owner: RepertoireOwner, repertoireId: string): Promise<Repertoire | null>`
    — the signature read from `src/lib/songs.ts:207`, not restated from memory — still
    locates the owner row **by id and owner** and still answers **`null`** when that pair
    matches no row. It throws nothing for an unknown id; the only throw is the wrapped
    `Failed to fetch song entry: …`. Keeping the `null` is not incidental: two live callers
    consume it — `src/hooks/useSongEntry.ts:63` (`if (!data) setNotFound(true)`) drives the
    not-found screen from it, and `src/hooks/useOfflinePlaylist.ts:104`
    (`if (!repertoire) continue`) skips an unavailable entry so an offline download of a
    playlist completes. Turning it into a throw would break offline download, and this task
    has no reason to make that change.
  - `getPersonalEntryForSong(songId: string, userId: string): Promise<Repertoire | null>`
    keeps that signature and still answers `null` when the user holds no version of the
    song. It is keyed by `(song_id, user_id)`, not by a version, which is why ER12's first assertion is not
    about it: `null` there means "you hold nothing of this song", a different question from
    "this version has no row of yours".
- Writes go through **one** owner-row write function whose patch covers the six override
  columns plus `status`, built with `src/lib/sqlUpdate.ts`; the per-field entry points
  delegate to it. That is what makes "every override is writable and every band write is
  gated" one fact instead of seven.
- `assertRepertoireAccess` re-keys onto the two tables as a `UNION ALL` of the user branch
  (`user_id = $2`) and the band branch (band membership, as today — reading and link
  editing are member-level), returning the row's id, `version_id`, `song_id` and owner.
  Its `RepertoireAccessRow` in `src/lib/dbRows.ts` gains `version_id`.
- `addSongToRepertoire` resolves the representative version for the song it is given and
  inserts one row, born `unknown` by the column default.
- `src/lib/playlists.ts` (`addSongToPlaylist`, and the playlist-entry read that joins the
  owner row) and `src/lib/spotifyPlaylistSync.ts` repoint onto the new tables. **One
  behaviour changes and one does not**, and the two are independent:
  - **Changed — the band branch is gated.** `addSongToPlaylist` keeps
    `assertPlaylistAccess` and, when the returned row carries a `band_id`, calls
    `assertBandAdmin` (exported by RH-96) **before** the transaction and outside the
    wrapping `try`, so its text reaches the UI verbatim (convention L1a) — the same
    call-site shape and the same `Access denied: band admin required` message RH-103 uses
    for reorder. The Spotify entry points are gated at their own guard rather than inside
    `ensureInRepertoire`, which takes a resolved owner and no caller:
    `resolveBandOwnership` (`src/lib/spotifyRouteAuth.ts`, the import route's body-`band_id`
    guard) swaps `assertBandMember` for `assertBandAdmin`, and the sync route adds the same
    admin check for a playlist that carries a `band_id`. Both keep answering 404 through
    the existing `guardResource`, so no existence leak is introduced. `assertPlaylistAccess`
    itself is **not** made role-aware — it is also the Spotify read guard, exactly the
    reason RH-103 gave for gating at the call site.
  - **Unchanged — the dual write stays.** The band-playlist path still also writes the
    caller's own `user_songs` row, and the sync path still writes every member's. That is
    wrong under *Add a song to a playlist*, and deleting it is **RH-126's whole
    deliverable**; doing it here would leave RH-126 with half a task. With the gate in
    place the caller of the band branch is now always an admin, so the second write lands
    on an admin's own row — still wrong, still RH-126's. Named here so it is a decision and
    not an oversight.

#### 6. Band admin on every band write

`src/app/actions/repertoire.ts` grows a second owner resolver beside `resolveOwner`: the
read path keeps `assertBandMember`, and a write path uses `assertBandAdmin` (exported by
RH-96). Every mutating action uses it — the **seven** of them: `addSongAction`,
`createAndAddSongAction`, `removeSongAction`, `updateSongStatusAction`,
`updateSongTagsAction`, `updateSongAction`, `updateLyricsAction`
— so adding, removing, status, key, tuning, lyrics, map and tags all require band admin,
which is *Writing a band's rows* in full. Together with the three playlist-side paths
gated in §5, **no path left under `src/` writes a `band_songs` row without an admin
check** — that is the property ER18 and ER19 assert together, and after this task it has no counterexample.

**`createAndAddSongAction` is the seventh, and it is gated for the same reason as the other
six.** Today (`src/app/actions/repertoire.ts:98`) it resolves its owner through
`resolveOwner` → `assertBandMember` and then calls `createAndAddSong`, whose owner-row half
inserts the band's hold (`src/lib/songs.ts:362,376`), so a non-admin member currently
creates a band repertoire row. Creating a song in band context **is** a band write: it
produces a `band_songs` row, and *Writing a band's rows* is unqualified. There is no reason
to carve out an exception for the one path that creates both the catalog row and the band's
hold on it — so it moves onto the write resolver with the rest, which is also what makes
ER5 and ER14 satisfiable (its two `repertoire` statements are among those §5 moves and
re-keys).

Four consequences are accepted and named: a
non-admin member can no longer edit a band row's tags inline, can no longer add
a song to a band playlist or import a Spotify playlist as the band's, can no longer create a
new song onto the band (`createAndAddSongAction` with a `bandId` now refuses), and saving
lyrics onto the
band's row in band context now fails for them with the existing Toast. The third costs no
UI today: all three client call sites pass a single argument and therefore no `bandId`
(`RepertoireDashboard.tsx:228`, `useSongPicker.ts:157` — whose `resolveTrackId` only wants
the song id — and `SongForm.tsx:256`, each typed `(data) => Promise<Repertoire>`), so the
band branch is reachable only by calling the Server Action directly, which is exactly the
caller an authz gate exists for. Their own row is
untouched by the gate, which is the point — *What creates a personal row in band context*
is unchanged and out of scope here.

#### 7. Offline

`src/lib/offlineSnapshot.ts`: `OfflineSongSnapshot.repertoireId` becomes the owner-row id,
`repertoire` / `personalRepertoire` carry the **resolved** row (offline is read-only and
cannot walk tables), the validator is updated to match, and `OFFLINE_SCHEMA_VERSION` is
raised by one above whatever RH-123 left in the tree — a snapshot of the previous shape is
read back as absent, not migrated.

### Files touched

- `migrations/<next>_split_repertoire_owner_songs.sql` — new; §4.
- `src/lib/songResolution.ts` — new; the cascade helper and its three level types.
- `src/lib/ownerSongs.ts` — new; owner-row data access repointed onto both tables.
- `src/lib/songs.ts` — owner-row functions removed; catalog work stays.
- `src/lib/dbRows.ts` — `RepertoireAccessRow` gains `version_id`.
- `src/types/database.ts` — `Repertoire` loses `personal_key`, gains `version_id`, `key`,
  `tuning`, `map`; `status` becomes `SongStatus | null` on the resolved shape; `SongMap`
  added.
- `src/lib/playlists.ts`, `src/lib/spotifyPlaylistSync.ts` — owner-row ensure and the
  playlist-entry join repointed; `addSongToPlaylist`'s band branch gated on
  `assertBandAdmin` (§5).
- `src/lib/spotifyRouteAuth.ts` — `resolveBandOwnership` gates on `assertBandAdmin`; the
  sync route's band playlists get the same check (§5).
- `src/app/actions/repertoire.ts` — imports move to `@/lib/ownerSongs`; the write-owner
  resolver and the gate (§6).
- `src/app/api/spotify/playlists/[id]/import/route.ts`, `…/sync/route.ts` — the owner-row
  ensure they call through.
- `src/components/songs/RepertoireDashboard.tsx`, `src/components/songs/SongForm.tsx`,
  `src/lib/filterSongs.ts`, `src/lib/playlistDetail.ts`, `src/lib/songEntry.ts`,
  `src/lib/playlistOverlay.ts`, `src/store/repertoireStore.ts`,
  `src/components/playlists/*` — `personal_key` → `key` on the resolved row; no new field.
- `src/lib/offlineSnapshot.ts`, `src/lib/offlineFirst.ts`, `src/lib/offlineStore.ts`,
  `src/hooks/useOfflinePlaylist.ts` — §7.
- `scripts/dev-seed`, `scripts/deduplicate-songs.mjs` — seed and repoint the new tables.
- `eslint.config.mjs` — the `src/lib/songs.ts` override re-pinned downward.
- `AGENTS.md` — the Repertoire / Band-ownership / Tags entries describe the two tables and
  the two cascade depths; `docs/suggestions-log.md` — the deferred vocabulary rename.
- `package.json` — version bump.
- Tests: new `src/lib/__tests__/songResolution.test.ts`,
  `src/lib/__tests__/ownerSongsMigration.db.test.ts`,
  `src/lib/__tests__/ownerSongs.db.test.ts`; updated
  `src/app/actions/__tests__/authzRepertoire.db.test.ts`, `repertoire.test.ts`,
  `src/lib/__tests__/songs.test.ts`, `transactionAtomicity.db.test.ts`,
  `spotifySyncAtomicity.db.test.ts`, `spotifyPlaylistRouteAuthz.db.test.ts`,
  `spotify.test.ts`, `playlists.test.ts`, `offlineSnapshot.test.ts`, `offlineFirst.test.ts`,
  `offlineStore.test.ts`, `songEntry.test.ts`, `filtering.test.ts`, `playlistDetail.test.ts`,
  `playlistOverlay.test.ts`, the hook tests that build `Repertoire` fixtures, the
  `repertoireDashboard` jsdom test, and `e2e/offline-mode.spec.ts`.

### Test criteria

**Unit (`songResolution.test.ts`), one case per rule in §2**: three-level `lyrics` and
`map` taking the first non-null at each level; two-level `key` and `tuning` resolving null
even when `songs` carries a value; `status` null when the owner row is absent and never
inherited; a null `owner` producing output identical to an all-null `owner`; an empty
string stopping the walk.

**DB (`ownerSongs.db.test.ts`, `RUN_DB_TESTS=1`)**: both uniques refuse a second hold of
the same `(owner, version_id)`; a user's and a band's holds on one version are independent
in both directions (setting one's `key` leaves the other's resolution unchanged); the
representative-version ordering is deterministic for a song with two versions on two
album types; `getResolvedEntryForVersion({ userId }, versionId)` for a `(user_id,
version_id)` with **no** `user_songs` row resolves — `ownerRowId: null`, `status: null`,
`tags: []`, `last_practiced: null`, inherited `key`/`tuning`/`lyrics`/`map` — instead of
throwing or answering `null`, while the two reads keep their real contracts — `getSongEntry`
with an unknown `repertoireId` answers **`null`** (not a throw) and `getPersonalEntryForSong`
for a song the user holds nothing of answers `null`; `createAndAddSong` for an
`(owner, song)` already held still throws `Song already in your repertoire` and writes no
second row; the representative-version ordering still
returns a version whose `album_id` is null.

**Migration (`ownerSongsMigration.db.test.ts`, `RUN_DB_TESTS=1`)**, on the recipe RH-95
established and RH-123 adopted: resolve the migration file from `migrations/` by its
`_split_repertoire_owner_songs.sql` suffix (fail if there is not exactly one), and inside
one transaction that is always rolled back — rebuild the legacy shape (drop the two new
tables, recreate `repertoire` with the DDL of `0001` plus the later `lyrics` column and
both partial uniques), seed the rows below, **capture `SELECT count(*) FROM repertoire`
before executing the file**, execute it, and assert:

- the seeded user-owned and band-owned rows landed in the right table against the right
  version with `status`, `key` (from `personal_key`), `tuning`, `lyrics`, `map`, `tags` and
  `last_practiced` as expected;
- the ownership anomaly (seeded with the CHECK dropped) is in `orphaned_repertoire_rows`
  with its reason;
- **conservation**: the captured pre-count equals
  `count(user_songs) + count(band_songs) + count(orphaned_repertoire_rows)`, each counted
  for the seeded fixture. This is the only assertion that can fail for a row that silently
  disappeared, and it is checked before `repertoire` is gone — after the drop there is no
  evidence left. It is what catches the ordering written as an inner join through `albums`;
- **the album-less case lands**: one further seeded `repertoire` row whose song's only
  `song_versions` row has a null `album_id` (and a sibling case whose album carries a null
  `release_date`) arrives in `user_songs` against that version, rather than vanishing or
  being archived as `no_version`. Deliberately a case RH-122's backfill cannot produce —
  the seed creates the album-less version by hand, because a fixture where every song has
  an album is exactly the fixture an inner join passes;
- `repertoire` is absent from `information_schema.tables`.

**Actions (`authzRepertoire.db.test.ts`, `RUN_DB_TESTS=1`)**: for each of the seven mutating
actions — `createAndAddSongAction` included, asserting additionally that the refused call
leaves **no** `band_songs` row for the song it would have created — a band admin succeeds
and a non-admin member is refused with no row written;
personal writes are unaffected. The file already parametrizes `createAndAddSongAction`
(`authzRepertoire.db.test.ts:131`), so this is a change of expectation on an existing case,
not a new one.

**Playlist-side gate (`playlists.ts` DB test and `spotifyPlaylistRouteAuthz.db.test.ts`,
`RUN_DB_TESTS=1`)**: `addSongToPlaylist` on a band playlist throws `Access denied: band
admin required` for a `member` and writes neither a `band_songs` nor a `playlist_songs`
row; the same call as an `admin` succeeds and produces both the `band_songs` row and the
caller's `user_songs` row (the dual write RH-126 removes); a personal playlist's owner is
unaffected. The import route answers 404 for a `band_id` the caller is a member but not an
admin of, and the sync route refuses a band playlist for a non-admin.

**Component / snapshot**: a jsdom test renders the dashboard in personal and in band
context off the new tables with the resolved `status`; a Fast View test opens a version
whose lyrics exist only on `songs` and renders those lyrics; an `offlineSnapshot` test
asserts the captured rows carry resolved values, that no entry carries a `repertoire` row
id, and that the previous schema version is rejected.

**Suite**: `npm run test:coverage`, `npm run lint:dead` and `npm run build` exit 0;
`migrationsSingleSource`, `complexityBudget`, `transactionGuard`, `errorHandlingStyle` and
`namingConventions` stay green.

## Expected Results

- [ ] ER1 — A new migration under `migrations/`, named with the suffix
      `_split_repertoire_owner_songs.sql` and numbered one above the highest prefix present
      in the directory at implementation time, creates `user_songs (id, user_id, version_id,
      status, key, tuning, lyrics, map, tags, last_practiced, created_at)` unique on
      `(user_id, version_id)` and `band_songs (id, band_id, version_id, …same columns)`
      unique on `(band_id, version_id)`, both with `version_id NOT NULL` referencing
      `song_versions`; `npm run db:migrate` exits 0 on a fresh database and
      `src/lib/__tests__/migrationsSingleSource.test.ts` passes.
- [ ] ER2 — The same migration carries every user-owned `repertoire` row into `user_songs`
      and every band-owned row into `band_songs`, against the deterministically chosen
      version of that row's song, with `status`, `personal_key` → `key`, `lyrics`, `tags`
      and `last_practiced` preserved, and then drops `repertoire`. Asserted by a
      `*.db.test.ts` that resolves the migration file by its name suffix and executes it
      against seeded legacy-shaped rows inside a transaction it rolls back. Gated
      `describe.skipIf(!RUN_DB_TESTS)`: only a `RUN_DB_TESTS=1` run in which the test
      **passes** satisfies this — a skipped run does not.
- [ ] ER3 — The migration loses no row, asserted before `repertoire` is dropped: the same
      `RUN_DB_TESTS=1`-gated test captures `count(*)` of the seeded `repertoire` rows before
      executing the file and asserts it equals `count(user_songs) + count(band_songs) +
      count(orphaned_repertoire_rows)` afterwards; observed passing, not skipped.
- [ ] ER4 — A `repertoire` row whose song's only `song_versions` row has **no album row**
      (null `album_id`), and one whose album carries a null `release_date`, both land in
      `user_songs` against that version rather than vanishing or being archived as
      `no_version`: seeded by hand in the same `RUN_DB_TESTS=1`-gated test (observed
      passing, not skipped), and every join onto `albums` in the representative-version
      ordering — in the migration and under `src/` — is a `LEFT JOIN`.
- [ ] ER5 — `repertoire` is gone: the same `RUN_DB_TESTS=1`-gated test asserts it is absent
      from `information_schema.tables` (observed passing, not skipped), and no SQL statement
      under `src/` or `e2e/` names `repertoire` as a table (in `FROM`, `JOIN`, `INSERT INTO`,
      `UPDATE` or `DELETE FROM`) outside the migration test file, which rebuilds the legacy
      shape. `migrations/` is excluded by construction. Neither
      `sync_band_repertoire_on_member_update` nor its trigger name appears under `src/` or
      `e2e/`.
- [ ] ER6 — A `repertoire` row the migration cannot carry is archived rather than lost: the
      `RUN_DB_TESTS=1`-gated test seeds a row that is neither user- nor band-owned (with the
      CHECK dropped), executes the migration, and finds the whole row as jsonb in
      `orphaned_repertoire_rows` with a reason; observed passing, not skipped.
- [ ] ER7 — Each unique refuses a duplicate hold: a `RUN_DB_TESTS=1`-gated test asserts a
      second insert of the same `(user_id, version_id)` and of the same
      `(band_id, version_id)` each raise a unique violation; observed passing, not skipped.
- [ ] ER8 — One exported helper in `src/lib/songResolution.ts` implements the walk-up and is
      the only place either cascade is written: a unit test proves `lyrics` and `map` resolve
      owner row → `song_versions` → `songs`, taking the first non-null at each level; and no
      query under `src/` coalesces `lyrics`, `map`, `key` or `tuning` across levels in SQL.
- [ ] ER9 — The same helper resolves `key` and `tuning` owner row → `song_versions` **only**:
      a unit test asserts that null at both of those levels resolves to null even when
      `songs` carries a value for the field.
- [ ] ER10 — `status` has no fallback: a unit test asserts the resolved `status` is the owner
      row's value, and `null` when there is no owner row — never inherited from the version
      or the song.
- [ ] ER11 — A missing owner row is not an error: a unit test asserts that resolving with
      `owner: null` returns exactly the same object as resolving a row whose overrides are
      all null (same `lyrics`, `map`, `key`, `tuning`, `status: null`, `tags: []`,
      `last_practiced: null`).
- [ ] ER12 — `getResolvedEntryForVersion(owner: { userId } | { bandId }, versionId):
      Promise<ResolvedSongEntry>` in `src/lib/ownerSongs.ts` is the read that proves it at
      the database: a `RUN_DB_TESTS=1`-gated test calls it with a `(user_id, version_id)`
      that has **no** `user_songs` row and asserts it returns `ownerRowId: null`,
      `status: null`, `tags: []`, `last_practiced: null` and the inherited
      `key`/`tuning`/`lyrics`/`map` — neither throwing nor answering `null`. The same test
      asserts the two reads keep the contracts they have today: `getSongEntry(owner,
      repertoireId)` returns **`null`** for an unknown `repertoireId` — it throws nothing,
      because `src/hooks/useSongEntry.ts` and `src/hooks/useOfflinePlaylist.ts` both branch
      on that `null` — and `getPersonalEntryForSong(songId, userId)` returns `null` for a
      song the user holds no version of. Observed passing, not skipped.
- [ ] ER13 — A user's and a band's holds on the same version are independent cascades: a
      `RUN_DB_TESTS=1`-gated test sets a `band_songs` `key` and asserts the same user's
      `user_songs` resolution is unchanged, and the reverse; observed passing, not skipped.
- [ ] ER14 — Every owner-scoped read and write targets `user_songs` or `band_songs`, lives
      in `src/lib/ownerSongs.ts`, and resolves through the §2 helper; `src/lib/songs.ts`
      holds no owner-row query — including the two inside `createAndAddSong`, whose
      owner-row half moves while its `global_songs` lookup and insert stay — its
      `eslint.config.mjs` override is re-pinned to the file's
      new worst number, and no new override entry is added for any file.
- [ ] ER15 — The dashboard lists a repertoire in both personal and band context off the new
      tables, asserted by a jsdom test that renders one owner row per context with its
      resolved `status` and the song's title and artist.
- [ ] ER16 — The Fast View entry point resolves its song through the helper, asserted by a
      test that opens a version whose `lyrics` exist only on `songs` and renders those
      lyrics.
- [ ] ER17 — The offline snapshot captures the owner's rows from the new tables with
      resolved values: a snapshot payload test asserts no entry carries a `repertoire` row
      id, that `OFFLINE_SCHEMA_VERSION` is one above the value RH-123 left, and that
      `readValidSnapshot` rejects a snapshot written under the previous version.
- [ ] ER18 — Every band write requires band admin — all seven mutating actions in
      `src/app/actions/repertoire.ts`: `addSongAction`, `createAndAddSongAction`,
      `removeSongAction`, `updateSongStatusAction`, `updateSongTagsAction`,
      `updateSongAction` and
      `updateLyricsAction` — asserted by a `RUN_DB_TESTS=1`-gated test covering each in both
      directions (admin succeeds; non-admin member refused with nothing written), with
      personal writes unaffected; observed passing, not skipped. For
      `createAndAddSongAction` the refused call additionally leaves no `band_songs` row for
      the song it would have created. `assertBandAdmin` from
      `src/lib/bands.ts` is the only admin check used.
- [ ] ER19 — The three playlist-side paths that create a band repertoire row sideways
      require band admin too, so ER18 has no counterexample: a `RUN_DB_TESTS=1`-gated test
      asserts `addSongToPlaylist` on a band playlist throws `Access denied: band admin
      required` for a `member` and writes neither a `band_songs` nor a `playlist_songs` row,
      and succeeds for an `admin`; a route authz test asserts the Spotify import route
      answers 404 for a `band_id` the caller is a member but not an admin of, and that the
      sync route refuses a band playlist for a non-admin. `assertPlaylistAccess` itself is
      unchanged. Observed passing, not skipped.
- [ ] ER20 — `src/lib/playlists.ts` and `src/lib/spotifyPlaylistSync.ts` read and write the
      new tables with their behaviour otherwise unchanged, including the dual write: a test
      asserts that an **admin** adding a song to a band playlist still produces both a
      `band_songs` row and the caller's `user_songs` row, and the spec records that deleting
      the second write is RH-126's deliverable.
- [ ] ER21 — `npm run test:coverage` exits 0 with all four thresholds met,
      `npm run lint:dead` exits 0, and `npm run build` exits 0.
- [ ] ER22 — `package.json`'s version is bumped following the `x.y.z-YYYYMMDDHHmm` rule, and
      `AGENTS.md`'s Repertoire, Band-ownership and Tags entries describe `user_songs` /
      `band_songs`, the `version_id` key and the two cascade depths.

## Out of Scope

- **`playlist_songs.version_id` — RH-125.** Playlist entries stay song-keyed here, which is
  why the owner-row join needs a lateral; RH-125 deletes it.
- **One write reaching exactly one owner — RH-126.** The dual writes in
  `src/lib/playlists.ts` and `src/lib/spotifyPlaylistSync.ts` are repointed and gated, not
  removed. RH-126 keeps exactly its own deliverable: deleting the **second**, personal
  write. Who may perform the **band** write is settled here, not there (§Scope, §5, §6).
- **The TypeScript/route vocabulary rename** (`Repertoire` → `OwnerSong`, `repertoireId` →
  `ownerSongId`) — its own task, in RH-121's shape; logged in `docs/suggestions-log.md`.
- **Any new UI field**, including a tuning or map display or editor — RH-102 (status
  control), RH-112 (add flow), RH-118 (map editor).
- **Version-aware addressing and navigation** — RH-109.
- **Reads moving from `songs.album` / `standard_key` / `duration_seconds` onto the version**
  — not in RH-122's scope and not in this one.
- **The `owners` supertype** — rejected in the plan; not to be reopened.
- **Deleting a song's files when its last version leaves the repertoire**, and the
  confirmation that lists overrides, playlists and files — RH-123's named follow-up.

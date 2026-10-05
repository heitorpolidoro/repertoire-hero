# RH-122 — Add albums and song_versions, and split the title instead of stripping it

Part 2 of 6 from the RH-105 split. Spec file is `docs/tasks/RH-123-spec.md` (board id + 1).

`blockedBy: ["RH-121", "RH-95"]`. Both predecessors have landed when this task runs, and
this spec is written against the tree they leave behind:

- **RH-121** renamed `global_songs` to `songs`, dropped `contributor_id` and renamed the
  TypeScript vocabulary (`Song`, `searchSongs`, `findOrCreateSong`,
  `src/lib/songEditPayload.ts`). Every name used below is the post-RH-121 name.
- **RH-95** (`docs/tasks/RH-96-spec.md`) already unified catalog identity: there is one
  identity resolver, `src/lib/songIdentity.ts`, matching on
  `(lower(trim(primary artist)), lower(trim(sanitized title)))` with album **not** in the
  key; both write paths call it, `createAndAddSong`'s old `LOWER(title)`-plus-album lookup
  is gone, `createAndAddSong` is already one `withTransaction`, the album-bearing unique
  index is already dropped, a unique index on `(lower(btrim(artist)), lower(btrim(title)))`
  already exists, and a shared primary-artist helper (`artists[0]`) is already used by both
  `src/lib/spotifyPlaylistSync.ts` and `src/app/api/spotify/search/route.ts`.

This task therefore **does not re-specify** either the identity unification or the
primary-artist extraction — it depends on them. Index and symbol names RH-95 and RH-121
leave behind must be **read from the tree** at implementation time, not copied from either
spec: RH-121 may have renamed `uq_global_songs_artist_title` along with the table.

## Scope

The two new catalog relations, the new song identity key, and the one parse that feeds
both:

- add `albums` and `song_versions` with the two load-bearing uniques from
  `docs/plans/repertoire-rework.md` `### Rules`;
- rewrite every `songs.title` to the left half of the split, which creates collisions under
  the artist+title unique RH-95 already installed, and collapse them;
- **the seam this task owns:** RH-95's resolver matches on the *sanitized* title and this
  task deletes the sanitizer. Afterwards the resolver matches on
  `(lower(trim(primary artist)), lower(trim(split title)))` — the splitter's **left half**,
  nothing stripped — and additionally returns the right half as the version `label`. The
  identity pair, the album-less key and the primary-artist rule are unchanged; only the
  title normaliser inside it changes;
- add `songs.lyrics` and `songs.map`, the top of the two cascades in
  `docs/use-cases.md` *Resolving a value*;
- backfill one album and one version per pre-existing catalog row;
- replace `sanitizeSongTitle` with a `" - "` **split**, and route its two halves to the
  two keys on every catalog write path.

**Data only. No screen changes.** The label becomes a column and is written from the
split, but no form gains a label input and no list renders it: every screen still reads
`songs` exactly as it does today, so there is nothing version-addressed to show it in
yet. The label-as-its-own-field UI (a subtitle in a version row, its own input in manual
entry) belongs to the later part that makes screens version-aware, and shipping an input
for a column nothing reads would be UI with no reader. What this task does guarantee is
the half of that rule that cannot wait: a typed-in or imported title carrying a suffix
is split on write, so **no new row persists a suffix inside a title**.

**Not covered:** the `repertoire` split into `user_songs` / `band_songs` (part 4 —
`repertoire` keeps its name, its columns and its FK to `songs` here), reads moving from
`songs.album`/`standard_key`/`duration_seconds` to the version, `song_links`,
`song_files`, `catalog_suggestions`, the band-status trigger, the `owners` supertype, the
grouped search card, and the one-off UI for versions.

## Approach

### Behavior

#### 1. The migration

One new file under `migrations/`, prefix **one above the highest present in the directory
at implementation time — re-read the directory, do not trust a number quoted in any
spec**. Several approved specs ahead of this one claim the same next number;
`src/lib/__tests__/migrationsSingleSource.test.ts` requires the prefixes to be unique and
contiguous from `0001`, so whoever lands second renumbers. `migrations/0001_initial_schema.sql`
is not edited — migrations are an append-only ledger.

The migration performs the steps below **in exactly this order**, and the order is
load-bearing: the artist+title unique index RH-95 installed is live when this migration
starts, so rewriting two rows down to the same title for the same artist aborts the
`UPDATE`. The index is therefore dropped *before* the rewrite (step 4) and recreated
*after* the collapse (step 6). No other sequence works, and no step may be reordered.

1. `songs` gains `lyrics text` and `map jsonb`, both nullable with no default: null is
   what makes the cascade walk up.
2. `albums` is created with `id`, `artist`, `name`, `album_type`, `cover_url`,
   `release_date`, plus a `created_at`. `artist` and `name` are `NOT NULL`;
   `album_type` is text, not null, default `'album'`, constrained to the three values
   Spotify reports (`album`, `single`, `compilation`) so the representative-version sort
   in the plan has a closed domain to order on. The identity is a **unique index on
   `(lower(artist), lower(name))`** — the artist is in the key because keying on the name
   alone merges Queen's *Greatest Hits* with Michael Jackson's into one row with one
   cover and one date, and the catalog has no delete path to undo it.
3. `song_versions` is created with `id`, `song_id` (not null, FK to `songs`, `ON DELETE
   CASCADE`), `album_id` (FK to `albums`, `ON DELETE SET NULL`), `label`,
   `duration_seconds`, `key`, `tuning`, `lyrics`, `map jsonb`, plus a `created_at`.
   `album_id` is **nullable**: today's catalog holds rows with no album at all, and a
   version of an unknown release is still a version. Its identity is
   `UNIQUE NULLS NOT DISTINCT (song_id, album_id, label)` — declared that way, not as a
   plain unique, because a null label is the common case and Postgres otherwise treats
   nulls as distinct, so two unlabelled versions of one album would both insert. The
   same clause is what makes two album-less, label-less versions of one song collapse.
   Add the two FK-supporting indexes (`song_id`, `album_id`).
4. **Drop the artist+title unique index on `songs`** that RH-95 created (name resolved
   from the tree, not hardcoded — RH-121 may have renamed it). Dropping it first is what
   lets step 5's title rewrite run at all.
5. **Backfill and collapse**, implemented as one `plpgsql` function the migration creates
   and then calls (see *Why a function* below). It must:
   - insert one `albums` row per distinct `(lower(artist), lower(album))` present in
     `songs` where `album` is a non-empty string, taking the artist and album text and
     the `cover_url` from one chosen source row, `album_type` defaulted and
     `release_date` left null (the catalog has never stored one). The key uses
     `songs.artist` **exactly as stored** — the migration does not re-derive a primary
     artist from it. RH-95 extracts `artists[0]` at both ingestion points, so new rows are
     already primary-artist-shaped, but legacy rows written before it may still hold a
     joined string such as `'Michael Jackson, Akon'`, and such a row backfills to its own
     `albums` row under that exact artist text. Splitting stored artist strings on `", "`
     in SQL is rejected: it would also cut artist names that legitimately contain a comma,
     and `albums` has no delete path to undo the resulting wrong merge. One extra `albums`
     row is the cheap error, consistent with the rest of this plan;
   - insert one `song_versions` row per `songs` row that has none, with `album_id`
     resolved through that same case-insensitive pair, `label` set to the right half of
     the title split (null when there is none), `duration_seconds` from
     `songs.duration_seconds`, `key` from `songs.standard_key`, and `tuning`, `lyrics`
     and `map` null;
   - rewrite `songs.title` to the left half of the split;
   - then collapse the rows the new key forbids: group `songs` by
     `(lower(artist), lower(title))`, keep the earliest `created_at` (id as tiebreak) as
     the survivor, re-point `song_versions.song_id`, `repertoire.song_id`,
     `playlist_songs.song_id` and `global_song_edits.song_id` at it, and delete the
     losers. Re-pointing can violate three existing uniques
     (`uq_repertoire_user_song`, `uq_repertoire_band_song`, `uq_playlist_song`) and the
     new version unique.

   **The collision rule, decided.** "Collide" means a duplicate key — duplicate
   `(user_id, song_id)`, `(band_id, song_id)`, `(playlist_id, song_id)` or
   `(song_id, album_id, label)` — never equal content. In every such case the **survivor's
   row is kept untouched and the loser's row is deleted**, with one exception: before a
   `repertoire` row is deleted, its `repertoire_tabs` rows are repointed at the surviving
   `repertoire` row (the FK is `ON DELETE CASCADE`, so without the repoint an uploaded PDF
   chart silently disappears, which is a file, not re-enterable data).

   **This is a stated loss, not a guarantee.** The deleted `repertoire` row's `status`,
   `tags`, `personal_key`, `lyrics` and `last_practiced` are **discarded**. Nothing is
   merged — not per-column coalesce, not max-status, not tag union. The justification is
   the plan's: `docs/plans/repertoire-rework.md` states migration cost is explicitly not a
   constraint and re-registering data is acceptable, and a per-column merge rule would have
   to invent an answer for `status` (whose "higher" is not obviously right) and
   `personal_key` (where two values are simply a conflict). An owner who had the same song
   twice under two albums keeps one of the two rows' practice state and re-enters the
   other. Scalar `songs` fields and `links` are likewise **not** merged: the survivor keeps
   its own album, key, cover and links, and a cover or link on a loser row is lost.
6. **Recreate the unique index on `(lower(btrim(artist)), lower(btrim(title)))`** on
   `songs`, under the same name it had before step 4. The collapse in step 5 is what makes
   it creatable again. The migration ends with `songs` carrying exactly the key RH-95
   installed — this task does not change the key, it changes what the titles under it look
   like.

**Why a function.** The backfill and the collapse are the only parts of this task that
cannot be observed on the fresh, empty database CI migrates, so a straight sequence of
statements inside the migration would ship untested. Creating them as one idempotent
function (`migrate_catalog_to_versions()` or similar) that the migration calls lets a
`*.db.test.ts` insert legacy-shaped rows and call it again, asserting one album and one
version per row and that a second call changes nothing. The function is **kept** after
the migration, with a comment in the migration saying it is retained because that test
calls it — not left behind by accident. To exercise the collapse the test opens a
transaction, drops the artist+title unique index, inserts rows whose raw titles differ only
by their `" - "` suffix (so the rewrite collapses them) together with `repertoire`,
`repertoire_tabs` and `playlist_songs` rows on both of them, calls the function, asserts the
collapse, the re-pointed FKs, the repointed tabs, and that the loser `repertoire` row is
gone with its `status` and `tags`, and rolls back; Postgres DDL is transactional, so nothing
leaks into the next test.

#### 2. The split replaces the sanitizer

`src/lib/songSanitizer.ts` is **deleted**, with all three of its exports. Its only
remaining caller after RH-95 is the identity resolver `src/lib/songIdentity.ts`, so
deleting it means **editing the resolver**: it keeps its identity pair, its album-less key
and its primary-artist helper, and swaps `sanitizeSongTitle` for the splitter. Afterwards
the resolver matches a `songs` row on `(lower(trim(primary artist)), lower(trim(left half
of the split title)))` — the split title, never a stripped one — and returns the right half
to its caller alongside the resolved row, so the caller can upsert the version `label` from
the same single parse. The resolver stays the only place under `src/` that resolves or
inserts a `songs` identity row (RH-95's ER4), and no second lookup rule is reintroduced
anywhere.

- `sanitizeSongTitle` — replaced by the split. It is not tuned: it preserves *live*,
  *acoustic*, *unplugged* and *demo*, which under the grouped card gives the live take
  its own card, the exact split the card exists to prevent.
- `isSpecialSongVersion` — the same vocabulary of special words, read by nothing outside
  its own test.
- `sanitizeAlbumName` — **deleted too, and this is a decision, not a consequence.** It
  existed to make album names collide so duplicates would merge; `albums` now has a real
  identity key, and stripping `(30th Anniversary Super Deluxe Edition)` off a name would
  merge a genuinely separate release — different cover, different date — into the
  standard album, with no delete path. The same wrong-merge argument that puts `artist`
  in the album key takes the stripper out. Album names are stored as the source reports
  them.

The replacement is one new module, `src/lib/songTitle.ts`, exporting one function that
takes a raw title and returns `{ title, label }`:

- split at the **first** `" - "`; everything after it, trimmed, is the `label`, including
  any further `" - "` (one parse, one label);
- no `" - "` → the whole trimmed string as `title`, `label` null;
- an empty right half (`"Song - "`) → the whole trimmed string minus the dangling
  separator as `title`, `label` null;
- an empty left half (`" - Live"`) → the whole trimmed string as `title`, `label` null.
  A title is never returned empty.

No special-word vocabulary, no parenthesised forms: `"Sweet Child O' Mine (2022
Remastered)"` keeps its parentheses in the title. A title genuinely containing `" - "` is
parsed wrongly and produces an extra card, which is the design's chosen error — a wrong
merge cannot be undone, an extra card costs a click.

The migration's SQL split must produce the same four outcomes as the TypeScript one; the
spec requires them to agree on the pinned examples, verified by the DB test over fixture
rows.

#### 3. Both keys, from one parse, on every write path

Every path that writes a catalog row parses the incoming title **once**, through the
resolver, and uses both halves: the left half (with the primary artist RH-95's shared
helper already produced) is the `songs` identity, the right half is the version `label`.
Because RH-95 collapsed the two divergent lookups into one resolver, there is **one** place
where the catalog row is resolved, and this task adds the album and version upserts around
it rather than at each call site. Primary-artist extraction and the identity pair itself are
RH-95's and are not re-specified or re-implemented here.

After the `songs` row is resolved, the album is upserted by `(lower(artist), lower(name))`
and the version by `(song_id, album_id, label)` — `ON CONFLICT DO NOTHING` plus a
read-back, never a caught `23505` (see *Transactions* in `AGENTS.md`). These writes are
atomic with the catalog resolution: `createAndAddSong` is already one `withTransaction`
after RH-95, and the Spotify path's existing transaction scope carries the new upserts, so
no new transaction wrapper is introduced and `transactionGuard.test.ts` stays green. The
call sites:

- `findOrCreateSong` in `src/lib/spotifyPlaylistSync.ts` — delegates identity to the
  resolver already; it stops calling `sanitizeAlbumName`, stores the raw album name, and
  upserts album and version from the resolver's two halves.
- `createAndAddSong` in `src/lib/songs.ts` — the manual-entry path, already transactional
  and already resolver-backed. It gains no lookup SQL of its own; a user typing a title that
  exists under a different album resolves to the existing row through the resolver, exactly
  as RH-95 made it, so no correct input can reach the unique index as a `23505`.
- `src/lib/songEditPayload.ts`'s title parser — it currently sanitizes; it now splits and
  keeps the **left half**. The suffix is dropped on this path: the moderation queue has
  no version context, and routing a correction to a version's label is part 6's job when
  `global_song_edits` becomes `catalog_suggestions`. Its album parser stops sanitizing
  and only trims (null for empty).

`songs` keeps `album`, `standard_key`, `cover_url` and `duration_seconds`, and they keep
being written, because every read still projects them. The duplication between those
columns and the version's is deliberate and temporary; it ends when reads move onto
versions in a later part. No read path, no projection and no `SONG_JSON` changes in this
task, and `OFFLINE_SCHEMA_VERSION` is **not** bumped: no snapshot field changes, and
bumping would invalidate every downloaded playlist for nothing.

No new domain types are added to `src/types/database.ts`. `Album` and `SongVersion`
arrive with the first code that reads them; declared now they would be exports nobody
imports, which `knip` fails on.

#### 4. `scripts/deduplicate-songs.mjs` is deleted

It is not dormant — `package.json`'s `build` script runs it on **every build**. It groups
the catalog by its own inlined copy of `sanitizeSongTitle`, rewrites titles with the old
stripping rule, and deletes the rows it considers duplicates. After this task that is
actively destructive: it would re-strip titles the split just normalised, and deleting a
`songs` row now cascades to its `song_versions`. Its merging job is done once by the
migration, and the new unique index makes the duplicates it hunted unreachable
afterwards, so there is nothing left for it to find. Its one other behaviour — upgrading
generic link labels through `fetchUrlTitle` — is redundant: `fetchUrlTitle` already runs
when a link is added. The script goes, and the `node scripts/deduplicate-songs.mjs`
segment comes out of the `build` script.

### Files touched

- `migrations/NNNN_add_albums_and_song_versions.sql` — new: the two tables and their
  uniques, `songs.lyrics`/`songs.map`, the drop and recreate of RH-95's artist+title unique
  around the backfill-and-collapse function and its call.
- `src/lib/songIdentity.ts` — RH-95's resolver: `sanitizeSongTitle` swapped for the
  splitter, and the label (right half) returned alongside the resolved row. Its identity
  pair, album-less key and primary-artist helper are unchanged.
- `src/lib/songTitle.ts` — new: the `" - "` splitter.
- `src/lib/songSanitizer.ts` — deleted.
- `src/lib/__tests__/songSanitizer.test.ts` — deleted, replaced by
  `src/lib/__tests__/songTitle.test.ts` covering the four split cases and the pinned
  examples.
- `src/lib/spotifyPlaylistSync.ts` — `findOrCreateSong` stops calling `sanitizeAlbumName`,
  stores the raw album name, and upserts album and version from the resolver's two halves.
  Primary-artist extraction here is RH-95's and is not touched.
- `src/lib/songs.ts` — `createAndAddSong` upserts album and version inside the
  `withTransaction` RH-95 already gave it; no lookup SQL is added back.
  The file carries a `max-lines` entry in the `complexity-budget-overrides` block: it may
  not grow past its pinned ceiling, so the album/version upsert goes into its own
  `src/lib/` module (shared with the Spotify path, which also removes the duplication
  `jscpd` would flag) rather than inline.
- `src/lib/songEditPayload.ts` — title parser splits and keeps the left half; album
  parser trims only.
- `src/lib/__tests__/spotifyPlaylistSync.test.ts`,
  `src/lib/__tests__/songEditPayload.test.ts` — updated for the new parse, with no
  assertion weakened and nothing skipped.
- `src/lib/__tests__/<new>.db.test.ts` — new: the schema, uniques, backfill, collapse and
  untouched-`repertoire` assertions.
- `scripts/deduplicate-songs.mjs` — deleted; `package.json`'s `build` script loses it.
- `scripts/seed-catalog.sql`, `scripts/dev-seed` — only if they insert a title carrying a
  `" - "` suffix or an album name the old stripper used to clean; seeded data must be
  consistent with the new keys.
- `AGENTS.md` — three corrections, not one: the *Song & Album Sanitization* domain concept
  is replaced by the title/label split; the two new relations (`Album`, `Song Version`) are
  added to *Domain Concepts*; and the **`Global Song` concept's stated identity** (today
  `AGENTS.md:217`, “looked up by title+album” — already wrong if RH-95 did not correct it,
  and contradicting this task's titles either way) is rewritten to the actual rule: looked
  up by primary artist plus split title, album not in the key, album and release carried by
  `albums`/`song_versions`. The `scripts/` description and the `build`-script mention of the
  deduplication script are corrected too.
- `package.json` — version bump.

### Test criteria

One `*.db.test.ts` (it needs a live Postgres and must skip visibly without
`RUN_DB_TESTS`) proving, against the migrated database: the two tables and their columns
exist; the album key admits two same-named albums by different artists and refuses a
case-variant of one pair; the version unique refuses a second `(song_id, album_id, null)`
row; the artist+title unique on `songs` is present after the migration's drop/recreate
round-trip and no album-bearing unique index on `songs` exists; `songs` has `lyrics` and
`map`; `repertoire` still has `song_id` referencing `songs`, no `version_id`, and the same
column set it had before. Plus, through the retained function: one album and one version
per legacy-shaped row, one `albums` row under the stored (possibly joined) artist text,
idempotence on a second call, and the collapse with its FK re-pointing, its repointed
`repertoire_tabs` and its deleted loser rows inside a rolled-back transaction.

**The write-path counting assertions are DB-backed, not mocked.** Counting “exactly one
`albums` row” against the mocked-`pg` suite asserts only what the mock was told to return,
so the duplicate-import and two-artists-one-album-name counts run in a
`*.db.test.ts` against real Postgres, calling `createAndAddSong` and the Spotify
`findOrCreateSong` and then issuing real `SELECT count(*)` statements. The mocked-`pg`
tests keep only what they can actually prove: which halves of the parse are passed where,
and that no `23505` is caught.

Unit tests pin the splitter's four cases and the pinned examples, and the two updated lib
tests prove the write paths pass the left half to the catalog and the right half to the
version label.

`npm run db:migrate` on a fresh database exits 0; `npm run test:coverage` exits 0 with all
four thresholds met; `npm run lint:dead`, `npm run lint:dup` and `npm run build` exit 0.

**Not a selling point.** A schema restructure is not something a musician chooses the app
for, so the landing page is not touched (the grouped search card, when it ships, may be).

## Expected Results

- [ ] ER1 — A single new migration under `migrations/`, numbered one above the highest
      prefix present in the directory at implementation time with no gap (re-checked
      against the directory, never a number copied from a spec), creates `albums`
      (`id`, `artist`, `name`, `album_type`, `cover_url`, `release_date`) and
      `song_versions` (`id`, `song_id`, `album_id`, `label`, `duration_seconds`, `key`,
      `tuning`, `lyrics`, `map`); `migrations/0001_initial_schema.sql` is unchanged,
      `src/lib/__tests__/migrationsSingleSource.test.ts` passes, and `npm run db:migrate`
      exits 0 against a fresh database.
- [ ] ER2 — `albums` carries an `artist` column and a unique index on
      `(lower(artist), lower(name))`: a `*.db.test.ts` inserts `('Queen','Greatest Hits')`
      and `('Michael Jackson','Greatest Hits')` and both rows persist, while a second
      `('queen','greatest hits')` is refused with a unique violation.
- [ ] ER3 — `song_versions`' unique on `(song_id, album_id, label)` is declared
      `NULLS NOT DISTINCT`: a `*.db.test.ts` inserts two rows with the same
      `(song_id, album_id)` and a null `label` and the second is refused with a unique
      violation; `album_id` is nullable and a row with a null `album_id` inserts.
- [ ] ER4 — After this migration, `songs` still carries RH-95's unique index on
      `(lower(btrim(artist)), lower(btrim(title)))`, under the same name, and no unique
      index on `songs` mentions `album`: a `*.db.test.ts` reads `pg_indexes` to assert both,
      and inserting two rows differing only by `album` yields one insert plus one unique
      violation. This task does not change the key — it drops and recreates it around the
      title rewrite.
- [ ] ER5 — `songs` has `lyrics` and `map` columns, both nullable, asserted present in
      `information_schema.columns` by a `*.db.test.ts`.
- [ ] ER6 — `sanitizeSongTitle`, `sanitizeAlbumName` and `isSpecialSongVersion` appear
      nowhere under `src/`, `e2e/` or `scripts/`; `src/lib/songSanitizer.ts` and its test
      no longer exist; no alias, re-export or wrapper is left behind.
- [ ] ER7 — A title splitter in `src/lib/songTitle.ts` returns both halves, pinned by
      unit tests: `'Still Of The Night - 2018 Remaster'` yields title
      `'Still Of The Night'` and label `'2018 Remaster'`; `'Smooth Criminal - Live at
      Wembley'` yields title `'Smooth Criminal'` and label `'Live at Wembley'`; a title
      with no `' - '` yields the whole string and a null label; `'Song - '` and
      `' - Live'` each yield a non-empty title and a null label.
- [ ] ER8 — RH-95's resolver `src/lib/songIdentity.ts` now normalises titles through
      `src/lib/songTitle.ts` and imports nothing from the deleted sanitizer, and it remains
      the only place under `src/` that resolves or inserts a `songs` identity row — no
      title-or-artist lookup or insert of `songs` is added back to `src/lib/songs.ts` or
      `src/lib/spotifyPlaylistSync.ts`. A `*.db.test.ts` proves manual entry of
      `'Song X - 2011 Remaster'` by an artist who already has a `'Song X'` row resolves to
      that existing row, creates no second `songs` row and raises no `23505`, and records
      the version label `'2011 Remaster'`.
- [ ] ER9 — All three write paths (`findOrCreateSong` in `src/lib/spotifyPlaylistSync.ts`,
      `createAndAddSong` in `src/lib/songs.ts`, the title parser in
      `src/lib/songEditPayload.ts`) feed the `songs` title from the left half of one parse,
      and the two catalog-writing paths write `song_versions.label` from its right half:
      tests assert both halves and that no path persists a `songs.title` still containing
      `' - '`.
- [ ] ER10 — The album and version upserts are counted against **real Postgres**, in a
      `*.db.test.ts` using `SELECT count(*)` (not the mocked-`pg` suite): importing the same
      Spotify track twice leaves exactly one `albums` row, one `songs` row and one
      `song_versions` row, and two tracks from same-named albums by different artists leave
      two `albums` rows. The writes are atomic with the catalog resolution and no new
      `catch` inspects `23505`; `transactionGuard.test.ts` and `errorHandlingStyle.test.ts`
      stay green.
- [ ] ER11 — The migration drops RH-95's artist+title unique index **before** the title
      rewrite and recreates it **after** the collapse: the migration text has the `DROP
      INDEX` ahead of the backfill-function call and the `CREATE UNIQUE INDEX` after it, and
      a `*.db.test.ts` that seeds two rows for one artist whose titles differ only by a
      `' - '` suffix and then executes the migration file (resolved from `migrations/` by
      its name suffix, not a hardcoded prefix) completes with no error and one surviving
      `songs` row — the reverse order would abort on the `UPDATE`.
- [ ] ER12 — The migration backfills exactly one `albums` row per distinct
      case-insensitive `(artist, album)` pair as stored — a seeded row whose artist is
      `'Michael Jackson, Akon'` produces one `albums` row carrying that exact artist text,
      with no comma-splitting — and exactly one `song_versions` row per pre-existing catalog
      row, with `label` from the title's right half. A `*.db.test.ts` calls the retained
      backfill function on legacy-shaped rows it inserts and asserts those counts, plus that
      a second call changes nothing.
- [ ] ER13 — The collapse re-points `song_versions`, `repertoire`, `playlist_songs` and
      `global_song_edits` at the survivor, and where a re-point would duplicate a key it
      **deletes the loser row instead of merging it**: a `*.db.test.ts` (new index dropped,
      transaction rolled back) seeds one user holding both colliding songs and asserts the
      survivor's `repertoire` row keeps its own `status`, `tags`, `personal_key` and
      `last_practiced` **unchanged** (not merged, not maxed, not unioned), the loser's
      `repertoire` row is gone, and the loser's `repertoire_tabs` rows now point at the
      surviving `repertoire` row rather than having been cascaded away.
- [ ] ER14 — `repertoire` is otherwise untouched by this task: a `*.db.test.ts` asserts it
      still carries `song_id` referencing `songs`, has no `version_id` column, and has the
      same column set as before; the migration contains no `ALTER TABLE repertoire`.
- [ ] ER15 — `scripts/deduplicate-songs.mjs` no longer exists and `package.json`'s
      `build` script no longer invokes it; `npm run build` exits 0 and `AGENTS.md` no
      longer describes it.
- [ ] ER16 — `AGENTS.md` is consistent with the shipped schema: the *Global Song* concept
      no longer says a song is “looked up by title+album” but states the real identity
      (primary artist plus split title, album not in the key, album and release carried by
      `albums`/`song_versions`); the *Song & Album Sanitization* concept is replaced by the
      title/label split; `albums` and `song_versions` appear under *Domain Concepts*. The
      string `title+album` appears nowhere in `AGENTS.md`.
- [ ] ER17 — `OFFLINE_SCHEMA_VERSION` is unchanged, the offline-snapshot tests pass,
      `npm run test:coverage` exits 0 with all four thresholds met, and `npm run lint:dead`,
      `npm run lint:dup` and `npm run build` each exit 0; no existing test is deleted or
      skipped to achieve this, other than the `songSanitizer` test whose subject is deleted.
- [ ] ER18 — `package.json`'s version is bumped following the `x.y.z-YYYYMMDDHHmm` rule,
      above the highest version already in `git log`.

## Out of Scope

- **The `repertoire` split into `user_songs` / `band_songs`** — part 4. `repertoire`
  keeps its name and its FK to `songs` here.
- **Moving reads onto the version.** `songs.album`, `standard_key`, `cover_url` and
  `duration_seconds` stay and keep being written; dropping them, and the grouped search
  card that reads versions, come with the part that makes screens version-aware.
- **Label UI.** No form input, no version row, no subtitle: the column is written but
  nothing renders it yet.
- **`song_links`, `song_files`, `catalog_suggestions`, the band-status trigger, the
  `owners` supertype** — each its own part or its own decision.
- **Backfilling `release_date` or `album_type` from Spotify.** The migration defaults
  them; enriching the catalog from the API is not this task.
- **Unifying the catalog lookup rule and extracting the primary artist** — both are
  **RH-95**'s (`docs/tasks/RH-96-spec.md`), a `blockedBy` of this task, and are deliberately
  not re-specified or re-implemented here. RH-95 delivers the single resolver in
  `src/lib/songIdentity.ts` (album out of the key, `createAndAddSong`'s title+album lookup
  deleted, that path transactional) and the shared `artists[0]` helper used by both
  `src/lib/spotifyPlaylistSync.ts` and `src/app/api/spotify/search/route.ts`. This task only
  swaps the title normaliser inside that resolver and hangs the album/version upserts off
  it.
- **Re-deriving a primary artist for rows written before RH-95.** The `albums` backfill keys
  on `songs.artist` as stored; a legacy joined string gets its own `albums` row, which is
  accepted (see §1 step 5).
- **Merging the per-owner data of collapsed `repertoire` rows.** Decided against in §1
  step 5: the loser's `status`, `tags`, `personal_key`, `lyrics` and `last_practiced` are
  discarded and re-entered by the owner.

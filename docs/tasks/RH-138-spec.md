# RH-137 — Key the Spotify push and import off `provider`, not off a label

> Spec file name is the board id + 1 (repo convention): this is RH-137's spec.
> `docs/tasks/RH-137-spec.md` is RH-136's.

## Scope

RH-136 (`fb549e1`) made each song link a `song_links` row with a
`GENERATED ALWAYS … STORED` `provider` column. It could not edit the Spotify
routes, so it shipped a **reverse mirror trigger**
(`mirror_column_on_song_links_write` → `mirror_column_from_song_links()`,
`migrations/0019_song_links.sql`) that rewrites `songs.links` after every
`song_links` write, purely so the push route — which still reads
`s.links` and matches by url host — keeps finding a track url. That is the dual
write this task removes.

This task:

1. **Re-keys the push** (`src/app/api/spotify/playlists/[id]/sync/route.ts`,
   `direction: 'push'`) off `song_links.provider = 'spotify'`. It stops
   selecting `s.links`, stops joining `songs` at all, and resolves its uris
   through one unit-tested library function.
2. **Re-keys the import** (`findOrCreateSong`, `src/lib/spotifyPlaylistSync.ts`)
   off `song_links`: the track link is appended as a row with
   `ON CONFLICT (song_id, url) DO NOTHING` instead of through
   `UPDATE songs SET links = $1`.
3. **Drops the reverse bridge trigger and its function** in a new migration,
   because (1) removes its only reader.

### The decision this spec is required to make, and makes

**`songs.links` is NOT dropped here, and the FORWARD bridge trigger
(`mirror_song_links_on_songs_write`) stays.** The column-drop follow-up did
**not** exist when this spec was written — the RH-110 split had three parts and
none of them owned the drop (RH-138 on the board is "Make a links correction act
per link row", a different deliverable). It has since been filed as **RH-143**,
"Drop `songs.links` and the forward bridge trigger", blocked by RH-137 and
RH-138. **RH-143** owns, as one deliverable:

- `ALTER TABLE songs DROP COLUMN links` and `DROP TRIGGER
  mirror_song_links_on_songs_write` / `DROP FUNCTION
  mirror_song_links_from_column()`;
- converting every SQL fixture that seeds the column
  (`src/lib/__tests__/spotify.test.ts`, `songLinksTable.db.test.ts`,
  `songLinksBridge.db.test.ts`, `songCatalogRefusal.db.test.ts`,
  `catalogTimestamp.db.test.ts`, `catalogRename.db.test.ts`,
  `songIdentity.db.test.ts`, `playlists.test.ts`,
  `src/app/actions/__tests__/authzFixtures.ts`) and
  `scripts/seed-catalog.sql` to write `song_links` rows directly;
- `searchSongs` (`src/lib/songs.ts:74`, `SELECT s.*`) and
  `CatalogSearchResult extends Song` — after a `DROP COLUMN links` the declared
  `links` field is `undefined` at runtime and `npx tsc --noEmit` cannot see it.

Why it is deferred rather than done here: dropping the forward trigger would
force rewriting the column-seeding fixtures in nine files plus the dev seed, in
the same PR as the route and import re-key. The forward trigger is what lets
`src/lib/__tests__/spotify.test.ts` keep seeding `songs.links` in SQL, and
measured, its push fixtures reach the re-keyed query unchanged through that
trigger (see Approach, probe 3). Note on the `max-lines: 678` pin that file
carries in `eslint.config.mjs`: it does **not** forbid the file ever growing —
`complexityBudget.test.ts` clause (e) only rejects a ceiling **looser** than the
file's current worst number, so a future task may raise the pin to match a
longer file, and clause (b) bounds only the entry count
(`MAX_OVERRIDES = 17`, currently 14). The narrower true statement, and the only
one this task needs, is that **within this task `spotify.test.ts` is
byte-identical**, so its 678 pin stands untouched (ER12). RH-143 may convert its
fixtures and raise the pin.

Why no dual write is left behind with no owner: after this task **no production
source writes `songs.links` at all** — measured, the only such writer today is
`src/lib/spotifyPlaylistSync.ts`, and this task removes it; `scripts/*.mjs`
holds no such writer. The forward trigger then fires for exactly one class of
writer, SQL that seeds the column by hand (`scripts/seed-catalog.sql` and test
fixtures), translating it one-way into the rows every production reader already
uses. The column also becomes read by nothing in production: measured, the only
production SQL naming `s.links` today is the push query this task rewrites (and
`src/lib/dbRows.ts:77`, that query's doc comment); `searchSongs` projects the
column through `SELECT s.*`, but no consumer reads the field — the only mentions
of `links` downstream of `CatalogSearchResult` are *writers* of a link literal
(`src/hooks/useSongPicker.ts:197`,
`src/components/songs/RepertoireDashboard.tsx:246`), and
`src/lib/songSearchMerge.ts` contains no `.links` read at all.

### Out of scope

- `ALTER TABLE songs DROP COLUMN links`, the forward trigger, the fixture/seed
  conversion, `searchSongs` and `CatalogSearchResult` — all named above as the
  follow-up's deliverable.
- `spotify.link` / `spoti.fi` short links — RH-142, not absorbed. Such a url
  stays `provider = 'other'` and contributes nothing to the push, which is the
  per-song skip that already exists.
- The Landing Page Rule (`AGENTS.md:526`) is **decided and declined**: this is
  an internal re-key with no user-visible behaviour change (the push already
  works since RH-135), so it is not a selling point and no `landing.*` copy
  changes in either dictionary.
- No Server Action is touched. Nothing is added under `src/app/actions/`, so no
  helper taking a caller-supplied `userId` is published past
  `getRequiredUserId`.

## Approach

### Behavior

**Push.** The push's query drops its `JOIN songs` and projects, per playlist
entry, the song's Spotify link urls as a json array keyed off the derived
column — in the canonical read order `position, created_at, id`. The url-level
rules RH-135 established are unchanged and still applied per url
(`spotifyTrackUriFromUrl`: web protocols only, dot-anchored host, track path
capture on the pathname), so the schema's `provider` and the host check are
defence in depth rather than one replacing the other.

**How many uris one playlist entry contributes: at most one, and it is the
first url in canonical read order that yields a track uri.** This is
`spotifyTrackUriFromLinks`'s existing first-non-null-wins rule
(`src/lib/spotifyTrackUri.ts:86-92`), preserved rather than reinvented, and it
is load-bearing in both directions:

- A row must **not** be resolved from `urls[0]` alone. A song may hold
  `https://open.spotify.com/album/abc` at position 1 and
  `https://open.spotify.com/track/xyz` at position 2 — both are
  `provider = 'spotify'`, and both orderings are reachable because the Fast
  View editor and the song picker append in whatever order the musician pastes.
  Resolving only the first url would silently drop that song from the playlist
  while answering HTTP 200, which is RH-135's defect class recurring per song.
- A row must **not** contribute one uri per url. A song with two Spotify track
  urls would otherwise be sent twice; `UNIQUE (song_id, url)` prevents only
  identical urls, not two distinct track urls for one song.

A song with no `provider = 'spotify'` row, or none of whose Spotify urls names
a track, contributes nothing and does not fail the push. Entry order and the
100-uri `PUT` + `POST` batching are unchanged.

**Why the fragment-level assertion in ER3 is the only possible proof of this
task's titular deliverable.** The conclusion is that a provider-keyed query and
a url-keyed one (`links::text LIKE '%spotify.com%'`) are **behaviourally
indistinguishable end to end**, so no runtime test can separate them and only
an assertion on the emitted SQL string can.

The reason is *not* that `provider` is derived from the url and therefore
equivalent to a substring match — it is not. The generated column is
**host-anchored** (`migrations/0019_song_links.sql:49-60`: the host is extracted
with `substring(lower(url) from '^https?://([^/?#]*)')`, userinfo and port
stripped, then tested `= 'spotify.com' OR LIKE '%.spotify.com'`), so
`https://notspotify.com/track/x` is `provider = 'other'` while a
`LIKE '%spotify.com%'` row filter would accept it. At the row level the two
queries genuinely differ.

What collapses the difference is the **second, independent host check further
down the pipeline**: `isSpotifyHost` in `src/lib/spotifyTrackUri.ts:39-48` is
dot-anchored too (`host === 'spotify.com' || host.endsWith('.spotify.com')`,
with a leading-dot guard), so `spotifyTrackUriFromUrl` answers `null` for
exactly the urls the column would have excluded. Every url the looser filter
lets through is then dropped per url, and both pipelines emit the same uri list
for every input. The two checks are **defence in depth, not one replacing the
other** — which is also why RH-143 must not infer from this paragraph that the
column is a substring match.

**Import.** `findOrCreateSong` keeps its existing guard
(`!song.created && !song.links.some(l => l.url === track.spotifyUrl)` — note
`song.links` already comes from `song_links` via `songLinksJson`), and when it
fires, appends one row at `COALESCE(max(position), 0) + 1` with
`ON CONFLICT (song_id, url) DO NOTHING`, then bumps the catalog timestamp with a
bare `UPDATE songs SET updated_at = now() WHERE id = $1` — the idiom
`applySongLinkUpdate` already uses (`src/lib/songs.ts:299`). The count of
`UPDATE songs` statements in production source is therefore **unchanged at 4**,
so `EXPECTED_CATALOG_WRITERS` (`catalogTimestampGuard.test.ts:74`) must **not**
change. Both statements stay inside `findOrCreateSong`'s existing
`withTransaction`; no `BEGIN/COMMIT/ROLLBACK` is issued through `query()`
(`transactionGuard.test.ts:27`). The import no longer touches `songs.links` at
all: for an appended song that column keeps whatever value it held.

**Reverse trigger.** A new migration drops the trigger and its function, and
nothing else. It must **not** be named `*_song_links.sql`: both
`songLinksBridge.db.test.ts:42` and `songLinksMigration.db.test.ts:54` select
migrations by that suffix and assert `toHaveLength(1)`. Use
`<nnnn>_drop_song_links_reverse_bridge.sql`; derive `<nnnn>` at implementation
time from `ls migrations | tail -1` (contiguous and unique — `0020` today, but
another task may take it first).

All three designs were measured on a scratch database `rh137probe`, built with
`DATABASE_URL=… node scripts/migrate.mjs` (Postgres 16.15, container
`repertoire-hero-postgres-1`, port 54322) and dropped afterwards:

Probe 1 — the append statement, run twice for the same url then once for a
second url:

```
INSERT 0 1 / INSERT 0 0 / INSERT 0 1
                url                 | label  | provider | position
------------------------------------+--------+----------+----------
 https://open.spotify.com/track/abc | T      | spotify  |        1
 https://genius.com/x               | Lyrics | other    |        2
```

Probe 2 — with the reverse trigger and function dropped, a `song_links` write
leaves the column alone, and the push projection still finds the url:

```
 links            spotify_urls
-------          ----------------------------------------
 []               ["https://open.spotify.com/track/abc"]

 tgname
-----------------------------------
 mirror_song_links_on_songs_write
 sync_profile_email_on_user_update
```

Probe 3 — a `spotify.test.ts`-shaped fixture (column seeded in SQL) still
reaches the re-keyed projection through the surviving forward trigger:

```
                      url                       | provider | position
------------------------------------------------+----------+----------
 https://open.spotify.com/track/spotify-track-a | spotify  |        1
      spotify_urls: ["https://open.spotify.com/track/spotify-track-a"]
```

### Files touched

- `migrations/<nnnn>_drop_song_links_reverse_bridge.sql` — new; drops
  `mirror_column_on_song_links_write` and `mirror_column_from_song_links()`,
  with a comment saying the forward bridge stays and why, and naming the
  follow-up that drops both.
- `migrations/0019_song_links.sql` — comment only: the reverse-bridge block's
  header gains a line saying it was dropped by the new migration. No SQL
  change; the file is already applied everywhere.
- `src/lib/songLinksSql.ts` — new exported SQL fragment helper beside
  `songLinksJson`, correlating a song's `provider = 'spotify'` link urls as a
  json array in canonical read order (`ORDER BY sl.position, sl.created_at,
  sl.id` — the literal `songLinksJson` already emits at `:44`, and the only
  canonical order this repo defines), wrapped in `COALESCE(…, '[]'::json)` so a
  link-less song answers `[]` rather than null. Keyed on `provider`, with no
  `LIKE` anywhere in the emitted string.
  **Parameter contract — a song-id expression, not a table alias.**
  `songLinksJson(alias)` emits `sl.song_id = ${alias}.id`, which presumes a
  `songs` row in scope. The re-keyed push has none: ER3 forbids `JOIN songs`,
  so the correlation must be on the playlist-version row's own
  `v.song_id` column. The new helper therefore takes the **song-id expression**
  (called with `'v.song_id'`, emitting `sl.song_id = v.song_id`), not an alias
  whose `.id` it appends. Writing it as an alias-taking twin of `songLinksJson`
  produces a helper that cannot express this query's join at all.
- `src/lib/__tests__/songLinksSql.test.ts` — one test on the new fragment's
  **returned string**, in the shape the file already uses for `songLinksJson`
  (`:82`-`:89`).
- `src/lib/dbRows.ts` — `PlaylistVersionLinksRow` replaced by the push's new
  projection row (`version_id`, `position`, the spotify-url array), its doc
  comment rewritten (the current one at `:77` is the last production mention of
  `s.links`). Row type, not a `Payload` (`AGENTS.md:413`).
- `src/lib/spotifyTrackUri.ts` — `spotifyTrackUriFromLinks` replaced by
  `spotifyPushUris`, the push's single entry point: it takes the query's rows
  and answers the uri list in row order, at most one uri per row, each being
  the first url in the row's array that yields a track uri (first-non-null
  wins, carried over from the function it replaces). `spotifyTrackUriFromUrl`
  unchanged; the now-unused `SongLink` import removed. It stays in `src/lib`
  because `src/app/api/**` is outside the coverage gate and the route file is
  an App Router handler whose export surface Next.js restricts to HTTP methods
  and route-segment config.
- `src/app/api/spotify/playlists/[id]/sync/route.ts` — push branch: new query,
  no `JOIN songs`, no `s.links`, uris from **one** `spotifyPushUris(...)` call
  and from nothing else; the `for`/`if (uri)` loop goes, and with it the
  `spotifyTrackUriFromLinks` import at `:13` and its call at `:140`. The route
  must not re-derive uris itself — no `spotifyTrackUriFromUrl` call and no
  `spotify:track:` literal anywhere in the file (ER4). A route that keeps a
  `rows.map(r => spotifyTrackUriFromUrl(r.spotifyUrls[0]))` inline would leave
  `spotifyPushUris` exported, unit-tested and dead while silently dropping every
  song whose track link is not first.
- `src/lib/spotifyPlaylistSync.ts` — `findOrCreateSong`'s append becomes the
  `song_links` insert plus the bare timestamp bump.
- `eslint.config.mjs` — the sync route's override lowered `complexity: 22` →
  `20`; `max-depth: 5` **stays** (measured: the deepest block is
  `if (!postResponse.ok)` inside the append-batch loop, untouched). Lowering is
  the only legal direction, the entry count stays 14 and
  `complexityBudget.test.ts` clause (e) requires the ceiling to **equal** the
  file's worst number. The RH-135 paragraph above that entry (`:87`-`:90`)
  narrates `spotifyTrackUriFromLinks` and "the loop is left with one
  `if (uri)`"; it goes stale when the loop goes, so it is rewritten to explain
  the 20 in terms of the provider-keyed query and `spotifyPushUris`.
- `src/lib/__tests__/spotifyTrackUri.test.ts` — the `spotifyTrackUriFromLinks`
  describe (`:114`) re-targeted at `spotifyPushUris`: ordering preserved, a row
  with no spotify url skipped without failing, a non-track Spotify url skipped,
  an `[album-url, track-url]` row yielding the **track** uri, and a two-track
  row yielding **exactly one** uri.
- `src/lib/__tests__/spotifyPlaylistSync.test.ts` — the mocked-statement
  assertions for the append (`:147` pins the old `UPDATE songs SET links` text).
- `src/lib/__tests__/songLinksBridge.db.test.ts` — the reverse-bridge describe
  (5 tests, `:321`-`:407`; `:409` begins
  `describe('the Spotify import keeps its link visible (ER18)')`, which
  **survives**) deleted and replaced by one test asserting the trigger and the
  function are **absent** from `pg_trigger` / `pg_proc` while
  `mirror_song_links_on_songs_write` is still present; the import describe gains
  the append-position / timestamp / column-untouched case. File is 436 lines
  against an 800 ceiling.
- `src/lib/__tests__/songLinksTable.db.test.ts` — RH-136's amended ER11
  assertion (`:263`-`:277`) flips back: the column is left **unmodified** by
  `applySongLinkUpdate` (the 2-element seeded array), since nothing reads it
  now; the `seedLinkRows` / `blankColumn` doc comments lose the reverse trigger.
- `src/lib/__tests__/spotifyPushUris.db.test.ts` — comments only (`:13`-`:19`,
  `:158`-`:164` credit the reverse trigger for the Fast View song being
  pushable). **No test changes**: all four cases go through real write paths and
  must pass unchanged.
- `package.json` — version bump (`AGENTS.md:523`).

### Test criteria

- `src/lib/__tests__/spotifyPushUris.db.test.ts`, unchanged, is the
  discriminating end-to-end check: 4 tests, each pushing a song whose Spotify
  link arrived through a real write path (Spotify pull, song picker, Fast View
  editor, song form), asserting the outbound `PUT .../tracks` body. Measured
  green at `fb549e1`: `Tests 4 passed (4)` with `RUN_DB_TESTS=1`. Each of its
  four fixtures gives its song exactly one Spotify link, so the multi-url rules
  above are carried by pure-function cases in `spotifyTrackUri.test.ts`, not by
  this suite.
- The new library function carries the unit tests (the route cannot be covered).
- The fragment helper's own test is the only possible proof that the query is
  provider-keyed, since a url-keyed query is runtime-equivalent.
- A scratch database built from `migrations/` proves the reverse trigger and its
  function are gone **with a row present** for the (now absent) trigger to have
  fired on.
- `catalogTimestampGuard.test.ts`, `complexityBudget.test.ts`,
  `songLinksMigration.db.test.ts`, `transactionGuard.test.ts` and
  `errorHandlingStyle.test.ts` all keep passing untouched. No `console.error` in
  any catch body (`AGENTS.md:260`); the route's existing `logger.error` stays.

## Expected Results

Reproduced verbatim in the `expected_results` array. Every grep is
boundary-anchored and anchored to one file; every count is `grep -o … | wc -l`
(`grep -c` counts lines, and is used only where lines and occurrences coincide
by construction); `grep` exiting 1 on no match is harmless inside those
pipelines. `master` is not used as a diff base (it equals `HEAD` here) — the
fixed commit `fb549e1` is.

- [ ] **ER1 — migration drops the reverse bridge only, and keeps the `*_song_links.sql` suffix unique.** `cd /Users/heitor/workspace/repertoire_hero` and run `ls migrations | grep -cE '_drop_song_links_reverse_bridge\.sql$'` → prints `1`; **both remaining clauses run over the file's executable text only, with `--` comment tails stripped first** (`sed 's/--.*$//'`), because §Files touched *mandates* a comment on this file that names the forward bridge and the follow-up `ALTER TABLE songs DROP COLUMN links`: `sed 's/--.*$//' migrations/*_drop_song_links_reverse_bridge.sql | grep -ohE 'DROP TRIGGER IF EXISTS mirror_column_on_song_links_write|DROP FUNCTION IF EXISTS mirror_column_from_song_links' | sort -u | wc -l` → prints `2`; `sed 's/--.*$//' migrations/*_drop_song_links_reverse_bridge.sql | grep -ohE 'DROP COLUMN|mirror_song_links_on_songs_write|mirror_song_links_from_column' | wc -l` → prints `0` (the forward bridge is deliberately kept). **The stripping is not cosmetic and was measured**: against a file carrying exactly the mandated comment, the unstripped form of the second clause prints `5`, not `0`, so it would fail a correct implementation — `migrations/0019_song_links.sql` is 165 comment lines out of 273, which is the comment density this repo's migrations are written at. Stripping also hardens the first clause, which a comment would otherwise satisfy (`grep -ohE` matches commented text); its real on-a-live-database proof is ER2 either way. `ls migrations | grep -cE '_song_links\.sql$'` → prints `1`. The new file must NOT end in `_song_links.sql`: `src/lib/__tests__/songLinksBridge.db.test.ts:42` and `src/lib/__tests__/songLinksMigration.db.test.ts:54` both select by that suffix and assert exactly one file, so a name like `0020_song_links_drop.sql` fails both suites.
- [ ] **ER2 — a scratch database built from `migrations/` has no reverse trigger and no reverse function, keeps the forward trigger, and leaves `songs.links` untouched after a `song_links` insert against a real row.** With Postgres 16.15 in container `repertoire-hero-postgres-1` on port 54322, run `export PGPASSWORD=postgres; /opt/homebrew/bin/psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "DROP DATABASE IF EXISTS rh137qa;" -c "CREATE DATABASE rh137qa;"`, then `cd /Users/heitor/workspace/repertoire_hero && DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/rh137qa" node scripts/migrate.mjs` (prints `All migrations executed successfully`), then against `rh137qa` with `\set VERBOSITY verbose`: (a) **asserted per trigger, not by enumerating the global set** (ER10's shape, mirrored here: a sibling migration adding any unrelated trigger — RH-138 is unblocked and could — would falsify an enumeration and fail a correct implementation) — `SELECT count(*) FROM pg_trigger WHERE tgname = 'mirror_column_on_song_links_write';` returns `0` and `SELECT count(*) FROM pg_trigger WHERE tgname = 'mirror_song_links_on_songs_write';` returns `1`; (b) `SELECT count(*) FROM pg_proc WHERE proname = 'mirror_column_from_song_links';` returns `0`; (c) **with a row guaranteed for the dropped trigger to have fired on** — `INSERT INTO songs (id, title, artist, links) VALUES ('11111111-1111-1111-1111-111111111111','T','A','[]'::jsonb); INSERT INTO song_links (song_id, url, label, position) VALUES ('11111111-1111-1111-1111-111111111111','https://open.spotify.com/track/abc','T',1);` — `SELECT links FROM songs WHERE id='11111111-1111-1111-1111-111111111111';` returns `[]` and `SELECT provider FROM song_links WHERE song_id='11111111-1111-1111-1111-111111111111';` returns `spotify`. The seeded row is not optional: a trigger is not evaluated for a statement matching no row, so without it (c) proves nothing. Finally `DROP DATABASE rh137qa;` and show the drop. Do not touch the pre-existing `rh136rev` schema or the `qa_base` / `qa_rh124_fresh` databases.
- [ ] **ER3 — the push query is keyed on `song_links.provider`, proved on the emitted SQL fragment, and nothing reads `s.links` / `PlaylistVersionLinksRow` any more.** In `/Users/heitor/workspace/repertoire_hero`: `grep -oE "(^|[^A-Za-z0-9_])s\.links([^A-Za-z0-9_]|$)" 'src/app/api/spotify/playlists/[id]/sync/route.ts' | wc -l` → prints `0` (it was `1` at `fb549e1`); `grep -rhoE "(^|[^A-Za-z0-9_])PlaylistVersionLinksRow([^A-Za-z0-9_]|$)" src | wc -l` → prints `0` (it was `4`); `grep -oE "(^|[^A-Za-z0-9_])JOIN songs([^A-Za-z0-9_]|$)" 'src/app/api/spotify/playlists/[id]/sync/route.ts' | wc -l` → prints `0`. The provider keying itself is proved on the fragment's **return value**, not by a grep over the file (which a comment would satisfy — `src/lib/songLinksSql.ts` is mostly prose): `src/lib/__tests__/songLinksSql.test.ts` contains a test that calls the new exported fragment helper from `src/lib/songLinksSql.ts` **with a song-id expression** (`'v.song_id'`, not a `songs` alias — the push has no `songs` row in scope, since `JOIN songs` is forbidden above) and asserts the returned string: **contains** `provider = 'spotify'`; **contains** `sl.song_id = v.song_id`; **contains** `ORDER BY sl.position, sl.created_at, sl.id`; and **does not contain** `LIKE`. All four in the same shape the file's existing `songLinksJson` test uses (`:82`-`:89`, which asserts `WHERE sl.song_id = s.id`, the same `ORDER BY` literal, and `'[]'::json`). **The `ORDER BY` assertion is load-bearing, not decorative**: "the first url in canonical read order" is normative in §Behavior, and a helper emitting `json_agg(sl.url)` with no `ORDER BY` satisfies every other clause of this ER, ER4 and ER5 (whose four fixtures hold one Spotify link each) while pushing, for a song holding two Spotify track urls, whichever url Postgres happens to return first — the wrong track, nondeterministically. `ORDER BY sl.position, sl.created_at, sl.id` is the literal `songLinksSql.ts:44` already emits and the only canonical order this repo defines. `cd /Users/heitor/workspace/repertoire_hero && npx vitest run src/lib/__tests__/songLinksSql.test.ts` reports 0 failed and 0 skipped. **Stated limitation, not a control:** a provider-keyed and a url-keyed query are indistinguishable end to end — not because `provider` is a substring match (it is host-anchored, `migrations/0019_song_links.sql:49-60`) but because `isSpotifyHost` (`src/lib/spotifyTrackUri.ts:39-48`) independently rejects, per url, exactly the look-alike hosts the column excludes — so no runtime test can separate them and the fragment assertions above are the only possible proof of this ER; the runtime side is covered by ER5, whose own control does bite.
- [ ] **ER4 — the push's uri resolution is `spotifyPushUris` in `src/lib`, unit-tested including the multi-url cases, with a positive control.** The export exists under exactly that name: `cd /Users/heitor/workspace/repertoire_hero && grep -oE 'export function spotifyPushUris\(' src/lib/spotifyTrackUri.ts | wc -l` → prints `1` (the identifier appears nowhere in `src/` at `fb549e1` except one doc comment, so this pin is not satisfiable by prose). `src/lib/__tests__/spotifyTrackUri.test.ts` covers at least five cases against it: (i) uris come back in row order; (ii) a row whose spotify-url array is empty is skipped without failing the push; (iii) a Spotify url naming no track (`https://open.spotify.com/album/abc123`) is skipped; (iv) **a row whose array is `['https://open.spotify.com/album/abc', 'https://open.spotify.com/track/xyz']` yields `spotify:track:xyz`** — it must NOT be skipped because the first url resolves to null, since the Fast View editor and the picker append in paste order and resolving only `urls[0]` would silently drop that song from the playlist while answering HTTP 200; (v) **a row holding two track urls yields exactly one uri** (array length 1 for that row) — one uri per playlist entry, never one per url, or the song is sent twice and `UNIQUE (song_id, url)` does not prevent it. The logic must live under `src/lib` and not in the route, because coverage excludes `src/app/api/**` and an App Router handler cannot export a testable helper. **The route must actually CALL it, and must assemble its uri list nowhere else** — without these two clauses every other ER in this spec goes green on a route that leaves `spotifyPushUris` exported, unit-tested and dead: `grep -oE 'spotifyPushUris\(' 'src/app/api/spotify/playlists/[id]/sync/route.ts' | wc -l` → prints `1` (measured `0` at `fb549e1`; the import line `import { spotifyPushUris } from …` does not match, so the `1` is the call site itself), and `grep -oE 'spotifyTrackUriFromUrl|spotifyTrackUriFromLinks|spotify:track:' 'src/app/api/spotify/playlists/[id]/sync/route.ts' | wc -l` → prints `0` (measured `2` at `fb549e1`: the `spotifyTrackUriFromLinks` import at `:13` and its call at `:140`, both of which go). Keep the route path **single-quoted** in both commands — it contains `[id]`. The second clause is what forbids a second inline path coexisting with the call: a route keeping `const uris = rows.map(r => spotifyTrackUriFromUrl(r.spotifyUrls[0])).filter(Boolean)` satisfies ER3 (no `s.links`, no `JOIN songs`, no `PlaylistVersionLinksRow`), ER5 (whose four fixtures hold one Spotify link each), ER13, and even ER9 — an arrow callback carries its own complexity scope, so dropping the `for` and the `if (uri)` still lands the measured 20 — while silently dropping every song whose track link is not first and answering HTTP 200. `npx vitest run src/lib/__tests__/spotifyTrackUri.test.ts` reports 0 failed and 0 skipped. *Positive control:* make the function body `return []` and re-run — at least one named test must fail. Revert.
- [ ] **ER5 — `spotifyPushUris.db.test.ts` passes unchanged with `RUN_DB_TESTS=1`, 0 failed and 0 skipped, and goes red when the provider filter is wrong.** After applying migrations to the dev database (`cd /Users/heitor/workspace/repertoire_hero && npm run db:migrate`), `RUN_DB_TESTS=1 npx vitest run src/lib/__tests__/spotifyPushUris.db.test.ts --reporter=verbose` reports `Tests 4 passed (4)`, 0 failed and 0 skipped, with all four named cases listed as **executed** — `sends the track URIs of songs created through the real write paths, in playlist position order`; `skips a song whose only link is a non-Spotify URL without failing the push`; `sends the track URI of a link added through the Fast View editor`; `sends the track URI of a link filled in through the song form`. The `RUN_DB_TESTS=1` and the verbose listing are both required: the suite is `describe.skipIf(!process.env.RUN_DB_TESTS)`, so a suite that never executes would otherwise satisfy "contains a passing test named X". `git diff --stat fb549e14c0350b223451313d5245ae1e7a884b8b -- src/lib/__tests__/spotifyPushUris.db.test.ts` shows changes on comment lines only, with no assertion changed. *Positive control:* in `src/lib/songLinksSql.ts` change `provider = 'spotify'` to `provider = 'youtube'` and re-run — at least 3 of the 4 tests must fail. Revert.
- [ ] **ER6 — the Spotify import appends a `song_links` row, bumps `songs.updated_at`, and leaves `songs.links` untouched, proved against a live database.** `cd /Users/heitor/workspace/repertoire_hero && grep -oE "(^|[^A-Za-z0-9_])SET links([^A-Za-z0-9_]|$)" src/lib/spotifyPlaylistSync.ts | wc -l` → prints `0`; `grep -oE 'INSERT INTO song_links' src/lib/spotifyPlaylistSync.ts | wc -l` → prints `1`; `grep -oE 'ON CONFLICT \(song_id, url\) DO NOTHING' src/lib/spotifyPlaylistSync.ts | wc -l` → prints `1`; `grep -oE 'UPDATE songs SET updated_at = now\(\) WHERE id = \$[0-9]' src/lib/spotifyPlaylistSync.ts | wc -l` → prints `1`. A live-database test in `src/lib/__tests__/songLinksBridge.db.test.ts` proves the behaviour: importing a track whose catalog row already holds links appends exactly one `song_links` row carrying `provider = 'spotify'` at `max(position) + 1`, leaves the existing rows' `id`s unchanged, advances that song's `songs.updated_at`, and — one extra `SELECT links FROM songs WHERE id = $1` in that same test — leaves `songs.links` **byte-identical to the value seeded before the import**, which is the cheapest demonstration that the reverse bridge is really gone on the very path that motivated it; re-importing the same track adds no second row. `RUN_DB_TESTS=1 npx vitest run src/lib/__tests__/songLinksBridge.db.test.ts` reports 0 failed and 0 skipped.
- [ ] **ER7 — no production source writes `songs.links`.** In `/Users/heitor/workspace/repertoire_hero`: `grep -rnE 'UPDATE[[:space:]]+songs[[:space:]]+SET[^;]*\blinks\b[[:space:]]*=|INSERT INTO songs \([^)]*\blinks\b' src --include='*.ts' --include='*.tsx' | grep -v '__tests__' | wc -l` → prints `0` (at `fb549e1` it printed 1 line, in `src/lib/spotifyPlaylistSync.ts`, which is the only production writer and the one this task removes). For the scripts, run the command **without** the `--include` flags, since explicit `.mjs` arguments combined with `--include='*.ts'` either filter everything out and print `0` vacuously or are ignored, depending on the grep build: `grep -nE 'UPDATE[[:space:]]+songs[[:space:]]+SET[^;]*\blinks\b[[:space:]]*=|INSERT INTO songs \([^)]*\blinks\b' scripts/*.mjs | wc -l` → prints `0` (measured `0` at `fb549e1` too — no script writes the column). `scripts/seed-catalog.sql` still writes the column and that is **intended** — the surviving forward trigger mirrors it into `song_links`, and RH-143 owns converting it.
- [ ] **ER8 — `EXPECTED_CATALOG_WRITERS` is still 4 and the timestamp guard passes.** `cd /Users/heitor/workspace/repertoire_hero && grep -oE 'EXPECTED_CATALOG_WRITERS = 4' src/lib/__tests__/catalogTimestampGuard.test.ts | wc -l` → prints `1`, unchanged: replacing the import's `UPDATE songs SET links = $1, updated_at = now()` with a `song_links` insert plus the bare `UPDATE songs SET updated_at = now() WHERE id = $1` (the idiom already at `src/lib/songs.ts:299`) keeps the production count of `UPDATE songs` statements at 4 and preserves RH-101's timestamp semantics. `npx vitest run src/lib/__tests__/catalogTimestampGuard.test.ts` reports 0 failed and 0 skipped. Note the guard is a **textual** scan over production `src/**/*.{ts,tsx}` plus `scripts/*.mjs` — `migrations/*.sql` is outside its set — so it slices from each `UPDATE songs` to the next `WHERE` and demands the literal `updated_at = now()` inside that span.
- [ ] **ER9 — the sync route's complexity pin is lowered to the measured 20, `max-depth` stays 5, the ratchet still has 14 entries.** In `/Users/heitor/workspace/repertoire_hero`, run the eslint probe twice, once per clause — the route path contains `[id]`, so it must stay single-quoted everywhere. (a) `npx eslint 'src/app/api/spotify/playlists/[id]/sync/route.ts' --rule '{"complexity":["error",1],"max-depth":["error",1]}' 2>&1 | grep -oE "'POST' has a complexity of [0-9]+"` prints `'POST' has a complexity of 20` (it was 22 at `fb549e1`); (b) as its **own** command, not eyeballed off (a)'s output, `npx eslint 'src/app/api/spotify/playlists/[id]/sync/route.ts' --rule '{"complexity":["error",1],"max-depth":["error",1]}' 2>&1 | grep -oE 'nested too deeply \([0-9]+\)' | sort -t'(' -k2 -n | tail -1` prints `nested too deeply (5)` — **numeric** sort on the parenthesised field, not `sort -u`, which sorts lexicographically and would rank a depth of `(10)` below `(2)` and report the wrong maximum (harmless at depth 5, wrong the moment it is not) — the deepest block is `if (!postResponse.ok)` at `route.ts:178`, which this task does not touch. `eslint.config.mjs`'s override entry for that route must read `complexity: ["error", 20]` and still `"max-depth": ["error", 5]`: `grep -oE 'complexity: \["error", 20\], "max-depth": \["error", 5\]' eslint.config.mjs | wc -l` → `1`. `grep -c 'name: "complexity-budget/override"' eslint.config.mjs` → `14`. **Lowering is the only legal direction**: `src/lib/__tests__/complexityBudget.test.ts` clause (e) requires each ceiling to EQUAL its file's current worst number and the list may only shrink, so leaving the pin at 22 after simplifying the file is a failure of this ER. `npx vitest run src/lib/__tests__/complexityBudget.test.ts` reports 0 failed and 0 skipped.
- [ ] **ER10 — the reverse-trigger suite is replaced by an absence assertion and `songLinksBridge.db.test.ts` passes with 0 skipped.** In `/Users/heitor/workspace/repertoire_hero`: `grep -oE 'mirror_column_on_song_links_write' src/lib/__tests__/songLinksBridge.db.test.ts | wc -l` → prints at least `1`, and the file contains a test asserting the reverse trigger and its function are **absent** while the forward trigger survives. **All three counts must be schema-qualified**, because the dev database carries `mirror_*` copies in a leftover `rh136rev` probe schema as well as in `public`: measured on the dev database today, the unqualified forms return **2, 2 and 2**, so a literal unqualified implementation would measure 0/0/1 as **1/1/2** and fail a correct change. The resolution is to narrow the predicates, never to drop the leftover schema (it is not this task's to remove):
      `SELECT count(*) FROM pg_trigger WHERE tgname = 'mirror_column_on_song_links_write' AND tgrelid = 'public.song_links'::regclass` → 0;
      `SELECT count(*) FROM pg_proc WHERE proname = 'mirror_column_from_song_links' AND pronamespace = 'public'::regnamespace` → 0;
      `SELECT count(*) FROM pg_trigger WHERE tgname = 'mirror_song_links_on_songs_write' AND tgrelid = 'public.songs'::regclass` → 1.
      Measured with the qualification and before this task lands, those three return 1, 1 and 1, so the first two flip only when the migration runs. The narrowing also strengthens the assertion: it pins the trigger to the relation it belongs on, not merely to a name existing somewhere in the cluster. The former reverse-mirroring tests no longer exist: `grep -oE 'mirrors a delete, and empties the column' src/lib/__tests__/songLinksBridge.db.test.ts | wc -l` → `0`. The surviving `describe('the Spotify import keeps its link visible (ER18)')` (which begins at `:409` at `fb549e1`, immediately after the deleted block) is still present: `grep -oE 'the Spotify import keeps its link visible' src/lib/__tests__/songLinksBridge.db.test.ts | wc -l` → `1`. `RUN_DB_TESTS=1 npx vitest run src/lib/__tests__/songLinksBridge.db.test.ts` reports 0 failed and 0 skipped.
- [ ] **ER11 — `applySongLinkUpdate` leaves `songs.links` unmodified, asserted against the seeded value, and no production reader of the column remains.** `src/lib/__tests__/songLinksTable.db.test.ts`'s additive-`applySongLinkUpdate` test asserts the `songs.links` column is left **unmodified** — equal to the 2-element array its fixture seeded (`[{label:'Chords',url:U1},{label:'Video',url:U2}]`), **not** the 3-element submitted set — while `song_links` holds all three urls in the submitted order `[U1,U2,U3]` with every pre-existing row's `id` preserved. This reverses RH-136's amended clause. Its safety rests on the **reader** side, which has its own measurement here rather than being inferred from ER3 (route file only) or ER7 (writers only): `cd /Users/heitor/workspace/repertoire_hero && grep -rnoE "SELECT[^;]*[^A-Za-z0-9_]s\.links[^A-Za-z0-9_]" src --include='*.ts' --include='*.tsx' | grep -v '__tests__' | wc -l` → prints `0` (at `fb549e1` it printed `1`, `src/lib/dbRows.ts:77`, the push row type's doc comment, the last production mention). `searchSongs` still projects the column through `SELECT s.*`, but no consumer reads the field: `grep -rnoE '\.links\b' src/lib/songSearchMerge.ts | wc -l` → prints `0`. `RUN_DB_TESTS=1 npx vitest run src/lib/__tests__/songLinksTable.db.test.ts` reports 0 failed and 0 skipped. *Positive control:* change the column assertion to `toEqual([])` — the test must fail, proving it is read against real column data and not against an empty or stale value. Revert.
- [ ] **ER12 — `src/lib/__tests__/spotify.test.ts` is byte-identical to `fb549e1` and still 678 lines, and its push cases pass.** `cd /Users/heitor/workspace/repertoire_hero && git diff --stat fb549e14c0350b223451313d5245ae1e7a884b8b -- src/lib/__tests__/spotify.test.ts` prints nothing, and `wc -l < src/lib/__tests__/spotify.test.ts` prints `678`, matching its `max-lines` pin in `eslint.config.mjs` — this task must not touch the file, so the pin stands untouched too. (The pin does not forbid future growth: `complexityBudget.test.ts` clause (e) only rejects a ceiling looser than the file's worst number, so RH-143 may raise it; within this task the requirement is byte-identity.) `fb549e1` is a deliberately fixed commit, not `git merge-base HEAD master`, which equals `HEAD` in this repo because commits land directly on master and would therefore diff the file against itself. `RUN_DB_TESTS=1 npx vitest run src/lib/__tests__/spotify.test.ts` reports 0 failed and 0 skipped — the `RUN_DB_TESTS=1` is mandatory because this file is gated (`skipIf(skip)`, `skip = !RUN_DB_TESTS`, `:8`/`:49`) despite not being named `*.db.test.ts` — including the push cases that seed `songs.links` in SQL and reach the re-keyed query through the surviving forward trigger.
- [ ] **ER13 — unwrapped `npm run lint` exits 0, unwrapped `npm run test:coverage` exits 0 with no failed test, and the full suite with the DB gate open has 0 failed and exactly 1 skipped.** (a) `/bin/zsh -f -c 'cd /Users/heitor/workspace/repertoire_hero && /usr/bin/env npm run lint'` exits `0` with no eslint output other than the npm banner. **This unwrapped form is required**: `rtk` masks `npm run lint`'s exit code and reformats its output, so a real failure reads as green. (b) `/bin/zsh -f -c 'cd /Users/heitor/workspace/repertoire_hero && /usr/bin/env npm run test:coverage'` exits `0` — a coverage-threshold breach is an **exit code**, not a failed test, so check the status and not only the summary line; thresholds are 80/65/78/80 — and its `Tests` summary line contains **no `failed` segment**. Do **not** require "only `pwaShell.test.ts` skips" here: this run sets no `RUN_DB_TESTS`, and measured at `fb549e1` it reports `Test Files 166 passed | 31 skipped (197)` / `Tests 2064 passed | 391 skipped (2455)` — 391 skips across 31 gated files, not 1, so a 1-skip demand would fail a perfect implementation. (c) The no-stray-skip check is this run instead, which opens the gate: with the dev database migrated (`npm run db:migrate`), `/bin/zsh -f -c 'cd /Users/heitor/workspace/repertoire_hero && RUN_DB_TESTS=1 /usr/bin/env npx vitest run'` exits `0` and reports a `Test Files` line of the form `Test Files N passed (N)` where **`N` is derived, not pinned** — `find src -name '*.test.ts' -o -name '*.test.tsx' | wc -l` (currently `197`) — so that a sibling task adding a test file does not falsify this ER, and a `Tests` line with no `failed` segment and **exactly `1 skipped`** — measured at `fb549e1`: `Tests 2454 passed | 1 skipped (2455)`. That single skip is `src/lib/__tests__/pwaShell.test.ts`'s service-worker case, skipped because `public/sw.js` exists; if it is absent the count is `3 skipped` and that is equally acceptable. The passed/total counts may differ from the measured `2454`/`2455` by whatever tests this task adds or removes, and the file count stays equal to the derived `N` above (this task adds and deletes no test file: `songLinksSql.test.ts`, `spotifyTrackUri.test.ts` and `spotifyPushUris.db.test.ts` all already exist, which is also why the `197` measured at `fb549e1` happens to be the expected value today), and no suite outside the `RUN_DB_TESTS` gate and `pwaShell.test.ts` may skip.
- [ ] **ER14 — `package.json` version bumped above `0.1.156-202610071754`, and no landing copy changed.** In `/Users/heitor/workspace/repertoire_hero`, `node -e "console.log(require('./package.json').version)"` prints a version matching `^0\.1\.[0-9]+-20[0-9]{10}$` that is strictly greater than every version reachable in history — **derive the floor, do not read the literal below as the floor**: it was `0.1.156-202610071754` when this spec was written and is already higher (`e4dbe33` bumped it while the spec sat in approval), which is exactly why this ER derives rather than pins (`AGENTS.md:523`; derive the floor with `git log -p --all -- package.json | grep -oE '"version": "[^"]+"' | sort -V -u | tail -1`). `git diff --stat fb549e14c0350b223451313d5245ae1e7a884b8b -- src/components/landing src/i18n/dictionaries` prints nothing: the Landing Page Rule (`AGENTS.md:526`) is decided and **declined**, this being an internal re-key with no user-visible change.

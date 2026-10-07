# RH-136 — Move a song's links into a `song_links` table with a provider

> Filename follows the repo convention `docs/tasks/<board id + 1>-spec.md`. This
> is the spec for board task **RH-136**, Part 1 of 3 from the RH-110 split. The
> collision with the id `RH-137` (Part 2) is expected under that convention.

## Scope

Introduce a `song_links` table as the single source of truth for a song's links,
backfill it from `songs.links`, and move every reader and writer of `songs.links`
that lives in this task's files onto it. `SongLink` gains an optional `provider`;
`label` and `url` are untouched, so no reader of the type loses a field.

**In scope** — the five seams the split named, re-measured at HEAD `f7ae8b1`:

| site | measured at | role |
|---|---|---|
| `src/lib/playlistSql.ts:66` | `'links', s.links,` inside `PLAYLIST_DETAIL_ENTRIES_JSON` | read |
| `src/lib/ownerSongRows.ts:62` | `'links', s.links,` inside `SONG_JSON` | read |
| `src/lib/moderation.ts:61` | `'links', s.links,` inside `getPendingSongEdits` | read |
| `src/lib/songIdentity.ts:117` / `:129` | `LOOKUP_SQL` (`SELECT id, links FROM songs`) / `INSERT_SQL` (`links` in the column list, `RETURNING id, links`) | read / write |
| `src/lib/songs.ts:191-239` | `applySongLinkUpdate`: the `SELECT links` at `:198` and the `UPDATE songs SET links` at `:228` | read / write |

**Also in scope, because the split analysis missed them and dropping the column
without them is a runtime break `tsc` cannot see** (see *Two unlisted seams*):

- `src/lib/songs.ts:118-150` `applyCatalogFill` — reads links implicitly through
  `SELECT * FROM songs ... FOR UPDATE` at `:123` and writes them through the
  `links` entry `src/lib/catalogFields.ts:150` puts in `fill`.
- `src/lib/moderation.ts:91-180` `reviewSongEdit` — applies an approved
  `links` payload through the generated `UPDATE songs SET …` at `:149-151`.

**Out of scope** — stated as boundaries, not deferrals:

- **`songs.links` is NOT dropped.** See *The column stays, and why*.
- `src/lib/catalogFields.ts` is not edited at all. `links` stays in
  `CATALOG_COLUMNS` and in `RefusableCatalogColumn`; removing it is RH-138's
  enumerated retype. `applyCatalogFill` partitions the `links` fill out in
  `songs.ts`, so `catalogFields.ts` needs no change.
- `src/lib/spotifyPlaylistSync.ts` and
  `src/app/api/spotify/playlists/[id]/sync/route.ts` are not edited — RH-137's
  territory, and `spotifyPlaylistSync.ts` is RH-126's concurrently. Their
  `songs.links` write is covered by the bridge trigger instead.
- No per-row accept/reject on a links correction (RH-138). A non-additive links
  edit still queues the whole set.
- `song_links` carries **no status and no pending flag**. It holds accepted
  catalog state only; a proposal stays in `global_song_edits` until RH-107
  replaces it with `catalog_suggestions`. `song_links.id` is the stable per-row
  target RH-107 and RH-111 need, and keeping `status` off the table is what
  leaves RH-111 free to carry it on the suggestion.

## Approach

### The table

One new migration file in `migrations/`, named with the next four-digit prefix
**read off `migrations/` at implementation time** (the directory ends at `0018`
today and `src/lib/__tests__/migrationsSingleSource.test.ts` requires prefixes
unique and contiguous from `0001`; several approved specs each claim "the next
number"). Its suffix must be `_song_links.sql`, because the replay test resolves
the file by suffix, never by prefix.

`song_links` columns:

- `id uuid` primary key, defaulted — the stable per-row target.
- `song_id uuid NOT NULL` referencing `songs` with `ON DELETE CASCADE`.
- `url text NOT NULL`.
- `label text NOT NULL` defaulting to the empty string. Never null: the UI
  renders `link.label || link.url` and an empty label already means "show the
  url" (`src/components/fastview/LinksSection.tsx:60`).
- `provider text` **`GENERATED ALWAYS AS (…) STORED`**, derived from `url`. One
  definition, in the schema, so no TypeScript writer can disagree with the
  backfill and no row can ever be written with a wrong provider. The expression
  must be IMMUTABLE and must match on the **host only**, so a `youtube.com` in a
  path is not a YouTube link.

  **The host is normalised in exactly this order**, each step measured on the
  dev database:
  1. `substring(lower(url) from '^https?://([^/?#\\]*)')` — lowercase the **whole
     url before** the match, not the extracted authority: the pattern is
     case-sensitive, so `HTTPS://OPEN.SPOTIFY.COM/track/2` otherwise extracts
     nothing and lands in `other` (measured).

     **The backslash is in the excluded class, and leaving it out is a
     spoofing hole.** `[^/?#]*` without it does not stop at a `\`, but the
     WHATWG URL parser treats `\` as `/` for a special scheme, so the browser's
     host for `https://evil.com\@spotify.com/x` is `evil.com`. Measured on the
     dev database: with `[^/?#]*` that url normalises to the host `spotify.com`
     and the expression labels it **`spotify`**; with `[^/?#\\]*` it normalises
     to `evil.com` and lands in **`other`**, which is what the browser would
     actually visit. Since RH-137 keys the Spotify push off `provider`, the
     unfixed class sends the push to resolve a track id from `evil.com`. ER6
     pins this url to `other`.
  2. Strip any `userinfo@` prefix by keeping the text after the **last** `@`.
     Order matters: stripping the port first instead reduces
     `https://user:pw@spotify.com/x` to the host `user` (measured).
  3. Strip any `:port` suffix by keeping the text before the first `:`.

  A url with no `http(s)://` prefix extracts the **empty** host and falls
  through to `other`.

  **The match is dot-anchored, never a bare suffix.** Per provider, against the
  normalised `host`:
  - `host = 'spotify.com' OR host LIKE '%.spotify.com'` → `spotify`
  - `host IN ('youtube.com', 'youtu.be') OR host LIKE '%.youtube.com' OR host LIKE '%.youtu.be'` → `youtube`
  - everything else → `other`.

  `LIKE '%spotify.com'` and `LIKE '%youtube.com'` **without the leading dot are
  wrong and must not be written**: they label `https://notspotify.com/x` as
  `spotify` and `http://NOTYOUTUBE.COM/y` as `youtube`. That is not cosmetic —
  RH-137 keys the Spotify push off `provider`, so one unlucky or hostile host
  would send the push to resolve a track id from a site that is not Spotify.

  Measured on the dev database with exactly this normalisation (backslash
  excluded) and these three predicates, as a generated column on a real table:
  `spotify` for `https://open.spotify.com/track/1`, `https://spotify.com/x`,
  `HTTPS://OPEN.SPOTIFY.COM/track/2` and `https://user:pw@spotify.com/x`;
  `youtube` for `https://youtu.be/abc`, `https://www.youtube.com/watch?v=1` and
  `https://music.youtube.com/x`; `other` for `https://notspotify.com/x`,
  `http://NOTYOUTUBE.COM/y`, `https://notyoutu.be/y`, `https://myyoutu.be/x`,
  `https://www.youtube.com.br/x`, `https://spotify.com@evil.com/x`,
  `https://example.com/youtube.com/x`, `https://evil.com:8080/?x=youtube.com`,
  `ftp://spotify.com/x`, `www.cifraclub.com.br/x`, `not a url`,
  **`https://evil.com\@spotify.com/x`**, `https://evil.com#@spotify.com/x`,
  `https://evil.com?@spotify.com/x`, `https://xn--spotify-xyz.com/x`,
  `https://spotify.com./x`, `https://[::1]/x` and `//open.spotify.com/track/1`.
  ER6 pins the hostile half of that list. Three values; adding a fourth is a
  later migration, which is the point of generating it rather than storing it.
- `position integer NOT NULL` — **a deliberate addition to the column list the
  justification settled**, and the reason is in *What a musician would lose*:
  the displayed order of a song's links is visible, and `(created_at, id)` alone
  scrambles any two rows inserted by the same statement, because they share
  `now()` and break the tie on a random uuid. Not unique, so a delete leaves a
  gap rather than forcing a renumber.
- `created_at timestamptz NOT NULL` defaulting to `now()`.

Constraints and indexes: `UNIQUE (song_id, url)` — the key every writer upserts
on — and an index supporting `(song_id, position)`.

**The canonical read order is `ORDER BY position, created_at, id`**, everywhere,
with no exception.

### The backfill

In the same migration, from `songs.links`, with ordinality. Every awkward case
is settled here, not deferred:

- **A `links` value that is not a jsonb array** contributes nothing. Guard on
  `jsonb_typeof(links) = 'array'` first: `jsonb_array_elements` on a scalar
  raises and would abort the whole migration. The column is unvalidated — the
  additive branch at `src/lib/songs.ts:228` runs a bare `UPDATE songs SET links
  = $1` with no url and no shape check, so the only thing guaranteeing an array
  today is that every writer happens to `JSON.stringify` one.
- **An element that is not an object, or an object with no `url`**, contributes
  nothing: it has no url, so nothing can be clicked and nothing is lost that a
  musician could ever have reached. `-> 'url'` reading null covers both cases.
- **A non-http(s) url is kept**, with its label, at `provider = 'other'`. It is
  reachable: `isSongLink` / `HTTP_URL` (`src/lib/songEditPayload.ts:95`, `:30`)
  only gates `parseLinks`, which is reached through the **moderation** branch at
  `src/lib/songs.ts:222`; adding a brand-new link is the **additive** branch at
  `:228`, which validates nothing.
- **A duplicate `(song_id, url)` collapses, keeping the lowest-ordinality
  element's label**, and the migration does not fail. Duplicates are possible
  after `0009_unify_song_identity.sql:56-96`: that step deduplicated only the
  links it *appended* from merged duplicates (`rn = 1` per keeper+url, plus the
  `NOT EXISTS` against the keeper's own array) and never deduplicated the
  keeper's pre-existing array; and no write path since has rejected one —
  `usableLinks` (`src/lib/catalogFields.ts:231`) does not dedupe, the moderation
  approval does not, and `scripts/seed-catalog.sql` is not validated. Only
  `useSongLinks` checks, client-side. (The live dev database currently holds 21
  elements across 39 songs with no duplicate, no non-object, no url-less element
  and no non-http url — so the awkward cases must be *seeded* by the test, never
  waited for.)
- **`position` is the element's 1-based array ordinality after the collapse**, so
  the order a musician sees today is the order they see afterwards.

### The bridge trigger

Exactly one trigger, on `songs`, `AFTER INSERT OR UPDATE OF links`, and **the
changed-value test lives in the function body, never in a `WHEN` clause**. This
is not a style choice: a `WHEN` clause referencing `OLD` on a trigger that also
fires `AFTER INSERT` is rejected at creation time — measured on the dev
database, `CREATE TRIGGER … AFTER INSERT OR UPDATE OF links ON songs FOR EACH
ROW WHEN (OLD.links IS DISTINCT FROM NEW.links)` fails with
`42P17: INSERT trigger's WHEN condition cannot reference OLD values`, which
aborts the migration so `song_links` never exists at all. The function therefore
takes no `WHEN` clause and opens by returning early when `TG_OP = 'UPDATE'` and
`OLD.links IS NOT DISTINCT FROM NEW.links`. One trigger, one function, and the
two-trigger split (one `AFTER INSERT`, one `AFTER UPDATE … WHEN`) is explicitly
not the chosen repair.

The body then inserts each element of the new array into `song_links` with
`ON CONFLICT (song_id, url) DO NOTHING`, guarding
`jsonb_typeof(NEW.links) = 'array'` and skipping any element that is not an
object or carries no `url`, exactly as the backfill does. **Insert-only — it
never updates a label and never deletes a row**, so it cannot lose data and
cannot disturb an existing `song_links.id`. An **empty array inserts nothing**:
that is what makes the `songs.links = '[]'::jsonb` fixture ER9 and ER16 need
constructible at all — a song can hold `song_links` rows while its column stays
empty, because no trigger firing will ever contradict the column.

**The `position` expression must be COALESCE'd, and this is the single most
dangerous detail in the migration:**

```
position = COALESCE((SELECT max(position) FROM song_links WHERE song_id = NEW.id), 0) + ordinality
```

The bare `max(position) + ordinality` is **wrong and must not be written**.
`max()` over zero rows returns NULL, `NULL + ordinality` is NULL, and `position`
is `NOT NULL`, so the insert raises **`23502 null value in column "position" of
relation "song_links" violates not-null constraint`** on *every* trigger firing
for a song that has no `song_links` row yet. Measured on the dev database with
the trigger built in the bare form, on both reachable paths:

- `INSERT INTO songs (title, artist, standard_key, links) VALUES (…)` carrying a
  non-empty `links` array → 23502;
- `UPDATE songs SET links = …` on a song whose `song_links` row count is 0 → 23502.

Both paths live in code **this task does not own**, so the bare form ships
broken with every other ER green:

- `scripts/seed-catalog.sql:20` — `INSERT INTO songs (title, artist,
  standard_key, links)`, mounted into the container at `docker-compose.yml:29`.
  The seed would abort, so a fresh dev database comes up with no catalog.
- `findOrCreateSong`'s found-song append (`src/lib/spotifyPlaylistSync.ts:140`)
  for a catalog song that currently holds **zero** links — the Spotify import
  dies mid-transaction. `song.links.some(...)` at `:139` is `false` for an empty
  array, so this is the *common* case for a catalog song without links, not an
  edge one.

With the COALESCE'd form, both yield `position = 1` — measured. ER17 pins both.

Verified on the dev database with this exact COALESCE'd shape: an `INSERT` of a
`songs` row carrying two elements, on a song with no `song_links` rows, yields
`position = 1` and `2`; an `UPDATE` from `'[]'` to one element, on a song with no
`song_links` rows, yields `position = 1`; an `UPDATE` to `[two existing urls, one
new url]` inserts exactly one row, leaves the existing rows' labels untouched and
gives the new row `position = 5` (max 2 + ordinality 3 — a gap, which is why
`position` is not unique); re-running the identical `UPDATE` inserts nothing; and
an `UPDATE` to `'[]'` inserts nothing and deletes nothing.

Both the function and the table names inside it are written **unqualified**, so
the function the migration creates lands in whatever schema is first on the
`search_path` and resolves `song_links` and `songs` in that same schema; the
body must not `SET search_path`, which would make the replay write into
`public`.

It exists for one writer this task may not edit:
`src/lib/spotifyPlaylistSync.ts:140`'s `UPDATE songs SET links = $1` (HEAD
`f7ae8b1`), which appends the Spotify link when importing a track whose catalog
row already exists. Without the trigger, that link would be written to a column
nothing reads any more and the song page would stop showing it until RH-137
lands. The precedent is `AGENTS.md:56`'s `sync_profile_email_on_user_update`
(`migrations/0008_sync_profile_email.sql`): a trigger kept because the write it
mirrors happens in code this repository does not own. It is a bridge: the part that drops
`songs.links` drops the trigger with it, and the spec for that part must say
so.

The four `songs.links` statements this task *does* own — `songIdentity.ts`'s
`INSERT_SQL`, `applySongLinkUpdate`'s `UPDATE`, `applyCatalogFill`'s `links`
fill and `reviewSongEdit`'s `links` clause — all stop writing the column, so the
forward trigger never fires for them.

**AMENDED IN REVIEW ROUND 1: a second, reverse trigger is required, and the
"there is no dual write" sentence this paragraph used to end with was wrong.**
It was written under the premise below ("Deferring the DROP costs a musician
nothing today"), which RH-135 (`5d602f7`, the commit immediately preceding this
work) had already falsified. The Spotify push reads `songs.links` and, since
RH-135, matches a track by its **url** rather than by a label no writer
produces — so the push really works, and with all four owned writers off the
column every song touched after this migration would push an empty `uris` list
and answer HTTP 200 with `{added: 0}`. Measured, with only the forward trigger:
`spotifyPushUris.db.test.ts` reports `3 failed`, each `expected { added: +0 }
to deeply equal { added: 2 }`.

The migration therefore also creates `mirror_column_on_song_links_write`, an
`AFTER INSERT OR UPDATE OR DELETE` trigger on `song_links` that recomputes
`songs.links` from the rows in canonical order. It covers all four writers with
one statement, keeps the TypeScript writers single-source, and is dropped
alongside the forward bridge by the dropping task. It is created **after** the
backfill, so the backfill still leaves the column byte-identical (ER4).

The alternative considered and rejected — keeping `links` in `INSERT_SQL`'s
column list and letting the forward trigger mirror it — covers only the create
path. Measured: it takes `spotifyPushUris.db.test.ts` from `3 failed` to
`2 failed | 2 passed`, the two failures being the Fast View editor
(`applySongLinkUpdate`) and the song form (`applyCatalogFill`), each pushing
`{added: 1}` where 2 tracks were expected — a push that silently sends half a
playlist.

### The column stays, and why

`songs.links` is **not** dropped, against the justification's settled "drop
`songs.links` in the same migration". Dropping it now breaks three sites this
task is forbidden to touch, and every one of those breaks is invisible to
`npx tsc --noEmit`:

1. `src/app/api/spotify/playlists/[id]/sync/route.ts:122` selects `s.links` in a
   SQL string — the playlist push becomes a 500.
2. `src/lib/spotifyPlaylistSync.ts:140` updates it in a SQL string — the Spotify
   import dies mid-transaction.
3. `src/lib/songs.ts:123` `SELECT * FROM songs` feeds `splitCatalogUpdate` a
   `CatalogSnapshot` whose `links` would be `undefined`;
   `isCatalogFieldEmpty` (`src/lib/catalogFields.ts:112`) reads
   `song.links === null || song.links.length === 0` and throws a TypeError on
   the second clause — the whole song-form save dies. `Song.links` is declared
   `SongLink[]`, so the compiler is satisfied.

(3) is handled inside `songs.ts` by this task; (1) and (2) belong to RH-137. The
DROP belongs to whichever part removes the last reader — RH-138, after RH-137 —
and that part's spec must own it.

**One further reader of the retained column survives this task deliberately, and
the dropping task inherits it.** `searchSongs` (`src/lib/songs.ts:77`) selects
`s.*`, so `CatalogSearchResult.links` keeps coming from `songs.links` rather than
from `song_links`. It is **not migrated here**: it is not one of the five seams
the split named, it is not a `'links', s.links` projection ER10 counts, and
moving it would widen this task without changing anything a musician sees.

The consequence is stated so RH-138 cannot miss it: once `applySongLinkUpdate`
stops writing the column, `CatalogSearchResult.links` **goes stale** for any song
whose links were edited after this task lands — it shows the pre-task set, plus
whatever the bridge trigger mirrors in from the Spotify writer. That is harmless
today, because every consumer of `CatalogSearchResult` was traced and none reads
`.links`: the search results feed the add-song picker, which renders title,
artist and album only. But after RH-138's `DROP COLUMN links` the field becomes
`undefined` at runtime while `CatalogSearchResult` still declares it, which
`npx tsc --noEmit` cannot see — the same class of invisible break as (1)–(3)
above. **RH-138 must either migrate `searchSongs` onto the aggregate or remove
`links` from `CatalogSearchResult`**, and its spec must say which.

**AMENDED IN REVIEW ROUND 1 — THE PARAGRAPH BELOW IS FALSE AS WRITTEN.** It
describes the push as it stood *before* RH-135 (`5d602f7`): `sync/route.ts` no
longer matches `l.label === 'spotify'`, it calls `spotifyTrackUriFromLinks` and
matches on the url's host, so the push is a live reader of `songs.links` that
works. Deferring the DROP therefore costs a musician the whole push unless the
column is kept current, which is why the reverse bridge trigger above exists.
The paragraph is retained only as the record of a premise this task
falsified. **It does not explain why `src/lib/__tests__/spotify.test.ts` needs
no edit** — an earlier wording claimed that, and it was wrong: the three
fixtures it cited seed the labels `'Sync Song A'`, `'Sync Song B'` and the
song's own title, and `grep` finds no fixture anywhere in `src/` seeding
`label: 'spotify'`. The real reason that file needs no edit, measured in code
review round 2, is that it seeds `songs.links` directly in SQL, the forward
bridge mirrors that into `song_links`, and the push matches by url through
`spotifyTrackUriFromLinks` — so the file passes unchanged, at 678 lines.

**Deferring the DROP costs a musician nothing today.** The `songs.links` write
the retained column still serves is the Spotify one, and the only *read* keyed
off a link label is `src/app/api/spotify/playlists/[id]/sync/route.ts:135`'s
`l.label === 'spotify'` — which no production path can satisfy, because
`findOrCreateSong` writes the **track title** as the label, not `'spotify'`.
That label is seeded only by `src/lib/__tests__/spotify.test.ts:507`, `:520`
and `:612`, and seeded directly into `songs.links`, which the bridge trigger
mirrors into `song_links`. That is why the one pinned-exact test ceiling in the
repo needs no edit: the file keeps working unchanged.

Rollback consequence, both ways. Migrations here are **forward-only**:
`scripts/migrate.mjs` has no down path. With the column retained and its
contents never modified or deleted by this migration, undoing this task is
`DROP TABLE song_links` plus reverting the code, and nothing a musician had is
lost. Had the column been dropped, there would be no undo at all short of
reconstructing the jsonb from `song_links` by hand.

### The duplicate-url policy, stated once for all four writers

`UNIQUE (song_id, url)` turns a duplicated url from today's harmless extra card
into an aborted transaction, and **a duplicated url is reachable today through
no misuse at all**:

- `src/components/songs/SongLinksEditor.tsx:22-73` — the editor both the song
  form and `CorrectionModal` render — has **no** duplicate check; its
  `updateLink` (`:23-27`) will happily make row 2's url equal row 1's.
- The only duplicate check in the repository is `isDuplicateLinkUrl`, called at
  `src/hooks/useSongLinks.ts:75`, and it guards the **Fast View add-link form
  alone**.
- `updateSongLinksAction` (`src/app/actions/repertoire.ts:169-176`) hands
  `links` to `applySongLinkUpdate` with no shape and no uniqueness check.
- `usableLinks` (`src/lib/catalogFields.ts:231-233`) filters blank urls and does
  not dedupe.
- `parseLinks` (`src/lib/songEditPayload.ts:98-103`) requires every element to be
  `{label, url}` with an http(s) url, and does not dedupe either.

Today such a save **succeeds**. After this task a naive implementation makes it
fail, and the failure is not local: `applyCatalogFill` runs on the caller's
transaction client, and that transaction is the one `updateSong`
(`src/lib/ownerSongs.ts:359-372`) opens around **both** halves of a song-form
save — the catalog fill at `:362` and the owner row at `:364`, "both writes or
neither". An aborted statement therefore takes the owner-row write with it and
**the musician's whole song edit is lost with an error**. The moderation path
fails identically at approval time.

Two Postgres facts, both measured on the dev database (container
`repertoire-hero-postgres-1`, port 54322) against a table carrying
`UNIQUE (song_id, url)`:

- a plain multi-row `INSERT` carrying the same `(song_id, url)` twice →
  **`23505` duplicate key value violates unique constraint**;
- the same rows with `ON CONFLICT (song_id, url) DO UPDATE SET label = EXCLUDED.label`
  → **`21000` ON CONFLICT DO UPDATE command cannot affect row a second time**.

`DO NOTHING` does *not* raise on an in-statement duplicate — measured, it
inserts the first row and skips the rest — but it silently drops whichever label
came second, so it is no substitute for deduplicating. And there is no per-row
recovery available: `src/lib/__tests__/transactionGuard.test.ts:27` bans
`query('BEGIN'|'COMMIT'|'ROLLBACK'` anywhere under `src/`, tests included, so
**no savepoint** can catch a conflict and continue. The statement itself has to
be safe.

**Two layers, both mandatory at every one of the four writers.**

*Layer 1 — deduplicate the array before any statement sees it.* One helper,
`dedupeLinksByUrl(links: SongLink[]): SongLink[]`, exported from the new
`src/lib/songLinksSql.ts` — a plain library module with no `'use server'`, so
exporting publishes no Server Action, and it takes no `userId`. It keeps the
**first** occurrence of each `url` and drops the rest, the same rule the backfill
applies (lowest ordinality wins) so the two can never disagree, and it numbers
`position` over the survivors so the collapse leaves no gap. Url equality is
byte equality — exactly the comparison `UNIQUE (song_id, url)` makes: no
trimming, no case folding, no trailing-slash normalisation. **Each of the four
writers calls it on the array it is about to write, and that result is the
statement's only source of rows.** The migration backfill and the bridge trigger
do the equivalent in SQL (`DISTINCT ON (song_id, url)` ordered by ordinality),
which this spec already required of them.

*Layer 2 — every link-writing statement names a conflict policy, chosen from
what that writer means.* None may be left bare:

| writer | policy, in SQL | why that one |
|---|---|---|
| `songIdentity.ts` create-path insert | `ON CONFLICT (song_id, url) DO NOTHING` | a create has nothing to overwrite; the only conflict reachable is a concurrent writer or the bridge trigger, and either row already carries the same url |
| `songs.ts` `applySongLinkUpdate` additive upsert | `ON CONFLICT (song_id, url) DO UPDATE SET label = EXCLUDED.label, position = EXCLUDED.position` | today's whole-array rewrite rewrites labels **and order** too, and both must survive (ER11, ER12); see *Who owns `position` at this writer* below for why omitting the `position` clause leaves the new row tied |
| `songs.ts` `applyCatalogFill` links write | `ON CONFLICT (song_id, url) DO NOTHING` | this writer fills what is empty and **refuses** what is set; overwriting an existing row's label here would be exactly the silent catalog overwrite the refusal model exists to prevent |
| `moderation.ts` `reviewSongEdit` replace-set | `DELETE FROM song_links WHERE song_id = $1 AND url <> ALL($2)` first, then the insert with `ON CONFLICT (song_id, url) DO UPDATE SET label = EXCLUDED.label, position = EXCLUDED.position` | an approved correction is authoritative over the whole set, labels and order included; deleting first keeps every surviving url's `song_links.id`, and an approved **empty** array deletes every row, since `url <> ALL('{}')` is true for all of them |

Measured confirmation of the combination: `DISTINCT ON (song_id, url)` over a
two-row `VALUES` list holding the same url twice, with
`ON CONFLICT (song_id, url) DO UPDATE SET label = EXCLUDED.label, position = EXCLUDED.position`,
inserts one row carrying the first occurrence's label and raises nothing.

#### Who owns `position` at this writer

Both `DO UPDATE` policies above set `position = EXCLUDED.position`, and that
clause is **load-bearing, not decorative**. `position` is owned by whichever
statement last wrote the row, and a `DO UPDATE` that names only `label` never
touches it — so survivors keep whatever numbers an earlier statement left them
while the freshly inserted row gets Layer 1's renumbered ordinality. Because the
bridge trigger deliberately leaves **gaps** (max + ordinality, so a third link
on a two-row song lands at 5), those two numberings are on different scales and
collide.

Measured on the dev database from exactly the state ER17 produces — `u1` at
position 1, `u2` at position 3 — submitting `[u1, u2, u3]` through Layer 1's
numbering 1,2,3:

- with `DO UPDATE SET label` **alone**: `u1→1`, `u2→3`, `u3→3`. The new row is
  **tied** with `u2`, `is_new_link_strictly_highest` is **false**, and the
  canonical `ORDER BY position, created_at, id` breaks the tie on a random uuid
  — the exact scramble *What a musician would lose* introduces `position` to
  prevent.
- with `DO UPDATE SET label = EXCLUDED.label, position = EXCLUDED.position`:
  `u1→1`, `u2→2`, `u3→3`; the canonical read order is `{u1, u2, u3}`, byte-for-byte
  the submitted array's url order, and `u3` is strictly highest.

So **Layer 1 numbers from 1 over the survivors and the statement re-asserts that
numbering on conflict.** The alternative — numbering Layer 1 from `max(position)`
of the existing rows — is rejected: it would preserve the trigger's gaps forever
and make the submitted array's order unrecoverable from the table. Renumbering
from 1 is also precisely today's semantics, since today's `UPDATE songs SET links
= $1` replaces the whole array and its order. ER11 asserts the read order, not
the raw numbers.

The two `DO NOTHING` writers (`songIdentity.ts`, `applyCatalogFill`) need no such
clause: `DO NOTHING` by definition leaves an existing row entirely alone, which
is what *refuse rather than overwrite* means at both of them.

ER12, ER14, ER15 and ER16 each carry a duplicated-url case, one per writer, so
no writer can be left on the naive form and still pass; ER29 checks the same
thing statically, by counting `INSERT INTO song_links`, `ON CONFLICT (song_id,
url)` and `dedupeLinksByUrl` call sites.

### Behavior, per site

Reads — all three `'links', s.links` projections are replaced by one correlated
aggregate over `song_links`, in canonical order, producing the same
`[{label, url, …}]` json shape plus `provider`. It is spelled **once**, in a new
`src/lib/songLinksSql.ts` exporting it as a function of the `songs` alias, and
imported by `playlistSql.ts`, `ownerSongRows.ts` and `moderation.ts`: three
copies of a SQL string drift silently and type-check while drifting, which is
the reason `playlistSql.ts` itself exists. The module sits under `src/lib`, so
it is inside the coverage universe.

- `songIdentity.ts` — `LOOKUP_SQL` resolves the row's links through the same
  aggregate instead of `SELECT id, links`. `INSERT_SQL` drops `links` from its
  column list and from `RETURNING`; on create, the input's links are inserted
  into `song_links` in input order, through `dedupeLinksByUrl` and with
  `ON CONFLICT (song_id, url) DO NOTHING` per *The duplicate-url policy* — an
  input array holding the same url twice would otherwise raise 23505 and abort
  the caller's transaction, the trap `src/lib/songIdentity.ts:123-128` already
  documents for `INSERT_SQL` itself. That insert runs **only when `INSERT_SQL`
  actually returned a row**: its own `ON CONFLICT DO NOTHING` (`:132`) returns
  none when a concurrent caller won `uq_songs_artist_title`, and the re-lookup
  path at `:179` onwards is a *found* row, which writes nothing.
  A **found** row is still returned untouched
  — no write to an already-set field — and its `links` are the current
  `song_links` rows. `src/lib/dbRows.ts:26-29`'s `SongLinksRow` doc comment
  quotes the old SQL verbatim and must be updated with it.
- `songs.ts` `applySongLinkUpdate` — reads current links from `song_links`; the
  additive test is unchanged (`every` current url present in the submission);
  non-additive still routes to `submitSongEdit` and returns `{success: true,
  pending: true}` without writing. Additive now upserts the
  `dedupeLinksByUrl`-ed array into `song_links` with
  `ON CONFLICT (song_id, url) DO UPDATE SET label = EXCLUDED.label, position = EXCLUDED.position`,
  because today's whole-array rewrite also rewrites labels and order and both
  must survive — see *Who owns `position` at this writer*. The dedupe is not
  optional here: `DO UPDATE` with the same `(song_id, url)` twice in one
  statement raises `21000` (measured), which is why submitting a duplicate
  through the song form would abort the write. It must also keep bumping
  `songs.updated_at`, and since `links` leaves the column this writer's
  `UPDATE songs` becomes the bare
  `UPDATE songs SET updated_at = now() WHERE id = $1` — see *The timestamp
  guard*. The read, the upsert and the bump are one `withTransaction` (the only
  sanctioned way).

  **The `fetchUrlTitle` loop must run before that transaction opens.** The
  label-filling loop at `src/lib/songs.ts:208-217` issues one *outbound HTTP
  request* per blank-labelled link (`fetchUrlTitle`, `src/lib/linkFetcher.ts`),
  and holding a Postgres transaction open across an arbitrary network round trip
  — one per link, to a host a musician chose, with whatever timeout the fetcher
  has — pins a connection from the pool and holds the `songs` row's locks for
  the duration. Today that loop sits before any write, and it must stay there:
  compute `processedLinks` first, then open `withTransaction` around the
  `song_links` read, the upsert and the timestamp bump. The initial
  `SELECT`-for-existence at `:203` may stay outside the transaction as it is
  today, or move inside it — either satisfies the ERs — but no `fetchUrlTitle`
  call may be inside.
- `songs.ts` `applyCatalogFill` — hydrates the `CatalogSnapshot`'s `links` from
  `song_links` rather than from the column, so the fill-or-refuse decision is
  taken against real data; partitions the `links` entry out of `fill` and
  applies it to `song_links` instead, through `dedupeLinksByUrl` and with
  `ON CONFLICT (song_id, url) DO NOTHING` per *The duplicate-url policy* —
  `DO NOTHING` and not `DO UPDATE`, because a fill never overwrites accepted
  catalog state. This is the one writer whose failure costs a musician the
  **whole** song-form save, since the statement runs on `updateSong`'s shared
  transaction (`src/lib/ownerSongs.ts:361-366`). `FOR UPDATE` on the `songs` row does not
  lock `song_links` rows; it still serialises two concurrent fills of the same
  song, which is all it ever bought.
  **The empty-`SET`-list trap applies here too, and it is reachable the moment
  `links` is partitioned out:** `src/lib/songs.ts:140-147` builds `setList` from
  `fill` inside `if (fill.length > 0)` (`:142`) and appends `, updated_at = now()`
  to the joined string (`:144`), so a fill whose *only* member was `links` leaves
  `setList` empty and `UPDATE songs SET , updated_at = now()` is a 42601 — every
  song-form save that only adds a link would die. **Which statement bumps the
  timestamp: the same single `UPDATE songs` already in `applyCatalogFill`, run
  whenever `fill` is non-empty **or** links were written, and written in the one
  shape that satisfies both halves of the problem** — the literal
  `'updated_at = now()'` appended to the clause array **inline inside the
  template's interpolation**, with the comma supplied by the join:

  ```
  `UPDATE songs SET ${[...clauses, 'updated_at = now()'].join(', ')} WHERE id = $${n}`
  ```

  An empty `clauses` then yields valid SQL, and the literal still sits textually
  between `UPDATE songs` and `WHERE`, which is what the timestamp guard scans
  for — see ER19 for the measurement of why building the joined list on an
  earlier line fails that guard. No second `UPDATE songs` is added anywhere —
  that would take `EXPECTED_CATALOG_WRITERS` to 5 and fail ER20. The same
  construction is the remedy in `reviewSongEdit`.
  One detail the partition must not lose: `fillFor` (`src/lib/catalogFields.ts:150`)
  hands the links entry back **already `JSON.stringify`-ed** with `cast: '::jsonb'`,
  so partitioning it out of `fill` means `JSON.parse`-ing that string back into a
  `SongLink[]` before it can be applied row-wise to `song_links`, and renumbering
  the surviving entries' `$n` placeholders, which `fill.map((f, i) => … $${i+1})`
  otherwise derives from the unpartitioned index.
- `moderation.ts` `reviewSongEdit` (`src/lib/moderation.ts:91-180`) — partitions
  `links` out of `setClauses` and applies it as a **replace-set** on
  `song_links`, in two statements in this order per *The duplicate-url policy*:
  `DELETE FROM song_links WHERE song_id = $1 AND url <> ALL($2)`, then the insert
  of the `dedupeLinksByUrl`-ed approved array with
  `ON CONFLICT (song_id, url) DO UPDATE SET label = EXCLUDED.label, position = EXCLUDED.position`.
  `DO UPDATE` and not `DO NOTHING`, because an approved correction is
  authoritative over labels and order; the dedupe is what keeps that `DO UPDATE`
  off `21000`, and `parseLinks` does not supply it (`src/lib/songEditPayload.ts:98-103`).

  **`position = EXCLUDED.position` is the whole reason this writer has authority
  over order, and omitting it is this task's likeliest silent failure.** A
  correction that keeps every url and only moves two of them produces a `DELETE`
  that removes nothing and an insert that conflicts on every row; with
  `DO UPDATE SET label` alone, *nothing at all* is written and the approved
  reorder is discarded without an error, while the edit's status still flips to
  `approved`. Measured on the dev database from a three-link song `[uA, uB, uC]`,
  approving `[uC, uA]`: with `label, position` the canonical read order becomes
  `{uC, uA}` — the approved order — and both surviving rows keep their original
  `song_links.id`; with `label` alone it stays `{uA, uC}`, the pre-approval
  order. ER14 carries the reorder case precisely because every other assertion in
  it passes either way.
  Deleting first is what lets a surviving url keep its `song_links.id`, and an
  approved empty array deletes every row, since `url <> ALL('{}')` holds for all
  of them. Two details that break if missed: `setClauses` may now be **empty**
  (a correction proposing only `links`), and the statement
  `src/lib/moderation.ts:149-151` builds today —
  `UPDATE songs SET ${setClauses.join(', ')}, updated_at = now() WHERE …` — is a
  42601 when it is; the remedy is the same inline-array construction as in
  `applyCatalogFill`, keeping one `UPDATE songs` in this file, and the timestamp
  bump must still happen. Also: `reviewSongEdit`'s loop
  (`src/lib/moderation.ts:135-138`) `JSON.stringify`s the links value as it
  pushes it and numbers each placeholder from `values.length + 1`, so
  partitioning `links` out after the loop means parsing that string back and
  renumbering every surviving clause — simpler to partition `fields` (built at
  `:131`) *before* the loop runs.

  **One comment becomes false in this commit and must be rewritten in it.**
  `src/lib/moderation.ts:146-148` reads "`updated_at` belongs to the template,
  never to `setClauses`: that array is the narrowed set of columns a submitted
  edit may propose, and the timestamp is not one of them (RH-101)" — and the
  statement above it stops being built that way. It should say instead that the
  timestamp clause is appended to the proposed-column clauses **inline in the
  template**, so the joined list supplies the comma and an edit proposing only
  `links` (whose clause is partitioned out, leaving none) still produces valid
  SQL; and that the literal must stay between `UPDATE songs` and `WHERE` in the
  source text, because `catalogTimestampGuard`'s scan is textual. The narrowing
  claim itself survives and should be kept: `setClauses` still carries only the
  columns `parseSongEditPayload` admitted, and `updated_at` is still not one of
  them — what changes is where the clause is concatenated, not who may propose
  it. The comment is also the only place a later reader will learn why the
  construction looks indirect, so leaving the old wording would license exactly
  the refactor that reintroduces the 42601.

### The timestamp guard

`src/lib/__tests__/catalogTimestampGuard.test.ts:74` pins
`EXPECTED_CATALOG_WRITERS = 4` — an **exact** count of `UPDATE songs`
statements in production source: **two in `songs.ts`** (`applyCatalogFill` at
`:144` and `applySongLinkUpdate` at `:228`, both verified at HEAD), one in
`spotifyPlaylistSync.ts` (`:140`), one in `moderation.ts` (`:149`). Keep the
total at 4, and keep `songs.ts` at exactly two: a `songs.updated_at` bump stays
in both `applySongLinkUpdate` and `applyCatalogFill` (the latter must now fire
when `fill` is empty but links were written). This is not bookkeeping: a links
change bumping the catalog row's timestamp is the existing convention, and
`catalogTimestamp.db.test.ts` asserts it.

**The three statements this task rewrites do not all take the same shape**, and
conflating them is how a meaningless requirement gets written:

| statement | after this task | shape required |
|---|---|---|
| `songs.ts:144` `applyCatalogFill` | still interpolates a **variable** clause list (`fill` minus the partitioned-out `links`), which may now be empty | the inline-array shape below |
| `moderation.ts:149` `reviewSongEdit` | still interpolates a **variable** clause list (`setClauses` minus the partitioned-out `links`), which may now be empty | the inline-array shape below |
| `songs.ts:228` `applySongLinkUpdate` | `links` leaves the column, so **no variable clause list remains** — it degenerates to a bare timestamp bump | the plain literal `UPDATE songs SET updated_at = now() WHERE id = $1` |

The inline-array shape is only a remedy for an interpolated list that can go
empty. Mandating it for `applySongLinkUpdate`, which has no list to interpolate,
would be a requirement about nothing. The bare bump is clean against the guard —
measured: `findStaleCatalogWrites` on
`'UPDATE songs SET updated_at = now() WHERE id = $1'` reports
`writers=1, violations=[]`.

**The guard is textual, and that dictates the shape of the two statements that
still interpolate a clause list.**
`findStaleCatalogWrites` (`src/lib/__tests__/catalogTimestampGuard.test.ts:102-116`)
does not parse SQL. For each `UPDATE\s+songs` match (`:77`) in the
comment-stripped source it slices from the match index to the next `WHERE`
(`:83`) and requires the literal `updated_at = now()` (`:80`) inside that slice.
Three consequences, all measured by running the detector against each shape:

1. Building the joined clause list on an **earlier line** and interpolating only
   `${setList}` leaves the scanned slice clause-free → reported as a violation →
   **ER20 fails**. Measured: `violations=[{"line":2,"text":"UPDATE songs SET ${setList}"}]`.
2. Keeping the clause as a hard-coded `}, updated_at = now() WHERE` **suffix**
   passes the guard (measured: `violations=[]`), but produces
   `UPDATE songs SET , updated_at = now()` and a 42601 whenever the clause list
   is empty — the case both `applyCatalogFill` and `reviewSongEdit` now reach.
3. The only shape that satisfies both is the literal appended **inline inside
   the interpolation**, `${[...clauses, 'updated_at = now()'].join(', ')}` —
   measured clean against `findStaleCatalogWrites` (`violations=[]`), for the
   same reason the detector's own `TEMPLATED` fixture (`:158`) is accepted: the
   literal lies between `UPDATE songs` and `WHERE` in the *source text*, whether
   it sits inside the interpolation or after it. ER19 states the shape, and
   scopes it to the two statements that interpolate a variable list.

The guard must not be edited, and `EXPECTED_CATALOG_WRITERS` must not move: it
is the project's only protection against a stale catalog `updated_at` (RH-101),
and it exists precisely because there is no timestamp trigger.

### The type

`src/types/database.ts`: add `SongLinkProvider = 'spotify' | 'youtube' | 'other'`
and an **optional** `provider?: SongLinkProvider` to `SongLink`. Optional
matters: `SongLink` is named in **16** non-test files
(`grep -rln 'SongLink\b' src --include='*.ts' --include='*.tsx'` minus the test
paths), **12** of which import it, and several construct bare
`{label, url}` literals (`src/components/songs/RepertoireDashboard.tsx:246`,
`src/hooks/useSongPicker.ts:197`, `src/components/songs/SongForm.tsx:272`,
`src/lib/songs.ts:212`, `src/lib/spotifyPlaylistSync.ts:122`). **Nothing is
removed from `SongLink`, so no reader loses a field and no union narrows** —
this task only adds. One site to re-check by hand:
`SongLinksEditor`'s `updateLink` (`src/components/songs/SongLinksEditor.tsx:23`)
takes `field: keyof SongLink` and assigns a `string` through a computed key into
an `EditableLink` (`:6`, `SongLink & { id?: string }`), so `keyof SongLink` now
includes a literal-union property; narrow that parameter to `'label' | 'url'` if
the compiler objects — `EditableLink` itself is unchanged, since it widens
`SongLink` rather than restating its keys.

### Files touched

- `migrations/<next>_song_links.sql` — table, generated `provider`, backfill, bridge trigger.
- `src/lib/songLinksSql.ts` (new) — the one links aggregate, as a function of the `songs` alias, plus `dedupeLinksByUrl`, the single dedupe helper all four writers call.
- `src/lib/playlistSql.ts` — `:66` reads the aggregate.
- `src/lib/ownerSongRows.ts` — `:62` reads the aggregate.
- `src/lib/moderation.ts` — `:61` reads the aggregate; `reviewSongEdit` applies `links` as a delete-then-upsert replace-set; empty-`setClauses` case; the now-false `:146-148` comment rewritten.
- `src/lib/songIdentity.ts` — `LOOKUP_SQL` / `INSERT_SQL` off the column; create-path links insert.
- `src/lib/songs.ts` — `applySongLinkUpdate` and `applyCatalogFill` onto `song_links`, each with its own conflict policy, both keeping the timestamp bump in the inline-array shape.
- `src/lib/dbRows.ts` — `SongLinksRow`'s doc comment, which quotes the replaced SQL.
- `src/types/database.ts` — `SongLinkProvider`, `SongLink.provider?`.
- `src/components/songs/SongLinksEditor.tsx` — only if `keyof SongLink` fails to compile.
- `src/lib/__tests__/songLinksMigration.db.test.ts` (new) — the replay (ER2–ER7).
- `src/lib/__tests__/songLinksTable.db.test.ts` (new) — the read and song-side-writer round trips: the three migrated reads, `applySongLinkUpdate`, `resolveOrCreateSongIdentity`, `applyCatalogFill`, and the timestamp bumps (ER9, ER11–ER13, ER15, ER16, ER19's runtime half).
- `src/lib/__tests__/songLinksBridge.db.test.ts` (new) — moderation, the bridge trigger and the Spotify import: `reviewSongEdit` as a replace-set, the trigger's insert-only behaviour, and the import's link staying visible (ER14, ER17, ER18).

**The behaviour suite is split in two up front, deliberately.** One file would
have carried roughly twenty DB scenarios against a hard `max-lines` of 800 that
ER24 forbids overriding, and the nearest comparable file,
`songIdentity.db.test.ts`, already spends **611** lines on materially fewer
scenarios. A suite that outgrows the ceiling mid-implementation has no legal
remedy left — the override block is shrink-only — so the split is not a
refactor to reach for later. The seam is the subsystem under test: the song-side
writers in `songs.ts` / `songIdentity.ts` in one file, `moderation.ts` plus the
database-level bridge in the other. Each file carries its own fixtures; no helper
is shared across the two beyond `test-helpers.ts`.
- `src/lib/__tests__/songs.test.ts`, `moderation.test.ts`, `songIdentity.test.ts`, `songIdentity.db.test.ts`, `ownerSongRows.test.ts`, `dbRowTypes.test.ts` — updated for the new SQL.
- `package.json` — version bump (AGENTS.md:523).

**No `eslint.config.mjs` change.** The override block has exactly 14 entries and
is shrink-only. Every file above is well inside its budget and none is pinned:
`songs.ts` 239/400, `songIdentity.ts` 184/400, `moderation.ts` 180/400,
`ownerSongRows.ts` 153/400, `playlistSql.ts` 106/400; tests `songIdentity.db.test.ts`
611/800, `songs.test.ts` 554/800, `moderation.test.ts` 337/800,
`ownerSongRows.test.ts` 149/800, `dbRowTypes.test.ts` 115/800. The one
pinned-exact ceiling in the repo, `src/lib/__tests__/spotify.test.ts` at 678
(`eslint.config.mjs:136`), is not in this set, and `src/lib/ownerSongs.ts` at
400/400 is not edited by this task. New test code goes in the **three** new test
files, not into an existing one.

`max-lines` is not the only budget that binds here. Measured with
`npx eslint src/lib/moderation.ts --rule '{"complexity":["error",1]}'`,
`reviewSongEdit` is already at cyclomatic complexity **13** against the base
ceiling of **15**, and `resolveOrCreateSongIdentity` at **12**. Both gain
branches in this task. ER24 forbids adding an override entry and ER29 pins
`INSERT INTO song_links` to exactly these four files, so if either function
crosses 15 the only legal remedy is to lift a branch into a **file-local
helper** — not a new override, and not a move to another module. Measure both
functions before and after.

### What a musician would lose

The justification's claim that nothing visible is lost is **true only with
`position`**, and that is why the column is in the table. Verified against every
reader of a link:

- `src/components/fastview/LinksSection.tsx:47-89` — renders
  `controller.links` in **array order**, one card each, text
  `link.label || link.url`, `href={link.url}`, keyed
  `` `${link.url}-${idx}` `` (`:49-51`) — **index-suffixed, so a duplicate url
  renders two cards today**.
- `src/components/fastview/AddLinkForm.tsx` — a label input and a url input.
- `src/components/songs/SongLinksEditor.tsx:32-61` — index-keyed label and url
  inputs, in array order.
- `src/components/songs/SongForm.tsx:505-523` — the locked catalog list, keyed
  on `link.url`, text `link.label || link.url`, in array order.

So: no reader reads a field that disappears (none does), and every label and url
of every **distinct** url survives the backfill.

**One visible change is accepted, and it is the duplicate collapse.** Because
`LinksSection`'s key is index-suffixed, a song whose `links` array holds the
same url twice under two labels renders **two cards today** and one after the
backfill — `UNIQUE (song_id, url)` admits a single row, and the lowest-ordinality
label is the one kept, so the second label is discarded. The alternative is to
drop `UNIQUE (song_id, url)`, and that key is what every writer in this task
upserts on; the collapse is the price. Its blast radius is measured, not assumed:
the live dev database holds 21 link elements across 39 songs with **no duplicate
url on any song**, so no musician loses a card today, and `useSongLinks` already
refuses to add one client-side. ER3 asserts the collapse and the kept label
explicitly; ER4's conservation is therefore scoped to urls that are not
duplicated within their song.

**The list order is visible in two places**, and the
justification's "array ordering is replaced by a deterministic order" would have
been a real, if small, regression: backfilling with `created_at = now()` for
every row leaves `(created_at, id)` tie-breaking on a random uuid, scrambling
every song's link list; and going forward, any statement inserting several links
at once — a song-form save with three links through `applyCatalogFill`, a
multi-link submission through `applySongLinkUpdate`, a create through
`resolveOrCreateSongIdentity` — writes rows sharing one `now()` and scrambles
them too. With `position` carrying the array ordinality and the canonical
`ORDER BY position, created_at, id`, the order a musician sees is byte-for-byte
the order they see today, and a newly added link still lands at the end.

The only other thing a musician could have lost is the Spotify link on an import
into an existing catalog row; the bridge trigger keeps it.

### Test criteria

**Three new DB suites, each named in the ER that owns it.** The migration replay
(`songLinksMigration.db.test.ts`), the read and song-side-writer round trips
(`songLinksTable.db.test.ts`) and the moderation / bridge / import behaviour
(`songLinksBridge.db.test.ts`) — split as *Files touched* explains. Every one is
`describe.skipIf(!process.env.RUN_DB_TESTS)`, so every ER naming one demands
`RUN_DB_TESTS=1 npx vitest run <file>` and asserts **0 skipped** as well as 0
failed: `npm run test:coverage` sets no `RUN_DB_TESTS`, so a suite that never
executes would otherwise satisfy its ER by silence.

The migration replay follows `src/lib/__tests__/ownerSongsMigration.db.test.ts`
exactly: resolve the file by its `_song_links.sql` **suffix** through
`migrationSqlBySuffix`, rebuild the pre-migration shape with
**`legacyCatalogReplayDdl(schema)`** (`src/lib/__tests__/test-helpers.ts:541`)
in a throwaway `rh136_<token>` schema put **first on the transaction's
`search_path`**, seed, run the file, assert, and always roll back through
`withTransaction` plus a sentinel throw.

**The local `songs` table is a prerequisite, not a convenience.** Every name in
this migration is unqualified — `REFERENCES songs(id)`, the backfill's
`FROM songs`, `CREATE TRIGGER … ON songs` — and an unqualified name resolves
along the `search_path`. Without a `songs` in the replay schema, all three find
**`public.songs`** and take `ACCESS EXCLUSIVE` on the live catalog inside a long
test transaction: that is the deadlock class
`src/lib/__tests__/ownerSongsMigration.db.test.ts:24-41` measured at "2
occurrences in 24 full runs", with the unqualified-name variant called out at
`:48-56` as verified empirically. It would also fold `public`'s 39 songs and 21
link elements into the backfill ER3 asserts a literal list against.
`legacyCatalogReplayDdl` creates exactly the needed shape —
`${schema}.songs` with `links jsonb NOT NULL DEFAULT '[]'::jsonb` — and nothing
else is substituted for it. (Unlike `ownerSongsMigration`, this replay issues no
unqualified `DROP INDEX`, so no index needs pre-creating in the schema.)

**The generated-column rejection gets its own transaction.** Asserting that
`INSERT INTO song_links (… provider …)` is refused necessarily aborts the
transaction it runs in: measured on the dev database, the insert fails
`428C9: cannot insert a non-DEFAULT value into column "provider"` and the very
next statement in that session returns
`25P02: current transaction is aborted, commands ignored until end of
transaction block` — the trap `src/lib/songIdentity.ts:123-128` documents for
23505. The only in-transaction escape is a savepoint, and
`src/lib/__tests__/transactionGuard.test.ts:27`'s `TX_CONTROL_THROUGH_QUERY`
bans `client.query('ROLLBACK TO SAVEPOINT …')` in every file under `src/`, test
files included (`:13`). So the rejection is **a second scenario in its own
`withTransaction`**, which rebuilds the schema, runs the migration, issues the
offending insert as the **last statement in that transaction**, and lets the
thrown error carry the rollback — no statement follows it, and the ER2–ER6
scenario is left intact. The awkward rows are **seeded**,
not hoped for. The expected `(url, label, provider, order)` for each seeded case
is written as a **literal** expectation, never recomputed from the seed by a
shared helper — a helper with the backfill's own bug agrees with it.

Conservation is the assertion no other replaces: `songs.links` is snapshotted
**before** the file runs and every url and label is accounted for afterwards,
because "the new table has rows" says nothing about whether the old data
arrived.

## Expected Results

- [ ] **ER1** `migrations/` gains exactly one file, whose name ends `_song_links.sql` and whose four-digit prefix keeps the directory unique and contiguous from `0001`; `RUN_DB_TESTS=1 npx vitest run src/lib/__tests__/migrationsSingleSource.test.ts` reports 0 failed and 0 skipped.
- [ ] **ER2** `src/lib/__tests__/songLinksMigration.db.test.ts` exists and replays the migration by its `_song_links.sql` suffix inside a throwaway schema that is **first on the transaction's `search_path`** and whose `songs` table (carrying `links jsonb NOT NULL DEFAULT '[]'::jsonb`) is created by `legacyCatalogReplayDdl` from `src/lib/__tests__/test-helpers.ts` before the migration runs, so no statement in the migration resolves to `public`; every scenario always rolls back. `RUN_DB_TESTS=1 npx vitest run src/lib/__tests__/songLinksMigration.db.test.ts` reports **0 failed AND 0 skipped**, and `public.songs` still holds exactly the row count it held before the run.
- [ ] **ER3** That replay seeds, in one scenario, **one song per case** — two well-formed http(s) `{label,url}` elements; a url with no `http(s)://` prefix; the same url twice with two different labels; a JSON string element; an object with a `label` and no `url`; an empty array — plus **its own separate row** for a `links` value that is not a jsonb array. The migration completes without error and, for each seeded song, the `(url, label)` pairs in `song_links` equal a **literal** expected list — not a list recomputed from the seed — in which the duplicated url appears **once**, carrying the label of its lowest-ordinality occurrence and not the other label; the non-http url is present with its label; and the string element, the url-less object and the non-array value contributed nothing.
- [ ] **ER4** In the same replay, `songs.links` is snapshotted before the migration runs, and afterwards, for every well-formed element of that snapshot **whose url is not duplicated within its own song**, that element's `url` and `label` are present in `song_links` for the same `song_id`; for a duplicated url, exactly one row exists and it carries the lowest-ordinality label. `songs.links` itself is byte-identical to the snapshot for every seeded row.
- [ ] **ER5** Reading each seeded song's `song_links` with `ORDER BY position, created_at, id` returns its urls in exactly the order the seeded jsonb array held them, after the duplicate collapse.
- [ ] **ER6** `provider` is asserted per seeded url, and the hostile hosts are asserted alongside the friendly ones, because a bare-suffix `LIKE '%spotify.com'` passes the friendly set on its own: `spotify` for `https://open.spotify.com/track/1`, `https://spotify.com/x`, `HTTPS://OPEN.SPOTIFY.COM/track/2` and `https://user:pw@spotify.com/x`; `youtube` for `https://youtu.be/abc`, `https://www.youtube.com/watch?v=1` and `https://music.youtube.com/x`; and `other` for **every one** of `https://notspotify.com/x`, `http://NOTYOUTUBE.COM/y`, `https://notyoutu.be/y`, `https://myyoutu.be/x`, `https://www.youtube.com.br/x`, `https://spotify.com@evil.com/x`, `` `https://evil.com\@spotify.com/x` `` (with a literal backslash before the `@`), `https://example.com/youtube.com/x`, `https://evil.com:8080/?x=youtube.com`, `ftp://spotify.com/x`, `https://www.cifraclub.com.br/eagles/hotel-california/`, `https://tabs.ultimate-guitar.com/tab/123` and the non-http url `www.cifraclub.com.br/x`. All 20 are measured against the stated normalisation and predicates. Three distinct mistakes each fail this ER on a specific url, and no other ER catches them: a mapping written as `host LIKE '%spotify.com'` without the leading dot fails on `https://notspotify.com/x`; one that does not lowercase the whole url before extracting the host fails on `HTTPS://OPEN.SPOTIFY.COM/track/2`; and one whose authority class is `[^/?#]*` rather than `[^/?#\\]*` fails on `` `https://evil.com\@spotify.com/x` ``, which it labels `spotify` while a browser would visit `evil.com` (both outcomes measured on the dev database).
- [ ] **ER7** `provider` is generated, not stored by the application, and the assertion runs in **its own `withTransaction`** — a separate scenario that rebuilds the replay schema, runs the migration, and issues an `INSERT INTO song_links` naming `provider` in its column list as the **last statement in that transaction**, which fails with SQLSTATE `428C9`; no statement is issued after it in the same transaction (the transaction is aborted and `25P02` would swallow it), and no savepoint is used, since `src/lib/__tests__/transactionGuard.test.ts` bans transaction control through `query()` in every file under `src/`. `RUN_DB_TESTS=1 npx vitest run src/lib/__tests__/transactionGuard.test.ts` still reports 0 failed.
- [ ] **ER8** Both behaviour suites exist and both run clean: `src/lib/__tests__/songLinksTable.db.test.ts` and `src/lib/__tests__/songLinksBridge.db.test.ts` are present, and each of `RUN_DB_TESTS=1 npx vitest run src/lib/__tests__/songLinksTable.db.test.ts` and `RUN_DB_TESTS=1 npx vitest run src/lib/__tests__/songLinksBridge.db.test.ts` exits 0 reporting **0 failed AND 0 skipped**. Neither file exceeds 800 lines (`wc -l` on each is `<= 800`), and neither appears in `eslint.config.mjs` (see ER24).
- [ ] **ER9** In `songLinksTable.db.test.ts`: for a song whose `songs.links` column is deliberately left `'[]'::jsonb` while `song_links` holds two rows, all three migrated reads return both links — `getPlaylistWithSongs` (through `PLAYLIST_DETAIL_ENTRIES_JSON`), **`getRepertoire`** (`src/lib/ownerSongs.ts:78`, through `ownerSongRows`' `SONG_JSON` and `LEVELS`) and `getPendingSongEdits` (through `moderation.ts`'s projection) — each with the stored `label`, `url` and `provider`, in `position` order.
- [ ] **ER10** `grep -rn "'links', s.links" src --include='*.ts' --include='*.tsx'` returns **0** matches (it returns 3 today: `src/lib/playlistSql.ts:66`, `src/lib/ownerSongRows.ts:62`, `src/lib/moderation.ts:61`), and the links aggregate SQL is spelled in exactly one production file, `src/lib/songLinksSql.ts`.
- [ ] **ER11** Additive round trip, **asserted on read order rather than on raw `position` numbers**: starting from a song whose `song_links` rows were produced by the bridge trigger and therefore carry a **gap** (url `u1` at `position` 1 and url `u2` at `position` 3 — construct it exactly as ER17 does, by inserting the song with `links` = `[u1]` and then updating it to `[u1, u2]`), submitting `[u1, u2, u3]` through `applySongLinkUpdate` returns `{success: true}` with no `pending`, inserts one `song_links` row for `u3` with the submitted label, leaves `u1`'s and `u2`'s `song_links.id` unchanged, **leaves `songs.links` holding exactly the submitted set `[u1, u2, u3]` in canonical read order** (AMENDED in review round 1 — this clause read "leaves `songs.links` unmodified", which the reverse bridge trigger makes false by design: the Spotify push reads that column and an unmodified one makes it send zero uris), and — the discriminating assertion — **reading that song's `song_links` with `ORDER BY position, created_at, id` returns exactly `[u1, u2, u3]`, the submitted array's url order, with the new url last**, and `u3`'s `position` is **strictly greater** than every other row's for that song. Measured: with the mandated `ON CONFLICT (song_id, url) DO UPDATE SET label = EXCLUDED.label, position = EXCLUDED.position` the positions become 1, 2, 3 and both assertions hold; with `DO UPDATE SET label` alone the survivors keep 1 and 3 while `u3` is given 3, so `u3` is **tied** with `u2`, "strictly greater" is false, and the canonical order breaks the tie on a random uuid.
- [ ] **ER12** Label rewrite preserved **and a duplicated url does not abort the write**, both through `applySongLinkUpdate`: (a) submitting the same urls with a changed label on one of them is still additive and the stored `label` for that url changes; (b) submitting an array that holds the **same url twice under two different labels** returns `{success: true}` with no `pending`, leaves exactly **one** `song_links` row for that url carrying the **first** occurrence's label, and raises neither 23505 nor 21000. (b) fails against the naive implementation: `ON CONFLICT (song_id, url) DO UPDATE SET label = …` without the dedupe raises `21000 ON CONFLICT DO UPDATE command cannot affect row a second time` (measured), and a bare insert raises `23505`.
- [ ] **ER13** Non-additive round trip: submitting an array with one existing url removed returns `{success: true, pending: true}`, inserts a `global_song_edits` row, and changes neither the `song_links` row count nor any row's `id`.
- [ ] **ER14** In `songLinksBridge.db.test.ts`: approving a links correction through `reviewSongEdit` applies it as a replace-set: the removed url's `song_links` row is gone, each surviving url keeps the same `song_links.id` it had before, and the edit row's status is `approved`. Asserted also for (a) a correction proposing **only** `links`, which must not produce a SQL syntax error (42601) and must still bump `songs.updated_at`; (b) an approved array holding the **same url twice under two different labels**, which completes without 23505 or 21000, leaves exactly one row for that url carrying the first occurrence's label, and still sets the edit's status to `approved` — `parseLinks` (`src/lib/songEditPayload.ts:98-103`) admits such an array, so this case is reachable from the correction modal; (c) an approved **empty** links array, which leaves that song zero `song_links` rows; and (d) — **the case that proves `reviewSongEdit` really has authority over order** — a song whose `song_links` holds three urls `[uA, uB, uC]` in that canonical order, against which an approved array **reorders two surviving urls and drops the third**, `[uC, uA]`: after the approval, reading that song's `song_links` with `ORDER BY position, created_at, id` returns exactly `[uC, uA]` — the approved array's url order, not the pre-approval order — `uB`'s row is gone, and `uA`'s and `uC`'s `song_links.id` are both unchanged. Measured on the dev database: with the mandated `ON CONFLICT (song_id, url) DO UPDATE SET label = EXCLUDED.label, position = EXCLUDED.position` the read order is `[uC, uA]`; with `DO UPDATE SET label` alone it stays `[uA, uC]` and the approved reorder is silently discarded while every other assertion in this ER still passes — which is why (d) is not optional.
- [ ] **ER15** `resolveOrCreateSongIdentity` on a **created** row writes its input links to `song_links` in input order and returns them; on a **found** row it writes nothing and returns that row's current `song_links` contents. An input array holding the same url twice resolves without error and yields **one** row carrying the first occurrence's label — the insert must raise neither 23505 nor 21000 and must not abort the caller's transaction, asserted by issuing a further successful statement on that same transaction client after the call returns.
- [ ] **ER16** `applyCatalogFill` decides against `song_links`, not the column: for a song whose `songs.links` is `'[]'::jsonb` while `song_links` holds one row, a save proposing a different link comes back in `refused` (it does not silently fill), and for a song with no links at all the proposed links land as `song_links` rows and are returned by `getRepertoire` (`src/lib/ownerSongs.ts:78`). **And a duplicated url does not destroy the save:** a song-form save through `updateSong` (`src/lib/ownerSongs.ts:359-372`) for a song with no links, proposing an array that holds the **same url twice under two different labels**, resolves without throwing, leaves exactly one `song_links` row for that url with the first occurrence's label, **and the owner-row half of the same transaction is committed** — the entry's `status` from that same save is readable afterwards. Against a naive implementation this case throws `Failed to update song: …` with 23505 or 21000 and the owner row is unchanged, which is the musician losing the whole edit.
- [ ] **ER17** Bridge trigger, in `songLinksBridge.db.test.ts`, with **all five cases**, because the first two are the only ones that catch an uncoalesced `position` expression and neither is reachable through the other three:
  - **(a) `AFTER INSERT` on a song with no `song_links` rows.** `INSERT INTO songs (title, artist, standard_key, links) VALUES (…)` carrying a **non-empty** two-element `links` array — the shape `scripts/seed-catalog.sql:20` uses — completes **without error** and leaves exactly two `song_links` rows for that song with `position` **1** and **2**. Against a trigger whose body reads `max(position) + ordinality` without `COALESCE`, this raises `23502 null value in column "position" of relation "song_links" violates not-null constraint` (measured on the dev database), so a fresh `docker compose` database would come up with an empty catalog.
  - **(b) `AFTER UPDATE` on a song with zero `song_links` rows** — the found-song append shape of `findOrCreateSong` (`src/lib/spotifyPlaylistSync.ts:140`), whose `song.links.some(...)` guard at `:139` is `false` for an empty array, making this the ordinary case for a catalog song without links. Insert the song with `links = '[]'::jsonb` (asserting its `song_links` row count is **0**), then `UPDATE songs SET links = '[{"label":"Track Title","url":"<a spotify url>"}]'::jsonb`: it completes **without error** and leaves exactly one `song_links` row at `position` **1**. Uncoalesced, this raises `23502` too (measured) and the Spotify import dies mid-transaction.
  - **(c) Append to a song that already has rows.** An `UPDATE songs SET links = <array containing the urls already in song_links plus one new url>` inserts exactly one row, leaves every existing row's `id` and `label` untouched, and gives the new row a `position` strictly greater than every existing one — a **gap** is expected and acceptable (measured: `max` 2 + ordinality 3 = **5**), which is why `position` is not unique.
  - **(d) Idempotence.** Running the identical `UPDATE` from (c) again inserts nothing and changes no row's `id` or `label`.
  - **(e) Empty array.** `UPDATE songs SET links = '[]'::jsonb` inserts nothing **and deletes nothing** — the trigger is insert-only — which is what makes ER9's and ER16's empty-column fixtures constructible.
  Additionally, the migration file contains **no `WHEN (OLD.`** clause on any trigger it creates — a `WHEN` referencing `OLD` on a trigger that also fires `AFTER INSERT` fails at creation with `42P17` and would abort the whole migration — so the changed-value test is in the function body; and `grep -c 'COALESCE' ` on the migration file's trigger function body shows the `position` expression is coalesced.
- [ ] **ER18** Spotify import keeps its link visible: importing a track through `findOrCreateSong` for a song already in the catalog that does not yet hold that Spotify url leaves the url present in `song_links` with `provider = 'spotify'`, asserted without editing `src/lib/spotifyPlaylistSync.ts`.
- [ ] **ER19** A links write still bumps the catalog timestamp, and the **count** of `UPDATE songs` statements is unchanged. Runtime half, in `songLinksTable.db.test.ts`: `songs.updated_at` read before and after an additive `applySongLinkUpdate`, and before and after an `applyCatalogFill` whose **only** written field is `links` (so its `fill` list is empty), is strictly greater afterwards in both cases.

  Static half: **no `UPDATE songs` statement is added or removed anywhere.** `src/lib/songs.ts` still holds exactly **two** (it holds two today, at `:144` in `applyCatalogFill` and `:228` in `applySongLinkUpdate`), `src/lib/moderation.ts` still holds exactly **one**, `src/lib/spotifyPlaylistSync.ts` still holds exactly **one**, and the repo-wide total `countCatalogWrites` sees stays at **4**, matching `EXPECTED_CATALOG_WRITERS` (ER20).

  The three rewritten statements take **two different shapes**, each required of the specific statements that need it:
  - The **two statements that interpolate a variable clause list** — `applyCatalogFill` (`src/lib/songs.ts:144`, interpolating `fill` minus the partitioned-out `links`) and `reviewSongEdit` (`src/lib/moderation.ts:149`, interpolating `setClauses` minus the partitioned-out `links`) — are each written with the literal `'updated_at = now()'` appended to the clause array **inline inside the template's interpolation**, so the comma comes from the join and the literal still sits textually between `UPDATE songs` and the template's `WHERE`: `` `UPDATE songs SET ${[...clauses, 'updated_at = now()'].join(', ')} WHERE id = $${n}` ``. Only this shape satisfies both constraints, measured by running `findStaleCatalogWrites` (`src/lib/__tests__/catalogTimestampGuard.test.ts:102-116`) against each candidate: it is a **textual** scan that slices comment-stripped source from each `UPDATE\s+songs` match (`:77`) to the next `WHERE` (`:83`) and requires the literal `updated_at = now()` (`:80`) inside that slice — so building the joined list on an **earlier line** and interpolating only `${setList}` leaves the slice clause-free and is reported as a violation (measured: `violations=[{"line":2,"text":"UPDATE songs SET ${setList}"}]`), failing ER20; while keeping the clause as a hard-coded `}, updated_at = now() WHERE` **suffix** — what `src/lib/moderation.ts:149-151` does today — passes the guard but yields `UPDATE songs SET , updated_at = now()` and a 42601 the moment the clause list is empty, the case ER14(a) and this ER both require to work. The inline form measures clean (`violations=[]`).
  - `applySongLinkUpdate`'s statement (`src/lib/songs.ts:228`) is **not** written in that shape, because after this task it has **no variable clause list at all**: `links` leaves the column, so the statement degenerates to the plain literal `UPDATE songs SET updated_at = now() WHERE id = $1`. That form is clean against the guard — measured: `findStaleCatalogWrites` on it reports `writers=1, violations=[]` — and mandating the clause-array interpolation for a statement with no clauses to interpolate would be a requirement about nothing.

  ER20 must not be met by editing the guard or moving `EXPECTED_CATALOG_WRITERS`.
- [ ] **ER20** `npx vitest run src/lib/__tests__/catalogTimestampGuard.test.ts` passes with `EXPECTED_CATALOG_WRITERS` still **4** at `src/lib/__tests__/catalogTimestampGuard.test.ts:74` — neither lowered nor raised.
- [ ] **ER21** `src/types/database.ts` exports `SongLinkProvider` as `'spotify' | 'youtube' | 'other'`, `SongLink` declares `provider?: SongLinkProvider`, and `SongLink`'s `label: string` and `url: string` are unchanged; nothing is removed from `SongLink`, from `CATALOG_COLUMNS` or from `RefusableCatalogColumn`.
- [ ] **ER22** `npx tsc --noEmit` exits 0.
- [ ] **ER23** The forbidden files are untouched, checked against the commit rather than the working tree (which may carry another task's changes): `git show --name-only --format= HEAD` lists **none** of `src/lib/catalogFields.ts`, `src/lib/spotifyPlaylistSync.ts`, `src/app/api/spotify/playlists/[id]/sync/route.ts`, and lists **no** `migrations/` path whose four-digit prefix is `0018` or lower. Run exactly `git show --name-only --format= HEAD | grep -E 'catalogFields\.ts|spotifyPlaylistSync\.ts|playlists/\[id\]/sync/route\.ts|^migrations/00(0[1-9]|1[0-8])_'` and expect **no output** (exit status 1).
- [ ] **ER24** `npx vitest run src/lib/__tests__/complexityBudget.test.ts` passes, and the block between `// BEGIN:complexity-budget-overrides` and `// END:complexity-budget-overrides` in `eslint.config.mjs` still holds exactly **14** entries, **none added and no ceiling raised** — the list is shrink-only, so no new test file may claim an override. The two pinned-exact ceilings, `src/lib/__tests__/spotify.test.ts` at 678 (`eslint.config.mjs:136`) and `src/lib/ownerSongs.ts` at 400, are unedited by this task and their files' line counts are unchanged.
- [ ] **ER25** `npm run lint` exits **0**, reporting **0 errors and 0 warnings** across the whole repository — not `src` only — including every file this task adds. This is unconditional: the repo is at zero as of RH-129 (`5260bf9`), `npm run lint` is `eslint . --max-warnings=0`, and the `Lint (eslint)` CI job fails on a single warning, so any non-zero count is a failure with no baseline to fall back on. **Run it unwrapped**: an output-filtering shell wrapper (`rtk`) can mask the exit code and the counts, so invoke it as `/bin/zsh -f -c 'cd <repo> && /usr/bin/env npm run lint'` and check the exit status, which must be 0 with no `problem`/`error`/`warning` line in the output.
- [ ] **ER26** `RUN_DB_TESTS=1 npm run test:coverage` passes its enforced thresholds (statements 80, branches 65, functions 78, lines 80) and reports **0 failed**, with the **only** skipped test in the whole run being the single known `src/lib/__tests__/pwaShell.test.ts` skip — that file carries three `it.runIf(swExists)` (`:191`, `:199`, `:204`) and one complementary `it.skipIf(swExists)` (`:216`), so exactly one branch always skips and the repo can never reach a global 0 (measured on that file alone: `13 passed | 1 skipped`). In particular **no `*.db.test.ts` suite is skipped**: every `*.db.test.ts` file is `describe.skipIf(!process.env.RUN_DB_TESTS)`, so a suite whose body never executes would otherwise satisfy its own ER by silence. Verify by confirming that every skipped test in the run is in `pwaShell.test.ts` and that the skipped count is **1** when `public/sw.js` exists in the tree and **3** when it does not — `public/sw.js` is a gitignored artefact of `npm run build`, so `swExists` decides which branch of that file skips, and pinning the count to 1 unconditionally would fail a correct implementation on a tree where the service worker was never built; any skip in `songLinksMigration.db.test.ts`, `songLinksTable.db.test.ts` or `songLinksBridge.db.test.ts` fails this ER.
- [ ] **ER27** `npm run lint:dead` and `npm run lint:dup` pass — `src/lib/songLinksSql.ts` is imported by all three readers, and no copy of the links aggregate is duplicated.
- [ ] **ER28** `package.json`'s `version` at `HEAD` is a patch bump carrying a fresh `YYYYMMDDHHmm` suffix, and is strictly greater than the version at `HEAD~1` and than every version reachable in history (`AGENTS.md:523`). Verify: `git show HEAD:package.json` and `git show HEAD~1:package.json` differ in `version`, the `HEAD` value sorts above the `HEAD~1` value, and `git log -p --all -- package.json | grep '"version"' | sort -V | tail -1` yields the `HEAD` value.

- [ ] **ER29** No link writer is left on the naive form, checked statically over production source (`src --include='*.ts'`, `__tests__` paths excluded): `INSERT INTO song_links` occurs exactly **4** times — once in `src/lib/songIdentity.ts`, twice in `src/lib/songs.ts`, once in `src/lib/moderation.ts` — and `ON CONFLICT (song_id, url)` occurs exactly **4** times across the same files, so every one of those inserts carries a policy and none is bare. `dedupeLinksByUrl` is **defined once**, in `src/lib/songLinksSql.ts`, and **called in exactly those four files**; `grep -rln 'dedupeLinksByUrl' src --include='*.ts' | grep -v __tests__` lists exactly `src/lib/songLinksSql.ts`, `src/lib/songIdentity.ts`, `src/lib/songs.ts`, `src/lib/moderation.ts`. `src/lib/songLinksSql.ts` contains no `'use server'` directive, and is not under `src/app/actions/`. **And the two order-authoritative policies carry their `position` clause:** over the same production source, `position = EXCLUDED.position` occurs exactly **2** times — once in `src/lib/songs.ts` (`applySongLinkUpdate`) and once in `src/lib/moderation.ts` (`reviewSongEdit`) — and **0** times in `src/lib/songIdentity.ts`, whose policy is `DO NOTHING`. A count of 0 or 1 means a `DO UPDATE` writer was left without authority over order, which ER11 and ER14(d) then fail at runtime.
- [ ] **ER30** The convention comment that this change falsifies is rewritten in the same commit: `grep -n "belongs to the template, never to \`setClauses\`" src/lib/moderation.ts` returns **0** matches, and the comment immediately above the `UPDATE songs` template in `reviewSongEdit` states, in English, (a) that the timestamp clause is appended to the proposed-column clauses **inline inside the template's interpolation** so an edit proposing only `links` still produces valid SQL rather than a 42601, and (b) that the literal must stay between `UPDATE songs` and `WHERE` in the source text because `catalogTimestampGuard`'s scan is textual. No `console.error` is introduced in any catch body (`AGENTS.md:260`); `logger` stays the only reporter.
- [ ] **ER31** No outbound HTTP request is made inside the mandated transaction. In `src/lib/songs.ts`, every `fetchUrlTitle` call site in `applySongLinkUpdate` lies **textually before** the `withTransaction(` call that wraps the `song_links` read, upsert and timestamp bump: `grep -n 'fetchUrlTitle\|withTransaction' src/lib/songs.ts` shows every `fetchUrlTitle` line number lower than the `withTransaction` line number inside that function, and no `fetchUrlTitle` appears between the `withTransaction(` line and its closing. The transaction therefore never spans a network round trip to a musician-chosen host, which would pin a pool connection and hold the `songs` row's locks for the fetcher's timeout, once per blank-labelled link. (Today's loop at `src/lib/songs.ts:208-217` already sits before any write; this ER only forbids moving it inward.)

## Out of Scope

- Dropping `songs.links`, and dropping the bridge trigger with it. Owned by the
  part that removes the last reader — after RH-137 has moved the two Spotify
  sites and RH-138 has taken `links` out of `CATALOG_COLUMNS`.
- Keying the Spotify push and import off `provider` (RH-137).
- Per-row accept/reject on a links correction (RH-138).
- `catalog_suggestions` and any pending/status concept on a link (RH-107, RH-111).
- Reordering links from the UI. `position` exists to preserve today's order, not
  to expose a new control.

# RH-108 — Merge the catalog and Spotify search results into one list

Spec file is `docs/tasks/RH-109-spec.md` (board id + 1).

`blockedBy: ["RH-122"]`, which is **done**.

## The title misleads — read this before anything else

**There is no pair of lists to merge. There never was.** The first revision of this spec took the
task title at its word and specified "one list in place of two sections". Spec review refuted it
from the tree, and the refutation holds:

- `src/components/playlists/SongPicker.tsx:37-87` renders **one** `<ul aria-live="polite">`. Inside
  it, `picker.catalogResults.map(...)` is followed directly by `picker.spotifyResults.map(...)`,
  both emitting the same `PickerRow` component. There are **no section headings** and no second
  container. The empty state is one `<li>No results</li>`, shown when
  `catalogResults.length === 0 && spotifyResults.length === 0`.
- `src/components/songs/RepertoireDashboard.tsx:489` is the same shape, under the literal source
  comment `{/* Flat list: catalog first, then Spotify */}` — one `<ul aria-live="polite">`, its
  `visibleCatalogResults` rows then its `visibleSpotifyResults` rows, through `SongResultItem`.

The list is already one. **The real defect is that one song occupies two rows in it.** A search for
`bad` returns the catalog's `"Bad"` and Spotify's `"Bad - Remaster 2012"` as two adjacent,
near-identical rows with nothing saying which to press, because the dedup key —
`pickerDedupKey` in `src/lib/songPicker.ts` — is
`` `${title.toLowerCase()}|${artist.toLowerCase()}` `` over the **raw** title. `"bad - remaster
2012"` is not `"bad"`, so `visiblePickerSpotify` does not filter the Spotify row out.

So the deliverable is: **collapse the duplicate rows for one song into a single row, inside the one
list that already exists, and carry every version both sources offered on that row** so RH-112 can
expand it. Nothing in this task creates a list, deletes a section or re-lays-out the panel.

## Facts read from the tree

Read on 2026-10-07; every name below was grepped for, not recalled.

- The catalog is `songs` / `albums` / `song_versions` (RH-122). `albums.album_type` is
  `NOT NULL DEFAULT 'album'` over the closed domain `('album','single','compilation')`;
  `albums.release_date` is a nullable `date` (`migrations/0014`). `song_versions.album_id` is
  nullable, so a version may have no album and therefore no type and no date.
- `representativeVersionOrder(version, album)` (`src/lib/songVersions.ts`) is the one place the
  representative sort exists: `album_type = 'album'` DESC NULLS LAST, then `release_date` ASC NULLS
  LAST, then `song_versions.created_at` ASC, then `id` ASC.
  `representativeVersionSubquery(songIdSql)` wraps it as a scalar subquery.
- **Catalog search** is `searchSongs(queryStr)` in `src/lib/songs.ts` (196 lines, **no** complexity
  override): `SELECT s.*, <representativeVersionSubquery> AS version_id FROM songs s WHERE s.title
  ILIKE $1 OR s.artist ILIKE $1 ORDER BY s.title ASC LIMIT 20`, reached through `searchSongsAction`
  (`src/app/actions/repertoire.ts`) bundled as `SONG_PICKER_ACTIONS.searchCatalog`
  (`src/app/songPickerActions.ts`). **Its `LIMIT 20` already counts songs, not versions** —
  `docs/plans/repertoire-rework.md`'s note that the limit "currently caps versions" is stale,
  written before RH-122. This task must not "fix" it.
- **Spotify search** is `searchSpotify(query)` in `src/lib/spotify.ts` — a client `fetch` of
  `/api/spotify/search?q=`, not a Server Action — returning `[]` for a query under 2 characters and
  `[]` on any non-ok response or throw. `src/app/api/spotify/search/route.ts` authenticates with
  `getRequiredUserId`, then uses **app-level client credentials** (`SPOTIFY_CLIENT_ID` /
  `SPOTIFY_CLIENT_SECRET`), **not** the signed-in user's OAuth connection. It returns `401` when
  unauthenticated, `400` when `q` is missing or blank, `200 []` when `SPOTIFY_CLIENT_ID` is unset,
  and `200 []` on any upstream failure after `logger.error('[spotify/search]', …)`. It reduces the
  credit list with `primarySpotifyArtist(item.artists)` and projects `limit=8` tracks.
- `interface SpotifyTrack` is declared **twice** with identical bodies — `src/lib/spotify.ts` and
  `src/app/api/spotify/search/route.ts`. Nothing imports the route's copy.
- **The consumers.** The picker is `useSongPicker` (`src/hooks/useSongPicker.ts`, 234 lines) over
  `src/lib/songPicker.ts` (164 lines), rendered by `SongPicker.tsx` (90 lines) through
  `src/components/playlists/PickerRow.tsx`, whose props are exactly
  `{ coverUrl, title, artist, album, adding, error, onAdd }` and which emits a `<li>` carrying a
  button named exactly `Add`. None of those four files carries a complexity override.
  `RepertoireDashboard.tsx` holds the same split state and its own raw-title dedup at lines
  **186-213**, renders through its own `SongResultItem`, and **is pinned at its ceiling**
  (`complexity 17`, `max-lines-per-function 525`, `max-lines 578`). See §Out of Scope.
- `src/lib/songTitle.ts` (`splitSongTitle`) has **no imports at all** and is client-safe.
  `src/lib/songIdentity.ts` imports `pool` from `@/lib/db` and is therefore **server-only**:
  `primaryArtistName`, `primarySpotifyArtist` and `songIdentityOf` cannot be imported for their
  values from client code, and `src/lib/__tests__/namingConventions.test.ts` fails the run if they
  are. Nothing here moves them.
- The override list between the `BEGIN:/END:complexity-budget-overrides` markers in
  `eslint.config.mjs` holds **14 entries** against `MAX_OVERRIDES = 17` in
  `src/lib/__tests__/complexityBudget.test.ts`. It is a ratchet that may only shrink:
  **no expected result below permits adding an entry or raising a ceiling.**
- **No migration.** Nothing here changes the schema, so
  `src/lib/__tests__/migrationsSingleSource.test.ts` (prefixes unique and contiguous from `0001`)
  is not engaged and no prefix is quoted.
- **The e2e locator survives this task, and this is settled, not assumed.**
  `e2e/offline-mode.spec.ts:99-101` locates a picker row as
  `page.locator('ul[aria-live="polite"]').getByRole('listitem').filter({ hasText: title })` and
  clicks `getByRole('button', { name: 'Add', exact: true })`. That `<ul>` is already the single
  container this task keeps, `PickerRow` still emits a `<li>` with an `Add` button, and no other
  `aria-live` list exists on `/playlists/[id]`. The filter is by **text**, not by row id, so the
  new row-id scheme (§2) does not reach it. CI runs these: `npm run test:e2e`,
  `.github/workflows/ci.yml:70`.

## Scope

One search produces **one row per song**, each row carrying every version candidate both sources
offered for it, inside the flat list that already exists.

1. A new client-safe module, `src/lib/songSearchMerge.ts`, holding the whole merge as two exports:
   `mergeSongSearchResults(catalog, tracks)` and `withoutHeldVersions(rows, playlistVersionIds)`
   (§3 — the two are separate because the merge is a function of the search response alone and the
   filter is a function of the playlist).
2. `searchSongs` returns, per song, the **full ordered list of its versions** with the fields the
   merge needs, alongside the `version_id` it already returns.
3. `/api/spotify/search` and `SpotifyTrack` carry the album's `album_type` and `release_date`, so
   a Spotify candidate can be ordered against a catalog one at all.
4. `useSongPicker` exposes one `results` array of merged rows in place of `catalogResults` /
   `spotifyResults`; `SongPicker.tsx` maps that one array into the existing `<ul>`; `PickerRow`
   gains the props the merged row needs (§6).

**This task writes nothing to the database and adds no migration.** The add path is untouched: a
row's `Add` still runs the existing `addToRepertoire` / `createAndAddSong` →
`resolveOrCreateSongIdentity` → `upsertAlbumAndVersion` chain. That matters for §1: a wrong
grouping here is a wrong *list*, never a wrong *row*.

## Approach

### Behavior

#### 1. The identity rule, and what it costs when it is wrong

A **row names a song**, not a version. Given RH-122 that is the only answer that works: two takes
of one song by one artist are one `songs` row with two `song_versions`, so a list keyed by
recording shows the same song three times with nothing to tell the three apart.

The group key is the lowercased, trimmed catalog identity pair — **split title, then artist** —
derived identically from both sources:

- the title half is `splitSongTitle(title).title`, lowercased and trimmed. On a catalog row this is
  a deliberate no-op in the normal case (`resolveOrCreateSongIdentity` already stored the left
  half) and it is the entire point for a Spotify row, whose `"Bad - Remaster 2012"` must land on
  the catalog's `"Bad"`. **This single change is what collapses the duplicate row.** It also
  rescues a `songs` row written outside that resolver — `scripts/seed-catalog.sql` inserts directly
  — whose title may still carry a `" - "`.
- the artist half is the source's `artist`, lowercased and trimmed, and is **not** re-reduced by
  `primaryArtistName`. Both sources already deliver a reduced primary artist by construction
  (`resolveOrCreateSongIdentity` stores `primaryArtistName(...)`; the route applies
  `primarySpotifyArtist`). Re-reducing here would be a second copy of the RH-95 rule in a second
  module — the exact defect RH-95 removed — and it cannot be imported anyway, because
  `songIdentity.ts` is server-only and this module must stay client-safe.

Matching is exact equality after that normalisation. No fuzzy matching, no similarity score, no
edit distance — those are RH-113's.

**Missed merge** is the chosen error, in both of its forms:

- *Two rows for one song* — the artist halves differ, e.g. a seeded catalog row reading
  `"Earth, Wind & Fire"` against Spotify's `"Earth"`. Cost: the duplicate row this task set out to
  remove survives in that case. The user presses either; pressing the Spotify one creates a second
  `songs` row through the unchanged add path, for which the admin merge screen (a later work item
  in `docs/plans/repertoire-rework.md`) is the remedy.
- *Two candidates for one recording* — inside one row, the album **names** differ (`"Bad"` against
  `"Bad (Remastered)"`), because a catalog version holds an `album_id` while Spotify hands back a
  name as text. This is the assumption recorded as **Open** under *Search for a song* in
  `docs/use-cases.md`; this task adopts it as the rule (see ER27). Cost: one extra candidate in the
  version list, invisible until RH-112 renders it.

**False merge** (two different things collapsed) is the expensive error everywhere else in this
plan — a catalog row has no delete path, and removing from `songs` / `song_versions` is
admin-master only — but **not here, because this task writes nothing.** A false merge at search
time hides nothing: the row retains *every* candidate from both sources, so the alternative stays
pressable, and the only visible damage is two songs sharing one title line until the query is
refined. That asymmetry is why the display rule may be as aggressive as the write rule and no more.

#### 2. What a row and a candidate carry

**A row** carries: `id`, `title`, `artist`, `coverUrl`, `album`, `songId`, and an ordered
`versions` array which is **non-empty except in the one case §2a defines**.

- **`id` is the group key itself** (e.g. `"bad|michael jackson"`). It is unique per row by
  construction — it is what the rows were grouped by — and stable across renders for a fixed
  query, which is what `SongPicker`'s React `key`, `picker.addingId === row.id` and
  `picker.rowErrors[row.id]` all require. It replaces today's `song.id` / `track.id` keying, under
  which a catalog row and a Spotify row for the same song had two different ids and therefore two
  independent error slots.
- `title` and `artist` are the catalog row's when the row has one, so the catalog's spelling wins
  over Spotify's; otherwise the first candidate's.
- `coverUrl` is the first non-null `coverUrl` among the candidates in their sorted order,
  **falling back to the catalog row's `songs.cover_url`** and then `null`. The fallback is not
  decoration: a candidate's `coverUrl` comes from `albums.cover_url` (§9), and
  `song_versions.album_id` is nullable, so a catalog song whose every version is album-less has no
  candidate cover at all — while `SongPicker.tsx:60` renders `coverUrl={song.cover_url}` for it
  today. Without the fallback that row silently loses its thumbnail. `songs.cover_url` is already
  in hand: `searchSongs` selects `s.*`, and `CatalogSearchResult extends Song`, which declares
  `cover_url: string | null`. Pinned in both directions by ER15.
- `album` is `versions[0].albumName`, falling back to the catalog row's legacy `songs.album` text
  column and then `null` — the same shape and the same reason as `coverUrl` above: a catalog
  version with no `album_id` has no `albumName` while its `songs` row may still carry the text, and
  `PickerRow` renders that line today.
- `songId: string | null` is non-null exactly when the row has at least one catalog candidate
  **or came from a catalog hit with no versions at all** (§2a).

#### 2a. A catalog song with zero versions

This is the one row with an empty `versions` array, and it is a real input rather than a defensive
branch: `scripts/seed-catalog.sql` inserts into `songs` and never into `song_versions`, so a seeded
song has none until `ensureSongHasVersion` gives it one. `src/lib/songPicker.ts:51` keeps such a
song explicitly today (`!song.version_id || !playlistVersionIds.has(song.version_id)`), and
`heldPickerVersionId`'s doc comment names the case. **It renders in the picker at HEAD, so dropping
it would delete a row a musician can see.**

The rule, which every other section is written against:

- the row **is produced**, with `songId` non-null, `versions: []`, and `title`, `artist`, `album`
  and `coverUrl` taken from the `songs` row (which is exactly where the two fallbacks above read
  from);
- it is a **catalog-backed** row for §5's row ordering — `songId !== null` — and its step-4
  tiebreak uses `songId`, never `versions[0]`, so nothing indexes an empty array. §5 states the
  tiebreak in that form for this reason;
- `addRow` takes the **catalog branch** for it: empty `versions` means `addToRepertoire(row.songId)`
  and never `createAndAddSong`. That is HEAD's behaviour unchanged — `addSongToRepertoire` is what
  gives such a song its first `song_versions` row, as `heldPickerVersionId` already documents.

Pinned by ER12.

**A candidate** carries `versionId: string | null`, `spotifyTrackId: string | null`, `rawTitle`,
`albumName: string | null`, `albumType: string | null`, `releaseDate: string | null`
(`YYYY-MM-DD`, or Spotify's shorter `YYYY` / `YYYY-MM` prefix), `label: string | null`,
`durationSeconds: number | null`, `createdAt: string | null` (catalog only),
`coverUrl: string | null` and `spotifyUrl: string | null`.

**A candidate is a recording, so one candidate may carry both ids.** This is the second half of
the collapse and it is easy to miss: grouping rows by song is not enough: if the catalog and
Spotify both describe the *same recording*, that recording must be **one** candidate holding
`versionId` **and** `spotifyTrackId`, not two candidates side by side. Otherwise RH-112's expanded
card lists the same recording twice and the add path has two ways to reach one
`song_versions` row. Consequently `source` is **not** a stored field — it is derived,
`versionId !== null ? 'catalog' : 'spotify'` — and a collapsed candidate is therefore a *catalog*
candidate, which is what makes `addRow` prefer the cheap branch (§6). A collapsed candidate's
`coverUrl` is the catalog's when non-null and Spotify's otherwise; its `rawTitle`, `albumName`,
`albumType` and `releaseDate` are the catalog's; its `spotifyUrl` and `spotifyTrackId` come from
the Spotify side, so nothing of either is lost.

**The recording-level key is `(lower(trim(albumName)), lower(trim(label)))`**, with `null` and
`''` both normalising to the empty string. For that to be well-defined on both sides, the
candidate's `label` must be derived the same way RH-122 derives `song_versions.label`:

- a **catalog** candidate's `label` is `song_versions.label`, read straight from the row;
- a **Spotify** candidate's `label` is `splitSongTitle(rawTitle).label` — the right half of the
  very same split whose left half produced the group key. One parse, both keys, exactly as
  `songIdentityOf` does for the write path. Spotify ships no label field; the suffix *is* the
  label.

**The dedup collapses at most one catalog and one Spotify candidate per key.** Two candidates of
the *same* provider sharing a key are **both kept**, never folded into each other: two Spotify
tracks both titled `"Bad"` on album `"Bad"` both key as `("bad", "")` and remain two candidates.
A global keep-the-first dedup would make the output depend on input order, which would contradict
§5's totality claim and make ER16's shuffle assertion flaky. Collapsing across providers is
well-defined because each side contributes at most one id.

So Spotify's `"Bad - Remaster 2012"` on album `"Bad"` keys as `("bad", "remaster 2012")` and
collapses onto a catalog version of album `"Bad"` labelled `"Remaster 2012"`, while an unsuffixed
`"Bad"` on album `"Bad"` keys as `("bad", "")` and collapses onto the unlabelled studio version.
Pinned by ER2 and ER7.

**Every field on the candidate exists to be threaded into `createAndAddSong`, and all five of its
arguments must be accounted for.** At HEAD `useSongPicker.ts:166-172` passes exactly five:

| `createAndAddSong` argument | fed from | why it must not be dropped |
| --- | --- | --- |
| `title` | candidate `rawTitle` | **the unsplit source title.** `splitSongTitle` runs inside `resolveOrCreateSongIdentity` and hands the right half to `upsertAlbumAndVersion` as `song_versions.label`. Passing the row's *split* display title would write `label: null` for `"Bad - Remaster 2012"` — precisely the stripping RH-122 existed to stop. |
| `artist` | row `artist` | the identity's other half. |
| `album` | candidate `albumName` | `resolveOrCreateSongIdentity` stores it on `songs.album` and `upsertAlbum` keys `albums` on `(lower(artist), lower(name))`. Dropping it writes the version album-less. |
| `cover_url` | candidate `coverUrl` | the created song's art. Dropping it means a Spotify-created song has no cover. |
| `links` | `[{ label: 'Spotify', url: candidate.spotifyUrl }]` | **the only reason `spotifyUrl` is on the candidate at all.** Dropping it loses the Spotify URL on every song the picker creates — invisible in the picker and discovered later on the song screen. |

All five are pinned by ER9, as literal values, so an `addRow` that threads four of them fails.
`undefined` (not `null`) is passed for an absent `album` or `coverUrl`, matching HEAD's
`?? undefined` and `SongIdentityInput`'s optional fields.

#### 3. The two exports, and where the playlist filter lives

```ts
export function mergeSongSearchResults(
  catalog: readonly CatalogSearchResult[],
  tracks: readonly SpotifyTrack[],
): SongSearchRow[]

export function withoutHeldVersions(
  rows: readonly SongSearchRow[],
  playlistVersionIds: ReadonlySet<string>,
): SongSearchRow[]
```

Two functions, not one with three parameters: the merge is a function of the search response alone
and is therefore the thing worth unit-testing exhaustively, while the filter is a function of the
playlist's current contents and changes on every add. `useSongPicker` composes them —
`mergeSongSearchResults` in the search effect, `withoutHeldVersions` in a `useMemo` keyed on
`songs` — which is also what keeps a successful add from re-issuing the search.

`withoutHeldVersions` drops any candidate whose `versionId` is in the set, and then drops any row
that **had** candidates and lost them all. This is existing behaviour (`visiblePickerCatalog` /
`visiblePickerSpotify`), not the similarity filtering `docs/plans/repertoire-rework.md` forbids.

**Drift correction (2026-10-07).** The clause above read "drops any row left with no candidates",
which deletes §2a's version-less catalog row — the row that arrives with `versions: []` and that
HEAD's `visiblePickerCatalog` offers unconditionally, because a song with no version cannot be in
any playlist. The filter therefore keys on whether the row *lost* its candidates, not on whether it
has none: `row.versions.length > 0 && kept.length === 0` is the drop condition. ER18's four cases
are unaffected (each starts from a row with at least one candidate); ER12's row survives.

#### 4. Spotify-only rows, and what a pick writes

A Spotify-only row has `songId: null` and every candidate `versionId: null` (so every candidate's
derived source is `'spotify'`).
**The search writes nothing for it.** On `Add`, the existing path runs unchanged:
`createAndAddSong` resolves or creates the `songs` row through `resolveOrCreateSongIdentity`,
`upsertAlbumAndVersion` creates the `albums` and `song_versions` rows, the owner row is created,
and `addSongToPlaylist` inserts the entry. No new write path, no new table, no speculative local
copy of a Spotify track.

A row whose `songId` is non-null but whose `versions[0]` is a Spotify candidate is legal and
intended (§5), and its `Add` takes the Spotify branch for that candidate.

#### 5. Ordering — total, deterministic, and not ranking

Ranking is RH-113's. This task's order must be **total**, so two runs over the same inputs cannot
disagree.

**Candidates within a row**, mirroring `representativeVersionOrder` and extended only where a
Spotify candidate has nothing to compare:

1. `albumType === 'album'` first; any other value and `null` after (nulls last).
2. earliest `releaseDate`, nulls last. Compared as a **string**, which is correct for
   `YYYY` / `YYYY-MM` / `YYYY-MM-DD` prefixes.
3. earliest `createdAt`, nulls last — which puts a Spotify candidate (always `null`) after a
   catalog candidate it ties with, and preserves parity with the SQL ordering for a catalog-only
   row.
4. the derived `source` (§2): `'catalog'` before `'spotify'`, so a collapsed candidate and a
   catalog-only one both precede a Spotify-only one they tie with.
5. `versionId ?? spotifyTrackId` ascending.

Step 5 makes it total: every candidate has at least one of the two ids and step 4 has already
separated those that differ in which, a uuid and a Spotify base62 id never collide, and no id
repeats inside a row after the recording-level dedup. Steps 1-2 are what let a Spotify
candidate **beat** a catalog one — if the only version anyone has added is a 2023 re-recording and
the 2001 album is in the Spotify response, the 2001 album leads — which is the behaviour
`docs/plans/repertoire-rework.md` asks for and the reason the two new Spotify fields exist.

**Rows**:

1. rows with `songId !== null` before rows without — which covers both a row with a catalog
   candidate and §2a's version-less catalog row;
2. `title` lowercased, ascending;
3. `artist` lowercased, ascending;
4. `songId` when it is non-null, otherwise `versions[0]`'s
   `versionId ?? spotifyTrackId`, ascending. In that order and never the reverse: a row with an
   empty `versions` array always has a `songId` (§2a), and a row with a null `songId` is
   Spotify-only and therefore always has at least one candidate — so **no row reaches
   `versions[0]` on an empty array**.

**Step 1 is settled, not open.** It reproduces HEAD exactly: `SongPicker.tsx:63-86` maps
`catalogResults` before `spotifyResults`, and `RepertoireDashboard.tsx:489` says so in its own
comment — `{/* Flat list: catalog first, then Spotify */}`. It is provider precedence carried
forward, not relevance, and this task changes nothing a user sees about it.

Both string comparisons use plain `<` / `>` on the lowercased values and **never
`localeCompare`**, whose result depends on the runtime's ICU data — two environments could
otherwise disagree about an order this spec calls deterministic. Step 4 makes it total.

#### 6. The consumers

`src/lib/songPicker.ts` loses `pickerDedupKey`, `pickerCatalogKeys`, `visiblePickerSpotify` and
`visiblePickerCatalog` — the merge module subsumes all four, and `pickerDedupKey`'s raw-title
lowercase is the defect this task removes. `heldPickerVersionId` becomes "the representative
candidate's `versionId` when the owner already holds it". `SongPickerController` replaces
`catalogResults` / `spotifyResults` with one `results: SongSearchRow[]`, and `addCatalogSong` /
`addSpotifyTrack` become one `addRow(row)`.

`addRow` dispatches on the representative candidate's **derived** source (§2), after the one
guard §2a requires:

- `versions.length === 0` — the **catalog branch**, on `row.songId`, which §2a guarantees is
  non-null. This case is checked **first**, so nothing evaluates `versions[0]` on an empty array.
- `versions[0].versionId !== null` — the **catalog branch**, unchanged from HEAD's
  `addCatalogSong`: `heldPickerVersionId` when the owner already holds that version, otherwise
  `addToRepertoire(row.songId)`, then `addSongToPlaylist`. **`createAndAddSong` is not called.**
  A collapsed candidate (both ids) takes this branch, which is the point of collapsing: the
  recording already exists locally, so nothing needs creating. An `addRow` that took the Spotify
  branch here would push an existing song back through `resolveOrCreateSongIdentity` on every add
  — a write path, and the expensive direction of error. Pinned by ER11.
- `versions[0].versionId === null` — the **Spotify branch**, `createAndAddSong` with all five
  arguments of §2's table, then `addSongToPlaylist`. Pinned by ER9.

**`findRepertoireVersionIdByTrack` changes behaviour deliberately, and that is a fix (§B6).** It is
the recovery path when `createAndAddSong` throws `already in your repertoire`, and at HEAD it keys
on `pickerDedupKey`'s raw title — so adding Spotify's `"Bad - Remaster 2012"` compares
`"bad - remaster 2012"` against the held entry's `rep.song.title` of `"Bad"`, never matches, and
the user sees the raw error instead of the row being added. **The recovery is dead today for every
suffixed Spotify title.** Re-pointing it at the split-title key is what makes it fire. Two
consequences, both accepted and stated:

- it will newly recover a held entry for the *song* when the user asked for a particular
  *recording*, so the version added may not be the one the row named. That is strictly better than
  today's visible error, and it is the pre-existing shape of the function's own doc comment;
- post-RH-125 an owner may hold several versions of one song, so `entries.find` would return an
  array-order-dependent row. The lookup therefore becomes deterministic: among the owner's
  matching entries, take the **lowest `version_id`**. Pinned by ER13.

`SongPicker.tsx` maps one array into the **same** `<ul aria-live="polite">`, with the same
`PickerRow` child, the same `Type to search…` / `Searching…` / `No results` states — the empty
condition becoming `picker.results.length === 0` — and no change to the input, the focus effect or
the container's classes. `PickerRow` gains `year?: string | null` (rendered alongside `album`, so
§2's album-and-year line is possible). Its existing `<li>` and its `Add` button are unchanged,
which is what keeps the e2e locator green.

**One open question for the operator — and the spec is built on its answer, not around it.**
`PickerRow` conveys nothing today about whether the app already knows a song: a catalog row and a
Spotify row are drawn identically. Collapsing the duplicate rows removes no such signal, because
there was none; the question is whether to *add* one. **This spec answers B, no tag**, and is
written as though that were settled: it preserves HEAD's appearance exactly, and a new affordance
on the row belongs with RH-112's card. **ER24 asserts B unconditionally** — the literal string
`In catalog` must appear nowhere under `src/components/`.

That is deliberate, and the reason is a gate-integrity one worth recording. An expected result of
the form "if the operator answered A do this, if B do that" cannot be decided by QA, who holds the
results and nothing else: the two branches are mutually exclusive, so a developer could build B
against an A answer and QA would pass it against the B branch. A conditional ER is a gate that
selects its own branch. So the answer is baked in, and if the operator answers **A**, that is a
visible scope change handled by **amending ER24 before implementation** — never by reinterpreting
it during QA. Option A is still rendered in `docs/tasks/RH-109-mock.html` so the choice can be
seen; it is simply not a live branch inside the contract.

#### 7. Moderation visibility

The product constraint "nothing shared is visible to other users before moderation approval" is
satisfied here **without a filter**, stated so no reviewer adds one speculatively: in the tree as
read, `songs` carries **no** approval or visibility column (checked against every
`migrations/*.sql`). Moderation applies to *field edits* only — `global_song_edits`, written by
`submitSongEdit` when `applyCatalogFill` refuses to overwrite an already-populated shared field —
so a `songs` row is visible to everyone from the moment it exists, and a pending edit is visible to
nobody but its author and an admin. The merged search reads `songs`, `song_versions` and `albums`
and never `global_song_edits`, so it shows only official values. Row-level catalog moderation does
not exist and introducing it is not this task.

#### 8. Degradation — the catalog half must work alone

- `mergeSongSearchResults` is total over its two arrays: empty `tracks` yields exactly the catalog
  rows, empty `catalog` yields exactly the Spotify rows, both empty yields `[]`.
- `useSongPicker`'s existing `Promise.all` with a `.catch(() => [])` on **each** half stays. A
  Spotify failure, an unconfigured deployment (no `SPOTIFY_CLIENT_ID`) or a user with no Spotify
  connection therefore produces a complete catalog-only list. The connection is irrelevant to
  search by construction: the route uses app-level client credentials.
- The reverse holds: a catalog failure yields a Spotify-only list rather than an empty panel.

#### 9. The two reads

**Catalog.** `searchSongs` keeps its predicate, its `ORDER BY s.title ASC` and its song-counting
`LIMIT 20`, keeps the `representativeVersionSubquery` column `version_id` (so nothing outside the
picker has to change), and gains one correlated `json_agg` column, `versions`, built from
`song_versions v LEFT JOIN albums a ON a.id = v.album_id` — the `LEFT JOIN` is mandatory and is
pinned by `src/lib/__tests__/ownerSongsGuards.test.ts` — ordered by
`representativeVersionOrder('v','a')`, projecting `v.id`, `v.label`, `v.duration_seconds`,
`v.created_at`, `a.name`, `a.album_type`, `a.cover_url` and `a.release_date` rendered as
`YYYY-MM-DD` text rather than left to the driver's date handling. A song with no version yields an
empty array, which is the §2a row: the row is still produced and still reports its `songId`.

**Spotify.** `SpotifyTrack` in `src/lib/spotify.ts` gains `albumType: string | null` and
`releaseDate: string | null`, read from `album.album_type` and `album.release_date` in the route's
response type; both are `null` when Spotify omits them and nothing throws on their absence. The
route's duplicate `SpotifyTrack` declaration is **deleted** in favour of
`import type { SpotifyTrack } from '@/lib/spotify'` — one definition, one fewer `jscpd` candidate.
Auth, the `401`, the `400` for a missing `q`, the token cache, `limit=8` and both `200 []`
degradation paths are untouched.

**Landing page (AGENTS.md §Landing Page Rule):** not a selling point. One row instead of two for
the same song is a defect repair inside an existing panel, not a capability a musician would choose
the app for; the grouped card is RH-112's. No dictionary change.

### Files touched

- `src/lib/songTitle.ts` — **drift correction (2026-10-07), not in the approved file list.** It
  gains `songIdentityKey(title, artist)`, the lowercased-split-title-then-artist group key of §1,
  and that is where the key has to live. ER1 allows `songSearchMerge.ts` to import **only**
  `@/lib/songTitle` and types, while ER13 needs the identical key inside `songPicker.ts` for the
  re-pointed `findRepertoireVersionIdByTrack`. Any other home forces either a second copy of the
  rule — the exact defect §1 argues against — or an import ER1 forbids. `songTitle.ts` already is
  "the one parse of an incoming song title", has no imports at all and is client-safe, so both
  modules import the one definition from it.
- `src/lib/songSearchMerge.ts` — **new.** The whole merge, pure and client-safe: imports only
  `@/lib/songTitle` and types. **Budget note for RH-112 (2026-10-07):** it lands at **394 of the
  base 400 `max-lines`**, with no override, and the first draft was 427 — the prose was compressed
  twice rather than an entry being added, because the ratchet may only shrink. RH-112 has six
  lines of headroom here. The companion `src/lib/__tests__/songSearchMerge.test.ts` lands at
  **784 of the test budget's 800**, with the three source-tree guards (ER1, ER23, ER24, plus
  ER25's) split into `src/lib/__tests__/songSearchMergeGuards.test.ts` for exactly that reason. Exports `mergeSongSearchResults`, `withoutHeldVersions` and the
  `SongSearchRow` / `SearchVersionCandidate` types. Split into small internal functions so none
  needs a complexity override.
- `src/lib/songs.ts` — `searchSongs` gains the `versions` aggregate column; predicate, order and
  `LIMIT 20` unchanged.
- `src/types/database.ts` — `CatalogSearchResult` gains `versions: CatalogVersionOption[]`, the new
  interface declared beside it.
- `src/lib/spotify.ts` — `SpotifyTrack` gains `albumType` and `releaseDate`.
- `src/app/api/spotify/search/route.ts` — duplicate `SpotifyTrack` deleted and imported; the two
  new fields projected.
- `src/lib/songPicker.ts` — the four dedup helpers deleted; `heldPickerVersionId` and
  `findRepertoireVersionIdByTrack` re-pointed (§6); `SongPickerController` re-shaped.
- `src/hooks/useSongPicker.ts` — the parallel search feeds `mergeSongSearchResults`; one
  `withoutHeldVersions` memo replaces the two filtered memos; `addRow` replaces the two add
  commands and passes `rawTitle` and `coverUrl`.
- `src/components/playlists/SongPicker.tsx` — one `.map` over `picker.results` inside the existing
  `<ul>`; the empty condition becomes `picker.results.length === 0`.
- `src/components/playlists/PickerRow.tsx` — gains `year?: string | null` and nothing else.
  `<li>`, the `Add` button and the seven existing props are unchanged.
- `src/lib/__tests__/songSearchMerge.test.ts` — **new.**
- `src/lib/__tests__/songPicker.test.ts` — deleted helpers' cases dropped; the re-pointed recovery
  lookup covered.
- `src/lib/__tests__/catalogVersions.db.test.ts` — the `versions`-aggregate cases (`.db.` because it
  needs a live Postgres; skips without `RUN_DB_TESTS`).
- `src/hooks/__tests__/useSongPicker.test.tsx` — re-pointed at `results` / `addRow`, plus the
  degradation and `rawTitle` cases.
- `src/components/playlists/__tests__/SongPicker.test.tsx` — the one-row-per-song case and the new
  props. **Drift correction (2026-10-07):** `src/components/playlists/__tests__/PickerRow.test.tsx`
  does **not** exist in the tree, so the conditional resolves and every assertion lands here.
- `src/components/playlists/__tests__/PlaylistDetailView.test.tsx`,
  `src/components/playlists/__tests__/playlistReorder.test.tsx`,
  `src/hooks/__tests__/usePlaylistDetail.test.tsx` — their `searchCatalog` mocks keep compiling
  against the widened `CatalogSearchResult`. **Drift correction (2026-10-07):** all three mock
  `searchCatalog` as `vi.fn().mockResolvedValue([])`, so the widening costs them nothing — but
  `usePlaylistDetail.test.tsx:318` *calls* `result.current.picker.addCatalogSong({ id: 's3' } as
  Song)`, which ER25 deletes. That one call is re-pointed at `addRow` with a §2a row
  (`songId: 's3'`, `versions: []`), which takes the same catalog branch and keeps the test's
  `addSongToPlaylist('pl-1', 's3')` assertion intact. The other two files need no edit.
- `docs/use-cases.md` — the *Search for a song* "Open" bullet moves to "Decided" (ER27).
- `docs/tasks/RH-109-mock.html` — **new.**
- `package.json` — version bump per AGENTS.md §Version Bumping Rule.

### Test criteria

- `src/lib/__tests__/songSearchMerge.test.ts`, with hand-built inputs and no mocks: the collapse of
  a catalog hit and a Spotify hit for the same song into one row; the collapse of two descriptions
  of one *recording* into one candidate carrying both ids, and the non-collapse when the album
  names differ; the `" - "` split driving both the group key and a Spotify candidate's `label`;
  the catalog's spelling winning the row title; the artist half not re-reduced;
  both total orders including a Spotify candidate winning on `albumType`/`releaseDate`, and
  order-independence under shuffled inputs; the three degradation cases; `withoutHeldVersions`
  shrinking a row and removing a row.
- `src/lib/__tests__/catalogVersions.db.test.ts` asserts the `versions` aggregate against real
  rows: ordering, an album-less version surviving the `LEFT JOIN`, a version-less song yielding
  `[]`, and `releaseDate` arriving as a `YYYY-MM-DD` string.
- `src/hooks/__tests__/useSongPicker.test.tsx` asserts, with both search functions mocked and a
  query typed: that a catalog hit and a Spotify hit for one song yield `results.length === 1` with
  both ids on the one candidate — the assertion that pins the deliverable end to end, which no
  test of the pure function or of the panel in isolation can make; both degradation directions;
  `addRow`'s dispatch by the representative candidate's derived source, including that the catalog
  branch never calls `createAndAddSong`; and the complete five-argument `createAndAddSong` payload
  on the Spotify branch.
- `src/components/playlists/__tests__/SongPicker.test.tsx` asserts one `listitem` with one `Add`
  button for a controller holding one merged row built from both sources.
- `npm run test:e2e` still passes, in particular
  `e2e/playlist-detail.spec.ts:155` *"adds two catalog songs to the playlist through the picker"*.
- `src/lib/__tests__/complexityBudget.test.ts` passes with the override list still at **14 entries**
  and no ceiling raised.
- `npm run lint:dead`, `npm run lint:dup`, `npm run test:coverage` (statements 80, branches 65,
  functions 78, lines 80) and `npm run build` all pass.

## Expected Results

Every result below is decidable by someone holding only this list. Where a test is named, the
assertion is stated in full; where a literal matters, it is written out.

### The collapse itself

- [ ] ER1 — `src/lib/songSearchMerge.ts` exists and exports exactly two functions,
      `mergeSongSearchResults(catalog, tracks)` and
      `withoutHeldVersions(rows, playlistVersionIds)`. The file imports nothing but
      `@/lib/songTitle` and type-only modules, and contains no `localeCompare` and no import of
      `@/lib/db`, `@/lib/songIdentity` or `react`.
- [ ] ER2 — **One row, one candidate, both provider ids.** In
      `src/lib/__tests__/songSearchMerge.test.ts`, `mergeSongSearchResults` is given one catalog
      hit (`title: 'Bad'`, `artist: 'Michael Jackson'`, one version with `versionId: 'v-1'`,
      `albumName: 'Bad'`, `label: null`) and one Spotify hit (`title: 'Bad'`,
      `artist: 'Michael Jackson'`, `album: 'Bad'`, `id: 'sp-aaa'`) and returns **exactly one row**
      whose `title === 'Bad'`, `artist === 'Michael Jackson'`, `songId` equal to the catalog
      song's id, and whose `versions` has **length 1** — a single candidate with
      `versionId === 'v-1'` **and** `spotifyTrackId === 'sp-aaa'`. Both sources described one
      recording, so one candidate carries both ids.
- [ ] ER3 — **The row title is the catalog's spelling, not Spotify's.** Given one catalog hit
      `title: 'Bad'` and one Spotify hit `title: 'Bad - Remaster 2012'` (same artist), the single
      returned row has `title === 'Bad'`. A row titled `'Bad - Remaster 2012'` fails.
- [ ] ER4 — **The collapse survives the hook, not just the pure function.** A test in
      `src/hooks/__tests__/useSongPicker.test.tsx` makes `searchCatalog` resolve to one song
      `title: 'Bad'`, `artist: 'Michael Jackson'` with one version on album `'Bad'`, makes
      `searchSpotify` resolve to one track `title: 'Bad - Remaster 2012'`,
      `artist: 'Michael Jackson'`, `album: 'Bad'`, types a query, and asserts
      `picker.results.length === 1` and that the one row's `versions` carries both the catalog
      `versionId` and the Spotify `spotifyTrackId`. An implementation that merges each source
      separately and concatenates the two arrays fails this.
- [ ] ER5 — **The panel renders one row for it.** A test in
      `src/components/playlists/__tests__/SongPicker.test.tsx` renders `SongPicker` with a
      controller whose `results` is the single row ER2 produces, and asserts the
      `ul[aria-live="polite"]` contains **exactly one** element with role `listitem` and
      **exactly one** button with the accessible name `Add`. (At HEAD the same two search hits
      produce two listitems and two `Add` buttons.)
- [ ] ER6 — **A row names a song and lists every recording, with a literal count.** Given one
      catalog song (`'Bad'` / `'Michael Jackson'`) whose `versions` array holds two versions —
      `versionId: 'v-1'`, `albumName: 'Bad'`, `label: null` and `versionId: 'v-2'`,
      `albumName: 'Live At Wembley'`, `label: 'Live'` — plus two Spotify tracks
      `'Bad - Remaster 2012'` and `'Bad - Remaster 2025'`, both `album: 'Bad'`, same artist:
      `mergeSongSearchResults` returns **one** row whose `versions.length === 4`. (Four distinct
      recording keys: `('bad','')`, `('live at wembley','live')`, `('bad','remaster 2012')`,
      `('bad','remaster 2025')`. An implementation that reads only the catalog row's single
      `version_id` and ignores its `versions` array cannot reach 4.)
- [ ] ER7 — **A differing album name misses the merge and keeps both candidates.** A catalog
      version with `albumName: 'Bad'`, `label: 'Remaster 2012'` and a Spotify track
      `'Bad - Remaster 2012'` with `album: 'Bad (Remastered)'`, same song, return one row whose
      `versions.length === 2`, with both candidates present and neither carrying the other's id.
      Nothing is lost; the cost is one extra candidate.
- [ ] ER8 — A Spotify-only group returns a row with `songId === null` and every candidate
      carrying `versionId === null` and a non-null `spotifyTrackId`.

### The add path — all five arguments

- [ ] ER9 — **The Spotify branch threads all five `createAndAddSong` arguments.** A test in
      `src/hooks/__tests__/useSongPicker.test.tsx` calls `addRow` on a row with
      `artist: 'Michael Jackson'` and `title: 'Bad'` whose representative candidate has
      `versionId: null`, `rawTitle: 'Bad - Remaster 2012'`, `albumName: 'Bad'`,
      `coverUrl: 'https://img/bad.jpg'` and `spotifyUrl: 'https://open.spotify.com/track/sp-aaa'`,
      and asserts `createAndAddSong` was called **once** with an object equal to:
      `{ title: 'Bad - Remaster 2012', artist: 'Michael Jackson', album: 'Bad', cover_url: 'https://img/bad.jpg', links: [{ label: 'Spotify', url: 'https://open.spotify.com/track/sp-aaa' }] }`.
      All five are required: `title` must be the **unsplit** `rawTitle` and not the row's display
      title `'Bad'`, and `links` must be present and carry the Spotify URL.
- [ ] ER10 — **`song_versions.label` survives, which is what the unsplit title buys.** A test
      asserts `splitSongTitle('Bad - Remaster 2012')` returns
      `{ title: 'Bad', label: 'Remaster 2012' }`, which is what `resolveOrCreateSongIdentity`
      hands `upsertAlbumAndVersion` for the payload ER9 pins. Passing the row's display title
      would make this `label: null`.
- [ ] ER11 — **The catalog branch does not create anything.** A test calls `addRow` on a row with
      `songId: 'song-1'` whose representative candidate has `versionId: 'v-1'`, and asserts
      `addToRepertoire` (or the held-version short-circuit, when the owner's repertoire map
      already contains `'v-1'`) is used and `addSongToPlaylist` is called with `'v-1'`, and that
      **`createAndAddSong` was not called at all**. A candidate carrying *both* ids takes this
      branch too: a second case with `versionId: 'v-1'` and `spotifyTrackId: 'sp-aaa'` also
      leaves `createAndAddSong` uncalled.
- [ ] ER12 — **A catalog song with no versions still gets a row, and adding it creates nothing.**
      `mergeSongSearchResults` is given one catalog hit (`songId: 'song-3'`, `title: 'Kashmir'`,
      `artist: 'Led Zeppelin'`, `album: 'Physical Graffiti'`,
      `cover_url: 'https://img/pg.jpg'`, `version_id: null`, `versions: []`) and no Spotify hits,
      and returns **exactly one** row with `songId === 'song-3'`, `versions.length === 0`,
      `title === 'Kashmir'`, `album === 'Physical Graffiti'` and
      `coverUrl === 'https://img/pg.jpg'`. A separate test in
      `src/hooks/__tests__/useSongPicker.test.tsx` calls `addRow` on that row and asserts
      `addToRepertoire` was called with `'song-3'`, `addSongToPlaylist` was called with the
      `version_id` it returned, and **`createAndAddSong` was not called**. (This input is reachable:
      `scripts/seed-catalog.sql` inserts `songs` rows with no `song_versions` row, and such a song
      renders in the picker at HEAD — a row that disappears is a regression.)
- [ ] ER13 — `findRepertoireVersionIdByTrack` in `src/lib/songPicker.ts` matches on the
      split-title key. A test in `src/lib/__tests__/songPicker.test.ts` asserts that a track
      titled `'Bad - Remaster 2012'` **finds** a repertoire entry whose `song.title` is `'Bad'`
      (same artist) — which returns `null` at HEAD — and that when the owner holds two entries
      for that song the function returns the **lowest** `version_id`, independent of the array
      order it is given.

### Rows, candidates, ordering

- [ ] ER14 — Every row returned by `mergeSongSearchResults` has a non-empty string `id` equal to
      its group key. A test asserts that two rows from one call never share an `id`, and that a
      row built from a catalog hit and a Spotify hit for the same song has **one** id — so one
      `rowErrors` slot and one `addingId`.
- [ ] ER15 — **No row loses its thumbnail, in either direction.** A test asserts every row's
      `coverUrl` is the first non-null `coverUrl` among its candidates in sorted order, falling
      back to the catalog row's `songs.cover_url`. **Case 1:** a catalog hit with
      `cover_url: null` whose version carries an album cover `null`, plus a Spotify hit with
      `albumArt: 'https://img/a.jpg'`, yields `coverUrl === 'https://img/a.jpg'`. **Case 2:** a
      catalog hit with `cover_url: 'https://img/c.jpg'` whose only version is **album-less**
      (`albumName: null`, so no album cover exists), and **no** Spotify hit, yields
      `coverUrl === 'https://img/c.jpg'` — not `null`. Case 2 is the one that fails if the
      fallback to `songs.cover_url` is omitted.
- [ ] ER16 — A test asserts the candidate order is total and places a Spotify candidate with
      `albumType: 'album'`, `releaseDate: '2001-03-06'` **ahead of** a catalog candidate whose
      album is a `'single'`; and asserts that two calls over the same inputs supplied in
      **different array order** return identical row order **and** identical `versions` order in
      every row.
- [ ] ER17 — A test asserts row order: given two catalog-backed rows and one Spotify-only row,
      the two catalog-backed rows come first (reproducing HEAD's catalog-before-Spotify order),
      then rows sort by lowercased title, then lowercased artist.
- [ ] ER18 — `withoutHeldVersions` is asserted in `src/lib/__tests__/songSearchMerge.test.ts` by
      four cases. **1:** one row with two candidates, `versionId` `'v-1'` and `'v-2'`, filtered
      with `new Set(['v-1'])` returns one row whose `versions` has length 1 and whose only
      candidate is `'v-2'`. **2:** one row whose only candidate is `'v-1'`, filtered with
      `new Set(['v-1'])`, returns `[]` — the row disappears entirely. **3:** a candidate with
      `versionId: null` is never filtered out. **4:** a candidate carrying both
      `versionId: 'v-1'` and `spotifyTrackId: 'sp-aaa'`, filtered with `new Set(['v-1'])`, **is**
      dropped — it is the held recording.

### Degradation

- [ ] ER19 — A test calls `mergeSongSearchResults(catalog, [])` with three catalog songs and
      asserts three rows in the documented order; a second case calls `([], tracks)` and asserts
      the Spotify rows are returned; a third asserts `([], [])` returns `[]`.
- [ ] ER20 — A test in `src/hooks/__tests__/useSongPicker.test.tsx` makes `searchSpotify` reject
      and asserts `picker.results` contains a row for every catalog hit and `picker.rowErrors` is
      `{}`; a second case makes `searchCatalog` reject and asserts `picker.results` contains a row
      for every Spotify hit.
- [ ] ER21 — `/api/spotify/search` still returns HTTP **401** with
      `{ error: 'Not authenticated', code: 401 }` when unauthenticated; HTTP **400** with
      `{ error: 'Missing required query parameter: q', code: 400 }` when `q` is absent or blank;
      and HTTP **200** with a JSON `[]` both when `SPOTIFY_CLIENT_ID` is unset and when the
      upstream call fails.

### The two reads

- [ ] ER22 — `searchSongs` in `src/lib/songs.ts` returns each row with a `versions` array ordered
      by `representativeVersionOrder` over a `LEFT JOIN albums`, and
      `src/lib/__tests__/catalogVersions.db.test.ts` asserts: the order for a song with an
      `'album'`, a `'single'` and an album-less version; that the album-less version is
      **present**; that a song with no version yields `[]`; and that `releaseDate` is the string
      `'1987-08-31'` for an album dated that day. `searchSongs` still ends in `LIMIT 20` applied
      to `songs`, and its `version_id` column still comes from `representativeVersionSubquery`.
- [ ] ER23 — `SpotifyTrack` is declared **exactly once** under `src/` (in `src/lib/spotify.ts`),
      carries `albumType` and `releaseDate`, and `src/app/api/spotify/search/route.ts` imports
      the type and projects both fields from `album.album_type` / `album.release_date`. A test
      asserts the single declaration by scanning the tree.

### The panel, unchanged where it must be

- [ ] ER24 — `src/components/playlists/PickerRow.tsx` accepts a `year?: string | null` prop and
      renders it on the album line, asserted by a component test showing both `Bad` and `1987`
      for a row whose representative candidate has `albumName: 'Bad'`,
      `releaseDate: '1987-08-31'`. No "in catalog" affordance is added: the literal string
      `In catalog` must appear **nowhere** under `src/components/`, and a catalog-backed row and
      a Spotify-only row must render the same set of elements apart from their text content.
      (This is the agreed answer to the open question on the task — option B, preserving HEAD's
      appearance. If the operator answers A instead, this ER is amended before implementation,
      not reinterpreted during QA.)
- [ ] ER25 — `src/lib/songPicker.ts` no longer exports `pickerDedupKey`, `pickerCatalogKeys`,
      `visiblePickerSpotify` or `visiblePickerCatalog`; `SongPickerController` exposes one
      `results` array and one `addRow`, and no longer exposes `catalogResults` or
      `spotifyResults`.
- [ ] ER26 — `src/components/playlists/SongPicker.tsx` still renders exactly one
      `<ul aria-live="polite">` with no section heading inside it, still renders the literal
      strings `Type to search…`, `Searching…` and `No results` in their existing states, and
      `npm run test:e2e` passes — in particular `e2e/playlist-detail.spec.ts:155` *"adds two
      catalog songs to the playlist through the picker"*, which locates a row as
      `page.locator('ul[aria-live="polite"]').getByRole('listitem').filter({ hasText: title })`
      and clicks the button named exactly `Add`.

### Gates and documentation

- [ ] ER27 — In `docs/use-cases.md` § *Search for a song*, the bullet currently under **Open**
      beginning "Not a decision but an unverified assumption: collapsing a catalog row and a
      Spotify row for one version compares them by `(album, label)`" is moved under **Decided**,
      and the section states in as many words that the comparison is by **album name and label**,
      that two candidates which do not collapse produce **one extra candidate and lose nothing**,
      and that no fuzzy name matching is performed. The **Open** heading is removed if that was
      its last bullet.
- [ ] ER28 — `src/lib/__tests__/complexityBudget.test.ts` passes with the override list between
      the `BEGIN:/END:complexity-budget-overrides` markers still holding **14 entries**, no
      entry's ceiling raised, and no entry added for any file this task touches.
- [ ] ER29 — `migrations/` is unchanged by this task: no file added, none edited, and
      `src/lib/__tests__/migrationsSingleSource.test.ts` passes.
- [ ] ER30 — `npm run test:coverage`, `npm run lint:dead`, `npm run lint:dup` and
      `npm run build` all exit 0, with the coverage thresholds (statements 80, branches 65,
      functions 78, lines 80) met.
- [ ] ER31 — `docs/tasks/RH-109-mock.html` exists, depicts the current list (two rows for one
      song) and the merged list (one row), and renders the open question's two options side by
      side, labelled A and B.
- [ ] ER32 — `package.json`'s `version` is bumped per AGENTS.md §Version Bumping Rule and is
      strictly higher than any version in `git log`.

## Out of Scope

**RH-112, "Rebuild the add-song flow around the grouped card"** — the line is drawn here and this
spec does not cross it. RH-112 owns: the expand/collapse card; the version list UI and its
album-led line (`Bad · 1987 · 4:17`) with the label as a subtitle; the per-version `Add` and the
disappearance of the collapsed one on expansion; manual entry sitting alongside the results rather
than behind an empty one; and bringing `RepertoireDashboard.tsx` onto the same component. This task
delivers the data every one of those needs — one ordered row per song, each carrying its ordered
candidates — and renders it through the existing `PickerRow` in the existing `<ul>`.

**`src/components/songs/RepertoireDashboard.tsx` is deliberately untouched**, and the consequence
the operator is accepting is narrow and worth stating precisely: after this task the **picker shows
one row** for a song the catalog and Spotify both know, while the **dashboard still shows two**,
because the dashboard's own dedup at lines 186-213 keys on the raw title
(`` `${t.title.toLowerCase()}|${t.artist.toLowerCase()}` ``) exactly as `pickerDedupKey` does
today. It is not that the dashboard "keeps two sections" — it has no sections; it keeps the
duplicate row. The reason is the ratchet: the file is pinned at `complexity 17`,
`max-lines-per-function 525`, `max-lines 578`, the override list may only shrink, and rewiring its
inline copy of this logic is the deletion RH-112 makes when it replaces the component.

**RH-113, "Make catalog search use an index and rank its results"** — ranking and indexing. This
task adds no index, keeps the `ILIKE '%…%'` predicate exactly as it is, and ranks nothing: §5's
order is provider precedence plus alphabetical plus id. Title similarity, typo tolerance and the
trigram/FTS index are RH-113's.

Also out: row-level catalog moderation visibility (§7 — no such column exists); any delete, merge
or split path for `songs` / `song_versions` (admin-master only, and a later work item); storing a
representative version as a column (`song_versions.is_default`, considered and rejected in
`docs/plans/repertoire-rework.md`); `version_albums` / RH-120; any change to the add, repertoire or
playlist write paths; the landing-page dictionaries; and any migration.

# RH-36 - Introduzir helper de transacao real e tornar escritas multi-statement atomicas

Baseline for every line number, count and command in this document is HEAD =
`6ec6301` ("fix(RH-35): authorize Spotify playlist route handlers against the
caller").

## Scope

This task introduces a real transaction helper in `src/lib/db.ts` and converts
every multi-statement write in the tree that depends on atomicity to use it. It
covers the four findings of `docs/plans/code-quality-review.md` section 5 T3:

- F4 (review line ~265): `BEGIN`, the statements and `COMMIT` are issued through
  the pool-level `query()` helper in three code paths (`updateSong`,
  `updateEmail`, `reviewGlobalSongEdit`), so none of them is atomic and each
  leaks a connection idle in transaction.
- F9 (~305): the Spotify pull resync deletes every `playlist_songs` row and then
  re-inserts them in a separate statement, outside any transaction.
- F18 (~377): `addSongToPlaylist` computes `position` with `SELECT COUNT(*)`
  then `INSERT`, a read-modify-write with nothing serialising it and no
  constraint behind it.
- F19 (~385): `ensureInRepertoire` runs two statements per band member per
  track, using check-then-insert with a `23505` catch.

Concretely it delivers: `withTransaction` and a `Queryable` type in
`src/lib/db.ts`; the conversion of the three F4 paths, the pull resync and
`addSongToPlaylist`; the set-based rewrite of `ensureInRepertoire`; migration
`0007_add_playlist_song_position_unique.sql` adding `UNIQUE (playlist_id,
position)` after repairing existing duplicate positions; a mechanical guard test
forbidding bare `BEGIN`/`COMMIT`/`ROLLBACK` through `query()`; four new test
files (two of them real-database); a one-paragraph `# Transactions` convention
in `AGENTS.md`; and the version bump.

It does NOT change any authorization behaviour. The RH-35 ownership guards in
`src/app/api/spotify/playlists/[id]/sync/route.ts`
(`resolveSpotifyRouteAccess`, `resolveOwnedPlaylist`, and their position before
any read or write) are preserved verbatim; the RH-34 `assertPlaylistAccess`
call at the head of `addSongToPlaylist` stays outside the new transaction, so a
refusal still happens before the first write. No user-visible feature changes:
the same rows are written on the success path, the same error messages surface,
and the sync response body (`{ added, removed }`) is unchanged.

## Audit at 6ec6301

**Path 1 - `updateSong` (`src/lib/songs.ts:242-303`, F4).** Runs
`await query('BEGIN')`, an `UPDATE global_songs` (fill-if-empty on title,
artist, album, standard_key, cover_url, duration_seconds, links), an
`UPDATE repertoire` (status, tags, personal_key), then `await query('COMMIT')`;
the catch runs `await query('ROLLBACK')`. `query()` is `pool.query()`
(`src/lib/db.ts:23-25`), which checks out an arbitrary idle connection per call
and returns it immediately, so the four statements may run on up to four
different connections. Each `UPDATE` is therefore autocommitted on its own
connection. A failure of the repertoire `UPDATE` leaves the shared catalog row
already filled in with data from an edit that the owner's own repertoire row
never received, and the `ROLLBACK` lands on a connection that never saw
`BEGIN` (Postgres answers with a `25P01` warning, not an error, so nothing in
the logs marks it). The connection that did receive `BEGIN` goes back to the
pool *idle in transaction*, holding its snapshot and locks until
`idleTimeoutMillis` (30000 ms) reaps it; with `max: 10` a burst exhausts the
pool.

**Path 2 - `updateEmail` (`src/lib/profile.ts:71-83`, F4).** Same shape, two
statements: `UPDATE "user" SET email = ...` (the Better Auth table) and
`UPDATE profiles SET email = ...`. A failure between them leaves the identity
the user signs in with and the identity the app displays permanently
disagreeing, with no error visible on the Better Auth side. `profiles.email` is
`NOT NULL` but not unique (migration `0001_initial_schema.sql:83-90`), so
nothing repairs the split afterwards.

**Path 3 - `reviewGlobalSongEdit` (`src/lib/moderation.ts:159-181`, F4).** The
approve branch wraps `UPDATE global_songs SET <narrowed fields>` and
`UPDATE global_song_edits SET status = 'approved'` in an inner
`try { query('BEGIN') ... } catch { query('ROLLBACK') }`. A failure of the
second statement leaves the shared catalog already rewritten while the edit
stays `pending` in the moderation queue, so an admin who approves it again
applies the same edit twice; a failure of the first leaves the edit marked
approved with nothing applied. Both are silent.

**Path 4 - pull resync (`src/app/api/spotify/playlists/[id]/sync/route.ts:96-101`,
F9).** After a long sequence of Spotify network calls and per-track upserts,
the handler runs `DELETE FROM playlist_songs WHERE playlist_id = $1` and then,
as a separate statement, the bulk insert built by `buildPlaylistSongsInsert`. A
Postgres error, a serverless timeout or a malformed bulk insert between the two
leaves the playlist permanently empty with no record of what it held. The
window is not theoretical: it opens after every network round trip in the
handler has already happened.

**Path 5 - `addSongToPlaylist` (`src/lib/playlists.ts:146-184`, F18).** Up to
five statements with nothing serialising them: for a band playlist a
`SELECT` + `INSERT` on the band repertoire row, a `SELECT` + `INSERT` on the
caller's repertoire row, then
`SELECT COUNT(*) as count FROM playlist_songs WHERE playlist_id = $1` and an
`INSERT` of `count + 1` as `position`. Two failure modes. Concurrency: two adds
read the same count and insert the same position, and the ordering the whole
feature is built on becomes ambiguous. Sequence: `removeSongFromPlaylist`
(`src/lib/playlists.ts:186-197`) deletes a row without renumbering, so
positions 1,2,3 minus position 1 leaves 2,3 and the next add computes
`COUNT(*) + 1 = 3`, a duplicate, with no concurrency at all. Nothing in the
schema objects: `playlist_songs` has `uq_playlist_song UNIQUE (playlist_id,
song_id)` (migration `0001_initial_schema.sql:265-271`) and no constraint on
`position`. A failure part way through also leaves the song in a repertoire but
not in the playlist.

**Path 6 - `ensureInRepertoire` (`src/lib/spotifyPlaylistSync.ts:131-172`,
F19).** For a band owner: one `SELECT` and possibly one `INSERT` for the band
row, one `SELECT` for the member list, then one `SELECT` and possibly one
`INSERT` per member. For a 3-member band that is 3 statements plus up to 6 more,
per track, inside the per-track `await` loop of the sync and import routes,
on a pool capped at 10. Each insert is wrapped in a `try/catch` that swallows
`23505`, which is an admission that the check-then-act was never sound. That
catch is also actively unsafe once the code runs inside a transaction: a
`23505` aborts the whole transaction, so swallowing it and continuing produces
`25P02 current transaction is aborted` on the next statement rather than the
intended no-op.

## Approach

### 1. `withTransaction` and `Queryable` in `src/lib/db.ts`

Add, keeping `pool` and `query` exactly as they are:

```ts
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg'

/** Anything that can run a parameterized statement: the pool, or one client
 *  checked out of it inside `withTransaction`. */
export interface Queryable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>>
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // The connection is already unusable; release() below discards it.
    }
    throw error
  } finally {
    client.release()
  }
}
```

Three points the reviewer should check. The `release()` is in a `finally`, so
the connection returns to the pool on every path, including the one where
`ROLLBACK` itself throws (that is the case that leaks today). The `ROLLBACK`
failure is swallowed under the `S1` convention of AGENTS.md with the one-line
comment above, because the original error is the one worth propagating and the
broken connection is discarded by `release()`. `withTransaction` rethrows the
original error unwrapped: the L1 log-then-wrap stays at each call site, so the
thrown message text does not change anywhere.

This exact code was typechecked against the repository's `tsconfig.json` while
writing this spec: `Pool` and `PoolClient` both satisfy `Queryable`
structurally, so `pool` can be passed as a default argument where a `Queryable`
is expected and `npx tsc --noEmit` exits 0 with no emitted file.

Do not export anything that is not consumed - `npm run lint:dead` (knip) fails
on an unused export. `Queryable` earns its export in step 6.

### 2. F4 path 1: `updateSong` (`src/lib/songs.ts`)

Replace the `query('BEGIN')` / `query('COMMIT')` / `query('ROLLBACK')` frame
with one `withTransaction` call inside the existing `try`, so the L1 catch and
its `Failed to update song: ${err.message}` message are untouched:

```ts
try {
  await withTransaction(async (client) => {
    await client.query(songSql, [ ... ])
    await client.query(repSql, [ ... ])
  })
} catch (error) { /* unchanged L1 block */ }
```

The two SQL strings, their parameter arrays and the fill-if-empty semantics do
not change.

### 3. F4 path 2: `updateEmail` (`src/lib/profile.ts`)

Same conversion, two `client.query` calls in the callback. The catch keeps its
current shape and its `Failed to update email: ${message}` text.

### 4. F4 path 3: `reviewGlobalSongEdit` (`src/lib/moderation.ts`)

Delete the inner `try`/`catch` that issued `BEGIN`/`ROLLBACK` and return the
row out of the callback:

```ts
return await withTransaction(async (client) => {
  if (setClauses.length > 0) {
    values.push(edit.song_id)
    await client.query(`UPDATE global_songs SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`, values)
  }
  const res = await client.query(updateEditSql, [adminUserId, editId])
  return res.rows[0] as GlobalSongEdit
})
```

The outer catch, including the L1a re-throw list (`Access denied`,
`Global song edit not found`, `Edit request is already reviewed`), stays as is.
`checkSystemAdmin` and the `SELECT * FROM global_song_edits` read stay outside
the transaction, where they are today.

### 5. F9: the pull resync (`src/app/api/spotify/playlists/[id]/sync/route.ts`)

Wrap only the destructive pair in one transaction, leaving every RH-35 guard,
the Spotify fetches, the per-track `findOrCreateGlobalSong` /
`ensureInRepertoire` loop, the added/removed counting and the trailing
`UPDATE playlists SET last_synced_at = now()` exactly where they are:

```ts
await withTransaction(async (client) => {
  await client.query('DELETE FROM playlist_songs WHERE playlist_id = $1', [localPlaylistId])
  if (spotifySongIdsInOrder.length > 0) {
    const { sql, values } = buildPlaylistSongsInsert(localPlaylistId, spotifySongIdsInOrder)
    await client.query(sql, values)
  }
})
```

A failing insert now rolls the delete back, so the playlist keeps its previous
rows and the R1 catch answers 500 as before. `buildPlaylistSongsInsert` is not
modified. Delete-then-insert (rather than the upsert the F9 remediation
mentions as an alternative) is deliberate: it is the smallest change that makes
the path atomic, and inside a single transaction the deletes precede the
inserts, so the new `UNIQUE (playlist_id, position)` constraint of step 7 is
never transiently violated and does not need to be deferrable.

### 6. F19: set-based `ensureInRepertoire` (`src/lib/spotifyPlaylistSync.ts`)

Replace the loop and the three `23505` catches with `ON CONFLICT DO NOTHING`
(the bare form, which covers the partial unique indexes
`uq_repertoire_user_song` and `uq_repertoire_band_song`), and accept an
optional `Queryable` so the helper can later be called inside a transaction:

```ts
export async function ensureInRepertoire(
  songId: string,
  owner: { userId?: string; bandId?: string },
  db: Queryable = pool,
): Promise<void> {
  if (owner.bandId) {
    await db.query(
      "INSERT INTO repertoire (band_id, song_id, status) VALUES ($1, $2, 'unknown') ON CONFLICT DO NOTHING",
      [owner.bandId, songId],
    )
    await db.query(
      "INSERT INTO repertoire (user_id, song_id, status) SELECT bm.user_id, $1, 'unknown' FROM band_members bm WHERE bm.band_id = $2 ON CONFLICT DO NOTHING",
      [songId, owner.bandId],
    )
  } else if (owner.userId) {
    await db.query(
      "INSERT INTO repertoire (user_id, song_id, status) VALUES ($1, $2, 'unknown') ON CONFLICT DO NOTHING",
      [owner.userId, songId],
    )
  }
}
```

Statement count per call goes from `3 + 2N` to exactly 2 for a band owner and
from 1 or 2 to exactly 1 for a personal owner; the owner-with-neither case still
issues none. Behaviour is preserved: the same band row and the same one row per
member end up present, and the `AFTER UPDATE OF status` trigger
`trg_sync_band_repertoire` (migration `0001_initial_schema.sql:309-312`) does
not fire on inserts, so band aggregate status is unaffected exactly as today.
Both call sites (`sync/route.ts:76`, `import/route.ts:86`) keep their current
two-argument call. Batching `findOrCreateGlobalSong` across the track list is
explicitly out of scope (see below).

### 7. F18: position in SQL plus a constraint

`src/lib/playlists.ts`, `addSongToPlaylist`: keep `assertPlaylistAccess` where
it is (outside and before the transaction) and run the rest in one
`withTransaction`. Drop the check-then-insert on repertoire in favour of
`ON CONFLICT DO NOTHING` - inside a transaction a swallowed `23505` would abort
everything that follows - and compute the position in the insert:

```sql
INSERT INTO playlist_songs (playlist_id, song_id, position)
SELECT $1, $2, COALESCE(MAX(position), 0) + 1 FROM playlist_songs WHERE playlist_id = $1
```

For a band playlist that is the band repertoire insert, the caller's repertoire
insert and the playlist insert (3 statements); for a personal playlist, 2. The
set of rows written is identical to today's. The L1 catch and its
`Failed to add song to playlist: ${err.message}` text are unchanged.

What serialises two concurrent adds is the constraint below, not the `SELECT`:
under `READ COMMITTED` the second insert cannot see the first's uncommitted row,
computes the same `position`, and then blocks on the unique index until the
first transaction ends - at which point it fails with `23505` on
`uq_playlist_song_position` instead of writing a duplicate. That block is the
observable the concurrency test of step 9 must wait for (via the waiting
backend's own `pg_locks` row) before it lets the first transaction commit;
releasing earlier lets the second insert start after the commit, read the
committed row, and legitimately compute the next position.

New migration `migrations/0007_add_playlist_song_position_unique.sql` - the
seventh file, continuing the four-digit numbering that
`src/lib/__tests__/migrationsSingleSource.test.ts` enforces, and the only
migrations directory:

```sql
-- RH-36 (F18): playlist ordering is only meaningful if positions are unique
-- within a playlist. Existing rows can already hold duplicates: positions were
-- assigned as COUNT(*) + 1 while removals never renumbered, so a delete
-- followed by an add produced a collision. Renumber every playlist to a
-- contiguous 1..n in its current order first, then add the constraint.
WITH renumbered AS (
    SELECT id, row_number() OVER (PARTITION BY playlist_id ORDER BY position, id) AS rn
    FROM playlist_songs
)
UPDATE playlist_songs ps
SET    position = r.rn
FROM   renumbered r
WHERE  ps.id = r.id
AND    ps.position <> r.rn;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_playlist_song_position') THEN
        ALTER TABLE playlist_songs
            ADD CONSTRAINT uq_playlist_song_position UNIQUE (playlist_id, position);
    END IF;
END
$$;
```

`scripts/migrate.mjs` already wraps each file in `BEGIN`/`COMMIT` and records it
in `_migrations`, so it is applied once by `npm run db:migrate` and by
`docker/init-migrations.sh` on first boot; the `IF NOT EXISTS` guard makes a
manual re-apply a no-op as well. A plain (non-deferrable) constraint is correct
here because no code path renumbers positions in place: the only bulk rewrite is
the resync of step 5, whose deletes and inserts share one transaction.

### 8. Convention note in `AGENTS.md`

Add one new top-level section `# Transactions`, placed immediately after
`# Error Handling Conventions` and before `# UI & UX Behavioral Directives`,
one paragraph: every multi-statement write that must be atomic goes through
`withTransaction` from `@/lib/db`, which checks one client out of the pool and
issues `BEGIN`/`COMMIT`/`ROLLBACK` on that client; `query()` is
`pool.query()` and issuing transaction control through it is forbidden and
enforced by `src/lib/__tests__/transactionGuard.test.ts`; inside a transaction,
an expected duplicate is handled with `ON CONFLICT DO NOTHING` and never by
catching `23505`, because a caught `23505` leaves the transaction aborted.

### 9. Test plan

Four new files, plus updates to the suites whose `@/lib/db` mocks or statement
expectations change.

**`src/lib/__tests__/withTransaction.test.ts`** (no database). Drives a fake
client through `vi.spyOn(pool, 'connect')`: commit path returns the callback
result and issues `BEGIN` then `COMMIT`; a throwing callback issues `ROLLBACK`
and rethrows the original error object; `release()` is called on both paths and
also when `ROLLBACK` itself rejects. The statement assertions read the mock's
recorded arguments (for example
`expect(queryMock.mock.calls.map((c) => c[0])).toEqual(['BEGIN', 'COMMIT'])`)
rather than invoking `query` with a transaction-control literal, so this file
too stays clear of the banned form.

**`src/lib/__tests__/transactionGuard.test.ts`** (no database). Uses the
existing scanner `findViolations(pattern, { skip })` from
`src/lib/__tests__/test-helpers.ts` with `skip: 'src/lib/db.ts'` and a pattern
matching a transaction-control keyword passed as a string literal to a `query(`
call, asserting zero violations; a second test feeds the detector a sample
line built by string concatenation (as `errorHandlingStyle.test.ts` does) so
the file never contains the banned literal itself and a plain grep does not
flag it.

`findViolations` accepts exactly one `skip` path
(`src/lib/__tests__/test-helpers.ts:309-326`), and that one path is spent on
`src/lib/db.ts`. So the ban is absolute for every other file under `src/`,
**test files included**: no new or edited test may write
`client.query('BEGIN')`, `query('COMMIT')` or any other transaction-control
literal. Where a test needs a transaction of its own - the concurrency case
below is the only one - it opens it with `withTransaction`, never by hand.

**`src/lib/__tests__/transactionAtomicity.db.test.ts`** (real database,
`describe.skipIf(!SERVICE_ROLE_KEY)` like the other `*.db.test.ts` files, users
created with `createTestUser` from `test-helpers.ts` and torn down in
`afterAll`). Fault injection is done at the database, not by mocking: a
`BEFORE UPDATE`/`BEFORE INSERT` trigger whose `WHEN` clause names exactly the
one fixture row, calling a function that does
`RAISE EXCEPTION 'RH-36 injected failure'`, created in the test and dropped in
`afterEach`. Scoping the trigger by row id matters because vitest runs files in
parallel workers and these tables are shared with the other database suites.
The four cases: the repertoire update of `updateSong` fails and `global_songs`
must be unchanged; the `profiles` update of `updateEmail` fails and the
`"user"` row must be unchanged; the `global_song_edits` update of
`reviewGlobalSongEdit` fails and `global_songs` must be unchanged with the edit
still `pending`; and, after those failures,
`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction'`
is 0 (polled, because `pg_stat_activity` is updated at statement boundaries).

The same file carries the two F18 position cases. The first is the
removal-then-add sequence, which produces a duplicate position today. The
second is the concurrent add, and it must be built out of two overlapping
`withTransaction` calls coordinated by a promise barrier - not out of two
clients checked out of `pool` with a hand-written `BEGIN`, which the guard of
ER2 forbids in every file but `src/lib/db.ts`. Shape: the first
`withTransaction` callback runs the position-computing insert for song A,
resolves a barrier promise the test awaits, then awaits a release promise the
test resolves later, so the transaction stays open; while it is open the test
starts a second `withTransaction` for song B and does not await it, whose
callback publishes its own backend pid (`SELECT pg_backend_pid()`, resolved
into a second barrier promise) before running the same insert; under
`READ COMMITTED` that insert cannot see A's uncommitted row, computes the same
position and blocks on the unique index; the test waits for the block to be
real before releasing anything, by polling
`SELECT count(*)::int FROM pg_locks WHERE pid = <pid> AND NOT granted` through
the pool-level `query()` helper until it is at least 1, bounded at 50 polls of
100 ms with an explicit failure when the bound is exhausted; only then does it
resolve the release promise, so A commits while B is already waiting, and the
second call rejects with `23505` on `uq_playlist_song_position`, which
`withTransaction` rolls back and rethrows unwrapped.

The poll is load-bearing, not defensive: without it the second call is still
inside `pool.connect()` when the release resolves, its insert then opens a
fresh `READ COMMITTED` snapshot that already contains A's committed row,
computes `MAX(position) + 1 = 2` and commits, and the test passes against the
buggy and the fixed code alike. It must be scoped to the second transaction's
own pid. A database-wide count over `pg_locks` or `pg_stat_activity` is not a
substitute: `*.db.test.ts` files run against one shared database in parallel
vitest workers, so an unrelated suite's lock would release the barrier early.
Bounding the poll matters for the same reason ER3(d) bounds its own: a wait
that never becomes true must fail with a readable assertion rather than hang
until the vitest timeout. Because this test holds a transaction open while a
second one blocks, keep it clear of `pool` exhaustion - it needs three
connections at once (two transactions and the polling `query()`), well inside
`max: 10`.

**`src/lib/__tests__/spotifySyncAtomicity.db.test.ts`** (real database). Mocks
`@/lib/auth-session`, `@/lib/spotifyAuth` and `global.fetch` exactly as
`src/lib/__tests__/spotifyPlaylistRouteAuthz.db.test.ts` already does (reuse its
`oneTrackPage` fixture shape), and drives `POST` of the sync route. Case 1
(F9): a `BEFORE INSERT` trigger scoped to the fixture playlist makes the
re-insert fail; the response is 500 and the playlist still holds its original
rows in their original order with `last_synced_at` still NULL. Case 2 (F19): a
pull on a band playlist with three members leaves one band repertoire row and
three member rows for the synced song, and answers `{ added: 1, removed: 0 }`.

**Existing suites that must be updated.** Their `vi.mock('@/lib/db', ...)`
factories must gain `withTransaction: async (fn) => fn({ query })` - passing a
fake client whose `query` is the same mock function - so their existing
per-statement assertions keep working with the `BEGIN`/`COMMIT` calls gone:
`src/lib/__tests__/moderation.test.ts` (also renumber the
`toHaveBeenNthCalledWith(4, ...)` assertion to 3),
`src/lib/__tests__/errors.test.ts` and `src/lib/__tests__/edge_cases.test.ts`
(their SQL dispatchers must match `insert into playlist_songs` before any
`from playlist_songs` branch, since the new insert contains both, and the
`count(*) as count from playlist_songs` branch is dead),
`src/lib/__tests__/spotifyPlaylistSync.test.ts` (add `pool` to the mocked
module, replace the per-member expectations with the two set-based statements,
drop the `23505`-swallow cases). `src/lib/__tests__/songs.test.ts`,
`src/lib/__tests__/profile.test.ts` and `src/lib/__tests__/playlists.test.ts`
are real-database suites and should keep passing unchanged; adjust them only if
they assert on a statement whose text changed. The header comment of
`src/lib/__tests__/spotifyPlaylistRouteAuthz.db.test.ts` says the resync has no
transaction "(finding F4 / RH-36)" - update that sentence.

## Expected Results

ER1 - `src/lib/db.ts` exports `withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>`, which checks a client out of the pool with `pool.connect()`, issues `BEGIN`, runs `fn(client)`, issues `COMMIT` and returns the callback result; when `fn` throws it issues `ROLLBACK` and rethrows the original error unwrapped; and it calls `client.release()` in a `finally` on every path, including the path where `ROLLBACK` itself rejects. Verify: `grep -n 'export async function withTransaction' src/lib/db.ts` prints exactly one line, and `npx vitest run src/lib/__tests__/withTransaction.test.ts` prints `Test Files  1 passed (1)` and `Tests  4 passed (4)` with 0 failed and 0 skipped. That file needs no database (it stubs `pool.connect` with `vi.spyOn`) and must contain tests named exactly `commits and returns the callback result`, `rolls back and rethrows when the callback throws`, `releases the client when the callback throws`, and `releases the client even when ROLLBACK itself fails`.

ER2 - No file under `src/` other than `src/lib/db.ts` passes a bare transaction-control statement to a query function. Verify: `grep -rn -E "query\('(BEGIN|COMMIT|ROLLBACK)'\)" src` prints exactly three lines, all of them in `src/lib/db.ts` (`client.query('BEGIN')`, `client.query('COMMIT')`, `client.query('ROLLBACK')`), and `grep -rn -E "query\('(BEGIN|COMMIT|ROLLBACK)'\)" src | grep -c -v '^src/lib/db.ts:'` prints `0`. At `6ec6301` the same first command printed nine lines across `src/lib/moderation.ts`, `src/lib/profile.ts` and `src/lib/songs.ts`. The rule is also enforced mechanically: `npx vitest run src/lib/__tests__/transactionGuard.test.ts` prints `Test Files  1 passed (1)` and `Tests  2 passed (2)`, one test asserting the scan of `src/` (with `src/lib/db.ts` skipped) reports zero violations and one asserting the detector does match a sample offending line.

ER3 - The three F4 paths are atomic and leak nothing. Verify with `SUPABASE_SERVICE_ROLE_KEY=local DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run src/lib/__tests__/transactionAtomicity.db.test.ts`, which must print `Test Files  1 passed (1)` and at least `Tests  6 passed (6)` with 0 failed and 0 skipped (run `npm run db:migrate` first). The file must contain, and pass, these four tests, each injecting the failure with a `BEFORE UPDATE` trigger scoped by a `WHEN` clause to the single fixture row and dropped afterwards: (a) `updateSong leaves global_songs untouched when the repertoire update fails` - fixture is a `global_songs` row with `album` and `standard_key` NULL plus a `repertoire` row for a fresh test user with `status = 'unknown'`, `tags = '{}'`, `personal_key` NULL; the trigger is on `repertoire`; `updateSong` is called with a non-empty album, key `C`, status `learning` and tags `['rh36']`; the call rejects with a message starting `Failed to update song:` and afterwards `SELECT album, standard_key FROM global_songs WHERE id = <song>` still returns two NULLs and `SELECT status, tags, personal_key FROM repertoire WHERE id = <entry>` still returns `unknown`, `{}`, NULL; (b) `updateEmail leaves the user row untouched when the profiles update fails` - trigger on `profiles`; the call rejects with a message starting `Failed to update email:` and `SELECT email FROM "user" WHERE id = <user>` still returns the original address; (c) `reviewGlobalSongEdit leaves global_songs untouched when marking the edit reviewed fails` - fixture is a system-admin profile and a `pending` `global_song_edits` row proposing a new title, trigger on `global_song_edits`; the call rejects with a message starting `Failed to review global song edit:` and afterwards the `global_songs` title is the original and `SELECT status FROM global_song_edits WHERE id = <edit>` is still `pending`; (d) `leaves no connection idle in transaction after a failed write` - after the three failures above, `SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction'` is `0` (polled up to 20 times at 100 ms because `pg_stat_activity` updates at statement boundaries).

ER4 - A failing re-insert in the Spotify pull resync leaves the playlist intact. Verify with `SUPABASE_SERVICE_ROLE_KEY=local DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run src/lib/__tests__/spotifySyncAtomicity.db.test.ts`, which must print `Test Files  1 passed (1)` and at least `Tests  2 passed (2)`, 0 failed, 0 skipped. It must contain a test named `a failing playlist_songs insert leaves the original playlist rows intact` whose fixture is a personal playlist owned by a fresh test user, linked to Spotify (`spotify_playlist_id` set) and holding two `playlist_songs` rows at positions 1 and 2, with the session and the Spotify token mocked and `global.fetch` stubbed to return a one-track page; a `BEFORE INSERT` trigger on `playlist_songs` with `WHEN (NEW.playlist_id = <playlist>)` raising an exception is installed and dropped afterwards; the test calls `POST` of `src/app/api/spotify/playlists/[id]/sync/route.ts` with body `{"direction":"pull"}` and asserts the response status is `500`, then that `SELECT song_id, position FROM playlist_songs WHERE playlist_id = <playlist> ORDER BY position` still returns exactly the original two rows in the original order, and that `SELECT last_synced_at FROM playlists WHERE id = <playlist>` is still NULL.

ER5 - Migration `migrations/0007_add_playlist_song_position_unique.sql` exists, repairs duplicate positions before constraining them, and applies cleanly on top of the existing schema. Verify on a throwaway database: `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c 'DROP DATABASE IF EXISTS rh36_probe'` then `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c 'CREATE DATABASE rh36_probe'`; apply the first six files with `for f in migrations/000[1-6]_*.sql; do psql postgresql://postgres:postgres@127.0.0.1:54322/rh36_probe -v ON_ERROR_STOP=1 -q -f "$f" || echo FAILED; done` (prints no `FAILED`); seed a colliding pair with `psql postgresql://postgres:postgres@127.0.0.1:54322/rh36_probe -v ON_ERROR_STOP=1 -q -c "INSERT INTO \"user\" (id, name, email) VALUES ('11111111-1111-1111-1111-111111111111','RH36','rh36@example.com'); INSERT INTO profiles (id, email) VALUES ('11111111-1111-1111-1111-111111111111','rh36@example.com'); INSERT INTO global_songs (id, title, artist) VALUES ('22222222-2222-2222-2222-222222222222','A','X'),('33333333-3333-3333-3333-333333333333','B','X'); INSERT INTO playlists (id, user_id, name) VALUES ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111','P'); INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES ('44444444-4444-4444-4444-444444444444','22222222-2222-2222-2222-222222222222',1),('44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',1);"`; then `psql postgresql://postgres:postgres@127.0.0.1:54322/rh36_probe -v ON_ERROR_STOP=1 -q -f migrations/0007_add_playlist_song_position_unique.sql` exits 0, after which `psql postgresql://postgres:postgres@127.0.0.1:54322/rh36_probe -At -c "SELECT position FROM playlist_songs WHERE playlist_id='44444444-4444-4444-4444-444444444444' ORDER BY position"` prints exactly `1` then `2`, and `psql postgresql://postgres:postgres@127.0.0.1:54322/rh36_probe -At -c "SELECT count(*)::int FROM pg_constraint WHERE conname = 'uq_playlist_song_position'"` prints `1`; re-running the same `-f migrations/0007_...` command exits 0 again (idempotent). Drop the probe with `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c 'DROP DATABASE rh36_probe'`. `scripts/migrate.mjs` overwrites `DATABASE_URL` from `.env.local` (line 24), so `npm run db:migrate` always targets the test database and the runner check must make itself repeatable there: run `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "DELETE FROM _migrations WHERE name = '0007_add_playlist_song_position_unique.sql'"` and then `npm run db:migrate`, which must print `Executing migration: 0007_add_playlist_song_position_unique.sql` followed by `Migration successful: 0007_add_playlist_song_position_unique.sql` even though the constraint is already present (that is the idempotence of the `IF NOT EXISTS` guard, re-applied against a live schema); running `npm run db:migrate` once more, without the `DELETE`, prints `Skipping migration: 0007_add_playlist_song_position_unique.sql (already executed)` instead.

ER6 - Playlist positions are computed in SQL and collisions are rejected loudly. Verify: `grep -c 'COALESCE(MAX(position), 0) + 1' src/lib/playlists.ts` prints `1` and `grep -c 'COUNT(\*) as count FROM playlist_songs' src/lib/playlists.ts` prints `0` (it printed `1` at `6ec6301`). The suite from ER3, `src/lib/__tests__/transactionAtomicity.db.test.ts`, must also contain and pass: (a) `assigns MAX(position) + 1 so a removal does not produce a duplicate position` - add three songs to a fresh personal playlist with `addSongToPlaylist`, remove the one at position 1 with `removeSongFromPlaylist`, add a fourth, then assert `SELECT position FROM playlist_songs WHERE playlist_id = <playlist> ORDER BY position` returns exactly `2, 3, 4` (at `6ec6301` the fourth add produced a second row at position 3); (b) `rejects two concurrent inserts that would take the same position` - on a fresh empty personal playlist, and without writing any transaction-control literal anywhere in the file (ER2 bans it outside `src/lib/db.ts`, and the guard skips only that one path), open two overlapping transactions with `withTransaction`, in exactly these four steps: (1) the first callback runs the position-computing insert for song A, resolves a barrier promise the test awaits, then awaits a release promise the test controls, so its transaction stays open; (2) while it is open the test starts a second `withTransaction` and does not await it, whose callback first runs `SELECT pg_backend_pid()` and publishes that pid to the test (resolving a second barrier promise with it) and only then runs the same position-computing insert for song B, which under READ COMMITTED cannot see A's uncommitted row, computes the same position and blocks on the unique index; (3) the test awaits the published pid and then, on the pool-level `query()` helper rather than on either transaction's client, polls `SELECT count(*)::int FROM pg_locks WHERE pid = <pid> AND NOT granted` until it is at least `1`, up to 50 times at 100 ms, and fails the test with an explicit assertion if the bound is exhausted, so a second transaction that never blocks fails fast instead of hanging until the vitest timeout - the poll must be scoped to that one pid and must not be a database-wide `pg_stat_activity` or `pg_locks` count, because `*.db.test.ts` files share one database with other suites running in parallel vitest workers and an unrelated worker would satisfy an unscoped count; (4) only after the poll succeeds does the test resolve the release promise, so the first transaction commits while the second is already waiting on its lock. It then asserts the second `withTransaction` promise rejects with a Postgres error whose message contains `uq_playlist_song_position`, after which `SELECT song_id, position FROM playlist_songs WHERE playlist_id = <playlist>` returns exactly one row, song A at position 1. Without step (3) this test does not fail on the code under test: the second call is still inside `pool.connect()` when the release resolves, so its insert takes a fresh READ COMMITTED snapshot after A commits, sees A's row, computes `MAX(position) + 1 = 2` and succeeds.

ER7 - `ensureInRepertoire` issues one statement per band instead of two per member, with unchanged results. Verify: `npx vitest run src/lib/__tests__/spotifyPlaylistSync.test.ts` prints `Test Files  1 passed (1)` with 0 failed and 0 skipped, and contains a test named `issues exactly two statements for a band owner regardless of member count` asserting the mocked `query` is called exactly twice for `ensureInRepertoire('song-1', { bandId: 'band-1' })` - the first an `INSERT INTO repertoire (band_id, song_id, status)` ending in `ON CONFLICT DO NOTHING`, the second an `INSERT INTO repertoire (user_id, song_id, status) SELECT ... FROM band_members ... ON CONFLICT DO NOTHING` - plus a test named `issues exactly one statement for a personal owner`; at `6ec6301` the band case issued 3 + 2N statements for N members. The results are unchanged end to end: the suite from ER4, `src/lib/__tests__/spotifySyncAtomicity.db.test.ts`, contains and passes `seeds the band row and every member repertoire row on a pull`, which pulls a one-track Spotify playlist into a band playlist whose band has three members and asserts the JSON response body equals `{"added":1,"removed":0}`, `SELECT count(*)::int FROM repertoire WHERE song_id = <song> AND band_id = <band>` is `1`, and `SELECT count(*)::int FROM repertoire WHERE song_id = <song> AND user_id IS NOT NULL` is `3`.

ER8 - The whole suite is green against a live database. With `npm run db:migrate` applied to `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, `SUPABASE_SERVICE_ROLE_KEY=local DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run` reports at least `51 passed` test files and at least `632 passed` tests, with `0 failed` and no skipped tests (baseline at `6ec6301`: 47 files, 624 tests, 0 skipped). The four new files `src/lib/__tests__/withTransaction.test.ts`, `src/lib/__tests__/transactionGuard.test.ts`, `src/lib/__tests__/transactionAtomicity.db.test.ts` and `src/lib/__tests__/spotifySyncAtomicity.db.test.ts` all appear in the run and pass.

ER9 - The static gates hold. `npx tsc --noEmit` exits 0 and prints nothing, and `git status --porcelain` reports no new untracked build artifact afterwards. `npx eslint .` prints the summary line `30 problems (12 errors, 18 warnings)` - identical to `6ec6301`, so the change adds no new lint problem (the command exits 1 at the baseline too; the summary line, not the exit code, is the check). `npm run lint:dup` exits 0 and reports at most 21 clones and at most 1.20 % duplicated lines (baseline: 19 clones, 239 duplicated lines, 0.99 %). `npm run lint:dead` exits 0 with no unused files, exports or dependencies reported - in particular `withTransaction` and `Queryable` are both consumed. `npm run audit` reports `found 0 vulnerabilities`.

ER10 - The coverage gate holds. `SUPABASE_SERVICE_ROLE_KEY=local DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run test:coverage` exits 0, prints no line containing `does not meet global threshold`, and its `All files` row shows statements at least 80, branches at least 65, functions at least 78 and lines at least 80 (the four thresholds configured in `vitest.config.ts`). Cite the four numbers from the `All files` row of the run you perform; per-file numbers, if cited, may be read from `coverage/coverage-final.json`, because the text table omits files at 100 %.

ER11 - Authorized behaviour is unchanged. `SUPABASE_SERVICE_ROLE_KEY=local DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run src/lib/__tests__/spotifyPlaylistRouteAuthz.db.test.ts src/app/actions/__tests__/authzPlaylists.db.test.ts src/app/actions/__tests__/authzRepertoire.db.test.ts src/app/actions/__tests__/authzBands.db.test.ts` reports `Test Files  4 passed (4)` with 0 failed and 0 skipped, so the RH-34 and RH-35 ownership guards still refuse foreign resources before any write. `npx next build` exits 0. `npx playwright test e2e/ssr-smoke.spec.ts` prints `4 passed`.

ER12 - Version, landing copy and the convention note. `node -p "require('./package.json').version"` prints a value matching `^0\.1\.71-[0-9]{12}$` and strictly greater than the baseline `0.1.70-202609062348`. This task ships no selling point (transaction safety is internal correctness), so the landing page is untouched: `git diff --stat 6ec6301 -- src/components/landing src/i18n/dictionaries` prints nothing. `AGENTS.md` gains exactly one new top-level section: `grep -c '^# Transactions$' AGENTS.md` prints `1`, that section sits between `# Error Handling Conventions` and `# UI & UX Behavioral Directives`, is a single paragraph, and mentions `withTransaction`, that `query()` must never carry `BEGIN`, `COMMIT` or `ROLLBACK`, and that an expected duplicate inside a transaction is handled with `ON CONFLICT DO NOTHING` rather than by catching `23505`.

ER13 - The change stays inside its scope. `git diff --name-only 6ec6301` lists only paths from this whitelist (not every path is required, but no path outside it may appear): `docs/tasks/RH-36-spec.md`, `docs/suggestions-log.md`, `package.json`, `AGENTS.md`, `migrations/0007_add_playlist_song_position_unique.sql`, `src/lib/db.ts`, `src/lib/songs.ts`, `src/lib/profile.ts`, `src/lib/moderation.ts`, `src/lib/playlists.ts`, `src/lib/spotifyPlaylistSync.ts`, `src/app/api/spotify/playlists/[id]/sync/route.ts`, `src/lib/__tests__/withTransaction.test.ts`, `src/lib/__tests__/transactionGuard.test.ts`, `src/lib/__tests__/transactionAtomicity.db.test.ts`, `src/lib/__tests__/spotifySyncAtomicity.db.test.ts`, `src/lib/__tests__/moderation.test.ts`, `src/lib/__tests__/errors.test.ts`, `src/lib/__tests__/edge_cases.test.ts`, `src/lib/__tests__/spotifyPlaylistSync.test.ts`, `src/lib/__tests__/spotifyPlaylistRouteAuthz.db.test.ts`, `src/lib/__tests__/songs.test.ts`, `src/lib/__tests__/profile.test.ts`, `src/lib/__tests__/playlists.test.ts`, `src/lib/__tests__/test-helpers.ts`. In particular no file under `src/components/`, `src/app/**/page.tsx`, `e2e/` or `.github/` is modified, and no second migrations directory is created (`npx vitest run src/lib/__tests__/migrationsSingleSource.test.ts` passes).

## Out of Scope

- **Batching `findOrCreateGlobalSong` across the track list** (the second half of
  the F19 remediation). It is a latency optimisation on a different axis
  (per-track network and catalog round trips), it changes the sanitisation and
  duplicate-detection path that RH-13 owns, and it can be measured on its own.
  This task only removes the per-member fan-out inside `ensureInRepertoire`.
- **Replacing the resync with an upsert that preserves `playlist_songs` ids**
  (the alternative in F9). Delete-then-insert inside a transaction removes the
  data-loss window, which is the finding. Id churn has no consumer today (no
  table references a `playlist_songs` id) and changing the shape would require
  a deferrable constraint, which the constraint in step 7 deliberately is not.
- **Renumbering positions on removal.** `removeSongFromPlaylist` keeps leaving a
  gap; `MAX(position) + 1` handles gaps correctly and the constraint tolerates
  them. Contiguity is a product decision, not an integrity one.
- **The other transaction-shaped call sites that are single-statement writes.**
  Nothing that currently issues exactly one statement is wrapped, because a
  single statement is already atomic in Postgres.
- **F8 (SQL in the Server Action layer), F5/F1-F3 (authorization) and the
  `global_song_edits` payload validation of F17.** They are separate tasks
  (T4, T1/T2, and the F17 remediation respectively); this task must not change
  any authorization predicate or validation rule.
- **CI workflow changes.** The new tests run under the existing `vitest` and
  `Coverage (vitest)` jobs, which already start a `postgres:16` service and run
  `npm run db:migrate` first.

## Post-merge checks (orchestrator)

Not expected results, and not verifiable before merge: confirm the `Coverage
(vitest)` and `Duplication (jscpd)` GitHub Actions jobs are green on the merge
commit, and that the Vercel deployment ran `node scripts/migrate.mjs` (the
`build` script) so `0007_add_playlist_song_position_unique.sql` is recorded in
`_migrations` on the production database.

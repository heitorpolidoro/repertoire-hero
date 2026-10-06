/**
 * RH-124 — the split migration against a real Postgres.
 *
 * `scripts/migrate.mjs` applies each migration file once per database and
 * records it in `_migrations`, so by the time any other `*.db.test.ts` runs the
 * schema is already the post-migration one and nothing has replayed the file.
 * This suite replays it, on the recipe RH-95 established and RH-123 adopted:
 *
 *  1. the file is resolved off disk by its `_split_repertoire_owner_songs.sql`
 *     **suffix**, never by a four-digit prefix — several approved specs each
 *     claim "the next number", so whichever lands second renumbers and a prefix
 *     written into a test would break on that renumber;
 *  2. the pre-migration shape is rebuilt inside one transaction (Postgres makes
 *     DDL transactional), the file is executed against seeded rows, the
 *     assertions are taken, and the transaction is **always** rolled back. The
 *     shared database never leaves its migrated shape. The legacy shape itself
 *     comes from `legacyCatalogReplayDdl` / `LEGACY_REPERTOIRE_TABLE` in
 *     `test-helpers.ts`, the one place the dropped table is named under `src/`
 *     (ER5).
 *
 * WHERE THE REPLAY HAPPENS, AND WHY IT MOVED (RH-129)
 *
 * In a **throwaway `rh124_<token>` schema**, built by `legacyCatalogReplayDdl`
 * and first on the transaction's `search_path`, so every unqualified name in
 * the migration file resolves inside it and nothing in `public` is touched.
 *
 * It used to rebuild the legacy shape in `public`, which meant dropping
 * `public.user_songs`, `public.band_songs` and `public.orphaned_repertoire_rows`
 * to get back to the pre-migration state. That is the deadlock: both owner
 * tables carry foreign keys to `profiles`, `bands` and `song_versions`, so
 * `DROP TABLE user_songs` needs ACCESS EXCLUSIVE on the *referenced* relations
 * too, and an ordinary suite holding AccessShare on `songs` / `song_versions`
 * and then asking for RowExclusive is taking the same relations the other way
 * round. Postgres breaks the cycle by killing one transaction at random, which
 * reads as an unrelated suite failing with `deadlock detected`. Measured at 2
 * occurrences in 24 full runs, in this file and `songFilesMigration`, *with*
 * the advisory lock those two shared — the lock serialised them against each
 * other, and the other party in the cycle was never the other replay. The
 * schema removes the shared relation instead, so there is no lock to order and
 * none to take: see the note in `test-helpers.ts` where that lock used to be.
 *
 * TWO CONSEQUENCES OF THE MOVE, BOTH LOAD-BEARING
 *
 *  - `migrations/0014` has to run in the schema **first**. Step 2 of this
 *    migration calls `migrate_catalog_to_versions()` and step 5 reads `albums`
 *    and `song_versions`; a throwaway schema carries none of the three, and
 *    borrowing `public`'s function would write RH-124's rows into `public`'s
 *    tables. `catalogVersionsMigration.db.test.ts` runs `0014` in its own
 *    replay schema for the same reason.
 *  - `0014` issues an **unqualified** `DROP INDEX IF EXISTS
 *    uq_songs_artist_title`, and an unqualified index name resolves along the
 *    `search_path`. With no such index in the replay schema that statement
 *    finds and drops **`public`'s**, silently removing the live catalog's
 *    identity key for every other worker — verified empirically, not inferred.
 *    So the scenario creates that index in the schema before running `0014`,
 *    exactly as `catalogVersionsMigration` does, and
 *    `publicIdentityIndexes` below asserts `public`'s own copy survived.
 *
 * It is this task's only guard on its one irreversible act — every musician's
 * status, tags, key, lyrics and practice date crossing from one table into two,
 * after which the source is dropped — which is why `RUN_DB_TESTS=1` matters
 * here more than anywhere else: skipped, this file asserts nothing at all.
 *
 * **Conservation (ER3) is the assertion that cannot be replaced by any other.**
 * A row that silently disappeared leaves no trace once `repertoire` is gone, so
 * the count is captured *before* the file runs and compared against the three
 * places a row can legitimately have gone. It is specifically what catches the
 * representative-version ordering written as an inner join through `albums`.
 *
 * No transaction-control literal appears in this file: the scenario opens its
 * transaction with `withTransaction`, the only sanctioned way
 * (`transactionGuard.test.ts`), and unwinds it by throwing a sentinel.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { withTransaction, type Queryable } from '@/lib/db'
import {
  legacyCatalogReplayDdl,
  LEGACY_REPERTOIRE_TABLE,
  LEGACY_TABS_TABLE,
  migrationSqlBySuffix,
  ownerStubsDdl,
} from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'migrations')
/** The stable half of the migration's name; the four-digit prefix may move. */
const MIGRATION_SUFFIX = '_split_repertoire_owner_songs.sql'

/**
 * The prerequisite migration, by suffix for the same reason: it installs
 * `migrate_catalog_to_versions()`, `albums` and `song_versions`, which the
 * replay schema has none of and this migration's steps 2 and 5 all need.
 */
const CATALOG_VERSIONS_SUFFIX = '_add_albums_and_song_versions.sql'

/** The catalog identity index — see the header on why it is created by hand. */
const SONGS_UNIQUE = 'uq_songs_artist_title'

function migrationFileNames(): string[] {
  return fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(MIGRATION_SUFFIX))
}

function migrationSql(): string {
  const names = migrationFileNames()
  if (names.length !== 1) {
    throw new Error(`expected exactly one *${MIGRATION_SUFFIX} migration, found ${names.length}`)
  }
  return fs.readFileSync(path.join(MIGRATIONS_DIR, names[0]), 'utf8')
}

/** One carried row, as it lands in `user_songs` or `band_songs`. */
interface CarriedRow {
  id: string
  version_id: string
  song_id: string
  status: string
  key: string | null
  tuning: string | null
  lyrics: string | null
  map: unknown
  tags: string[]
  last_practiced: string | null
}

interface MigrationScenario {
  /** `count(*) FROM repertoire` for the seeded fixture, captured before the run. */
  seededCount: number
  userRows: CarriedRow[]
  bandRows: CarriedRow[]
  orphans: { reason: string; row_json: Record<string, unknown> }[]
  /** The version the album-less song's only recording lives on. */
  albumlessVersionId: string
  /** The version of the song whose album carries a null release_date. */
  nullDateVersionId: string
  legacyTableSurvives: boolean
  userSongsColumns: string[]
  bandSongsColumns: string[]
  /**
   * `public`'s own `uq_songs_artist_title`, read while the replay is still
   * live. Guards trap 1 from the file header: `0014`'s unqualified
   * `DROP INDEX IF EXISTS` must have hit the replay schema's copy, not this one.
   */
  publicIdentityIndexes: string[]
}

const ROLLBACK = 'RH-124 split migration scenario rollback'

const CARRIED = `o.id, o.version_id, o.status::text AS status, o.key, o.tuning, o.lyrics,
                 o.map, o.tags, o.last_practiced::text AS last_practiced`

async function insertId(client: Queryable, sql: string, params: unknown[]): Promise<string> {
  const res = await client.query<{ id: string }>(sql, params)
  return res.rows[0].id
}

async function runMigrationScenario(): Promise<MigrationScenario> {
  const sql = migrationSql()
  const token = randomUUID().replace(/-/g, '').slice(0, 12)
  const schema = `rh124_${token}`
  let scenario: MigrationScenario | undefined

  await withTransaction(async (client) => {
    // The pre-migration shape, in a schema of its own: `songs` and the
    // owner-row table RH-124 dropped. `test-helpers.ts` is the one place that
    // table is named under `src/` (ER5).
    //
    // No `DROP TABLE user_songs` / `band_songs` / `orphaned_repertoire_rows` is
    // needed or wanted any more: this schema has none of the three, and the
    // migration's own `CREATE TABLE IF NOT EXISTS` resolves for creation in the
    // first schema on the `search_path`, so it creates them *here* even though
    // `public` holds all three names. Issuing those drops was the deadlock (see
    // the file header).
    //
    // `ownerStubsDdl` is what keeps the migration's own foreign keys inside the
    // schema: `user_songs.user_id REFERENCES profiles(id)` and
    // `band_songs.band_id REFERENCES bands(id)` are unqualified, and without
    // local tables they would resolve to `public`'s and take
    // SHARE ROW EXCLUSIVE on two tables every other worker inserts into.
    await client.query(legacyCatalogReplayDdl(schema))
    await client.query(ownerStubsDdl(schema))
    await client.query(`SET LOCAL search_path = ${schema}, public`)

    // Trap 1 (file header): `0014` below issues an unqualified
    // `DROP INDEX IF EXISTS uq_songs_artist_title`. With no such index in this
    // schema the statement resolves along the `search_path` and drops
    // **`public`'s**. Creating it here is also the state `0014` really runs
    // against in production.
    await client.query(
      `CREATE UNIQUE INDEX ${SONGS_UNIQUE} ON ${schema}.songs (lower(btrim(artist)), lower(btrim(title)))`,
    )

    // The prerequisite, over an **empty** `songs`: `0014` ends by calling its
    // own backfill, so running it before anything is seeded keeps that call a
    // no-op and leaves every fixture below authored by hand. What this buys is
    // `migrate_catalog_to_versions()`, `albums` and `song_versions`, all three
    // inside this schema.
    await client.query(migrationSqlBySuffix(CATALOG_VERSIONS_SUFFIX))

    // `0015` ran between `0014` and this migration in production, and what it
    // did that matters here is drop the legacy tabs table. The replay schema
    // gets that table from `legacyCatalogReplayDdl` (the other three replays
    // need it), and its foreign key into the owner-row table is the one object
    // that still depends on it — so step 6's `DROP TABLE repertoire` fails with
    // `other objects depend on it` unless the tabs table goes first, exactly as
    // it had already gone on a real database. Dropped **after** `0014`, because
    // `0014`'s collapse branch names it, and **schema-qualified**, because an
    // unqualified drop of a live application table is the whole class of
    // statement this conversion removes.
    await client.query(`DROP TABLE ${schema}.${LEGACY_TABS_TABLE}`)

    // Synthetic owners, registered in the schema's stubs so step 5's inserts
    // satisfy their foreign keys. No `"user"` row and no real `profiles` /
    // `bands` row: nothing the migration issues reads a column of any of them,
    // and seeding them in `public` would put this replay back in the lock graph
    // it just left.
    const userId = randomUUID()
    const bandId = randomUUID()
    await client.query('INSERT INTO profiles (id) VALUES ($1)', [userId])
    await client.query('INSERT INTO bands (id) VALUES ($1)', [bandId])

    // ---- four catalog songs, each a different shape of the version pick ----
    const song = async (label: string) =>
      insertId(client, 'INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id', [
        `RH-124 ${label} ${token}`,
        `RH-124 Artist ${token}`,
      ])
    const userSongId = await song('User Song')
    const bandSongId = await song('Band Song')
    const albumlessSongId = await song('Albumless Song')
    const nullDateSongId = await song('Null Date Song')

    // The first two get an album and a version each, through the normal shape.
    const albumId = await insertId(
      client,
      `INSERT INTO albums (artist, name, album_type, release_date)
       VALUES ($1, $2, 'album', '1991-01-01') RETURNING id`,
      [`RH-124 Artist ${token}`, `RH-124 Album ${token}`],
    )
    for (const id of [userSongId, bandSongId]) {
      await client.query(
        'INSERT INTO song_versions (song_id, album_id, label) VALUES ($1, $2, $3)',
        [id, albumId, 'Studio'],
      )
    }

    // ER4, first half: a song whose only version has **no album row at all**.
    // Deliberately a case RH-122's backfill cannot produce — a fixture where
    // every song has an album is exactly the fixture an inner join passes.
    const albumlessVersionId = await insertId(
      client,
      'INSERT INTO song_versions (song_id, album_id, label) VALUES ($1, NULL, $2) RETURNING id',
      [albumlessSongId, 'No Release'],
    )

    // ER4, second half: an album row that carries a null `release_date`, which
    // the ordering has to sort last rather than drop.
    const undatedAlbumId = await insertId(
      client,
      `INSERT INTO albums (artist, name, album_type, release_date)
       VALUES ($1, $2, 'single', NULL) RETURNING id`,
      [`RH-124 Artist ${token}`, `RH-124 Undated ${token}`],
    )
    const nullDateVersionId = await insertId(
      client,
      'INSERT INTO song_versions (song_id, album_id, label) VALUES ($1, $2, $3) RETURNING id',
      [nullDateSongId, undatedAlbumId, 'Undated'],
    )

    // ---- the rows the migration has to carry ----
    const practiced = '2026-01-02 03:04:05+00'
    await client.query(
      `INSERT INTO ${LEGACY_REPERTOIRE_TABLE}
         (user_id, song_id, status, personal_key, lyrics, tags, last_practiced)
       VALUES ($1, $2, 'polishing', 'C#', $3, $4, $5)`,
      [userId, userSongId, 'these are the words', ['rock', 'setlist-2026'], practiced],
    )
    await client.query(
      `INSERT INTO ${LEGACY_REPERTOIRE_TABLE}
         (band_id, song_id, status, personal_key, lyrics, tags)
       VALUES ($1, $2, 'mastered', 'Eb', $3, $4)`,
      [bandId, bandSongId, "the band's own words", ['live']],
    )
    for (const songId of [albumlessSongId, nullDateSongId]) {
      await client.query(
        `INSERT INTO ${LEGACY_REPERTOIRE_TABLE} (user_id, song_id, status) VALUES ($1, $2, 'learning')`,
        [userId, songId],
      )
    }

    // ER6 — a row that is neither user- nor band-owned. The CHECK forbids it,
    // so it is dropped first: the migration's archive step is defensive, and
    // the only way to prove the defence works is to breach the constraint.
    await client.query(
      `ALTER TABLE ${LEGACY_REPERTOIRE_TABLE} DROP CONSTRAINT check_${LEGACY_REPERTOIRE_TABLE}_owner_exclusive`,
    )
    await client.query(
      `INSERT INTO ${LEGACY_REPERTOIRE_TABLE} (user_id, band_id, song_id, status, tags)
       VALUES (NULL, NULL, $1, 'learning', $2)`,
      [userSongId, ['orphan-marker']],
    )

    // ER3 — captured **before** the file runs. After the drop there is no
    // evidence left of a row that disappeared.
    const seeded = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${LEGACY_REPERTOIRE_TABLE}`,
      [],
    )

    // The migration, verbatim off disk, exactly as `scripts/migrate.mjs` runs it.
    await client.query(sql)

    const userRows = await client.query<CarriedRow>(
      `SELECT ${CARRIED}, v.song_id
         FROM user_songs o JOIN song_versions v ON v.id = o.version_id
        WHERE o.user_id = $1 ORDER BY v.song_id`,
      [userId],
    )
    const bandRows = await client.query<CarriedRow>(
      `SELECT ${CARRIED}, v.song_id
         FROM band_songs o JOIN song_versions v ON v.id = o.version_id
        WHERE o.band_id = $1 ORDER BY v.song_id`,
      [bandId],
    )
    const orphans = await client.query<{ reason: string; row_json: Record<string, unknown> }>(
      // Schema-qualified on purpose: unqualified, this would fall through to
      // `public.orphaned_repertoire_rows` if the migration's own `CREATE TABLE
      // IF NOT EXISTS` were ever removed, and fail against an empty live table
      // with a message pointing nowhere.
      `SELECT reason, row_json FROM ${schema}.orphaned_repertoire_rows ORDER BY reason`,
      [],
    )
    // These three used to name `public` and now name the replay schema. They
    // are re-pointed rather than dropped: against `public` they would now be
    // vacuous — the two owner tables are whatever `npm run db:migrate` left and
    // `public.repertoire` has been gone since RH-124 — so they would pass
    // without the migration having run at all. Read inside the schema they
    // still assert what they were written to assert: the column set this file
    // creates, and that its last statement dropped the source table.
    const legacy = await client.query<{ present: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
          WHERE table_schema = $1 AND table_name = $2
       ) AS present`,
      [schema, LEGACY_REPERTOIRE_TABLE],
    )
    const columns = async (table: string) =>
      (
        await client.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2 ORDER BY column_name`,
          [schema, table],
        )
      ).rows.map((row) => row.column_name)

    // Trap 1, asserted rather than assumed, and from inside the transaction:
    // `public`'s identity index must still be there after `0014` ran with this
    // schema first on the `search_path`.
    const publicIdentity = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
      [SONGS_UNIQUE],
    )

    scenario = {
      seededCount: Number(seeded.rows[0].n),
      userRows: userRows.rows,
      bandRows: bandRows.rows,
      orphans: orphans.rows,
      albumlessVersionId,
      nullDateVersionId,
      legacyTableSurvives: legacy.rows[0].present,
      userSongsColumns: await columns('user_songs'),
      bandSongsColumns: await columns('band_songs'),
      publicIdentityIndexes: publicIdentity.rows.map((row) => row.indexname),
    }

    throw new Error(ROLLBACK)
  }).catch((error: unknown) => {
    if (!(error instanceof Error) || error.message !== ROLLBACK) throw error
  })

  if (!scenario) throw new Error('the migration scenario produced no snapshot')
  return scenario
}

describe.skipIf(!RUN_DB_TESTS)('the split-repertoire migration (RH-124 ER1–ER6)', () => {
  let scenario: MigrationScenario

  beforeAll(async () => {
    scenario = await runMigrationScenario()
  }, 60_000)

  it('resolves exactly one migration file by its name suffix, not by a prefix (ER1)', () => {
    expect(migrationFileNames()).toHaveLength(1)
    // The prefix is free to move; only the suffix is pinned.
    expect(migrationFileNames()[0]).toMatch(/^\d{4}_split_repertoire_owner_songs\.sql$/)
  })

  it('creates both tables with the agreed column set (ER1)', () => {
    const shared = ['created_at', 'id', 'key', 'last_practiced', 'lyrics', 'map', 'status', 'tags', 'tuning', 'version_id']
    expect(scenario.userSongsColumns).toEqual([...shared, 'user_id'].sort())
    expect(scenario.bandSongsColumns).toEqual([...shared, 'band_id'].sort())
  })

  it('carries the user-owned row into user_songs with every field preserved (ER2)', () => {
    const carried = scenario.userRows.find((row) => row.status === 'polishing')
    expect(carried).toMatchObject({
      status: 'polishing',
      // `personal_key` became `key`.
      key: 'C#',
      lyrics: 'these are the words',
      tags: ['rock', 'setlist-2026'],
    })
    expect(carried!.last_practiced).toContain('2026-01-02')
    // Neither column existed on the source table, so both must arrive null.
    expect(carried!.tuning).toBeNull()
    expect(carried!.map).toBeNull()
  })

  it('carries the band-owned row into band_songs, not into user_songs (ER2)', () => {
    expect(scenario.bandRows).toHaveLength(1)
    expect(scenario.bandRows[0]).toMatchObject({
      status: 'mastered',
      key: 'Eb',
      lyrics: "the band's own words",
      tags: ['live'],
    })
    expect(scenario.userRows.map((row) => row.lyrics)).not.toContain("the band's own words")
  })

  it('loses no row: the pre-count equals carried plus archived (ER3)', () => {
    const accounted =
      scenario.userRows.length + scenario.bandRows.length + scenario.orphans.length
    expect(scenario.seededCount).toBe(accounted)
    // Guards the guard: a fixture that seeded nothing would satisfy the
    // equality above and prove nothing at all.
    expect(scenario.seededCount).toBe(5)
  })

  it('lands the album-less version and the null-release-date one in user_songs (ER4)', () => {
    const versionIds = scenario.userRows.map((row) => row.version_id)
    expect(versionIds).toContain(scenario.albumlessVersionId)
    expect(versionIds).toContain(scenario.nullDateVersionId)
    // Neither was archived as unreachable.
    expect(scenario.orphans.map((row) => row.reason)).not.toContain('no_version')
  })

  it('drops the source table (ER5)', () => {
    expect(scenario.legacyTableSurvives).toBe(false)
  })

  it("leaves public's own uq_songs_artist_title standing (RH-129)", () => {
    // `0014` runs inside the replay schema and drops that index by an
    // unqualified name. Verified empirically: with no copy in the replay schema
    // the statement resolves along the `search_path` and takes `public`'s, so a
    // replay that forgot to create one would silently remove the live catalog's
    // identity key for every other worker in the run.
    expect(scenario.publicIdentityIndexes).toEqual([SONGS_UNIQUE])
  })

  it('archives the ownerless row whole, with a reason, rather than losing it (ER6)', () => {
    expect(scenario.orphans).toHaveLength(1)
    expect(scenario.orphans[0].reason).toBe('no_owner')
    // The *whole* row, so a musician's status and tags are recoverable by hand.
    expect(scenario.orphans[0].row_json).toMatchObject({
      status: 'learning',
      tags: ['orphan-marker'],
      user_id: null,
      band_id: null,
    })
  })
})

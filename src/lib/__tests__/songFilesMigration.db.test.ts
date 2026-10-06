/**
 * RH-123 — the `song_files` migration against a real Postgres.
 *
 * `scripts/migrate.mjs` applies each migration file once per database and
 * records it in `_migrations`, so by the time any other `*.db.test.ts` runs the
 * schema is already the post-migration one and nothing has replayed the file.
 * This suite is the only thing in the repository that does replay one, and it
 * does so the way `songIdentity.db.test.ts` (RH-95) established:
 *
 *  1. the file is resolved off disk by its `_song_files.sql` **suffix**, never
 *     by a four-digit prefix — several approved specs each claim "the next
 *     number", so whichever lands second renumbers and a prefix written into a
 *     test would break on that renumber;
 *  2. the pre-migration shape is rebuilt inside one transaction (Postgres makes
 *     DDL transactional), the file is executed against seeded rows, the
 *     assertions are taken, and the transaction is **always** rolled back. The
 *     shared database never leaves its migrated shape and nothing is left
 *     behind for the next suite. The legacy shape itself comes from
 *     `legacyCatalogReplayDdl` / `LEGACY_TABS_TABLE` in `test-helpers.ts`, the
 *     one place the dropped table is named under `src/` (ER5).
 *
 * WHERE THE REPLAY HAPPENS, AND WHY IT MOVED (RH-129)
 *
 * In a **throwaway `rh123_<token>` schema**, built by `legacyCatalogReplayDdl`
 * and first on the transaction's `search_path`, so every unqualified name in
 * the migration file resolves inside it and nothing in `public` is touched.
 *
 * It used to rebuild the legacy shape in `public`, which meant dropping
 * `public.song_files` and `public.abandoned_blobs` to get back to the
 * pre-migration state. That is the deadlock: `song_files` carries foreign keys
 * to `profiles` and `songs`, so `DROP TABLE song_files` needs ACCESS EXCLUSIVE
 * on the *referenced* relations too, and an ordinary suite holding AccessShare
 * on `songs` and then asking for RowExclusive is taking the same two relations
 * the other way round. Postgres breaks the cycle by killing one transaction at
 * random, which reads as an unrelated suite failing with `deadlock detected`.
 * Measured at 2 occurrences in 24 full runs, in this file and
 * `ownerSongsMigration`, *with* the advisory lock those two shared — because
 * the lock serialised them against each other and the other party in the cycle
 * was never the other replay. The schema removes the shared relation instead,
 * so there is no lock to order and no lock to take: see the note in
 * `test-helpers.ts` where that lock used to be.
 *
 * Nothing in the migration notices the move. Every name in it is unqualified,
 * and it issues no `DROP INDEX`, so it is not exposed to the hazard
 * `legacyCatalogReplayDdl` documents (an unqualified index name resolving along
 * the `search_path` into `public`); the one existence check that *was* written
 * against `public` is re-pointed at the replay schema rather than dropped, so
 * it still proves the migration dropped the legacy table.
 *
 * It is the task's only guard on its one irreversible act — annotations
 * crossing from `repertoire_tabs` into `song_files` — which is why
 * `RUN_DB_TESTS=1` matters here more than anywhere else: skipped, this file
 * asserts nothing at all.
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
  ownerStubsDdl,
} from './test-helpers'
import type { TabAnnotations } from '@/types/database'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'migrations')
/** The stable half of the migration's name; the four-digit prefix may move. */
const MIGRATION_SUFFIX = '_song_files.sql'

/** Resolves the migration by suffix and fails unless there is exactly one. */
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

/** Non-empty on purpose: an empty `{}` would pass an assertion that lost data. */
const SEEDED_ANNOTATIONS: TabAnnotations = {
  '1': [{ id: 'stroke-1', color: '#ef4444', width: 0.01, points: [[0.1, 0.2], [0.3, 0.4]] }],
  '3': [{ id: 'stroke-2', color: '#2563eb', width: 0.02, points: [[0.5, 0.5], [0.6, 0.7]] }],
}

const USER_FILE_URL = 'https://blob.example/rh123/user-owned.pdf'
const BAND_FILE_URL = 'https://blob.example/rh123/band-owned.pdf'

/** What the scenario carries out of its (rolled-back) transaction. */
interface MigrationScenario {
  userId: string
  songId: string
  /** Every `song_files` row the migration produced for the seeded user. */
  songFiles: {
    id: string
    user_id: string
    song_id: string
    title: string
    file_url: string
    annotations: TabAnnotations
    created_at: string
  }[]
  /** The `created_at` the seeded user-owned tab row carried before the move. */
  seededCreatedAt: string
  /** Column names of `song_files`, read from `information_schema.columns`. */
  songFilesColumns: string[]
  /** The ledger rows the migration wrote for the dropped band-owned file. */
  abandoned: { file_url: string; reason: string }[]
  /** Whether the legacy tabs table still exists after the file ran. */
  tabsTableSurvives: boolean
}

/** Rolls the whole scenario back; the sentinel is how `withTransaction` undoes it. */
const ROLLBACK = 'RH-123 song_files migration scenario rollback'

async function insertId(client: Queryable, sql: string, params: unknown[]): Promise<string> {
  const res = await client.query<{ id: string }>(sql, params)
  return res.rows[0].id
}

async function runMigrationScenario(): Promise<MigrationScenario> {
  const sql = migrationSql()
  const token = randomUUID().replace(/-/g, '').slice(0, 12)
  const schema = `rh123_${token}`
  let scenario: MigrationScenario | undefined

  await withTransaction(async (client) => {
    // The pre-migration shape, in a schema of its own: `songs`, and the
    // owner-row and tabs tables RH-124 and RH-123 dropped. `test-helpers.ts` is
    // the one place either of those two is spelled (RH-123 ER5, RH-124 ER5).
    //
    // No `DROP TABLE song_files` / `DROP TABLE abandoned_blobs` is needed or
    // wanted any more: this schema has neither, and the migration's own
    // `CREATE TABLE IF NOT EXISTS` resolves for creation in the first schema on
    // the `search_path`, so it creates them *here* even though `public` holds
    // both names. Issuing those drops was the deadlock (see the file header).
    //
    // `ownerStubsDdl` is what keeps the migration's own foreign keys inside the
    // schema: `song_files.user_id REFERENCES profiles(id)` is unqualified, and
    // without a local `profiles` it would resolve to `public`'s and take
    // SHARE ROW EXCLUSIVE on a table every other worker inserts into.
    await client.query(legacyCatalogReplayDdl(schema))
    await client.query(ownerStubsDdl(schema))
    await client.query(`SET LOCAL search_path = ${schema}, public`)

    // A synthetic owner, registered in the schema's stub so step 2's
    // `INSERT INTO song_files` satisfies its foreign key. No `"user"` row and
    // no real `profiles` row: nothing the migration issues reads a column of
    // either, and seeding them in `public` would put this replay back in the
    // lock graph it just left.
    const userId = randomUUID()
    await client.query('INSERT INTO profiles (id) VALUES ($1)', [userId])

    const songId = await insertId(
      client,
      'INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id',
      [`RH-123 Song ${token}`, `RH-123 Artist ${token}`],
    )
    // Synthetic too, and deliberately *not* registered: the replay schema's
    // owner-row table carries no band foreign key (see `legacyRepertoireDdl`),
    // and the band-owned path is the one the migration drops rather than
    // carries, so it never reaches a table that references `bands`.
    const bandId = randomUUID()

    const userEntryId = await insertId(
      client,
      `INSERT INTO ${LEGACY_REPERTOIRE_TABLE} (user_id, song_id, status) VALUES ($1, $2, 'learning') RETURNING id`,
      [userId, songId],
    )
    const bandEntryId = await insertId(
      client,
      `INSERT INTO ${LEGACY_REPERTOIRE_TABLE} (band_id, song_id, status) VALUES ($1, $2, 'unknown') RETURNING id`,
      [bandId, songId],
    )

    const seeded = await client.query<{ created_at: string }>(
      `INSERT INTO ${LEGACY_TABS_TABLE} (repertoire_id, title, file_url, annotations)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING created_at::text AS created_at`,
      [userEntryId, 'RH-123 User Chart', USER_FILE_URL, JSON.stringify(SEEDED_ANNOTATIONS)],
    )
    await client.query(
      `INSERT INTO ${LEGACY_TABS_TABLE} (repertoire_id, title, file_url) VALUES ($1, $2, $3)`,
      [bandEntryId, 'RH-123 Band Chart', BAND_FILE_URL],
    )

    // The migration, verbatim off disk, exactly as `scripts/migrate.mjs` runs it.
    await client.query(sql)

    const songFiles = await client.query<MigrationScenario['songFiles'][number]>(
      `SELECT id, user_id, song_id, title, file_url, annotations, created_at::text AS created_at
       FROM song_files WHERE song_id = $1 ORDER BY created_at`,
      [songId],
    )
    // Both of these used to name `public` and now name the replay schema. They
    // are re-pointed rather than dropped: against `public` they would now be
    // vacuous — `public.song_files` is whatever `npm run db:migrate` left and
    // `public.repertoire_tabs` has been gone since RH-123 — so they would pass
    // without the migration having run at all. Read inside the schema they
    // still assert what they were written to assert: the column set this file
    // creates, and that its last statement dropped the legacy table.
    const columns = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'song_files'`,
      [schema],
    )
    const abandoned = await client.query<{ file_url: string; reason: string }>(
      // Schema-qualified on purpose: unqualified, this would fall through to
      // `public.abandoned_blobs` if the migration's own `CREATE TABLE IF NOT
      // EXISTS` were ever removed, and fail against an empty live table with a
      // message pointing nowhere.
      `SELECT file_url, reason FROM ${schema}.abandoned_blobs ORDER BY file_url`,
      [],
    )
    const stillThere = await client.query<{ exists: boolean }>(
      `SELECT to_regclass($1) IS NOT NULL AS exists`,
      [`${schema}.${LEGACY_TABS_TABLE}`],
    )

    scenario = {
      userId,
      songId,
      songFiles: songFiles.rows,
      seededCreatedAt: seeded.rows[0].created_at,
      songFilesColumns: columns.rows.map((row) => row.column_name),
      abandoned: abandoned.rows,
      tabsTableSurvives: stillThere.rows[0].exists,
    }

    throw new Error(ROLLBACK)
  }).catch((error: unknown) => {
    if (!(error instanceof Error) || error.message !== ROLLBACK) throw error
  })

  if (!scenario) throw new Error('the migration scenario produced no snapshot')
  return scenario
}

describe.skipIf(!RUN_DB_TESTS)('the song_files migration (RH-123 ER2, ER3, ER4, ER8)', () => {
  let scenario: MigrationScenario

  beforeAll(async () => {
    scenario = await runMigrationScenario()
  }, 60_000)

  it('resolves exactly one migration file by its name suffix, not by a prefix', () => {
    expect(migrationFileNames()).toHaveLength(1)
    // The prefix is free to move; only the suffix is pinned.
    expect(migrationFileNames()[0]).toMatch(/^\d{4}_song_files\.sql$/)
  })

  it('carries the user-owned row across under its (user_id, song_id) pair (ER2)', () => {
    expect(scenario.songFiles).toHaveLength(1)
    expect(scenario.songFiles[0]).toMatchObject({
      user_id: scenario.userId,
      song_id: scenario.songId,
      title: 'RH-123 User Chart',
      file_url: USER_FILE_URL,
    })
  })

  it('keeps the migrated row\'s created_at verbatim, so the file list keeps its order', () => {
    expect(scenario.songFiles[0].created_at).toBe(scenario.seededCreatedAt)
  })

  it('drops the band-owned row and drops the legacy tabs table last (ER2)', () => {
    expect(scenario.songFiles.map((row) => row.file_url)).not.toContain(BAND_FILE_URL)
    expect(scenario.tabsTableSurvives).toBe(false)
  })

  it('gives song_files no band_id column — a file belongs to a person (ER3)', () => {
    expect(scenario.songFilesColumns).not.toContain('band_id')
    expect(scenario.songFilesColumns.sort()).toEqual([
      'annotations',
      'created_at',
      'file_url',
      'id',
      'song_id',
      'title',
      'user_id',
    ])
  })

  it('records the dropped band-owned file_url in abandoned_blobs (ER4)', () => {
    expect(scenario.abandoned.map((row) => row.file_url)).toEqual([BAND_FILE_URL])
    expect(scenario.abandoned[0].reason).toContain('band-owned')
  })

  it('carries the annotations jsonb across unchanged (ER8)', () => {
    expect(scenario.songFiles[0].annotations).toEqual(SEEDED_ANNOTATIONS)
  })
})

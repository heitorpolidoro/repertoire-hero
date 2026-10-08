/**
 * RH-107 — the conversion from the legacy moderation queue to
 * `catalog_suggestions`, executed rather than argued.
 *
 * The dev database holds no legacy rows, so a migrated database cannot observe
 * the backfill at all: it has nothing to convert. So the migration file is
 * replayed here over hand-seeded legacy rows, the same way
 * `catalogVersionsMigration.db.test.ts` replays `migrations/0014`'s.
 *
 * In a **throwaway `rh107_<token>` schema**, built by
 * `legacyModerationQueueReplayDdl` and first on the transaction's
 * `search_path`, so every unqualified name in the migration file resolves
 * inside it and nothing in `public` is touched — no shared-table lock, and
 * therefore no place in the lock graph (see `legacyCatalogReplayDdl`'s note).
 * The whole scenario is rolled back; Postgres DDL is transactional, so not even
 * the schema survives.
 *
 * The migration is resolved off disk by its name **suffix**
 * (`migrationSqlBySuffix`), never by its four-digit prefix: several approved
 * specs are written against the same high-water mark, so whichever lands second
 * renumbers, and a prefix written into a test would break on that renumber
 * while reading as if it still checked something.
 *
 * No transaction-control literal appears here: `withTransaction` is the only
 * sanctioned way to open one (`transactionGuard.test.ts`), and a thrown
 * sentinel is how the scenario is undone.
 */

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTransaction, type Queryable } from '@/lib/db'
import { LEGACY_EDITS_TABLE, legacyModerationQueueReplayDdl, migrationSqlBySuffix } from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

/** The stable half of the migration's name; the four-digit prefix may move. */
const MIGRATION_SUFFIX = '_catalog_suggestions.sql'

/** Rolls a scenario back; the sentinel is how `withTransaction` undoes it. */
const ROLLBACK = 'RH-107 migration scenario rollback'

function token(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12)
}

/** One legacy queue row as seeded, and the suggestion rows it converted into. */
interface Converted {
  legacyId: string
  rows: Array<{
    group_id: string
    target_table: string
    target_id: string
    target_column: string
    value: unknown
    value_type: string
    reason: string | null
    status: string
    reviewed_by: string | null
    rejection_reason: string | null
    created_at: string
    updated_at: string
  }>
}

/** A legacy row to seed, as the columns `migrations/0006` gave the table. */
interface LegacyRow {
  proposedData: string
  status?: string
  /** `true` points `reviewed_by` at the replay's reviewer profile. */
  reviewed?: boolean
  rejectionReason?: string | null
  /** `null` seeds a genuinely NULL timestamp, which both legacy columns allow. */
  timestamps?: null
}

/**
 * Seeds `rows` into a fresh replay schema, runs the migration file over them,
 * and returns what each legacy row converted into.
 *
 * The migration ends in `DROP TABLE <the legacy table>`, so the read below is
 * the only chance to correlate: `group_id` is the legacy row's own id, which is
 * what makes the conversion traceable row by row and what this helper keys on.
 */
async function convert(rows: LegacyRow[]): Promise<Converted[]> {
  const schema = `rh107_${token()}`
  let result: Converted[] | undefined

  await withTransaction(async (client: Queryable) => {
    await client.query(legacyModerationQueueReplayDdl(schema))
    await client.query(`SET LOCAL search_path = ${schema}, public`)

    const requesterId = randomUUID()
    const reviewerId = randomUUID()
    for (const [id, who] of [[requesterId, 'requester'], [reviewerId, 'reviewer']] as const) {
      await client.query('INSERT INTO profiles (id, email) VALUES ($1, $2)', [
        id,
        `rh107-${who}-${token()}@example.com`,
      ])
    }
    const songId = (
      await client.query<{ id: string }>(
        'INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id',
        [`RH-107 Song ${token()}`, 'RH-107 Artist'],
      )
    ).rows[0].id

    const legacyIds: string[] = []
    for (const row of rows) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO ${LEGACY_EDITS_TABLE}
           (song_id, requested_by, proposed_data, status, reviewed_by, rejection_reason,
            created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6,
                 ${row.timestamps === null ? 'NULL, NULL' : 'now(), now()'})
         RETURNING id`,
        [
          songId,
          requesterId,
          row.proposedData,
          row.status ?? 'pending',
          row.reviewed ? reviewerId : null,
          row.rejectionReason ?? null,
        ],
      )
      legacyIds.push(inserted.rows[0].id)
    }

    await client.query(migrationSqlBySuffix(MIGRATION_SUFFIX))

    const converted: Converted[] = []
    for (const legacyId of legacyIds) {
      const res = await client.query<Converted['rows'][number]>(
        `SELECT group_id, target_table, target_id::text AS target_id, target_column,
                value, jsonb_typeof(value) AS value_type, reason, status,
                reviewed_by::text AS reviewed_by, rejection_reason,
                created_at::text AS created_at, updated_at::text AS updated_at
           FROM catalog_suggestions
          WHERE group_id = $1
          ORDER BY target_column`,
        [legacyId],
      )
      converted.push({ legacyId, rows: res.rows })
    }

    result = converted
    throw new Error(ROLLBACK)
  }).catch((error: unknown) => {
    if (!(error instanceof Error) || error.message !== ROLLBACK) throw error
  })

  if (result === undefined) throw new Error('the scenario produced no result')
  return result
}

describe.skipIf(!RUN_DB_TESTS)('the catalog suggestions conversion (replayed migration)', () => {
  it('fans a multi-field row out into one row per column, keeping the reason and the legacy id as group_id', async () => {
    const [converted] = await convert([
      { proposedData: JSON.stringify({ title: 'Plush', album: 'Core', reason: 'typo in the title' }) },
    ])

    expect(converted.rows).toHaveLength(2)
    expect(converted.rows.map((r) => r.target_column)).toEqual(['album', 'title'])
    expect(converted.rows.map((r) => r.value)).toEqual(['Core', 'Plush'])
    for (const row of converted.rows) {
      // The non-column key lands in the `reason` **column**: a
      // `target_column = 'reason'` row would be a non-column name reaching an
      // identifier position, and the row-wise CHECK refuses it outright.
      expect(row.reason).toBe('typo in the title')
      expect(row.group_id).toBe(converted.legacyId)
      expect(row.target_table).toBe('songs')
      expect(row.status).toBe('pending')
    }
  })

  it('stores a proposed SQL NULL as a jsonb null rather than losing it', async () => {
    const [converted] = await convert([{ proposedData: JSON.stringify({ album: null }) }])

    expect(converted.rows).toHaveLength(1)
    // `value jsonb NOT NULL` still expresses "set the album to nothing":
    // `jsonb_typeof('null')` is `null` and `'null'::jsonb IS NULL` is false.
    expect(converted.rows[0].value_type).toBe('null')
    expect(converted.rows[0].value).toBeNull()
  })

  it('carries a rejected row across with its status, reviewer and rejection reason', async () => {
    const [converted] = await convert([
      {
        proposedData: JSON.stringify({ artist: 'Wrong Artist' }),
        status: 'rejected',
        reviewed: true,
        rejectionReason: 'Inaccurate information',
      },
    ])

    expect(converted.rows).toHaveLength(1)
    expect(converted.rows[0].status).toBe('rejected')
    expect(converted.rows[0].reviewed_by).toBeTruthy()
    expect(converted.rows[0].rejection_reason).toBe('Inaccurate information')
  })

  it('coalesces NULL legacy timestamps instead of raising 23502', async () => {
    const [converted] = await convert([
      { proposedData: JSON.stringify({ standard_key: 'Am' }), timestamps: null },
    ])

    expect(converted.rows).toHaveLength(1)
    // Both legacy columns are nullable (`migrations/0006:14-15`) and both new
    // ones are NOT NULL: uncoalesced this whole migration is a 23502.
    expect(converted.rows[0].created_at).toBeTruthy()
    expect(converted.rows[0].updated_at).toBeTruthy()
  })

  it('skips a non-object proposed_data instead of raising 22023', async () => {
    // `proposed_data` is `jsonb NOT NULL` with no shape constraint, so a
    // directly written array is legal and `jsonb_each` on it is a hard error
    // that would take the whole migration down.
    const [nonObject, sibling] = await convert([
      { proposedData: '[1,2]' },
      { proposedData: JSON.stringify({ title: 'Survivor' }) },
    ])

    expect(nonObject.rows).toEqual([])
    // The sibling proves the migration ran to completion rather than aborting.
    expect(sibling.rows.map((r) => r.target_column)).toEqual(['title'])
  })

  it('produces no row for a legacy row whose only keys are not catalog columns', async () => {
    const [converted] = await convert([
      { proposedData: JSON.stringify({ reason: 'just a note', nonsense: 1 }) },
    ])

    // Stated rather than hidden: such a row is lost. It cannot be produced
    // through the application, because the payload narrower refuses a payload
    // proposing no known column.
    expect(converted.rows).toEqual([])
  })

  it('carries a value that no longer validates across verbatim', async () => {
    const [converted] = await convert([
      { proposedData: JSON.stringify({ duration_seconds: 'abc' }) },
    ])

    // The backfill does not validate, exactly as the legacy table did not: the
    // row survives, stays `pending`, and fails at approval instead.
    expect(converted.rows).toHaveLength(1)
    expect(converted.rows[0].value).toBe('abc')
    expect(converted.rows[0].status).toBe('pending')
  })

  it('converts the whole fixture set with the per-shape counts above', async () => {
    const converted = await convert([
      { proposedData: JSON.stringify({ title: 'A', album: 'B', reason: 'r' }) },
      { proposedData: JSON.stringify({ album: null }) },
      { proposedData: JSON.stringify({ artist: 'C' }), status: 'rejected', reviewed: true },
      { proposedData: JSON.stringify({ standard_key: 'Am' }), timestamps: null },
      { proposedData: '[1,2]' },
      { proposedData: JSON.stringify({ reason: 'note' }) },
      { proposedData: JSON.stringify({ duration_seconds: 'abc' }) },
    ])

    // Per-shape, never a total: the total is a property of this fixture set and
    // a fixture gaining a shape must not falsify the contract.
    expect(converted.map((c) => c.rows.length)).toEqual([2, 1, 1, 1, 0, 0, 1])
  })
})

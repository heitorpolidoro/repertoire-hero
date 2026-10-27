/**
 * RH-185 — `migrations/0030_canonical_tunings.sql`, executed over a legacy-shaped
 * fixture in a throwaway schema rolled back by a sentinel error.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTransaction, type Queryable } from '@/lib/db'
import { migrationSqlBySuffix } from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''
const ROLLBACK = 'RH-185 migration scenario rollback'

function token(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12)
}

const LEGACY_DDL = (schema: string) => `
  CREATE SCHEMA ${schema};
  CREATE TABLE ${schema}.song_versions (
      id     integer PRIMARY KEY,
      tuning text
  );
  CREATE TABLE ${schema}.user_songs (
      id     integer PRIMARY KEY,
      tuning text
  );
  CREATE TABLE ${schema}.band_songs (
      id     integer PRIMARY KEY,
      tuning text
  );
`

const INPUT_ROWS: ReadonlyArray<{ id: number; tuning: string | null }> = [
  { id: 1, tuning: 'Standard' },
  { id: 2, tuning: 'Half step down' },
  { id: 3, tuning: 'Whole step down' },
  { id: 4, tuning: 'Drop D' },
  { id: 5, tuning: 'DADGAD' },
  { id: 6, tuning: null },
]

const EXPECTED_ROWS: ReadonlyArray<{ id: number; tuning: string | null }> = [
  { id: 1, tuning: 'E' },
  { id: 2, tuning: 'Eb' },
  { id: 3, tuning: 'D' },
  { id: 4, tuning: 'Drop D' },
  { id: 5, tuning: 'DADGAD' },
  { id: 6, tuning: null },
]

type TableName = 'user_songs' | 'band_songs' | 'song_versions'
const TABLES: readonly TableName[] = ['user_songs', 'band_songs', 'song_versions']

async function readRows(
  client: Queryable,
  table: TableName,
): Promise<Array<{ id: number; tuning: string | null }>> {
  const res = await client.query<{ id: number; tuning: string | null }>(
    `SELECT id, tuning FROM ${table} ORDER BY id`,
  )
  return res.rows
}

describe.skipIf(!RUN_DB_TESTS)('migration 0030 canonical tunings (RH-185)', () => {
  const outcomes: Record<TableName, Array<{ id: number; tuning: string | null }>> = {
    user_songs: [],
    band_songs: [],
    song_versions: [],
  }

  beforeAll(async () => {
    const schema = `rh185_${token()}`
    const sql = migrationSqlBySuffix('_canonical_tunings.sql')

    await withTransaction(async (client) => {
      await client.query(LEGACY_DDL(schema))
      await client.query(`SET LOCAL search_path = ${schema}, public`)

      for (const table of TABLES) {
        for (const row of INPUT_ROWS) {
          await client.query(`INSERT INTO ${table} (id, tuning) VALUES ($1, $2)`, [
            row.id,
            row.tuning,
          ])
        }
      }

      await client.query(sql)

      for (const table of TABLES) {
        outcomes[table] = await readRows(client, table)
      }

      throw new Error(ROLLBACK)
    }).catch((error: unknown) => {
      if (!(error instanceof Error) || error.message !== ROLLBACK) throw error
    })
  })

  it.each(TABLES)(
    'rewrites Standard->E, Half step down->Eb and Whole step down->D in %s and leaves Drop D, DADGAD and null unchanged',
    (table) => {
      expect(outcomes[table]).toEqual(EXPECTED_ROWS)
    },
  )
})

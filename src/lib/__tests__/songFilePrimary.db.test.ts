/**
 * RH-147 — the primary-file migration against a real Postgres.
 *
 * The migration is replayed over a seeded pre-migration `song_files`, in a
 * throwaway schema first on the transaction's `search_path` (the technique
 * `songFilesMigration.db.test.ts` established). The file is resolved by its
 * `_song_file_primary.sql` suffix, never by its four-digit prefix, so a
 * renumbering cannot turn the replay into a no-op.
 *
 * The migration header states the rule: backfill = oldest chart
 * (`created_at ASC`, `id` as the final tie-break) per `(user_id, song_id)`;
 * audio rows are never primary. No transaction-control literal appears here;
 * the scenario unwinds through a sentinel throw.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { withTransaction } from '@/lib/db'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', '..', 'migrations')
const MIGRATION_SUFFIX = '_song_file_primary.sql'

function migrationSql(): string {
  const names = fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(MIGRATION_SUFFIX))
  if (names.length !== 1) {
    throw new Error(`expected exactly one *${MIGRATION_SUFFIX} migration, found ${names.length}`)
  }
  return fs.readFileSync(path.join(MIGRATIONS_DIR, names[0]), 'utf8')
}

const ROLLBACK = 'RH-147 song_file_primary scenario rollback'

interface Row {
  id: string
  user_id: string
  song_id: string
  is_primary: boolean
}

interface Scenario {
  /** Ids by label, so the assertions name the row they expect. */
  ids: Record<string, string>
  users: { a: string; b: string; c: string }
  songId: string
  rows: Row[]
  /** Whether a second chart primary for one pair raised `23505` after the migration. */
  secondPrimaryRejected: boolean
  /** The user-a primaries after clearing the old one and setting another. */
  movedTo: string[]
}

async function runScenario(): Promise<Scenario> {
  const sql = migrationSql()
  const schema = `rh147_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  let scenario: Scenario | undefined

  await withTransaction(async (client) => {
    await client.query(`CREATE SCHEMA ${schema}`)
    // The pre-migration shape: the columns of `song_files` before this task,
    // without the foreign keys (the migration neither reads nor needs them).
    await client.query(`
      CREATE TABLE ${schema}.song_files (
        id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id      uuid        NOT NULL,
        song_id      uuid        NOT NULL,
        title        text        NOT NULL,
        file_url     text        NOT NULL,
        annotations  jsonb       NOT NULL DEFAULT '{}'::jsonb,
        created_at   timestamptz NOT NULL DEFAULT now(),
        content_type text        NOT NULL DEFAULT 'application/pdf',
        size_bytes   bigint
      )`)
    await client.query(`SET LOCAL search_path = ${schema}, public`)

    const a = randomUUID()
    const b = randomUUID()
    const c = randomUUID()
    const songId = randomUUID()
    const ids: Record<string, string> = {}
    // Inserted newest-first on purpose: the winner must come from created_at,
    // not from insertion order. User c holds an audio row older than any chart
    // and a chart: the audio row must not win.
    const seed: [string, string, string, string][] = [
      ['a-new', a, '2026-03-01T00:00:00Z', 'application/pdf'],
      ['a-mid', a, '2026-02-01T00:00:00Z', 'image/png'],
      ['a-old', a, '2026-01-01T00:00:00Z', 'application/pdf'],
      ['b-new', b, '2026-04-01T00:00:00Z', 'application/pdf'],
      ['b-old', b, '2026-01-15T00:00:00Z', 'application/pdf'],
      ['c-audio', c, '2025-12-01T00:00:00Z', 'audio/mpeg'],
      ['c-chart', c, '2026-05-01T00:00:00Z', 'application/pdf'],
    ]
    for (const [label, user, createdAt, contentType] of seed) {
      const res = await client.query<{ id: string }>(
        `INSERT INTO song_files (user_id, song_id, title, file_url, created_at, content_type)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [user, songId, label, `https://blob.example/rh147/${label}.pdf`, createdAt, contentType],
      )
      ids[label] = res.rows[0].id
    }

    await client.query(sql)

    const rows = await client.query<Row>(
      'SELECT id, user_id, song_id, is_primary FROM song_files WHERE song_id = $1',
      [songId],
    )

    // The database itself must refuse a second primary for the pair. The
    // attempt runs inside a PL/pgSQL block with an exception handler (a
    // sub-transaction), so the surrounding transaction survives the violation.
    await client.query('CREATE TABLE flag (rejected boolean NOT NULL)')
    await client.query(
      `DO $$ BEGIN
         UPDATE song_files SET is_primary = true WHERE id = '${ids['a-new']}';
         INSERT INTO flag VALUES (false);
       EXCEPTION WHEN unique_violation THEN
         INSERT INTO flag VALUES (true);
       END $$`,
    )
    const flag = await client.query<{ rejected: boolean }>('SELECT rejected FROM flag')

    await client.query('UPDATE song_files SET is_primary = false WHERE id = $1', [ids['a-old']])
    await client.query('UPDATE song_files SET is_primary = true WHERE id = $1', [ids['a-new']])
    const moved = await client.query<{ id: string }>(
      'SELECT id FROM song_files WHERE user_id = $1 AND is_primary',
      [a],
    )

    scenario = {
      ids,
      users: { a, b, c },
      songId,
      rows: rows.rows,
      secondPrimaryRejected: flag.rows[0].rejected,
      movedTo: moved.rows.map((row) => row.id),
    }
    throw new Error(ROLLBACK)
  }).catch((error: unknown) => {
    if (!(error instanceof Error) || error.message !== ROLLBACK) throw error
  })

  if (!scenario) throw new Error('the migration scenario produced no result')
  return scenario
}

describe.skipIf(!RUN_DB_TESTS)('the song_file_primary migration (RH-147)', () => {
  let scenario: Scenario

  beforeAll(async () => {
    scenario = await runScenario()
  }, 60_000)

  const primariesOf = (user: string) =>
    scenario.rows.filter((row) => row.user_id === user && row.is_primary)

  it('resolves exactly one migration file by its name suffix, not by a prefix', () => {
    const names = fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(MIGRATION_SUFFIX))
    expect(names).toHaveLength(1)
    expect(names[0]).toMatch(/^\d{4}_song_file_primary\.sql$/)
  })

  it('leaves exactly one primary per (user_id, song_id) group after the migration is replayed', () => {
    expect(primariesOf(scenario.users.a)).toHaveLength(1)
    expect(primariesOf(scenario.users.b)).toHaveLength(1)
    expect(primariesOf(scenario.users.c)).toHaveLength(1)
    expect(scenario.rows).toHaveLength(7)
  })

  it('picks the oldest chart by created_at, as the migration header states', () => {
    expect(primariesOf(scenario.users.a)[0].id).toBe(scenario.ids['a-old'])
    expect(primariesOf(scenario.users.b)[0].id).toBe(scenario.ids['b-old'])
  })

  it('never backfills an audio row as primary', () => {
    expect(primariesOf(scenario.users.c)[0].id).toBe(scenario.ids['c-chart'])
    const audio = scenario.rows.find((row) => row.id === scenario.ids['c-audio'])
    expect(audio?.is_primary).toBe(false)
  })

  it('has the database itself reject a second row claiming the primary slot for one pair', () => {
    expect(scenario.secondPrimaryRejected).toBe(true)
  })

  it('lets a primary move once the old one is cleared', () => {
    expect(scenario.movedTo).toEqual([scenario.ids['a-new']])
  })

  it('keeps two different user_ids on the same song_id with independent primaries', () => {
    const a = primariesOf(scenario.users.a)[0]
    const b = primariesOf(scenario.users.b)[0]
    expect(a.song_id).toBe(b.song_id)
    expect(a.id).not.toBe(b.id)
    expect(a.user_id).not.toBe(b.user_id)
  })
})

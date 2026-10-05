/**
 * RH-101 — `songs.updated_at` exists, starts at `created_at`, and moves
 * when a real writer runs.
 *
 * `catalogTimestampGuard.test.ts` proves the clause is present in every
 * statement's text. That is a claim about source, not about Postgres: it cannot
 * show that the column exists with the intended shape, that
 * `migrations/0011` (the migration that added the column) backfilled from
 * `created_at` rather than from the migration's clock, or that the clause
 * actually advances the stored value. Those three are what this file checks,
 * against a live database.
 *
 * The writer exercised is the additive-link path in `src/lib/songs.ts`
 * (`applySongLinkUpdate`), called for real rather than mocked — a mocked `pg`
 * would reduce the assertion back to the SQL text the static guard already
 * covers.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { query } from '@/lib/db'
import { applySongLinkUpdate } from '@/lib/songs'
import type { SongLink } from '@/types/database'
import { createTestUser, deleteTestUser } from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

const CHORDS: SongLink = { label: 'Chords', url: 'https://chords.test/rh101' }

interface TimestampRow {
  created_at: string
  updated_at: string
  same: boolean
  advanced: boolean
}

describe.skipIf(!RUN_DB_TESTS)('songs.updated_at (real database)', () => {
  const suffix = Date.now()
  let userId: string
  const createdSongIds: string[] = []

  /** A fresh catalog row with no links, so a link add is an additive edit. */
  const makeSong = async (): Promise<string> => {
    const res = await query<{ id: string }>(
      `INSERT INTO songs (title, artist, links)
       VALUES ($1, $2, '[]'::jsonb) RETURNING id`,
      [`RH-101 Song ${suffix}-${createdSongIds.length}`, 'RH-101 Artist'],
    )
    createdSongIds.push(res.rows[0].id)
    return res.rows[0].id
  }

  const timestamps = async (songId: string): Promise<TimestampRow> => {
    const res = await query<TimestampRow>(
      `SELECT created_at, updated_at,
              updated_at = created_at AS same,
              updated_at > created_at AS advanced
         FROM songs WHERE id = $1`,
      [songId],
    )
    return res.rows[0]
  }

  beforeAll(async () => {
    userId = await createTestUser({ email: `rh101-timestamp-${suffix}@test.local` })
  })

  afterAll(async () => {
    for (const songId of createdSongIds) {
      await query('DELETE FROM songs WHERE id = $1', [songId])
    }
    if (userId) await deleteTestUser(userId)
  })

  it('is a NOT NULL timestamptz defaulting to now()', async () => {
    const res = await query<{
      data_type: string
      is_nullable: string
      column_default: string | null
    }>(
      `SELECT data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = 'songs' AND column_name = 'updated_at'`,
    )

    expect(res.rows[0]).toMatchObject({
      data_type: 'timestamp with time zone',
      is_nullable: 'NO',
    })
    expect(res.rows[0].column_default).toContain('now()')
  })

  it('equals created_at on a freshly inserted row', async () => {
    const songId = await makeSong()

    const row = await timestamps(songId)

    expect(row.same).toBe(true)
    expect(row.advanced).toBe(false)
  })

  it('advances past created_at when a link update runs through songs.ts', async () => {
    const songId = await makeSong()
    expect((await timestamps(songId)).same).toBe(true)

    const result = await applySongLinkUpdate(userId, songId, [CHORDS])

    // Additive, so it is applied straight to the catalog, not queued for
    // moderation — a `pending` result would leave the row untouched and make
    // the timestamp assertion below vacuous.
    expect(result).toEqual({ success: true })
    const row = await timestamps(songId)
    expect(row.advanced).toBe(true)
    expect(row.same).toBe(false)
  })
})

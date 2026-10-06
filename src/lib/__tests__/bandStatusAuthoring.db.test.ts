/**
 * RH-96 — status is per-owner, and nothing aggregates.
 *
 * Both facts here are statements about the database, so neither can be proved
 * with a mocked `pg`:
 *
 *  1. (ER2) a member's personal status change leaves every band row for that
 *     song untouched. Asserted behaviourally — the whole band repertoire is
 *     snapshotted before and compared after — rather than by reading
 *     `pg_trigger`, so the test keeps its meaning if the mechanism changes.
 *  2. (ER4) a personal row created while the caller is in band context is born
 *     `unknown`, at the column default, even when the band's own row for the
 *     same song is further along. The RH-83 seed that copied the band's status
 *     existed only to avoid becoming the floor of a `MIN` that no longer runs.
 *
 * The drop migration is resolved off disk by its `_drop_band_status_trigger.sql`
 * suffix, never by a hardcoded four-digit prefix: several approved specs were
 * written against the same high-water mark, so whichever lands second renumbers
 * its own file (the same reason `songIdentity.db.test.ts` matches by suffix).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { query } from '@/lib/db'
import { addSongToRepertoire, updateSongStatus } from '@/lib/ownerSongs'
import { createBand } from '@/lib/bands'
import { createTestUser, deleteTestUser } from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', '..', 'migrations')
const MIGRATION_SUFFIX = '_drop_band_status_trigger.sql'

describe.skipIf(!RUN_DB_TESTS)('band status is authored, not aggregated (real database)', () => {
  const suffix = Date.now()

  let memberId: string
  let otherMemberId: string
  let bandId: string
  let songId: string
  const createdSongIds: string[] = []

  /** Every band row for the fixture band, in the shape ER2 compares. */
  const bandRows = async () => {
    const res = await query(
      `SELECT o.id, v.song_id, o.status FROM band_songs o
       JOIN song_versions v ON v.id = o.version_id
       WHERE o.band_id = $1 ORDER BY o.id`,
      [bandId],
    )
    return res.rows
  }

  const createSong = async (title: string): Promise<string> => {
    const res = await query<{ id: string }>(
      'INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id',
      [title, 'RH-96 Artist'],
    )
    createdSongIds.push(res.rows[0].id)
    return res.rows[0].id
  }

  beforeAll(async () => {
    memberId = await createTestUser({ email: `rh96-member-${suffix}@example.com` })
    otherMemberId = await createTestUser({ email: `rh96-other-${suffix}@example.com` })
    bandId = await createBand(memberId, `RH-96 Band ${suffix}`, null, null)
    await query("INSERT INTO band_members (band_id, user_id, role) VALUES ($1, $2, 'member')", [
      bandId,
      otherMemberId,
    ])
    songId = await createSong(`RH-96 Song ${suffix}`)
  })

  afterAll(async () => {
    if (bandId) await query('DELETE FROM bands WHERE id = $1', [bandId])
    for (const user of [memberId, otherMemberId]) {
      if (user) await deleteTestUser(user)
    }
    for (const song of createdSongIds) {
      await query('DELETE FROM songs WHERE id = $1', [song])
    }
  })

  it('ships exactly one drop migration, naming both objects 0001 created', () => {
    const names = fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(MIGRATION_SUFFIX))
    expect(names).toHaveLength(1)

    // The two identifiers are read out of 0001 rather than written here: ER3
    // keeps both of them out of every file under `src/`, and a name taken from
    // the migration that created it cannot drift from the one being dropped.
    const initial = fs.readFileSync(path.join(MIGRATIONS_DIR, '0001_initial_schema.sql'), 'utf8')
    const functionName = /CREATE OR REPLACE FUNCTION\s+(\w*sync_band\w*)\s*\(/i.exec(initial)?.[1]
    const triggerName = /CREATE OR REPLACE TRIGGER\s+(\w*sync_band\w*)\b/i.exec(initial)?.[1]
    expect(functionName).toBeDefined()
    expect(triggerName).toBeDefined()

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, names[0]), 'utf8')
    expect(sql).toMatch(new RegExp(`DROP TRIGGER IF EXISTS\\s+${triggerName}\\b`, 'i'))
    expect(sql).toMatch(new RegExp(`DROP FUNCTION IF EXISTS\\s+${functionName}\\b`, 'i'))
  })

  it('leaves every band row untouched when a member changes their own status (ER2)', async () => {
    const bandEntry = await addSongToRepertoire({ bandId }, songId)
    await updateSongStatus({ bandId }, bandEntry.id, 'mastered')

    const personalEntry = await addSongToRepertoire({ userId: memberId }, songId)
    const before = await bandRows()
    expect(before.find((row) => row.id === bandEntry.id)).toMatchObject({ status: 'mastered' })

    await updateSongStatus({ userId: memberId }, personalEntry.id, 'learning')

    expect(await bandRows()).toEqual(before)
  })

  it('borns a personal row created in band context as unknown (ER4)', async () => {
    const ownSongId = await createSong(`RH-96 Seedless Song ${suffix}`)
    const bandEntry = await addSongToRepertoire({ bandId }, ownSongId)
    await updateSongStatus({ bandId }, bandEntry.id, 'polishing')

    // What Fast View does for a band-context user with no personal row yet.
    const personalEntry = await addSongToRepertoire({ userId: otherMemberId }, ownSongId)

    expect(personalEntry.status).toBe('unknown')
  })
})

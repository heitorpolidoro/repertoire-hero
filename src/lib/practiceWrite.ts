/**
 * RH-158 — the practice write: "I practised this", on a list of versions.
 *
 * It lives beside `ownerSongs.ts` rather than in it because that module sits at
 * the global 400-line budget and the ratchet forbids a new override.
 *
 * The rules this module keeps true:
 *
 *  - **The presser's own row is the write.** The key always includes the
 *    presser's user id, so another member's `user_songs` row cannot be reached.
 *    A missing row is created (born `unknown` when no status is given).
 *  - **A band row is only ever updated, never inserted.** When a band id is
 *    passed the band's existing `band_songs` row at that version gets the same
 *    values; with no row there, nothing happens. Whether the presser may touch
 *    the band is decided by the caller (`recordPracticeAction`): this module
 *    trusts the band id it is handed, like the rest of the owner-row writes.
 *  - **The date is the database's `now()`**, never a value from the client.
 *  - **All or nothing**: one transaction per call, so a failing item rolls the
 *    whole batch back; an empty list does nothing.
 *
 * Built list-shaped so the whole-playlist review (a later part) reuses it.
 */

import { withTransaction, type Queryable } from '@/lib/db'
import { logger } from '@/lib/logger'
import { PRESENCE_USER_SQL, presentOthers } from '@/lib/practicePresence'
import type { SongStatus } from '@/types/database'

export interface PracticeItem {
  versionId: string
  /** Absent leaves an existing row's status alone; a new row is born `unknown`. */
  status?: SongStatus
}

export interface PracticeStatusItem {
  versionId: string
  status: SongStatus
}

const PRACTISE_USER_SQL = `
  INSERT INTO user_songs (user_id, version_id, status, last_practiced)
  VALUES ($1, $2, COALESCE($3::song_status, 'unknown'), now())
  ON CONFLICT (user_id, version_id) DO UPDATE
    SET last_practiced = now(), status = COALESCE($3::song_status, user_songs.status)
`

const PRACTISE_BAND_SQL = `
  UPDATE band_songs
     SET last_practiced = now(), status = COALESCE($3::song_status, status)
   WHERE band_id = $1 AND version_id = $2
`

const STATUS_USER_SQL = `
  INSERT INTO user_songs (user_id, version_id, status)
  VALUES ($1, $2, $3::song_status)
  ON CONFLICT (user_id, version_id) DO UPDATE SET status = EXCLUDED.status
`

const STATUS_BAND_SQL = `
  UPDATE band_songs SET status = $3::song_status
   WHERE band_id = $1 AND version_id = $2
`

interface Batch {
  verb: string
  sql: { user: string; band: string }
  userId: string
  bandId: string | undefined
  items: Array<{ versionId: string; status?: SongStatus }>
  /** RH-119: other members to credit (already validated by the caller). */
  present?: string[]
}

async function writeBatch({ verb, sql, userId, bandId, items, present = [] }: Batch): Promise<void> {
  if (items.length === 0) return
  try {
    await withTransaction(async (client: Queryable) => {
      for (const { versionId, status } of items) {
        await client.query(sql.user, [userId, versionId, status ?? null])
        if (bandId) await client.query(sql.band, [bandId, versionId, status ?? null])
        for (const memberId of present) await client.query(PRESENCE_USER_SQL, [memberId, versionId])
      }
    })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error(`Failed to ${verb}`, err, { items: items.length })
    throw new Error(`Failed to ${verb}: ${err.message}`)
  }
}

/** Sets `last_practiced` to the database's now() for every item (see module doc). */
export function recordPractice(
  userId: string,
  bandId: string | undefined,
  items: PracticeItem[],
  presentUserIds?: readonly string[],
): Promise<void> {
  const sql = { user: PRACTISE_USER_SQL, band: PRACTISE_BAND_SQL }
  const present = presentOthers(userId, presentUserIds)
  return writeBatch({ verb: 'record practice', sql, userId, bandId, items, present })
}

/** The status-only sibling: writes `status` and never mentions `last_practiced`. */
export function recordPracticeStatus(
  userId: string,
  bandId: string | undefined,
  items: PracticeStatusItem[],
): Promise<void> {
  const sql = { user: STATUS_USER_SQL, band: STATUS_BAND_SQL }
  return writeBatch({ verb: 'record practice status', sql, userId, bandId, items })
}

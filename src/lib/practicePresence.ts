/**
 * RH-119 — the presence statement, kept apart from the single-owner `PRACTISE_*`
 * statements in `practiceWrite.ts` so none of this logic leaks into them.
 *
 * It is the one deliberate exception to "a write reaches one owner": a band
 * admin credits a present member's own `user_songs` row. It writes
 * `last_practiced` and nothing else, and only ever forward — `GREATEST` keeps a
 * later date the member set themselves. A missing row is born `unknown`. Whether
 * the ids may be named (admin of the band, all current members) is decided by
 * `recordPracticeAction` before this runs.
 */

import { query } from '@/lib/db'

export const PRESENCE_USER_SQL = `
  INSERT INTO user_songs (user_id, version_id, status, last_practiced)
  VALUES ($1, $2, 'unknown', now())
  ON CONFLICT (user_id, version_id) DO UPDATE
    SET last_practiced = GREATEST(user_songs.last_practiced, now())
`

/** Throws, before any write, unless every id is a current member of the band. */
export async function assertPresentAreMembers(bandId: string, presentUserIds: readonly string[]): Promise<void> {
  const ids = [...new Set(presentUserIds)]
  if (ids.length === 0) return
  const res = await query<{ n: number }>(
    'SELECT count(*)::int AS n FROM band_members WHERE band_id = $1 AND user_id::text = ANY($2::text[])',
    [bandId, ids],
  )
  if (res.rows[0].n !== ids.length) throw new Error('Access denied: present user is not a member of this band')
}

/** The ids to credit: unique, and never the presser, whose own row is written separately. */
export function presentOthers(userId: string, presentUserIds: readonly string[] | undefined): string[] {
  return [...new Set(presentUserIds ?? [])].filter(id => id !== userId)
}

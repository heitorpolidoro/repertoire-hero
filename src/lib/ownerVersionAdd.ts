/**
 * RH-151 — add one named **version** to an owner's repertoire.
 *
 * `addSongToRepertoire` (`ownerSongs.ts`) always inserts a song's
 * *representative* version, so it cannot add a recording the musician picked
 * from an expanded card. This is the by-version sibling. It lives beside that
 * module because `ownerSongs.ts` sits at the 400-line budget and the ratchet
 * forbids a new override.
 *
 * Same shape as the song-keyed add: one transaction, the owner table and column
 * from the resolved owner, a row born `unknown` by the column default, read
 * straight back as a resolved entry. A version id that names nothing throws.
 */

import { withTransaction } from '@/lib/db'
import { logger } from '@/lib/logger'
import { LEVELS, ownerColumn, ownerId, ownerTable, toEntry, type RepertoireOwner } from '@/lib/ownerSongRows'
import type { OwnerSongLevelsRow } from '@/lib/dbRows'
import type { Repertoire } from '@/types/database'

function addVersionSql(owner: RepertoireOwner): string {
  return `
    WITH inserted AS (
      INSERT INTO ${ownerTable(owner)} (${ownerColumn(owner)}, version_id)
      SELECT $1, v.id FROM song_versions v WHERE v.id = $2::uuid
      RETURNING *
    )
    SELECT ${LEVELS}
    FROM inserted o
    JOIN song_versions v ON v.id = o.version_id
    JOIN songs s ON s.id = v.song_id
  `
}

/** Adds exactly `versionId` to `owner`'s repertoire; throws when it does not exist. */
export async function addVersionToRepertoire(owner: RepertoireOwner, versionId: string): Promise<Repertoire> {
  const sql = addVersionSql(owner)
  try {
    return await withTransaction(async (client) => {
      const res = await client.query<OwnerSongLevelsRow>(sql, [ownerId(owner), versionId])
      if (res.rows.length === 0) throw new Error('Song version not found')
      return toEntry(res.rows[0], owner)
    })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to add version to repertoire', err)
    throw new Error(`Failed to add version to repertoire: ${err.message}`)
  }
}

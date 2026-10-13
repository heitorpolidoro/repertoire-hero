/**
 * RH-154 — the system admin's catalog data layer: what a version or song
 * sustains, merging one version into another, and deleting an unreferenced one.
 *
 * Every function calls `checkSystemAdmin` before it reads or writes anything.
 * Merge and delete each run in one `withTransaction`; a collision is prevented
 * by deleting the losing row first, never by catching `23505`.
 */
import { query, withTransaction, type Queryable } from '@/lib/db'
import { checkSystemAdmin } from '@/lib/moderation'
import { logger } from '@/lib/logger'

export interface BlastRadius {
  repertoires: number
  playlists: number
}

export type CatalogTarget = { versionId: string } | { songId: string }

/** A refusal raised on purpose, re-thrown verbatim (L1a). */
class CatalogAdminRefusal extends Error {}

const VERSION_IDS_OF_VERSION = 'SELECT id FROM song_versions WHERE id = $1'
const VERSION_IDS_OF_SONG = 'SELECT id FROM song_versions WHERE song_id = $1'

const BLAST_RADIUS_SQL = (versions: string) => `
  SELECT
    (SELECT count(DISTINCT user_id) FROM user_songs WHERE version_id IN (${versions}))
    + (SELECT count(DISTINCT band_id) FROM band_songs WHERE version_id IN (${versions})) AS repertoires,
    (SELECT count(DISTINCT playlist_id) FROM playlist_songs WHERE version_id IN (${versions})) AS playlists`

interface Counts {
  repertoires: string | number
  playlists: string | number
}

async function readBlastRadius(db: Queryable, target: CatalogTarget): Promise<BlastRadius> {
  const [versions, id] =
    'versionId' in target
      ? [VERSION_IDS_OF_VERSION, target.versionId]
      : [VERSION_IDS_OF_SONG, target.songId]
  const res = await db.query<Counts>(BLAST_RADIUS_SQL(versions), [id])
  return {
    repertoires: Number(res.rows[0].repertoires),
    playlists: Number(res.rows[0].playlists),
  }
}

function rethrowOrWrap(error: unknown, message: string, context: Record<string, unknown>): never {
  const err = error instanceof Error ? error : new Error(String(error))
  if (err instanceof CatalogAdminRefusal || err.message.startsWith('Access denied')) throw err
  logger.error(message, err, context)
  throw new Error(`${message}: ${err.message}`)
}

/** Distinct repertoire owners and distinct playlists holding a version, or any version of a song. */
export async function getCatalogBlastRadius(
  adminUserId: string,
  target: CatalogTarget,
): Promise<BlastRadius> {
  try {
    await checkSystemAdmin(adminUserId)
    return await readBlastRadius({ query }, target)
  } catch (error) {
    return rethrowOrWrap(error, 'Failed to compute catalog blast radius', { adminUserId })
  }
}

const DELETE_COLLIDING_OWNER_ROWS = (table: string, owner: string) => `
  DELETE FROM ${table} a
   WHERE a.version_id = $1
     AND EXISTS (SELECT 1 FROM ${table} b WHERE b.${owner} = a.${owner} AND b.version_id = $2)`

const REPOINT_OWNER_ROWS = (table: string) =>
  `UPDATE ${table} SET version_id = $2 WHERE version_id = $1`

const DELETE_COLLIDING_PLAYLIST_ROWS = `
  DELETE FROM playlist_songs a
   WHERE a.version_id = $1
     AND EXISTS (SELECT 1 FROM playlist_songs b WHERE b.playlist_id = a.playlist_id AND b.version_id = $2)
  RETURNING a.playlist_id`

const RENUMBER_PLAYLISTS = `
  UPDATE playlist_songs p SET position = r.rn
    FROM (SELECT id, row_number() OVER (PARTITION BY playlist_id ORDER BY position, id)::int AS rn
            FROM playlist_songs WHERE playlist_id = ANY($1::uuid[])) r
   WHERE p.id = r.id AND p.position <> r.rn`

/**
 * Merges version `fromVersionId` into `intoVersionId` and deletes the former.
 * Where an owner or playlist already holds the target, the target's row wins
 * and the source's is discarded.
 */
export async function mergeSongVersions(
  adminUserId: string,
  fromVersionId: string,
  intoVersionId: string,
): Promise<void> {
  try {
    await checkSystemAdmin(adminUserId)
    if (fromVersionId === intoVersionId) {
      throw new CatalogAdminRefusal('Cannot merge a version into itself')
    }
    await withTransaction(async (client) => {
      const found = await client.query<{ id: string }>(
        'SELECT id FROM song_versions WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
        [[fromVersionId, intoVersionId]],
      )
      if (found.rows.length !== 2) {
        throw new CatalogAdminRefusal('Both versions must exist to merge')
      }
      const ids = [fromVersionId, intoVersionId]
      await client.query(DELETE_COLLIDING_OWNER_ROWS('user_songs', 'user_id'), ids)
      await client.query(REPOINT_OWNER_ROWS('user_songs'), ids)
      await client.query(DELETE_COLLIDING_OWNER_ROWS('band_songs', 'band_id'), ids)
      await client.query(REPOINT_OWNER_ROWS('band_songs'), ids)
      const collided = await client.query<{ playlist_id: string }>(
        DELETE_COLLIDING_PLAYLIST_ROWS,
        ids,
      )
      await client.query(REPOINT_OWNER_ROWS('playlist_songs'), ids)
      await client.query(RENUMBER_PLAYLISTS, [collided.rows.map((row) => row.playlist_id)])
      await client.query(
        'UPDATE catalog_suggestions SET target_id = $2 WHERE target_id = $1',
        ids,
      )
      await client.query('DELETE FROM song_versions WHERE id = $1', [fromVersionId])
    })
  } catch (error) {
    rethrowOrWrap(error, 'Failed to merge song versions', {
      adminUserId,
      fromVersionId,
      intoVersionId,
    })
  }
}

/** Deletes a version nothing references; refuses otherwise. */
export async function deleteSongVersion(adminUserId: string, versionId: string): Promise<void> {
  try {
    await checkSystemAdmin(adminUserId)
    await withTransaction(async (client) => {
      const locked = await client.query(
        'SELECT id FROM song_versions WHERE id = $1 FOR UPDATE',
        [versionId],
      )
      if (locked.rows.length === 0) throw new CatalogAdminRefusal('Song version not found')
      const radius = await readBlastRadius(client, { versionId })
      const suggestions = await client.query(
        'SELECT 1 FROM catalog_suggestions WHERE target_id = $1 LIMIT 1',
        [versionId],
      )
      if (radius.repertoires + radius.playlists > 0 || suggestions.rows.length > 0) {
        throw new CatalogAdminRefusal('Cannot delete a song version that is still referenced')
      }
      await client.query('DELETE FROM song_versions WHERE id = $1', [versionId])
    })
  } catch (error) {
    rethrowOrWrap(error, 'Failed to delete song version', { adminUserId, versionId })
  }
}

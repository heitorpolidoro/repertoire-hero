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

const UNION_ALBUM_LINKS = `
  INSERT INTO version_albums (version_id, album_id, created_at)
  SELECT $2, album_id, created_at FROM version_albums WHERE version_id = $1
  ON CONFLICT DO NOTHING`

const RENUMBER_PLAYLISTS = `
  UPDATE playlist_songs p SET position = r.rn
    FROM (SELECT id, row_number() OVER (PARTITION BY playlist_id ORDER BY position, id)::int AS rn
            FROM playlist_songs WHERE playlist_id = ANY($1::uuid[])) r
   WHERE p.id = r.id AND p.position <> r.rn`

/**
 * The body of a version merge, run on the caller's transaction client (a
 * nested `withTransaction` is not allowed). Locks both versions, repoints
 * every reference to `intoVersionId` (its rows win) and deletes `fromVersionId`.
 */
async function mergeVersionsInTransaction(
  client: Queryable,
  fromVersionId: string,
  intoVersionId: string,
): Promise<void> {
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
  const collided = await client.query<{ playlist_id: string }>(DELETE_COLLIDING_PLAYLIST_ROWS, ids)
  await client.query(REPOINT_OWNER_ROWS('playlist_songs'), ids)
  await client.query(RENUMBER_PLAYLISTS, [collided.rows.map((row) => row.playlist_id)])
  await client.query('UPDATE catalog_suggestions SET target_id = $2 WHERE target_id = $1', ids)
  await client.query(UNION_ALBUM_LINKS, ids)
  await client.query('DELETE FROM song_versions WHERE id = $1', [fromVersionId])
}

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
    await withTransaction((client) =>
      mergeVersionsInTransaction(client, fromVersionId, intoVersionId),
    )
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

export type SplitTarget = { new: { artist: string; title: string } } | { songId: string }

async function lockSongs(client: Queryable, songIds: string[]): Promise<void> {
  const found = await client.query<{ id: string }>(
    'SELECT id FROM songs WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
    [songIds],
  )
  if (found.rows.length !== songIds.length) throw new CatalogAdminRefusal('Song not found')
}

async function lockVersionIds(client: Queryable, songId: string): Promise<string[]> {
  const res = await client.query<{ id: string }>(
    'SELECT id FROM song_versions WHERE song_id = $1 ORDER BY id FOR UPDATE',
    [songId],
  )
  return res.rows.map((row) => row.id)
}

const COLLIDING_VERSION = `
  SELECT t.id FROM song_versions m
    JOIN song_versions t ON t.song_id = $2
     AND t.label IS NOT DISTINCT FROM m.label
   WHERE m.id = $1`

/** Moves versions onto a song; one that duplicates a target version is merged into it. */
async function moveVersions(
  client: Queryable,
  versionIds: string[],
  targetSongId: string,
): Promise<void> {
  for (const versionId of versionIds) {
    const twin = await client.query<{ id: string }>(COLLIDING_VERSION, [versionId, targetSongId])
    if (twin.rows.length > 0) {
      await mergeVersionsInTransaction(client, versionId, twin.rows[0].id)
    } else {
      await client.query('UPDATE song_versions SET song_id = $2 WHERE id = $1', [
        versionId,
        targetSongId,
      ])
    }
  }
}

async function appendedLinkBase(client: Queryable, songId: string): Promise<number> {
  const res = await client.query<{ max: number }>(
    'SELECT COALESCE(max(position), 0) AS max FROM song_links WHERE song_id = $1',
    [songId],
  )
  return Number(res.rows[0].max)
}

const COPY_LINKS = `
  INSERT INTO song_links (song_id, url, label, position)
  SELECT $2, url, label, $3 + row_number() OVER (ORDER BY position, created_at, id)
    FROM song_links WHERE song_id = $1
  ON CONFLICT (song_id, url) DO NOTHING`

const MOVE_FILES_OF_MOVED_VERSIONS = `
  UPDATE song_files f SET song_id = $2
   WHERE f.song_id = $1
     AND EXISTS (SELECT 1 FROM user_songs u WHERE u.user_id = f.user_id AND u.version_id = ANY($3::uuid[]))
     AND NOT EXISTS (SELECT 1 FROM user_songs u WHERE u.user_id = f.user_id AND u.version_id = ANY($4::uuid[]))`

const INSERT_SPLIT_SONG = `
  INSERT INTO songs (title, artist, standard_key, cover_url, duration_seconds)
  SELECT $2, $3, standard_key, cover_url, duration_seconds FROM songs WHERE id = $1
  RETURNING id`

const SONG_WITH_IDENTITY = `
  SELECT 1 FROM songs
   WHERE lower(btrim(artist)) = lower(btrim($1)) AND lower(btrim(title)) = lower(btrim($2))`

async function createSplitTarget(
  client: Queryable,
  sourceId: string,
  named: { artist: string; title: string },
): Promise<string> {
  const exists = await client.query(SONG_WITH_IDENTITY, [named.artist, named.title])
  if (exists.rows.length > 0) {
    throw new CatalogAdminRefusal(
      'A song with this artist and title already exists; split onto it instead',
    )
  }
  const created = await client.query<{ id: string }>(INSERT_SPLIT_SONG, [
    sourceId,
    named.title.trim(),
    named.artist.trim(),
  ])
  return created.rows[0].id
}

function assertSplitInput(sourceId: string, versionIds: string[], target: SplitTarget): void {
  if (versionIds.length === 0) throw new CatalogAdminRefusal('Choose at least one version to move')
  if ('songId' in target && target.songId === sourceId) {
    throw new CatalogAdminRefusal('The target song must differ from the source song')
  }
  if ('new' in target && (!target.new.artist.trim() || !target.new.title.trim())) {
    throw new CatalogAdminRefusal('A new song needs an artist and a title')
  }
}

/**
 * Moves chosen versions off `sourceSongId` onto a new song or an existing one,
 * in one transaction. The source keeps at least one version, its own links and
 * the files of musicians who still hold one of its versions.
 */
export async function splitSongVersions(
  adminUserId: string,
  sourceSongId: string,
  versionIds: string[],
  target: SplitTarget,
): Promise<void> {
  try {
    await checkSystemAdmin(adminUserId)
    const chosen = [...new Set(versionIds)]
    assertSplitInput(sourceSongId, chosen, target)
    await withTransaction(async (client) => {
      await lockSongs(client, 'songId' in target ? [sourceSongId, target.songId] : [sourceSongId])
      const all = await lockVersionIds(client, sourceSongId)
      if (!chosen.every((id) => all.includes(id))) {
        throw new CatalogAdminRefusal('Every chosen version must belong to the source song')
      }
      const remaining = all.filter((id) => !chosen.includes(id))
      if (remaining.length === 0) {
        throw new CatalogAdminRefusal('Cannot move every version; merge the songs instead')
      }
      const targetId =
        'songId' in target
          ? target.songId
          : await createSplitTarget(client, sourceSongId, target.new)
      await client.query(MOVE_FILES_OF_MOVED_VERSIONS, [sourceSongId, targetId, chosen, remaining])
      await moveVersions(client, chosen, targetId)
      const base = await appendedLinkBase(client, targetId)
      await client.query(COPY_LINKS, [sourceSongId, targetId, base])
    })
  } catch (error) {
    rethrowOrWrap(error, 'Failed to split song versions', { adminUserId, sourceSongId })
  }
}

const REPOINT_LINK_SUGGESTIONS = `
  UPDATE catalog_suggestions cs SET target_id = bl.id
    FROM song_links al JOIN song_links bl ON bl.song_id = $2 AND bl.url = al.url
   WHERE al.song_id = $1 AND cs.target_table = 'song_links' AND cs.target_id = al.id`

const DELETE_DUPLICATE_LINKS = `
  DELETE FROM song_links al
   WHERE al.song_id = $1
     AND EXISTS (SELECT 1 FROM song_links bl WHERE bl.song_id = $2 AND bl.url = al.url)`

const REPOINT_LINKS = `
  UPDATE song_links l SET song_id = $2, position = $3 + r.rn
    FROM (SELECT id, row_number() OVER (ORDER BY position, created_at, id) AS rn
            FROM song_links WHERE song_id = $1) r
   WHERE l.id = r.id`

async function mergeSongRows(client: Queryable, fromId: string, intoId: string): Promise<void> {
  await moveVersions(client, await lockVersionIds(client, fromId), intoId)
  await client.query('UPDATE song_files SET song_id = $2 WHERE song_id = $1', [fromId, intoId])
  const base = await appendedLinkBase(client, intoId)
  await client.query(REPOINT_LINK_SUGGESTIONS, [fromId, intoId])
  await client.query(DELETE_DUPLICATE_LINKS, [fromId, intoId])
  await client.query(REPOINT_LINKS, [fromId, intoId, base])
  await client.query(
    "UPDATE catalog_suggestions SET target_id = $2 WHERE target_table = 'songs' AND target_id = $1",
    [fromId, intoId],
  )
  await client.query('DELETE FROM songs WHERE id = $1', [fromId])
}

/** Merges song `fromSongId` into `intoSongId` and deletes the former, in one transaction. */
export async function mergeSongs(
  adminUserId: string,
  fromSongId: string,
  intoSongId: string,
): Promise<void> {
  try {
    await checkSystemAdmin(adminUserId)
    if (fromSongId === intoSongId) throw new CatalogAdminRefusal('Cannot merge a song into itself')
    await withTransaction(async (client) => {
      const found = await client.query<{ id: string }>(
        'SELECT id FROM songs WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
        [[fromSongId, intoSongId]],
      )
      if (found.rows.length !== 2) {
        throw new CatalogAdminRefusal('Both songs must exist to merge')
      }
      await mergeSongRows(client, fromSongId, intoSongId)
    })
  } catch (error) {
    rethrowOrWrap(error, 'Failed to merge songs', { adminUserId, fromSongId, intoSongId })
  }
}

/**
 * RH-168 - read-only data access for a practice session's sources.
 *
 * Kept out of `ownerSongs.ts`, which sits at the 400-line budget. Nothing here
 * writes: a start reads the candidates and stops.
 *
 * Authorization is split the way `getPlaylistDetailsWithEntries` splits it: the
 * caller (`src/app/actions/practice.ts`) establishes band membership with
 * `assertBandMember` before passing a `bandId` in; a playlist source is checked
 * here with `assertPlaylistAccess`.
 *
 * A playlist's entries are read against the owner's table with a `LEFT JOIN`, so
 * an entry whose owner holds no row comes back with a null status and counts as
 * unassessed. The whole-repertoire read is the owner's rows only.
 */

import { query } from '@/lib/db'
import type { PracticeCandidateRow, PracticePlaylistRow } from '@/lib/dbRows'
import { logger } from '@/lib/logger'
import { assertPlaylistAccess } from '@/lib/playlists'
import type { PracticeCandidate } from '@/lib/practiceOrder'
import type { PracticeSource } from '@/lib/practiceSession'

type OwnerTable = { table: 'user_songs' | 'band_songs'; column: 'user_id' | 'band_id' }

function ownerTable(bandId: string | null): OwnerTable {
  return bandId ? { table: 'band_songs', column: 'band_id' } : { table: 'user_songs', column: 'user_id' }
}

function repertoireSql({ table, column }: OwnerTable): string {
  return `
    SELECT o.version_id, s.title, s.artist, o.status, o.last_practiced
      FROM ${table} o
      JOIN song_versions v ON v.id = o.version_id
      JOIN songs s ON s.id = v.song_id
     WHERE o.${column} = $1
  `
}

function playlistSql({ table, column }: OwnerTable): string {
  return `
    SELECT ps.version_id, s.title, s.artist, o.status, o.last_practiced
      FROM playlist_songs ps
      JOIN song_versions v ON v.id = ps.version_id
      JOIN songs s ON s.id = v.song_id
      LEFT JOIN ${table} o ON o.version_id = ps.version_id AND o.${column} = $1
     WHERE ps.playlist_id = $2
     ORDER BY ps.position ASC
  `
}

function toCandidate(row: PracticeCandidateRow): PracticeCandidate {
  const last = row.last_practiced
  return {
    versionId: row.version_id,
    title: row.title,
    artist: row.artist,
    status: row.status,
    lastPracticed: last instanceof Date ? last.toISOString() : last,
  }
}

/**
 * The songs of one source with their level and last-practised date, unordered.
 * `bandId` null reads the caller's own rows; a band id must already have passed
 * `assertBandMember`.
 */
export async function getPracticeCandidates(
  userId: string,
  source: PracticeSource,
  bandId: string | null,
): Promise<PracticeCandidate[]> {
  if (source.kind === 'playlist') await assertPlaylistAccess(source.playlistId, userId)

  const owner = ownerTable(bandId)
  const ownerId = bandId ?? userId
  try {
    const res =
      source.kind === 'playlist'
        ? await query<PracticeCandidateRow>(playlistSql(owner), [ownerId, source.playlistId])
        : await query<PracticeCandidateRow>(repertoireSql(owner), [ownerId])
    return res.rows.map(toCandidate)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to fetch practice candidates', err, { source: source.kind })
    throw new Error(`Failed to fetch practice candidates: ${err.message}`)
  }
}

/** The owner's own playlists (id and name), newest first. Band id must have passed `assertBandMember`. */
export async function listPracticePlaylists(
  userId: string,
  bandId: string | null,
): Promise<PracticePlaylistRow[]> {
  const column = bandId ? 'band_id' : 'user_id'
  try {
    const res = await query<PracticePlaylistRow>(
      `SELECT id, name FROM playlists WHERE ${column} = $1 ORDER BY created_at DESC, id`,
      [bandId ?? userId],
    )
    return res.rows
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to fetch practice playlists', err)
    throw new Error(`Failed to fetch practice playlists: ${err.message}`)
  }
}

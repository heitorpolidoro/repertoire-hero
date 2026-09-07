import { assertBandMember } from '@/lib/bands'
import { query, withTransaction } from '@/lib/db'
import { logger } from '@/lib/logger'
import { buildUpdateSet } from '@/lib/sqlUpdate'
import type { Playlist } from '@/types/database'

export async function getUserPlaylists(userId: string): Promise<Playlist[]> {
  try {
    // Fetch band IDs the user belongs to
    const bandIdsResult = await query('SELECT band_id FROM band_members WHERE user_id = $1', [userId])
    const bandIds = bandIdsResult.rows.map((m) => m.band_id)

    // Personal playlists + playlists of every band the user is a member of
    const sql = `
      SELECT p.*,
             COALESCE(
               (SELECT json_agg(json_build_object(
                 'id', ps.id,
                 'song', json_build_object('duration_seconds', s.duration_seconds)
               ))
                FROM playlist_songs ps
                JOIN global_songs s ON ps.song_id = s.id
                WHERE ps.playlist_id = p.id
               ), '[]'::json) as songs,
             (SELECT json_build_object('id', b.id, 'name', b.name)
              FROM bands b
              WHERE b.id = p.band_id
             ) as band
      FROM playlists p
      WHERE p.user_id = $1 OR p.band_id = ANY($2::uuid[])
      ORDER BY p.created_at DESC
    `
    const res = await query(sql, [userId, bandIds])
    return res.rows as Playlist[]
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to fetch playlists', err)
    throw new Error(`Failed to fetch playlists: ${err.message}`)
  }
}

export async function createPlaylist(
  userId: string,
  data: {
    name: string
    description?: string
  }
): Promise<Playlist> {
  const sql = `
    INSERT INTO playlists (user_id, name, description)
    VALUES ($1, $2, $3)
    RETURNING *
  `
  try {
    const res = await query(sql, [userId, data.name, data.description ?? null])
    return res.rows[0] as Playlist
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to create playlist', err)
    throw new Error(`Failed to create playlist: ${err.message}`)
  }
}

/**
 * The playlist row the caller may act on, or throws. A playlist is reachable
 * when the caller owns it personally or is a member of the band that owns it;
 * a non-existent id throws the same message, so existence is not leaked.
 */
export async function assertPlaylistAccess(
  playlistId: string,
  userId: string,
): Promise<{ id: string; user_id: string | null; band_id: string | null }> {
  const sql = `
    SELECT id, user_id, band_id
    FROM playlists
    WHERE id = $1
      AND (user_id = $2 OR band_id IN (SELECT band_id FROM band_members WHERE user_id = $2))
  `
  let res
  try {
    res = await query(sql, [playlistId, userId])
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to authorize playlist access', err, { playlistId })
    throw new Error(`Failed to authorize playlist access: ${err.message}`)
  }

  if (res.rowCount === 0) throw new Error('Access denied: not allowed on this playlist')
  return res.rows[0] as { id: string; user_id: string | null; band_id: string | null }
}

export async function updatePlaylist(
  id: string,
  userId: string,
  data: {
    name?: string
    description?: string
    sync_with_spotify?: boolean
    tags?: string[]
  }
): Promise<void> {
  await assertPlaylistAccess(id, userId)

  try {
    // Dynamically build the update query to avoid overwriting omitted fields
    const { setClauses, values, nextIndex: paramIndex } = buildUpdateSet(data, [
      'name',
      'description',
      'sync_with_spotify',
      'tags',
    ])

    setClauses.push(`updated_at = now()`)

    if (setClauses.length === 1) return // Only updated_at

    const sql = `
      UPDATE playlists
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
    `
    values.push(id)

    const res = await query(sql, values)
    if (res.rowCount === 0) throw new Error('Playlist not found')
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to update playlist', err, { id })
    throw new Error(`Failed to update playlist: ${err.message}`)
  }
}

export async function deletePlaylist(id: string, userId: string): Promise<void> {
  await assertPlaylistAccess(id, userId)

  const sql = `DELETE FROM playlists WHERE id = $1`
  try {
    const res = await query(sql, [id])
    if (res.rowCount === 0) throw new Error('Playlist not found')
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to delete playlist', err, { id })
    throw new Error(`Failed to delete playlist: ${err.message}`)
  }
}

export async function addSongToPlaylist(playlistId: string, userId: string, songId: string): Promise<void> {
  // 1. Fetch playlist context — and refuse a playlist the caller cannot write to.
  const playlist = await assertPlaylistAccess(playlistId, userId)

  try {
    // 2. One transaction for the whole write: the song must not end up in a
    //    repertoire without landing in the playlist. Expected duplicates go
    //    through ON CONFLICT DO NOTHING — a caught 23505 would leave the
    //    transaction aborted (see AGENTS.md, "Transactions").
    await withTransaction(async (client) => {
      if (playlist.band_id) {
        // Band playlist: the band's repertoire and the caller's own.
        await client.query(
          "INSERT INTO repertoire (band_id, song_id, status) VALUES ($1, $2, 'unknown') ON CONFLICT DO NOTHING",
          [playlist.band_id, songId],
        )
        await client.query(
          "INSERT INTO repertoire (user_id, song_id, status) VALUES ($1, $2, 'unknown') ON CONFLICT DO NOTHING",
          [userId, songId],
        )
      } else if (playlist.user_id) {
        await client.query(
          "INSERT INTO repertoire (user_id, song_id, status) VALUES ($1, $2, 'unknown') ON CONFLICT DO NOTHING",
          [playlist.user_id, songId],
        )
      }

      // 3. Position is computed in the insert itself. MAX + 1 (not COUNT + 1)
      //    tolerates the gaps `removeSongFromPlaylist` leaves behind, and
      //    `uq_playlist_song_position` is what actually serialises two
      //    concurrent adds: the loser fails with 23505 instead of silently
      //    writing a duplicate position.
      await client.query(
        `INSERT INTO playlist_songs (playlist_id, song_id, position)
         SELECT $1, $2, COALESCE(MAX(position), 0) + 1 FROM playlist_songs WHERE playlist_id = $1`,
        [playlistId, songId],
      )
    })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to add song to playlist', err, { playlistId, songId })
    throw new Error(`Failed to add song to playlist: ${err.message}`)
  }
}

export async function removeSongFromPlaylist(playlistId: string, userId: string, songId: string): Promise<void> {
  await assertPlaylistAccess(playlistId, userId)

  const sql = `DELETE FROM playlist_songs WHERE playlist_id = $1 AND song_id = $2`
  try {
    await query(sql, [playlistId, songId])
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to remove song from playlist', err, { playlistId, songId })
    throw new Error(`Failed to remove song from playlist: ${err.message}`)
  }
}

export async function getPlaylistWithSongs(id: string, userId: string): Promise<Playlist | null> {
  const sql = `
    SELECT p.*,
           COALESCE(
             (SELECT json_agg(json_build_object(
               'id', ps.id,
               'playlist_id', ps.playlist_id,
               'song_id', ps.song_id,
               'position', ps.position,
               'song', json_build_object(
                 'id', s.id,
                 'contributor_id', s.contributor_id,
                 'title', s.title,
                 'artist', s.artist,
                 'album', s.album,
                 'standard_key', s.standard_key,
                 'cover_url', s.cover_url,
                 'duration_seconds', s.duration_seconds,
                 'links', s.links,
                 'created_at', s.created_at
               )
             ) ORDER BY ps.position ASC)
              FROM playlist_songs ps
              JOIN global_songs s ON ps.song_id = s.id
              WHERE ps.playlist_id = p.id
             ), '[]'::json) as songs
    FROM playlists p
    WHERE p.id = $1
      AND (p.user_id = $2 OR p.band_id IN (SELECT band_id FROM band_members WHERE user_id = $2))
  `
  try {
    // Access-scoped: an unrelated caller gets null, the same as for an id that
    // does not exist — the UI already routes that to "playlist not found".
    const res = await query(sql, [id, userId])
    if (res.rowCount === 0) return null
    return res.rows[0] as Playlist
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to fetch playlist with songs', err, { id })
    throw new Error(`Failed to fetch playlist with songs: ${err.message}`)
  }
}

/** One playlist row as the fast view consumes it: the song, plus the repertoire
 * entry that owner context holds for it. */
export interface PlaylistEntrySummary {
  repertoireId: string
  songId: string
  title: string
  artist: string | null
}

/**
 * A playlist's name plus its songs resolved against one owner context's
 * repertoire, ordered by position — what the fast view needs to walk a setlist.
 *
 * Both ids are client-supplied, so both are authorized here: the playlist must
 * be one the caller may read, and the owner context it is read under must be a
 * band they belong to. The playlist check runs first, so an unrelated caller
 * learns nothing about the band. The name read below is unscoped and is only
 * safe because of it.
 */
export async function getPlaylistDetailsWithEntries(
  playlistId: string,
  userId: string,
  bandId?: string | null,
): Promise<{ name: string; entries: PlaylistEntrySummary[] }> {
  await assertPlaylistAccess(playlistId, userId)
  if (bandId) await assertBandMember(bandId, userId)

  const sql = `
    SELECT ps.position, r.id AS repertoire_id, ps.song_id, s.title, s.artist
    FROM playlist_songs ps
    JOIN global_songs s ON s.id = ps.song_id
    JOIN repertoire r ON r.song_id = ps.song_id
      AND (
        ($1::uuid IS NOT NULL AND r.band_id = $1::uuid)
        OR
        ($1::uuid IS NULL AND r.user_id = $2::uuid)
      )
    WHERE ps.playlist_id = $3
    ORDER BY ps.position ASC
  `
  try {
    const playlistRes = await query('SELECT name FROM playlists WHERE id = $1', [playlistId])
    const name = (playlistRes.rows[0]?.name as string) ?? 'Playlist'

    const res = await query(sql, [bandId ?? null, userId, playlistId])
    const entries = res.rows.map((row) => ({
      repertoireId: row.repertoire_id as string,
      songId: row.song_id as string,
      title: row.title as string,
      artist: row.artist as string | null,
    }))

    return { name, entries }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to fetch playlist details', err, { playlistId })
    throw new Error(`Failed to fetch playlist details: ${err.message}`)
  }
}

import { query } from '@/lib/db'
import { logger } from '@/lib/logger'
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

export async function updatePlaylist(
  id: string,
  data: {
    name?: string
    description?: string
    sync_with_spotify?: boolean
    tags?: string[]
  }
): Promise<void> {
  try {
    // Dynamically build the update query to avoid overwriting omitted fields
    const setClauses: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const values: any[] = []
    let paramIndex = 1

    if (data.name !== undefined) {
      setClauses.push(`name = $${paramIndex++}`)
      values.push(data.name)
    }
    if (data.description !== undefined) {
      setClauses.push(`description = $${paramIndex++}`)
      values.push(data.description)
    }
    if (data.sync_with_spotify !== undefined) {
      setClauses.push(`sync_with_spotify = $${paramIndex++}`)
      values.push(data.sync_with_spotify)
    }
    if (data.tags !== undefined) {
      setClauses.push(`tags = $${paramIndex++}`)
      values.push(data.tags)
    }

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

export async function deletePlaylist(id: string): Promise<void> {
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

export async function addSongToPlaylist(userId: string, playlistId: string, songId: string): Promise<void> {
  try {
    // 1. Fetch playlist context
    const playlistRes = await query('SELECT user_id, band_id FROM playlists WHERE id = $1', [playlistId])
    if (playlistRes.rowCount === 0) throw new Error('Playlist not found')
    const playlist = playlistRes.rows[0]

    // 2. Ensure song exists in the appropriate repertoire
    if (playlist.band_id) {
      // Band Playlist: Ensure in band repertoire
      const bandRep = await query('SELECT id FROM repertoire WHERE band_id = $1 AND song_id = $2', [playlist.band_id, songId])
      if (bandRep.rowCount === 0) {
        await query('INSERT INTO repertoire (band_id, song_id, status) VALUES ($1, $2, \'unknown\')', [playlist.band_id, songId])
      }

      // Ensure in current user repertoire
      const userRep = await query('SELECT id FROM repertoire WHERE user_id = $1 AND song_id = $2', [userId, songId])
      if (userRep.rowCount === 0) {
        await query('INSERT INTO repertoire (user_id, song_id, status) VALUES ($1, $2, \'unknown\')', [userId, songId])
      }
    } else if (playlist.user_id) {
      // Personal Playlist: Ensure in personal repertoire
      const userRep = await query('SELECT id FROM repertoire WHERE user_id = $1 AND song_id = $2', [playlist.user_id, songId])
      if (userRep.rowCount === 0) {
        await query('INSERT INTO repertoire (user_id, song_id, status) VALUES ($1, $2, \'unknown\')', [playlist.user_id, songId])
      }
    }

    // 3. Count existing songs for position
    const countRes = await query('SELECT COUNT(*) as count FROM playlist_songs WHERE playlist_id = $1', [playlistId])
    const count = Number(countRes.rows[0].count)
    const position = count + 1

    // 4. Insert into playlist_songs
    await query('INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES ($1, $2, $3)', [playlistId, songId, position])
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to add song to playlist', err, { playlistId, songId })
    throw new Error(`Failed to add song to playlist: ${err.message}`)
  }
}

export async function removeSongFromPlaylist(playlistId: string, songId: string): Promise<void> {
  const sql = `DELETE FROM playlist_songs WHERE playlist_id = $1 AND song_id = $2`
  try {
    await query(sql, [playlistId, songId])
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to remove song from playlist', err, { playlistId, songId })
    throw new Error(`Failed to remove song from playlist: ${err.message}`)
  }
}

export async function getPlaylistWithSongs(id: string): Promise<Playlist | null> {
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
  `
  try {
    const res = await query(sql, [id])
    if (res.rowCount === 0) return null
    return res.rows[0] as Playlist
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to fetch playlist with songs', err, { id })
    throw new Error(`Failed to fetch playlist with songs: ${err.message}`)
  }
}

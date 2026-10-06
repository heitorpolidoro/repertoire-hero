import { assertBandAdmin, assertBandMember } from '@/lib/bands'
import { query, withTransaction } from '@/lib/db'
import type { PlaylistAccessRow, PlaylistEntryRow } from '@/lib/dbRows'
import { logger } from '@/lib/logger'
import { buildUpdateSet } from '@/lib/sqlUpdate'
import { ensureSongHasVersion, representativeVersionOrder, representativeVersionSubquery } from '@/lib/songVersions'
import type { Playlist } from '@/types/database'

export async function getUserPlaylists(userId: string): Promise<Playlist[]> {
  try {
    const bandIdsResult = await query<{ band_id: string }>('SELECT band_id FROM band_members WHERE user_id = $1', [userId])
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
                JOIN songs s ON ps.song_id = s.id
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
    const res = await query<Playlist>(sql, [userId, bandIds])
    return res.rows
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
    const res = await query<Playlist>(sql, [userId, data.name, data.description ?? null])
    return res.rows[0]
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
): Promise<PlaylistAccessRow> {
  const sql = `
    SELECT id, user_id, band_id
    FROM playlists
    WHERE id = $1
      AND (user_id = $2 OR band_id IN (SELECT band_id FROM band_members WHERE user_id = $2))
  `
  let res
  try {
    res = await query<PlaylistAccessRow>(sql, [playlistId, userId])
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to authorize playlist access', err, { playlistId })
    throw new Error(`Failed to authorize playlist access: ${err.message}`)
  }

  if (res.rowCount === 0) throw new Error('Access denied: not allowed on this playlist')
  return res.rows[0]
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

    const res = await query<never>(sql, values)
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
    const res = await query<never>(sql, [id])
    if (res.rowCount === 0) throw new Error('Playlist not found')
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to delete playlist', err, { id })
    throw new Error(`Failed to delete playlist: ${err.message}`)
  }
}

/**
 * Seeds one owner's hold on the representative version of `songId`. The
 * duplicate goes through the bare `ON CONFLICT DO NOTHING`, never a caught
 * 23505, which inside a transaction leaves it aborted (AGENTS.md).
 */
function seedOwnerSongSql(table: 'user_songs' | 'band_songs', column: 'user_id' | 'band_id'): string {
  return `INSERT INTO ${table} (${column}, version_id, status)
          SELECT $1, ${representativeVersionSubquery('$2')}, 'unknown'
          ON CONFLICT DO NOTHING`
}

/**
 * Adds a catalog song to a playlist, and to the repertoire it belongs to.
 *
 * **A band playlist requires band admin** (RH-124): adding through a playlist
 * is adding (docs/use-cases.md, *Writing a band's rows*). The role check is at
 * this call site, in the shape RH-103 uses for reordering and with the same
 * message, **before** the transaction and outside the wrapping `try` so the
 * text reaches the UI verbatim (L1a). `assertPlaylistAccess` is left alone: it
 * is also the Spotify read guard, which is member-level.
 *
 * **The dual write stays**, as a decision and not an oversight: the band branch
 * also writes the caller's own `user_songs` row — wrong under *Add a song to a
 * playlist*, and deleting it is RH-126's whole deliverable.
 */
export async function addSongToPlaylist(playlistId: string, userId: string, songId: string): Promise<void> {
  // 1. Fetch playlist context — and refuse a playlist the caller cannot write to.
  const playlist = await assertPlaylistAccess(playlistId, userId)
  if (playlist.band_id) await assertBandAdmin(playlist.band_id, userId)

  try {
    // 2. One transaction: the song must not end up in a repertoire without
    //    landing in the playlist.
    await withTransaction(async (client) => {
      await ensureSongHasVersion(songId, client)
      if (playlist.band_id) {
        // Band playlist: the band's repertoire and — until RH-126 — the
        // caller's own.
        await client.query<never>(seedOwnerSongSql('band_songs', 'band_id'), [playlist.band_id, songId])
        await client.query<never>(seedOwnerSongSql('user_songs', 'user_id'), [userId, songId])
      } else if (playlist.user_id) {
        await client.query<never>(seedOwnerSongSql('user_songs', 'user_id'), [playlist.user_id, songId])
      }

      // 3. Position is computed in the insert itself. MAX + 1 (not COUNT + 1)
      //    tolerates the gaps `removeSongFromPlaylist` leaves, and
      //    `uq_playlist_song_position` serialises two concurrent adds: the
      //    loser fails with 23505 rather than writing a duplicate position.
      await client.query<never>(
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
    await query<never>(sql, [playlistId, songId])
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to remove song from playlist', err, { playlistId, songId })
    throw new Error(`Failed to remove song from playlist: ${err.message}`)
  }
}

/**
 * RH-103 — rewrites every `position` of a playlist to 1..n in the order the
 * caller submitted, where `orderedIds` are `playlist_songs.id`s.
 *
 * Authorization comes first and sits **outside** the wrapping `try`, so its
 * text reaches the UI verbatim (convention L1a): `assertPlaylistAccess` as
 * every other playlist write does, plus — for a band-owned playlist —
 * `assertBandAdmin`, because the use case makes reordering a band setlist an
 * admin act. `assertPlaylistAccess` itself is left alone: it is also the
 * Spotify route guard, and tightening it would change read answers too.
 *
 * The submitted list must be **exactly** the playlist's current row set: no
 * missing id, no extra, no duplicate and no row from another playlist. A subset
 * would renumber part of the list into positions other rows still hold, which
 * the constraint would reject at a confusing distance from the mistake. Check
 * and write therefore share one `withTransaction`, so they agree on the same
 * rows; the deferrable constraint itself needs no transaction.
 *
 * The renumber is **one** statement, scoped by `playlist_id`, and there is no
 * `SET CONSTRAINTS` anywhere: `uq_playlist_song_position` is
 * `DEFERRABLE INITIALLY IMMEDIATE` since
 * `migrations/0012_defer_playlist_song_position.sql`, which moves the
 * uniqueness check to the end of the statement — exactly where a permutation
 * is valid again. `unnest(...) WITH ORDINALITY` keeps the placeholder count at
 * two however long the playlist is.
 */
export async function reorderPlaylistSongs(
  playlistId: string,
  userId: string,
  orderedIds: string[],
): Promise<void> {
  const playlist = await assertPlaylistAccess(playlistId, userId)
  if (playlist.band_id) await assertBandAdmin(playlist.band_id, userId)

  try {
    await withTransaction(async (client) => {
      const current = await client.query<{ id: string }>(
        'SELECT id FROM playlist_songs WHERE playlist_id = $1',
        [playlistId],
      )
      const known = new Set(current.rows.map((row) => row.id))
      const submitted = new Set(orderedIds)
      if (
        submitted.size !== orderedIds.length ||
        submitted.size !== known.size ||
        orderedIds.some((id) => !known.has(id))
      ) {
        throw new Error(
          `the submitted order is not this playlist's row set ` +
            `(${orderedIds.length} ids for ${known.size} rows)`,
        )
      }

      await client.query<never>(
        `UPDATE playlist_songs ps
         SET position = ordered.ordinality::int
         FROM unnest($2::uuid[]) WITH ORDINALITY AS ordered(id, ordinality)
         WHERE ps.id = ordered.id AND ps.playlist_id = $1`,
        [playlistId, orderedIds],
      )
    })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to reorder playlist songs', err, { playlistId })
    throw new Error(`Failed to reorder playlist songs: ${err.message}`)
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
              JOIN songs s ON ps.song_id = s.id
              WHERE ps.playlist_id = p.id
             ), '[]'::json) as songs
    FROM playlists p
    WHERE p.id = $1
      AND (p.user_id = $2 OR p.band_id IN (SELECT band_id FROM band_members WHERE user_id = $2))
  `
  try {
    // Access-scoped: an unrelated caller gets null, the same as for an id that
    // does not exist — the UI already routes that to "playlist not found".
    const res = await query<Playlist>(sql, [id, userId])
    if (res.rowCount === 0) return null
    return res.rows[0]
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

  // `playlist_songs` is still song-keyed (RH-125 gives it a `version_id`), so
  // the owner's row comes from a lateral applying the shared
  // representative-version ordering to the rows that owner **actually holds** —
  // one row per song, as the setlist expects. `LEFT JOIN albums` is not
  // optional: `album_id` is nullable, and an inner join would drop every
  // album-less version.
  const table = bandId ? 'band_songs' : 'user_songs'
  const ownerColumn = bandId ? 'band_id' : 'user_id'
  const sql = `
    SELECT ps.position, r.id AS repertoire_id, ps.song_id, s.title, s.artist
    FROM playlist_songs ps
    JOIN songs s ON s.id = ps.song_id
    JOIN LATERAL (
      SELECT o.id FROM ${table} o
      JOIN song_versions ov ON ov.id = o.version_id
      LEFT JOIN albums oa ON oa.id = ov.album_id
      WHERE ov.song_id = ps.song_id AND o.${ownerColumn} = $1
      ORDER BY ${representativeVersionOrder('ov', 'oa')} LIMIT 1
    ) r ON true
    WHERE ps.playlist_id = $2
    ORDER BY ps.position ASC
  `
  try {
    const playlistRes = await query<{ name: string }>('SELECT name FROM playlists WHERE id = $1', [playlistId])
    const name = playlistRes.rows[0]?.name ?? 'Playlist'

    const res = await query<PlaylistEntryRow>(sql, [bandId ?? userId, playlistId])
    const entries = res.rows.map((row) => ({
      repertoireId: row.repertoire_id,
      songId: row.song_id,
      title: row.title,
      artist: row.artist,
    }))

    return { name, entries }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to fetch playlist details', err, { playlistId })
    throw new Error(`Failed to fetch playlist details: ${err.message}`)
  }
}

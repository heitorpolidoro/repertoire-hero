import { assertBandAdmin, assertBandMember } from '@/lib/bands'
import { query, withTransaction } from '@/lib/db'
import type { PlaylistAccessRow, PlaylistEntryRow } from '@/lib/dbRows'
import { logger } from '@/lib/logger'
import {
  PLAYLIST_CARD_ENTRIES_JSON,
  PLAYLIST_DETAIL_ENTRIES_JSON,
  playlistEntriesSql,
} from '@/lib/playlistSql'
import { buildUpdateSet } from '@/lib/sqlUpdate'
import type { Playlist } from '@/types/database'

export async function getUserPlaylists(userId: string): Promise<Playlist[]> {
  try {
    const bandIdsResult = await query<{ band_id: string }>('SELECT band_id FROM band_members WHERE user_id = $1', [userId])
    const bandIds = bandIdsResult.rows.map((m) => m.band_id)

    // Personal playlists + playlists of every band the user is a member of
    const sql = `
      SELECT p.*,
             ${PLAYLIST_CARD_ENTRIES_JSON} as songs,
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
 * Seeds one owner's hold on the version `$2`. The duplicate goes through the
 * bare `ON CONFLICT DO NOTHING`, never a caught 23505, which inside a
 * transaction leaves it aborted (AGENTS.md). This clause is on the **owner**
 * table; no `playlist_songs` insert carries one (see
 * {@link addSongToPlaylist} step 3).
 *
 * RH-125 deleted the representative-version pick that used to sit here: the
 * caller now supplies the version, so there is nothing left to choose.
 */
function seedOwnerSongSql(table: 'user_songs' | 'band_songs', column: 'user_id' | 'band_id'): string {
  return `INSERT INTO ${table} (${column}, version_id, status)
          VALUES ($1, $2, 'unknown')
          ON CONFLICT DO NOTHING`
}

/**
 * Adds one **version** of a song to a playlist, and to the repertoire the
 * playlist belongs to (RH-125). Two takes of one song are two entries, which is
 * what `uq_playlist_song_version (playlist_id, version_id)` allows and the old
 * `(playlist_id, song_id)` unique refused.
 *
 * **A band playlist requires band admin** (RH-124): adding through a playlist
 * is adding (docs/use-cases.md, *Writing a band's rows*). The role check is at
 * this call site, in the shape RH-103 uses for reordering and with the same
 * message, **before** the transaction and outside the wrapping `try` so the
 * text reaches the UI verbatim (L1a). `assertPlaylistAccess` is left alone: it
 * is also the Spotify read guard, which is member-level.
 *
 * **One write reaches exactly one owner** (RH-126): the band branch writes the
 * band's row and the personal branch the owner's, never both. It used to add
 * the acting admin's own row too — a band act putting a song in a personal
 * repertoire; gone. Only the three exceptions in `docs/use-cases.md`, *What
 * creates a personal row in band context*, put a personal row there.
 */
export async function addSongToPlaylist(playlistId: string, userId: string, versionId: string): Promise<void> {
  // 1. Fetch playlist context — and refuse a playlist the caller cannot write to.
  const playlist = await assertPlaylistAccess(playlistId, userId)
  if (playlist.band_id) await assertBandAdmin(playlist.band_id, userId)

  try {
    // 2. One transaction: the version must not end up in a repertoire without
    //    landing in the playlist.
    await withTransaction(async (client) => {
      if (playlist.band_id) {
        // Band playlist: the band's repertoire, and only the band's.
        await client.query<never>(seedOwnerSongSql('band_songs', 'band_id'), [playlist.band_id, versionId])
      } else if (playlist.user_id) {
        await client.query<never>(seedOwnerSongSql('user_songs', 'user_id'), [playlist.user_id, versionId])
      }

      // 3. Position is computed in the insert itself. MAX + 1 (not COUNT + 1)
      //    tolerates the gaps `removeSongFromPlaylist` leaves, and
      //    `uq_playlist_song_position` serialises two concurrent adds: the
      //    loser fails with 23505 rather than writing a duplicate position.
      //
      //    **No `ON CONFLICT` clause, deliberately**: the insert is positional,
      //    so an arbiter that skipped a duplicate version would leave a gap
      //    behind the skipped row and a duplicate add would stop raising.
      await client.query<never>(
        `INSERT INTO playlist_songs (playlist_id, version_id, position)
         SELECT $1, $2, COALESCE(MAX(position), 0) + 1 FROM playlist_songs WHERE playlist_id = $1`,
        [playlistId, versionId],
      )
    })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to add song to playlist', err, { playlistId, versionId })
    throw new Error(`Failed to add song to playlist: ${err.message}`)
  }
}

export async function removeSongFromPlaylist(playlistId: string, userId: string, versionId: string): Promise<void> {
  await assertPlaylistAccess(playlistId, userId)

  const sql = `DELETE FROM playlist_songs WHERE playlist_id = $1 AND version_id = $2`
  try {
    await query<never>(sql, [playlistId, versionId])
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to remove song from playlist', err, { playlistId, versionId })
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
    SELECT p.*, ${PLAYLIST_DETAIL_ENTRIES_JSON} as songs
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

/**
 * One playlist entry as the fast view consumes it: the **version** it names,
 * plus the repertoire row that owner context holds for it — if it holds one.
 *
 * `versionId` is the entry's identity and is always non-null. `repertoireId` is
 * nullable (RH-125): an owner holding no row is information, not an error, and
 * the entry is returned either way. It stays on the entry because Fast View is
 * still addressed by the owner row's id — re-addressing it by version is
 * RH-109 — so an entry with a null one has no Fast View address yet and is
 * rendered non-interactive.
 */
export interface PlaylistEntrySummary {
  repertoireId: string | null
  versionId: string
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

  // RH-125 deleted the `LEFT JOIN LATERAL` version pick that stood here while
  // `playlist_songs` was song-keyed: the entry names the version itself now, so
  // the owner's row is a plain `LEFT JOIN` on that table's own unique key. The
  // join is `LEFT` on purpose — an entry whose owner holds no row comes back
  // with `repertoireId: null` rather than being dropped, and dropping it used
  // to collapse the whole setlist (`computePlaylistNav` answers `null` when the
  // current song is not in the list).
  const sql = bandId
    ? playlistEntriesSql('band_songs', 'band_id')
    : playlistEntriesSql('user_songs', 'user_id')
  try {
    const playlistRes = await query<{ name: string }>('SELECT name FROM playlists WHERE id = $1', [playlistId])
    const name = playlistRes.rows[0]?.name ?? 'Playlist'

    const res = await query<PlaylistEntryRow>(sql, [bandId ?? userId, playlistId])
    const entries = res.rows.map((row) => ({
      repertoireId: row.repertoire_id,
      versionId: row.version_id,
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

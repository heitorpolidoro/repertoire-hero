import { query } from '@/lib/db'
import { logger } from '@/lib/logger'
import type { GlobalSong, Repertoire, SongLink, SongStatus } from '@/types/database'

export type RepertoireOwner = { userId: string } | { bandId: string }

export async function getRepertoire(owner: RepertoireOwner): Promise<Repertoire[]> {
  const isBand = 'bandId' in owner
  const id = isBand ? owner.bandId : owner.userId
  const sql = `
    SELECT r.*,
           json_build_object(
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
           ) as song
    FROM repertoire r
    JOIN global_songs s ON r.song_id = s.id
    WHERE ${isBand ? 'r.band_id = $1' : 'r.user_id = $1'}
    ORDER BY r.id DESC
  `
  try {
    const res = await query(sql, [id])
    return res.rows as Repertoire[]
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to fetch repertoire', err)
    throw new Error(`Failed to fetch repertoire: ${err.message}`)
  }
}

export async function addSongToRepertoire(owner: RepertoireOwner, songId: string): Promise<Repertoire> {
  const isBand = 'bandId' in owner
  const userId = isBand ? null : owner.userId
  const bandId = isBand ? owner.bandId : null
  const sql = `
    WITH inserted AS (
      INSERT INTO repertoire (song_id, user_id, band_id, status)
      VALUES ($1, $2, $3, 'unknown')
      RETURNING *
    )
    SELECT i.*,
           json_build_object(
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
           ) as song
    FROM inserted i
    JOIN global_songs s ON i.song_id = s.id
  `
  try {
    const res = await query(sql, [songId, userId, bandId])
    return res.rows[0] as Repertoire
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to add song to repertoire', err)
    throw new Error(`Failed to add song to repertoire: ${err.message}`)
  }
}

export async function updateSongStatus(owner: RepertoireOwner, repertoireId: string, status: SongStatus): Promise<void> {
  const isBand = 'bandId' in owner
  const id = isBand ? owner.bandId : owner.userId
  const sql = `
    UPDATE repertoire
    SET status = $1
    WHERE id = $2 AND ${isBand ? 'band_id = $3' : 'user_id = $3'}
    RETURNING id
  `
  try {
    const res = await query(sql, [status, repertoireId, id])
    if (res.rowCount === 0) throw new Error('Repertoire entry not found or access denied')
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to update song status', err, { repertoireId, status })
    throw new Error(`Failed to update song status: ${err.message}`)
  }
}

export async function updateSongTags(owner: RepertoireOwner, repertoireId: string, tags: string[]): Promise<void> {
  const isBand = 'bandId' in owner
  const id = isBand ? owner.bandId : owner.userId
  const sql = `
    UPDATE repertoire
    SET tags = $1
    WHERE id = $2 AND ${isBand ? 'band_id = $3' : 'user_id = $3'}
    RETURNING id
  `
  try {
    const res = await query(sql, [tags, repertoireId, id])
    if (res.rowCount === 0) throw new Error('Repertoire entry not found or access denied')
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to update song tags', err, { repertoireId })
    throw new Error(`Failed to update song tags: ${err.message}`)
  }
}

export async function updatePersonalKey(owner: RepertoireOwner, repertoireId: string, personalKey: string): Promise<void> {
  const isBand = 'bandId' in owner
  const id = isBand ? owner.bandId : owner.userId
  const sql = `
    UPDATE repertoire
    SET personal_key = $1
    WHERE id = $2 AND ${isBand ? 'band_id = $3' : 'user_id = $3'}
    RETURNING id
  `
  try {
    const res = await query(sql, [personalKey, repertoireId, id])
    if (res.rowCount === 0) throw new Error('Repertoire entry not found or access denied')
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to update personal key', err, { repertoireId })
    throw new Error(`Failed to update personal key: ${err.message}`)
  }
}

export async function removeSongFromRepertoire(owner: RepertoireOwner, repertoireId: string): Promise<void> {
  const isBand = 'bandId' in owner
  const id = isBand ? owner.bandId : owner.userId
  const sql = `
    DELETE FROM repertoire
    WHERE id = $1 AND ${isBand ? 'band_id = $2' : 'user_id = $2'}
    RETURNING id
  `
  try {
    const res = await query(sql, [repertoireId, id])
    if (res.rowCount === 0) throw new Error('Repertoire entry not found or access denied')
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to remove song from repertoire', err, { repertoireId })
    throw new Error(`Failed to remove song from repertoire: ${err.message}`)
  }
}

export async function searchGlobalSongs(queryStr: string): Promise<GlobalSong[]> {
  const trimmed = queryStr.trim()
  if (!trimmed) return []
  const sql = `
    SELECT * FROM global_songs
    WHERE title ILIKE $1 OR artist ILIKE $1
    ORDER BY title ASC
    LIMIT 20
  `
  try {
    const res = await query(sql, [`%${trimmed}%`])
    return res.rows as GlobalSong[]
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to search global songs', err, { query: trimmed })
    throw new Error(`Failed to search global songs: ${err.message}`)
  }
}

export async function getSongEntry(owner: RepertoireOwner, repertoireId: string): Promise<Repertoire | null> {
  const isBand = 'bandId' in owner
  const id = isBand ? owner.bandId : owner.userId
  const sql = `
    SELECT r.*,
           json_build_object(
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
           ) as song
    FROM repertoire r
    JOIN global_songs s ON r.song_id = s.id
    WHERE r.id = $1 AND ${isBand ? 'r.band_id = $2' : 'r.user_id = $2'}
  `
  try {
    const res = await query(sql, [repertoireId, id])
    if (res.rowCount === 0) return null
    return res.rows[0] as Repertoire
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to fetch song entry', err, { repertoireId })
    throw new Error(`Failed to fetch song entry: ${err.message}`)
  }
}

export async function updateSong(
  owner: RepertoireOwner,
  entry: Repertoire,
  data: {
    title: string
    artist: string
    album?: string | null
    key: string | null
    status: SongStatus
    tags: string[]
    links: SongLink[]
    cover_url?: string | null
    duration_seconds?: number | null
  }
): Promise<void> {
  const isBand = 'bandId' in owner
  const ownerId = isBand ? owner.bandId : owner.userId

  try {
    await query('BEGIN')

    const songSql = `
      UPDATE global_songs
      SET title = $1,
          artist = $2,
          album = $3,
          standard_key = $4,
          cover_url = $5,
          duration_seconds = $6,
          links = $7
      WHERE id = $8
    `
    await query(songSql, [
      data.title,
      data.artist,
      data.album ?? null,
      data.key,
      data.cover_url ?? null,
      data.duration_seconds ?? null,
      JSON.stringify(data.links),
      entry.song_id,
    ])

    const repSql = `
      UPDATE repertoire
      SET status = $1,
          tags = $2,
          personal_key = $3
      WHERE id = $4 AND ${isBand ? 'band_id = $5' : 'user_id = $5'}
    `
    await query(repSql, [
      data.status,
      data.tags,
      data.key,
      entry.id,
      ownerId,
    ])

    await query('COMMIT')
  } catch (error) {
    await query('ROLLBACK')
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to update song', err, { songId: entry.song_id })
    throw new Error(`Failed to update song: ${err.message}`)
  }
}

export async function createAndAddSong(
  owner: RepertoireOwner,
  data: {
    title: string
    artist: string
    album?: string
    standard_key?: string
    cover_url?: string
    duration_seconds?: number
    links?: SongLink[]
  }
): Promise<Repertoire> {
  const isBand = 'bandId' in owner
  const ownerId = isBand ? owner.bandId : owner.userId
  const albumValue = data.album?.trim() ?? ''

  try {
    let songId: string

    // Lookup song
    let lookupSql = 'SELECT id FROM global_songs WHERE LOWER(title) = LOWER($1)'
    const lookupParams = [data.title.trim()]
    if (albumValue) {
      lookupSql += ' AND LOWER(album) = LOWER($2)'
      lookupParams.push(albumValue)
    } else {
      lookupSql += ' AND (album IS NULL OR album = \'\')'
    }
    lookupSql += ' LIMIT 1'

    const lookupRes = await query(lookupSql, lookupParams)

    if (lookupRes.rowCount && lookupRes.rowCount > 0) {
      songId = lookupRes.rows[0].id
    } else {
      // Insert song
      const contributorId = isBand ? null : owner.userId
      const insertSongSql = `
        INSERT INTO global_songs (contributor_id, title, artist, album, standard_key, cover_url, duration_seconds, links)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `
      const insertRes = await query(insertSongSql, [
        contributorId,
        data.title,
        data.artist,
        albumValue || null,
        data.standard_key ?? null,
        data.cover_url ?? null,
        data.duration_seconds ?? null,
        JSON.stringify(data.links ?? []),
      ])
      songId = insertRes.rows[0].id
    }

    // Check if already in repertoire
    const checkSql = `
      SELECT id FROM repertoire
      WHERE song_id = $1 AND ${isBand ? 'band_id = $2' : 'user_id = $2'}
      LIMIT 1
    `
    const checkRes = await query(checkSql, [songId, ownerId])
    if (checkRes.rowCount && checkRes.rowCount > 0) {
      throw new Error('Song already in your repertoire')
    }

    // Insert into repertoire
    const userId = isBand ? null : owner.userId
    const bandId = isBand ? owner.bandId : null
    const insertRepSql = `
      WITH inserted AS (
        INSERT INTO repertoire (song_id, user_id, band_id, status)
        VALUES ($1, $2, $3, 'unknown')
        RETURNING *
      )
      SELECT i.*,
             json_build_object(
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
             ) as song
      FROM inserted i
      JOIN global_songs s ON i.song_id = s.id
    `
    const repRes = await query(insertRepSql, [songId, userId, bandId])
    return repRes.rows[0] as Repertoire
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to create and add song', err)
    throw new Error(err.message.includes('already in') ? err.message : `Failed to create and add song: ${err.message}`)
  }
}

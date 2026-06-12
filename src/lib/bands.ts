import { query } from "@/lib/db"
import { logger } from "@/lib/logger"
import type { Band, BandMember, Playlist } from "@/types/database"

export const getBands = async (userId: string): Promise<Band[]> => {
  const sql = `
    SELECT b.*,
           COALESCE(
             (SELECT json_agg(json_build_object('user_id', bm.user_id))
              FROM band_members bm
              WHERE bm.band_id = b.id
             ), '[]'::json) as members
    FROM bands b
    WHERE EXISTS (
      SELECT 1 FROM band_members bm2 WHERE bm2.band_id = b.id AND bm2.user_id = $1
    )
    ORDER BY b.created_at DESC
  `
  try {
    const res = await query(sql, [userId])
    return res.rows as Band[]
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error("Failed to fetch bands", err)
    throw new Error(`Failed to fetch bands: ${err.message}`)
  }
}

export const getBandWithMembers = async (
  bandId: string,
): Promise<Band | null> => {
  const sql = `
    SELECT b.*,
           COALESCE(
             (SELECT json_agg(json_build_object(
               'id', bm.id,
               'band_id', bm.band_id,
               'user_id', bm.user_id,
               'role', bm.role,
               'joined_at', bm.joined_at,
               'profile', json_build_object(
                 'id', p.id,
                 'full_name', p.full_name,
                 'avatar_url', p.avatar_url,
                 'email', p.email,
                 'primary_instrument', p.primary_instrument
               )
             ))
              FROM band_members bm
              JOIN profiles p ON bm.user_id = p.id
              WHERE bm.band_id = b.id
             ), '[]'::json) as members
    FROM bands b
    WHERE b.id = $1
  `
  try {
    const res = await query(sql, [bandId])
    if (res.rowCount === 0) return null
    return res.rows[0] as Band
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error("Failed to fetch band", err)
    throw new Error(`Failed to fetch band: ${err.message}`)
  }
}

export const createBand = async (
  userId: string,
  name: string,
  description?: string | null,
  coverUrl?: string | null,
): Promise<string> => {
  try {
    const res = await query('SELECT create_band($1, $2, $3, $4) as band_id', [
      name,
      description ?? null,
      coverUrl ?? null,
      userId,
    ])
    return res.rows[0].band_id as string
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error("Failed to create band", err)
    throw new Error(`Failed to create band: ${err.message}`)
  }
}

export const updateBand = async (
  bandId: string,
  data: {
    name?: string;
    description?: string | null;
    cover_url?: string | null;
  },
): Promise<void> => {
  try {
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
    if (data.cover_url !== undefined) {
      setClauses.push(`cover_url = $${paramIndex++}`)
      values.push(data.cover_url)
    }

    setClauses.push(`updated_at = now()`)

    const sql = `
      UPDATE bands
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
    `
    values.push(bandId)

    const res = await query(sql, values)
    if (res.rowCount === 0) throw new Error('Band not found')
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error("Failed to update band", err)
    throw new Error(`Failed to update band: ${err.message}`)
  }
}

export const deleteBand = async (bandId: string): Promise<void> => {
  const sql = `DELETE FROM bands WHERE id = $1`
  try {
    const res = await query(sql, [bandId])
    if (res.rowCount === 0) throw new Error('Band not found')
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error("Failed to delete band", err)
    throw new Error(`Failed to delete band: ${err.message}`)
  }
}

export const leaveBand = async (
  bandId: string,
  userId: string,
): Promise<void> => {
  const sql = `DELETE FROM band_members WHERE band_id = $1 AND user_id = $2`
  try {
    await query(sql, [bandId, userId])
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error("Failed to leave band", err)
    throw new Error(`Failed to leave band: ${err.message}`)
  }
}

export const removeBandMember = async (memberId: string): Promise<void> => {
  const sql = `DELETE FROM band_members WHERE id = $1`
  try {
    await query(sql, [memberId])
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error("Failed to remove band member", err)
    throw new Error(`Failed to remove band member: ${err.message}`)
  }
}

export const getBandPlaylists = async (bandId: string): Promise<Playlist[]> => {
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
             ), '[]'::json) as songs
    FROM playlists p
    WHERE p.band_id = $1
    ORDER BY p.created_at DESC
  `
  try {
    const res = await query(sql, [bandId])
    return res.rows as Playlist[]
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error("Failed to fetch band playlists", err)
    throw new Error(`Failed to fetch band playlists: ${err.message}`)
  }
}

export const createBandPlaylist = async (
  bandId: string,
  name: string,
): Promise<string> => {
  const sql = `
    INSERT INTO playlists (name, band_id, sync_with_spotify)
    VALUES ($1, $2, false)
    RETURNING id
  `
  try {
    const res = await query(sql, [name, bandId])
    return res.rows[0].id as string
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error("Failed to create band playlist", err)
    throw new Error(`Failed to create band playlist: ${err.message}`)
  }
}

export const joinBandByInviteClient = async (
  userId: string,
  inviteCode: string,
): Promise<string | null> => {
  try {
    const res = await query('SELECT join_band_by_invite($1, $2) as band_id', [inviteCode, userId])
    return res.rows[0].band_id as string | null
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error("Failed to join band", err)
    throw new Error(`Failed to join band: ${err.message}`)
  }
}

export const getBandMembers = (band: Band): BandMember[] => {
  return (band.members ?? []) as BandMember[]
}

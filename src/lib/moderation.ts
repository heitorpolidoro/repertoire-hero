import { query } from '@/lib/db'
import { logger } from '@/lib/logger'
import { sanitizeSongTitle, sanitizeAlbumName } from '@/lib/songSanitizer'
import type { GlobalSongEdit } from '@/types/database'

export async function submitGlobalSongEdit(
  userId: string,
  songId: string,
  data: Record<string, unknown>
): Promise<GlobalSongEdit> {
  const sql = `
    INSERT INTO global_song_edits (song_id, requested_by, proposed_data, status)
    VALUES ($1, $2, $3, 'pending')
    RETURNING *
  `
  try {
    const res = await query(sql, [songId, userId, JSON.stringify(data)])
    return res.rows[0] as GlobalSongEdit
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to submit global song edit', err, { userId, songId })
    throw new Error(`Failed to submit global song edit: ${err.message}`)
  }
}

export async function checkSystemAdmin(userId: string): Promise<void> {
  const sql = 'SELECT is_system_admin FROM profiles WHERE id = $1'
  const res = await query(sql, [userId])
  if (res.rowCount === 0 || !res.rows[0]?.is_system_admin) {
    throw new Error('Access denied: User is not a system admin')
  }
}

export async function getPendingGlobalSongEdits(
  adminUserId: string
): Promise<GlobalSongEdit[]> {
  try {
    await checkSystemAdmin(adminUserId)

    const sql = `
      SELECT e.*,
             json_build_object(
               'id', s.id,
               'title', s.title,
               'artist', s.artist,
               'album', s.album,
               'standard_key', s.standard_key,
               'cover_url', s.cover_url,
               'duration_seconds', s.duration_seconds,
               'links', s.links,
               'created_at', s.created_at
             ) as song,
             json_build_object(
               'id', p.id,
               'email', p.email,
               'full_name', p.full_name,
               'avatar_url', p.avatar_url,
               'instruments', p.instruments,
               'primary_instrument', p.primary_instrument,
               'is_system_admin', p.is_system_admin
             ) as requester
      FROM global_song_edits e
      JOIN global_songs s ON e.song_id = s.id
      JOIN profiles p ON e.requested_by = p.id
      WHERE e.status = 'pending'
      ORDER BY e.created_at ASC
    `
    const res = await query(sql, [])
    return res.rows as GlobalSongEdit[]
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    if (err.message.startsWith('Access denied')) {
      throw err
    }
    logger.error('Failed to fetch pending global song edits', err, { adminUserId })
    throw new Error(`Failed to fetch pending global song edits: ${err.message}`)
  }
}

export async function reviewGlobalSongEdit(
  adminUserId: string,
  editId: string,
  action: 'approve' | 'reject',
  reason?: string
): Promise<GlobalSongEdit> {
  try {
    await checkSystemAdmin(adminUserId)

    const editRes = await query(
      'SELECT * FROM global_song_edits WHERE id = $1',
      [editId]
    )

    if (editRes.rowCount === 0) {
      throw new Error('Global song edit not found')
    }

    const edit = editRes.rows[0] as GlobalSongEdit

    if (edit.status !== 'pending') {
      throw new Error('Edit request is already reviewed')
    }

    if (action === 'reject') {
      const updateSql = `
        UPDATE global_song_edits
        SET status = 'rejected', reviewed_by = $1, rejection_reason = $2, updated_at = now()
        WHERE id = $3
        RETURNING *
      `
      const res = await query(updateSql, [adminUserId, reason || null, editId])
      return res.rows[0] as GlobalSongEdit
    }

    // Action: approve
    const proposed = edit.proposed_data as Record<string, unknown>
    const setClauses: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const values: any[] = []
    let paramIndex = 1

    if (typeof proposed.title === 'string') {
      setClauses.push(`title = $${paramIndex++}`)
      values.push(sanitizeSongTitle(proposed.title))
    }
    if (typeof proposed.artist === 'string') {
      setClauses.push(`artist = $${paramIndex++}`)
      values.push(proposed.artist.trim())
    }
    if (proposed.album !== undefined) {
      setClauses.push(`album = $${paramIndex++}`)
      values.push(
        typeof proposed.album === 'string'
          ? sanitizeAlbumName(proposed.album)
          : null
      )
    }
    if (proposed.standard_key !== undefined) {
      setClauses.push(`standard_key = $${paramIndex++}`)
      values.push(proposed.standard_key)
    }
    if (proposed.cover_url !== undefined) {
      setClauses.push(`cover_url = $${paramIndex++}`)
      values.push(proposed.cover_url)
    }
    if (proposed.duration_seconds !== undefined) {
      setClauses.push(`duration_seconds = $${paramIndex++}`)
      values.push(proposed.duration_seconds)
    }
    if (proposed.links !== undefined) {
      setClauses.push(`links = $${paramIndex++}`)
      values.push(
        typeof proposed.links === 'string'
          ? proposed.links
          : JSON.stringify(proposed.links)
      )
    }

    await query('BEGIN')
    try {
      if (setClauses.length > 0) {
        values.push(edit.song_id)
        const updateSongSql = `UPDATE global_songs SET ${setClauses.join(
          ', '
        )} WHERE id = $${paramIndex}`
        await query(updateSongSql, values)
      }

      const updateEditSql = `
        UPDATE global_song_edits
        SET status = 'approved', reviewed_by = $1, updated_at = now()
        WHERE id = $2
        RETURNING *
      `
      const res = await query(updateEditSql, [adminUserId, editId])
      await query('COMMIT')
      return res.rows[0] as GlobalSongEdit
    } catch (err) {
      await query('ROLLBACK')
      throw err
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    if (
      err.message.startsWith('Access denied') ||
      err.message === 'Global song edit not found' ||
      err.message === 'Edit request is already reviewed'
    ) {
      throw err
    }
    logger.error('Failed to review global song edit', err, {
      adminUserId,
      editId,
      action,
    })
    throw new Error(`Failed to review global song edit: ${err.message}`)
  }
}

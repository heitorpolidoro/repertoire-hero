import { query, withTransaction } from '@/lib/db'
import { parseGlobalSongEditPayload } from '@/lib/globalSongEditPayload'
import { logger } from '@/lib/logger'
import type { GlobalSongEdit, SongLink } from '@/types/database'

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
  // Outside the wrapper (convention L1a): the UI shows this message verbatim.
  // Validation only — `proposed_data` is stored verbatim so the moderation queue
  // keeps the requester's `reason` (see src/app/admin/moderation/page.tsx).
  parseGlobalSongEditPayload(data)
  try {
    const res = await query<GlobalSongEdit>(sql, [songId, userId, JSON.stringify(data)])
    return res.rows[0]
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
    const res = await query<GlobalSongEdit>(sql, [])
    return res.rows
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

    const editRes = await query<GlobalSongEdit>(
      'SELECT * FROM global_song_edits WHERE id = $1',
      [editId]
    )

    if (editRes.rowCount === 0) {
      throw new Error('Global song edit not found')
    }

    const edit = editRes.rows[0]

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
      const res = await query<GlobalSongEdit>(updateSql, [adminUserId, reason || null, editId])
      return res.rows[0]
    }

    // Action: approve. The row was written by whoever submitted it, so its
    // fields are narrowed before any of them reaches the catalog UPDATE.
    const payload = parseGlobalSongEditPayload(edit.proposed_data)
    // The payload only ever holds the seven `global_songs` column names, in
    // column order, so interpolating a key as a SQL identifier is safe here.
    const fields: Array<[string, string | number | null | SongLink[]]> = Object.entries(payload)
    const setClauses: string[] = []
    const values: (string | number | null)[] = []

    for (const [column, value] of fields) {
      setClauses.push(`${column} = $${values.length + 1}`)
      values.push(Array.isArray(value) ? JSON.stringify(value) : value)
    }

    // Applying the edit and marking it reviewed are one unit: a catalog rewrite
    // whose edit stays `pending` gets applied twice by the next admin.
    return await withTransaction(async (client) => {
      // The validator guarantees at least one proposed column, so the SET list
      // is never empty.
      values.push(edit.song_id)
      const updateSongSql = `UPDATE global_songs SET ${setClauses.join(
        ', '
      )} WHERE id = $${values.length}`
      await client.query(updateSongSql, values)

      const updateEditSql = `
        UPDATE global_song_edits
        SET status = 'approved', reviewed_by = $1, updated_at = now()
        WHERE id = $2
        RETURNING *
      `
      const res = await client.query(updateEditSql, [adminUserId, editId])
      return res.rows[0] as GlobalSongEdit
    })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    if (
      err.message.startsWith('Access denied') ||
      err.message.startsWith('Invalid global song edit') ||
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
